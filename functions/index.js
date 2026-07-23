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

// Shared extraction prompt + schema for reading a contractor quote (pasted text
// or an uploaded PDF / Word file) into structured job fields.
const QUOTE_EXTRACT_SYSTEM =
  "You extract structured data from contractor quotes sent to a condominium property manager. " +
  "Extract only what the text actually says; leave unknown fields empty/null. " +
  "amount_cad is the quoted price as a plain number (no currency symbols). " +
  "hst_included is true only if the text says tax/HST is included. " +
  "quote_date is ISO YYYY-MM-DD if a date is given or inferable, else empty. " +
  "high_priority is true only for urgent/safety/emergency work.";
const QUOTE_SCHEMA = {
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
};

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
      throw new HttpsError("permission-denied", "This account is not the property manager.");
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
      return await callClaude(key, QUOTE_EXTRACT_SYSTEM,
        "Contractor quote text:\n\n" + text, QUOTE_SCHEMA, 800);
    }

    // ----- mode: quote intake from an uploaded FILE (PDF read natively; .docx text-extracted) -----
    if (request.data && request.data.parseFile === true) {
      const b64 = String(request.data.fileB64 || "");
      if (!b64) throw new HttpsError("invalid-argument", "No file was provided.");
      const media = String(request.data.mediaType || "");
      if (media === "application/pdf") {
        // Claude reads the PDF directly — works for digital and scanned quotes.
        return await callClaude(key, QUOTE_EXTRACT_SYSTEM, [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
          { type: "text", text: "The attached PDF is a contractor's quote to a condominium property manager. Extract the fields from it." },
        ], QUOTE_SCHEMA, 800);
      }
      if (media === "docx") {
        let text = "";
        try {
          const mammoth = require("mammoth");
          const out = await mammoth.extractRawText({ buffer: Buffer.from(b64, "base64") });
          text = String((out && out.value) || "").slice(0, 20000);
        } catch (e) {
          throw new HttpsError("invalid-argument", "Could not read that Word document — try saving it as a PDF.");
        }
        if (!text.trim()) {
          throw new HttpsError("invalid-argument", "That document looks empty or image-only — save it as a PDF so Claude can read it.");
        }
        return await callClaude(key, QUOTE_EXTRACT_SYSTEM, "Contractor quote text:\n\n" + text, QUOTE_SCHEMA, 800);
      }
      throw new HttpsError("invalid-argument", "Unsupported file — upload a PDF or a Word .docx file.");
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

// ---- RFC 3161 trusted timestamping ----------------------------------------
// When a board vote closes, we bind the resolution fingerprint (SHA-256 of the
// resolution text) to a neutral, independently verifiable UTC time by asking a
// public Time-Stamping Authority to sign it. This runs server-side because TSAs
// don't send CORS headers, so a browser can't call them directly.
const crypto = require("crypto");
const TSA_URL = "https://freetsa.org/tsr";

// Minimal DER (ASN.1) helpers — enough to build a TimeStampReq and read a reply.
function derLen(n) {
  if (n < 0x80) return Buffer.from([n]);
  const b = [];
  while (n > 0) { b.unshift(n & 0xff); n = Math.floor(n / 256); }
  return Buffer.from([0x80 | b.length, ...b]);
}
function tlv(tag, body) {
  return Buffer.concat([Buffer.from([tag]), derLen(body.length), body]);
}
function readTLV(buf, off) {
  let len = buf[off + 1], hdr = 2;
  if (len & 0x80) {
    const n = len & 0x7f; len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[off + 2 + i];
    hdr = 2 + n;
  }
  return { tag: buf[off], hdr, len, start: off + hdr, end: off + hdr + len };
}
// TimeStampReq over a SHA-256 hash: version, messageImprint(sha256, hash), nonce, certReq=TRUE.
function buildTimeStampReq(hashHex) {
  const sha256Oid = Buffer.from([0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);
  const nullParam = Buffer.from([0x05, 0x00]);
  const version = tlv(0x02, Buffer.from([0x01]));
  const algId = tlv(0x30, Buffer.concat([sha256Oid, nullParam]));
  const digest = tlv(0x04, Buffer.from(hashHex, "hex"));
  const messageImprint = tlv(0x30, Buffer.concat([algId, digest]));
  let nonce = crypto.randomBytes(8);
  if (nonce[0] & 0x80) nonce = Buffer.concat([Buffer.from([0x00]), nonce]); // keep INTEGER positive
  const nonceTlv = tlv(0x02, nonce);
  const certReq = tlv(0x01, Buffer.from([0xff])); // embed the TSA cert in the token
  return tlv(0x30, Buffer.concat([version, messageImprint, nonceTlv, certReq]));
}
// Extract genTime (GeneralizedTime) from the TSTInfo inside a timestamp token.
function tokenGenTime(token) {
  const oid = Buffer.from([0x06, 0x0B, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x09, 0x10, 0x01, 0x04]); // id-ct-TSTInfo
  let i = token.indexOf(oid);
  if (i < 0) return null;
  let t = readTLV(token, i + oid.length);
  if (t.tag === 0xA0) t = readTLV(token, t.start); // [0] eContent
  if (t.tag === 0x04) t = readTLV(token, t.start); // OCTET STRING -> TSTInfo
  if (t.tag !== 0x30) return null;                 // TSTInfo SEQUENCE
  let p = t.start;
  while (p < t.end) {
    const c = readTLV(token, p);
    if (c.tag === 0x18) { // GeneralizedTime, e.g. 20260722153000Z
      const g = token.slice(c.start, c.end).toString("ascii");
      const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(g);
      return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : g;
    }
    p = c.end;
  }
  return null;
}

// Trusted-timestamp a resolution hash. Editor-only. Returns { ok, tsa, genTime, token }.
exports.nnsccStamp = onCall(
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 30, maxInstances: 3 },
  async (request) => {
    const auth = request.auth;
    if (!auth || !auth.token || !auth.token.email || auth.token.email_verified !== true) {
      throw new HttpsError("unauthenticated", "Sign in with an authorized account.");
    }
    const email = auth.token.email.toLowerCase();
    const cfgSnap = await admin.firestore().doc("nnsccQuoteTrackerConfig/main").get();
    const editors = ((cfgSnap.exists ? cfgSnap.data().editors : []) || []).map((e) => String(e).toLowerCase());
    if (email !== OWNER && !editors.includes(email)) {
      throw new HttpsError("permission-denied", "Only the property manager can timestamp a resolution.");
    }
    const hash = String((request.data && request.data.hash) || "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      throw new HttpsError("invalid-argument", "Expected a 64-character SHA-256 hex hash.");
    }
    let resp;
    try {
      resp = await fetch(TSA_URL, {
        method: "POST",
        headers: { "content-type": "application/timestamp-query" },
        body: buildTimeStampReq(hash),
      });
    } catch (e) {
      throw new HttpsError("unavailable", "Could not reach the time-stamping authority.");
    }
    if (!resp.ok) throw new HttpsError("unavailable", "Time-stamping authority returned HTTP " + resp.status + ".");
    const der = Buffer.from(await resp.arrayBuffer());
    // TimeStampResp ::= SEQUENCE { status PKIStatusInfo, timeStampToken ContentInfo OPTIONAL }
    const outer = readTLV(der, 0);
    const statusInfo = readTLV(der, outer.start);     // PKIStatusInfo SEQUENCE
    const statusInt = readTLV(der, statusInfo.start); // PKIStatus INTEGER (0 granted, 1 grantedWithMods)
    const status = der[statusInt.start];
    if (status !== 0 && status !== 1) {
      throw new HttpsError("internal", "Time-stamp request was not granted (status " + status + ").");
    }
    if (statusInfo.end >= outer.end) {
      throw new HttpsError("internal", "Authority returned no timestamp token.");
    }
    const tokenTlv = readTLV(der, statusInfo.end);    // the timeStampToken (ContentInfo)
    const tokenBuf = der.slice(statusInfo.end, tokenTlv.end);
    return {
      ok: true,
      tsa: "freetsa.org",
      genTime: tokenGenTime(tokenBuf) || null,
      token: tokenBuf.toString("base64"),
    };
  }
);

// ---- Shared-passcode view gate ---------------------------------------------
// Lets an unauthenticated viewer read the current report only after entering a
// shared passcode. The passcode is stored as a salted scrypt hash (never in
// plaintext, never client-readable — the config doc is `allow read: if false`)
// and verified server-side, with throttling to blunt brute-force attempts.
const GATE_REPORT = { live: "nnsccQuoteTracker/main", beta: "nnsccQuoteTrackerBeta/main" };
function gateFields(beta) {
  return beta
    ? { hash: "viewHashBeta", salt: "viewSaltBeta", fails: "viewFailsBeta", until: "viewLockBeta" }
    : { hash: "viewHash", salt: "viewSalt", fails: "viewFails", until: "viewLock" };
}
function scryptHex(passcode, saltHex) {
  return crypto.scryptSync(String(passcode), Buffer.from(saltHex, "hex"), 32).toString("hex");
}

exports.nnsccGate = onCall(
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 30, maxInstances: 5 },
  async (request) => {
    const db = admin.firestore();
    const cfgRef = db.doc("nnsccQuoteTrackerConfig/main");
    const data = request.data || {};
    const beta = data.beta === true;
    const f = gateFields(beta);

    // ----- editor-only: check status, set, or clear the passcode -----
    if (data.set === true || data.check === true) {
      const auth = request.auth;
      if (!auth || !auth.token || auth.token.email_verified !== true || !auth.token.email) {
        throw new HttpsError("unauthenticated", "Sign in as the property manager.");
      }
      const email = auth.token.email.toLowerCase();
      const cfgSnap = await cfgRef.get();
      const cfg = cfgSnap.exists ? cfgSnap.data() : {};
      const editors = (cfg.editors || []).map((e) => String(e).toLowerCase());
      if (email !== OWNER && !editors.includes(email)) {
        throw new HttpsError("permission-denied", "Only the property manager can set the view passcode.");
      }
      if (data.check === true) return { set: !!cfg[f.hash] };
      const pass = String(data.passcode || "");
      if (!pass.length) { // clear the gate
        await cfgRef.set({ [f.hash]: admin.firestore.FieldValue.delete(),
          [f.salt]: admin.firestore.FieldValue.delete() }, { merge: true });
        return { set: false };
      }
      if (pass.length < 6) throw new HttpsError("invalid-argument", "Use at least 6 characters — a short phrase is best.");
      const salt = crypto.randomBytes(16).toString("hex");
      await cfgRef.set({ [f.salt]: salt, [f.hash]: scryptHex(pass, salt), [f.fails]: 0, [f.until]: 0 }, { merge: true });
      return { set: true };
    }

    // ----- public: verify passcode and return the report data -----
    if (data.view === true) {
      const cfgSnap = await cfgRef.get();
      const cfg = cfgSnap.exists ? cfgSnap.data() : {};
      if (!cfg[f.hash]) throw new HttpsError("failed-precondition", "Viewing isn’t protected yet — ask the manager to set a passcode.");
      const now = Date.now();
      if ((cfg[f.until] || 0) > now) throw new HttpsError("resource-exhausted", "Too many attempts — try again in a minute.");
      const pass = String(data.passcode || "");
      const ok = pass.length > 0 &&
        crypto.timingSafeEqual(Buffer.from(scryptHex(pass, cfg[f.salt]), "hex"), Buffer.from(cfg[f.hash], "hex"));
      if (!ok) {
        const fails = (cfg[f.fails] || 0) + 1;
        const upd = { [f.fails]: fails };
        if (fails >= 5) { upd[f.until] = now + 60 * 1000; upd[f.fails] = 0; } // 5 wrong tries → 60s lock
        await cfgRef.set(upd, { merge: true });
        throw new HttpsError("permission-denied", "That passcode isn’t right.");
      }
      await cfgRef.set({ [f.fails]: 0, [f.until]: 0 }, { merge: true });
      const rep = await db.doc(beta ? GATE_REPORT.beta : GATE_REPORT.live).get();
      const d = rep.exists ? rep.data() : {};
      return { ok: true, report: { jobs: d.jobs || [], meta: d.meta || null, ai: d.ai || null, reportName: d.reportName || null } };
    }

    throw new HttpsError("invalid-argument", "Unknown request.");
  }
);

// NOTE: The multi-tenant CondoQuote SaaS functions (saas*) live in the
// separate SAAS repo (github.com/vinobaje/SAAS), functions codebase "saas".
// Do not add SaaS code here.
