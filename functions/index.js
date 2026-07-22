const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
admin.initializeApp();

const OWNER = "mvinobaje@gmail.com";
const AI_MODEL = "claude-haiku-4-5";

// One Claude structured-output call; returns the parsed JSON object.
async function callClaude(key, system, user, schema, maxTokens) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: maxTokens || 1200,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { format: { type: "json_schema", schema } },
    }),
  });
  const j = await resp.json();
  if (!resp.ok) {
    const msg = (j.error && j.error.message) || "HTTP " + resp.status;
    throw new HttpsError(resp.status === 401 ? "failed-precondition" : "internal",
      resp.status === 401 ? "The saved API key was rejected — the owner should save a valid key." : msg);
  }
  let txt = "";
  (j.content || []).forEach((b) => { if (b.type === "text") txt += b.text; });
  return JSON.parse(txt);
}

// AI helper for the NNSCC 292 quote tracker. Modes:
//  {check:true}          → is a key saved?
//  {parse:true, text}    → read a pasted quote email into structured job/bid fields
//  {memo:true, stats}    → draft a cover memo to the board
//  {stats}               → (default) report narrative: summary + spendNote + openNote
// The Anthropic key lives in Firestore (nnsccQuoteTrackerConfig/main), unreadable by clients.
exports.nnsccTrackerAi = onCall(
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 120, maxInstances: 3 },
  async (request) => {
    const auth = request.auth;
    if (!auth || !auth.token || !auth.token.email || auth.token.email_verified !== true) {
      throw new HttpsError("unauthenticated", "Sign in with an authorized account.");
    }
    const email = auth.token.email.toLowerCase();

    const cfgSnap = await admin.firestore().doc("nnsccQuoteTrackerConfig/main").get();
    const cfg = cfgSnap.exists ? cfgSnap.data() : {};
    const editors = (cfg.editors || []).map((e) => String(e).toLowerCase());
    if (email !== OWNER && !editors.includes(email)) {
      throw new HttpsError("permission-denied", "This account is not an editor.");
    }
    // Key-status probe: tells editors whether a key exists, never the key itself.
    if (request.data && request.data.check === true) {
      return { keySet: !!cfg.anthropicKey };
    }

    const key = cfg.anthropicKey;
    if (!key) throw new HttpsError("failed-precondition", "No Anthropic API key has been saved yet.");

    // ----- mode: quote intake (parse a pasted quote email into fields) -----
    if (request.data && request.data.parse === true) {
      const text = String(request.data.text || "").slice(0, 20000);
      if (!text.trim()) throw new HttpsError("invalid-argument", "No quote text provided.");
      return await callClaude(key,
        "You extract structured data from contractor quotes sent to a condominium property manager. " +
        "Extract only what the text actually says; leave unknown fields empty/null. " +
        "amount_cad is the quoted price as a plain number (no currency symbols). " +
        "hst_included is true only if the text says tax/HST is included. " +
        "quote_date is ISO YYYY-MM-DD if a date is given or inferable, else empty. " +
        "high_priority is true only for urgent/safety/emergency work.",
        "Contractor quote text:\n\n" + text,
        {
          type: "object",
          properties: {
            job_description: { type: "string" },
            high_priority: { type: "boolean" },
            contractor: { type: "string" },
            quote_number: { type: "string" },
            amount_cad: { type: ["number", "null"] },
            hst_included: { type: "boolean" },
            scope_notes: { type: "string" },
            quote_date: { type: "string" },
          },
          required: ["job_description", "high_priority", "contractor", "quote_number",
                     "amount_cad", "hst_included", "scope_notes", "quote_date"],
          additionalProperties: false,
        }, 800);
    }

    // ----- shared stats validation for memo + narrative -----
    const stats = request.data && request.data.stats;
    if (!stats || JSON.stringify(stats).length > 200000) {
      throw new HttpsError("invalid-argument", "Bad stats payload.");
    }

    // ----- mode: board memo (cover note for the board package) -----
    if (request.data && request.data.memo === true) {
      const out = await callClaude(key,
        "You draft a short cover memo from a condominium superintendent/property manager to the Board of Directors, " +
        "accompanying a contractor-quote report. Professional, plain, warm-neutral tone. " +
        "Structure: subject line, one-paragraph overview with the key totals, a short bulleted list of items " +
        "needing a board decision, and a closing line inviting questions. Canadian dollars with $ and thousands " +
        "separators. Every figure must come from the data. 150-250 words. Plain text only (no markdown).",
        "Report data (all amounts include 13% HST):\n" + JSON.stringify(stats) +
        "\n\nDraft the memo now.",
        {
          type: "object",
          properties: { memo: { type: "string" } },
          required: ["memo"],
          additionalProperties: false,
        }, 900);
      return { memo: out.memo };
    }

    // ----- default mode: report narrative -----
    const out = await callClaude(key,
      "You write concise, professional narrative text for a condominium board of directors' " +
      "contractor-quote report. Plain, factual, board-appropriate tone; no hype, no first person. " +
      "Canadian dollars with $ and thousands separators. Refer to notable jobs by name. " +
      "All figures you cite must come from the data provided.",
      "Data for the report (all amounts include 13% HST):\n" + JSON.stringify(stats) +
      "\n\nWrite three pieces of text:\n" +
      "- summary: an executive summary paragraph (3–5 sentences) covering total committed spend, " +
      "the high-priority slate, savings achieved through competitive bidding, and outstanding bids.\n" +
      "- spendNote: 1–2 sentences interpreting the spend-by-contractor breakdown (concentration, largest programs).\n" +
      "- openNote: 1–2 sentences framing what needs the board's attention.",
      {
        type: "object",
        properties: {
          summary: { type: "string" },
          spendNote: { type: "string" },
          openNote: { type: "string" },
        },
        required: ["summary", "spendNote", "openNote"],
        additionalProperties: false,
      }, 1200);
    return { summary: out.summary, spendNote: out.spendNote, openNote: out.openNote };
  }
);

// NOTE: The multi-tenant CondoQuote SaaS functions (saas*) live in the
// separate SAAS repo (github.com/vinobaje/SAAS), functions codebase "saas".
// Do not add SaaS code here.
