const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
admin.initializeApp();

const OWNER = "mvinobaje@gmail.com";
const AI_MODEL = "claude-haiku-4-5";
// A signed contract is read by a stronger model than the report narrative: it is
// the record the board relies on for renewal dates and money, it is read a
// handful of times a year, and a misread date is expensive.
const CONTRACT_MODEL = "claude-sonnet-5";

// One Claude structured-output call; returns the parsed JSON object.
async function callClaude(key, system, user, schema, maxTokens, model) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model || AI_MODEL,
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

// Reading a signed contract into the register + a summary the board can read.
// The board is elderly and reads this once, on a phone: the summary has to be
// plain sentences, not clauses. Nothing here is written anywhere on its own —
// the property manager confirms every field before it is saved.
const CONTRACT_SYSTEM =
  "You read signed service agreements between a contractor and a condominium corporation, " +
  "for a property manager who keeps a register of them for the board of directors.\n" +
  "Extract only what the document actually says. Leave a field empty (or null) when the " +
  "document does not say — never guess a date or an amount.\n" +
  "Dates are ISO YYYY-MM-DD. amount_cad is the recurring contract price as a plain number, " +
  "excluding one-off extras quoted separately; taxes excluded unless the document says otherwise. " +
  "period says how that amount is charged: month, year, visit, or fixed for a one-time total.\n" +
  "notice_days is the number of days' written notice needed to stop it renewing, if stated.\n" +
  "board_summary is 90-130 words of plain English for a reader over 65 with no legal background: " +
  "who the contractor is, what they do and how often, what it costs a year, how long it runs, " +
  "and what happens at the end (renews automatically, notice by when). Short sentences, no " +
  "clause numbers, no legal jargon, no markdown, no bullet points, third person, no hype.\n" +
  "watch_out is one sentence naming the single thing the board should not miss — usually the " +
  "notice deadline or an automatic price increase. Empty if there is nothing of the sort.\n" +
  "unclear lists anything you could not read with confidence (a smudged date, a missing page), " +
  "in plain words, so the manager knows what to check by hand. Empty array if the document was clear.";
const CONTRACT_SCHEMA = {
  type: "object",
  properties: {
    contractor: { type: "string" },
    title: { type: "string" },
    start: { type: "string" },
    end: { type: "string" },
    auto_renew: { type: "boolean" },
    notice_days: { type: ["number", "null"] },
    amount_cad: { type: ["number", "null"] },
    period: { type: "string", enum: ["month", "year", "visit", "fixed", ""] },
    board_summary: { type: "string" },
    watch_out: { type: "string" },
    unclear: { type: "array", items: { type: "string" } },
  },
  required: ["contractor", "title", "start", "end", "auto_renew", "notice_days",
             "amount_cad", "period", "board_summary", "watch_out", "unclear"],
  additionalProperties: false,
};

// AI helper for the NNSCC 292 quote tracker. Modes:
//  {check:true}          → is a key saved?
//  {parse:true, text}    → read a pasted quote email into structured job/bid fields
//  {contract:true, ...}  → read a signed contract into register fields + a board summary
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

    // ----- mode: read a signed contract (PDF or .docx) for the register -----
    if (request.data && request.data.contract === true) {
      const b64 = String(request.data.fileB64 || "");
      if (!b64) throw new HttpsError("invalid-argument", "No document was provided.");
      const media = String(request.data.mediaType || "");
      const ask = "The attached document is a signed service agreement between a contractor and a " +
        "condominium corporation. Read it for the register and write the board's summary.";
      if (media === "application/pdf") {
        return await callClaude(key, CONTRACT_SYSTEM, [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
          { type: "text", text: ask },
        ], CONTRACT_SCHEMA, 1500, CONTRACT_MODEL);
      }
      if (media === "docx") {
        let text = "";
        try {
          const mammoth = require("mammoth");
          const out = await mammoth.extractRawText({ buffer: Buffer.from(b64, "base64") });
          text = String((out && out.value) || "").slice(0, 60000);
        } catch (e) {
          throw new HttpsError("invalid-argument", "Could not read that Word document — try saving it as a PDF.");
        }
        if (!text.trim()) {
          throw new HttpsError("invalid-argument", "That document looks empty or image-only — save it as a PDF so Claude can read it.");
        }
        return await callClaude(key, CONTRACT_SYSTEM, ask + "\n\nAgreement text:\n\n" + text,
          CONTRACT_SCHEMA, 1500, CONTRACT_MODEL);
      }
      throw new HttpsError("invalid-argument", "Unsupported file — a contract must be a PDF or a Word .docx file.");
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
// The contract register travels with the report: a board member reading with the
// passcode sees the agreements alongside the quotes, the same as every other
// card. The signed PDFs stay behind the same passcode — they are handed out by
// this function (below), never by a public link.
const GATE_CONTRACTS = { live: "nnsccQuoteTracker/contracts", beta: "nnsccQuoteTrackerBeta/contracts" };
const CONTRACT_BUCKET = (process.env.GCLOUD_PROJECT || "") + ".firebasestorage.app";
function gateFields(beta) {
  return beta
    ? { hash: "viewHashBeta", salt: "viewSaltBeta", fails: "viewFailsBeta", until: "viewLockBeta" }
    : { hash: "viewHash", salt: "viewSalt", fails: "viewFails", until: "viewLock" };
}
// A second, independent passcode for the same report. The building's own
// passcode is set by its property manager; this one is set across every
// building so a manager or director can open any report with one phrase.
// Stored the same way — salted scrypt hash, never plaintext, never readable
// by a client — and it shares the primary's rate limiter.
function masterFields(beta) {
  return beta
    ? { hash: "masterHashBeta", salt: "masterSaltBeta" }
    : { hash: "masterHash", salt: "masterSalt" };
}
function scryptHex(passcode, saltHex) {
  return crypto.scryptSync(String(passcode), Buffer.from(saltHex, "hex"), 32).toString("hex");
}

// Check a passcode against this building's own and the all-buildings one, with
// one rate limiter behind both. Returns the config on success; throws otherwise.
async function gateVerify(cfgRef, beta, pass) {
  const f = gateFields(beta), mv = masterFields(beta);
  const cfgSnap = await cfgRef.get();
  const cfg = cfgSnap.exists ? cfgSnap.data() : {};
  if (!cfg[f.hash] && !cfg[mv.hash]) {
    throw new HttpsError("failed-precondition", "Viewing isn’t protected yet — ask the manager to set a passcode.");
  }
  const now = Date.now();
  if ((cfg[f.until] || 0) > now) throw new HttpsError("resource-exhausted", "Too many attempts — try again in a minute.");
  const matches = (hash, salt) => hash && salt && pass.length > 0 &&
    crypto.timingSafeEqual(Buffer.from(scryptHex(pass, salt), "hex"), Buffer.from(hash, "hex"));
  if (!matches(cfg[f.hash], cfg[f.salt]) && !matches(cfg[mv.hash], cfg[mv.salt])) {
    const fails = (cfg[f.fails] || 0) + 1;
    const upd = { [f.fails]: fails };
    if (fails >= 5) { upd[f.until] = now + 60 * 1000; upd[f.fails] = 0; }   // 5 wrong tries → 60s lock
    await cfgRef.set(upd, { merge: true });
    throw new HttpsError("permission-denied", "That passcode isn’t right.");
  }
  await cfgRef.set({ [f.fails]: 0, [f.until]: 0 }, { merge: true });
  return cfg;
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
      const m = masterFields(beta);
      if (data.check === true) return { set: !!cfg[f.hash], master: !!cfg[m.hash] };
      // {master:true} sets the all-buildings passcode instead of this one's
      const t = data.master === true ? m : f;
      const pass = String(data.passcode || "");
      if (!pass.length) { // clear that passcode
        await cfgRef.set({ [t.hash]: admin.firestore.FieldValue.delete(),
          [t.salt]: admin.firestore.FieldValue.delete() }, { merge: true });
        return { set: false };
      }
      if (pass.length < 6) throw new HttpsError("invalid-argument", "Use at least 6 characters — a short phrase is best.");
      const salt = crypto.randomBytes(16).toString("hex");
      await cfgRef.set({ [t.salt]: salt, [t.hash]: scryptHex(pass, salt), [f.fails]: 0, [f.until]: 0 }, { merge: true });
      return { set: true };
    }

    // ----- public: verify passcode and return the report data -----
    if (data.view === true) {
      await gateVerify(cfgRef, beta, String(data.passcode || ""));
      const [rep, con] = await Promise.all([
        db.doc(beta ? GATE_REPORT.beta : GATE_REPORT.live).get(),
        db.doc(beta ? GATE_CONTRACTS.beta : GATE_CONTRACTS.live).get(),
      ]);
      const d = rep.exists ? rep.data() : {};
      const cl = con.exists && Array.isArray(con.data().list) ? con.data().list : [];
      return {
        ok: true,
        report: { jobs: d.jobs || [], meta: d.meta || null, ai: d.ai || null, reportName: d.reportName || null },
        contracts: cl,
        alertSettings: (con.exists && con.data().alerts) || {},
      };
    }

    // ----- public: hand over one signed contract, passcode first -----
    // The file is fetched here with the project's own credentials and sent on,
    // so nothing in Storage is ever public and no shareable link exists. Only a
    // path the register itself lists can be asked for, which stops the passcode
    // from being used to walk the bucket.
    if (data.doc === true) {
      const path = String(data.path || "");
      if (!path) throw new HttpsError("invalid-argument", "No document was named.");
      await gateVerify(cfgRef, beta, String(data.passcode || ""));
      const con = await db.doc(beta ? GATE_CONTRACTS.beta : GATE_CONTRACTS.live).get();
      const list = con.exists && Array.isArray(con.data().list) ? con.data().list : [];
      let named = null;
      list.forEach((c) => (c.files || []).forEach((fl) => { if (fl && fl.path === path) named = fl; }));
      if (!named) throw new HttpsError("not-found", "That document is not on any contract in the register.");
      let buf;
      try {
        [buf] = await admin.storage().bucket(CONTRACT_BUCKET).file(path).download();
      } catch (e) {
        throw new HttpsError("not-found", "That document is no longer in the file store.");
      }
      if (buf.length > 9 * 1024 * 1024) {
        throw new HttpsError("failed-precondition", "That document is too large to open this way — sign in to read it.");
      }
      return { ok: true, name: named.name || "contract.pdf", b64: buf.toString("base64") };
    }

    throw new HttpsError("invalid-argument", "Unknown request.");
  }
);

// ---------------------------------------------------------------------------
// Arrears letters — render to PDF (nnscc-arrears at nnscc292.web.app)
//
// The browser can print a letter but cannot hand the resulting PDF back to the
// page, and a PDF is exactly what has to be attached to an email. So the same
// letter HTML the app prints is rendered here by headless Chrome. Rendering the
// identical markup, with preferCSSPageSize so the page's own @page rule governs,
// is what keeps the emailed PDF byte-identical to the printed one — a second
// layout engine would drift from it the first time anyone edited a template.
// ---------------------------------------------------------------------------

async function requireArrearsEditor(request) {
  const auth = request.auth;
  if (!auth || !auth.token || !auth.token.email || auth.token.email_verified !== true) {
    throw new HttpsError("unauthenticated", "Sign in with an authorized account.");
  }
  const email = auth.token.email.toLowerCase();
  const cfgSnap = await admin.firestore().doc("nnsccQuoteTrackerConfig/main").get();
  const editors = ((cfgSnap.exists ? cfgSnap.data().editors : []) || []).map((e) => String(e).toLowerCase());
  if (email !== OWNER && !editors.includes(email)) {
    throw new HttpsError("permission-denied", "Only the property manager can produce arrears letters.");
  }
  return email;
}

exports.nnsccArrearsPdf = onCall(
  { region: "us-central1", memory: "1GiB", timeoutSeconds: 180, maxInstances: 2, concurrency: 1 },
  async (request) => {
    await requireArrearsEditor(request);

    const html = String((request.data && request.data.html) || "");
    if (!html) throw new HttpsError("invalid-argument", "No letter markup was sent.");
    if (html.length > 4000000) {
      throw new HttpsError("invalid-argument", "That batch is too large to render in one go — split it.");
    }

    // A single-unit letter says which unit it is for, and the caller says which unit
    // it asked for. If those ever disagree, the wrong owner is about to be sent
    // another resident's arrears — so refuse rather than render. Checked on this
    // side of the wire too, so a client-side bug cannot talk its way past it.
    const expectUnit = String((request.data && request.data.expectUnit) || "");
    if (expectUnit) {
      if (!/^[\w\- ]{1,20}$/.test(expectUnit)) {
        throw new HttpsError("invalid-argument", "That is not a unit number.");
      }
      if (html.indexOf(expectUnit) < 0) {
        throw new HttpsError("failed-precondition",
          "Refusing to render: the letter does not mention unit " + expectUnit + ".");
      }
      // And it must not carry somebody else's unit as well. The lookahead is
      // essential: the Corporation's own address is "550-560 North Service Road",
      // which otherwise reads as unit 550-560 and rejects every real letter.
      const others = (html.match(/\b5[56]0-[A-Za-z0-9]{1,6}\b(?!\s+North\b)/g) || [])
        .filter((u) => u !== expectUnit);
      if (others.length) {
        throw new HttpsError("failed-precondition",
          "Refusing to render: the letter for unit " + expectUnit +
          " also mentions " + [...new Set(others)].join(", ") + ".");
      }
    }

    // puppeteer-core + @sparticuz/chromium rather than full puppeteer: the normal
    // package downloads a Chromium for whatever machine ran `npm install`, which
    // on a Mac means an arm64 binary that cannot execute on Cloud Run's linux/x64.
    const chromium = require("@sparticuz/chromium");
    const puppeteer = require("puppeteer-core");
    let browser;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: [...chromium.args, "--font-render-hinting=none"],
        defaultViewport: { width: 1100, height: 1400 },
        executablePath: await chromium.executablePath(),
      });
      const page = await browser.newPage();

      // The markup comes from our own client, but it is still content arriving
      // over the wire: no scripts run, and nothing may be fetched except the
      // data: URIs the letterhead logo is embedded as.
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const u = req.url();
        if (u.startsWith("data:") || u === "about:blank") req.continue();
        else req.abort();
      });

      await page.setContent(html, { waitUntil: "load", timeout: 30000 });
      await page.emulateMediaType("print");
      const pdf = await page.pdf({
        format: "letter",
        printBackground: true,
        preferCSSPageSize: true,   // the letter's own @page rule wins
      });
      // echo the unit back so the caller can confirm it got the PDF it asked for
      return { pdf: Buffer.from(pdf).toString("base64"), unit: expectUnit };
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      throw new HttpsError("internal", "Could not render the letter: " + ((e && e.message) || "unknown error"));
    } finally {
      if (browser) { try { await browser.close(); } catch (_) { /* nothing to do */ } }
    }
  }
);

// NOTE: The multi-tenant CondoQuote SaaS functions (saas*) live in the
// separate SAAS repo (github.com/vinobaje/SAAS), functions codebase "saas".
// Do not add SaaS code here.

// ---------------------------------------------------------------------------
// Renewal and expiry alerts
//
// Two dates in this system quietly cost money when they pass unnoticed: the
// last day notice can be given on a contract that renews itself, and the day a
// contractor's quoted price stops being good. Nobody opens a report to check
// for either. So the dates are checked here once a day and mailed out, and the
// same list is drawn at the top of the report for whoever opens it.
//
// The rules live in one place and are shared with the page, so what the board
// reads on screen and what lands in the property manager's inbox cannot drift.
// ---------------------------------------------------------------------------
const { onSchedule } = require("firebase-functions/v2/scheduler");

// The settings ride along in the contract register, which every reader of the
// report already receives — so the page can draw the same list with the same
// windows without a second document and a second permission to go with it.
const ALERT_PATHS = {
  report: "nnsccQuoteTracker/main",
  contracts: "nnsccQuoteTracker/contracts",
  directory: "nnsccQuoteTracker/contractors",
  state: "nnsccQuoteTracker/alertState",
};
const ALERT_DEFAULTS = {
  contractDays: 90,      // a renewal or an ending contract, this far ahead
  insuranceDays: 60,     // a contractor's cover running out
  quoteDays: 7,          // a quoted price about to stop being good
  recipients: [],        // filled from settings; the owner is always included
  from: "Waterview Quote Report <onboarding@resend.dev>",
  reportUrl: "https://quote-report.web.app",
  enabled: true,
};

function alertDaysUntil(iso, todayMs) {
  const s = String(iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const p = s.split("-");
  return Math.round((Date.UTC(+p[0], +p[1] - 1, +p[2]) - todayMs) / 86400000);
}
function alertDate(iso) {
  const s = String(iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const p = s.split("-");
  const m = ["January", "February", "March", "April", "May", "June", "July",
             "August", "September", "October", "November", "December"][+p[1] - 1];
  return m + " " + +p[2] + ", " + p[0];
}
function alertMoney(n) {
  return "$" + Number(n || 0).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// the last day notice can be given before a contract renews itself
function alertNoticeBy(c) {
  if (!c.renew || !c.end || !(+c.noticeDays > 0)) return "";
  const p = String(c.end).slice(0, 10).split("-");
  if (p.length !== 3) return "";
  const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  d.setUTCDate(d.getUTCDate() - Math.round(+c.noticeDays));
  return d.toISOString().slice(0, 10);
}
function alertWhen(days) {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 0) return Math.abs(days) + " day" + (days === -1 ? "" : "s") + " ago";
  return "in " + days + " days";
}

// Every date worth watching, in one list. `audience` says who it concerns:
// "all" is anyone reading the report, "manager" is housekeeping the board has
// no use for. Each item carries a key that changes when its date does, so a
// rescheduled deadline is announced again and an unchanged one is not.
function buildAlerts(data, cfg, todayISO) {
  const p = String(todayISO).split("-");
  const today = Date.UTC(+p[0], +p[1] - 1, +p[2]);
  const out = [];
  const contracts = Array.isArray(data.contracts) ? data.contracts : [];
  const directory = Array.isArray(data.directory) ? data.directory : [];
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];

  contracts.forEach((c) => {
    const who = (c.contractor || "").trim() || "Contractor not named";
    const what = (c.title || "").trim();
    const label = who + (what ? " — " + what : "");
    const notice = alertNoticeBy(c);
    const endDays = alertDaysUntil(c.end, today);
    if (notice) {
      const nd = alertDaysUntil(notice, today);
      /* a deadline that went by months ago is history, not news — the register
         still shows it, but it stops arriving in the post every Monday */
      if (nd != null && nd <= cfg.contractDays && nd > -60) {
        out.push({
          key: "con-notice-" + c.id + "-" + notice,
          kind: "contract", audience: "all",
          severity: nd < 0 ? "passed" : (nd <= 14 ? "urgent" : "soon"),
          days: nd, when: alertDate(notice),
          title: label,
          detail: nd < 0
            ? "The deadline to give notice passed " + alertWhen(nd) + " (" + alertDate(notice) +
              ") — this agreement renews for another term."
            : "Notice to end this agreement must be given by " + alertDate(notice) + " (" + alertWhen(nd) +
              "), otherwise it renews automatically" +
              (c.end ? " on " + alertDate(c.end) : "") + ".",
        });
      }
    } else if (endDays != null && endDays <= cfg.contractDays && endDays > -60) {
      out.push({
        key: "con-end-" + c.id + "-" + c.end,
        kind: "contract", audience: "all",
        severity: endDays < 0 ? "passed" : (endDays <= 14 ? "urgent" : "soon"),
        days: endDays, when: alertDate(c.end),
        title: label,
        detail: endDays < 0
          ? "This agreement ended " + alertWhen(endDays) + " (" + alertDate(c.end) + ")."
          : "This agreement ends " + alertDate(c.end) + " (" + alertWhen(endDays) + ")" +
            (c.renew ? " and renews automatically." : " and does not renew on its own."),
      });
    }
    if (!(c.files || []).length) {
      out.push({
        key: "con-nodoc-" + c.id,
        kind: "housekeeping", audience: "manager", severity: "info", days: null, when: "",
        title: label, detail: "No signed copy of this agreement is attached to the register.",
      });
    }
  });

  // cover on a contractor who currently holds a live agreement
  const holders = {};
  contracts.forEach((c) => {
    const nm = (c.contractor || "").trim();
    if (!nm) return;
    const endDays = alertDaysUntil(c.end, today);
    if (c.end && endDays != null && endDays < 0 && !c.renew) return;   // finished
    holders[nm.toLowerCase()] = nm;
  });
  directory.forEach((r) => {
    const nm = (r.name || "").trim();
    if (!nm || !holders[nm.toLowerCase()] || !r.insuranceExp) return;
    const d = alertDaysUntil(r.insuranceExp, today);
    if (d == null || d > cfg.insuranceDays) return;
    out.push({
      key: "ins-" + nm.toLowerCase() + "-" + String(r.insuranceExp).slice(0, 10),
      kind: "insurance", audience: "all",
      severity: d < 0 ? "passed" : (d <= 14 ? "urgent" : "soon"),
      days: d, when: alertDate(r.insuranceExp),
      title: nm,
      detail: d < 0
        ? "Their insurance certificate expired " + alertWhen(d) + " (" + alertDate(r.insuranceExp) +
          ") — no new work should be awarded until it is renewed."
        : "Their insurance certificate expires " + alertDate(r.insuranceExp) + " (" + alertWhen(d) + ").",
    });
  });

  // a quoted price stops being good; the board decides on figures that hold
  jobs.forEach((j) => {
    (j.bids || []).forEach((b, bi) => {
      if (!b || !b.qdate || b.amount == null || b.amount === "") return;
      const days = +b.validDays > 0 ? Math.round(+b.validDays) : 60;
      const q = String(b.qdate).slice(0, 10).split("-");
      if (q.length !== 3) return;
      const exp = new Date(Date.UTC(+q[0], +q[1] - 1, +q[2]));
      exp.setUTCDate(exp.getUTCDate() + days);
      const expISO = exp.toISOString().slice(0, 10);
      const d = alertDaysUntil(expISO, today);
      /* long-lapsed quotes are a fact of the report, not something to chase */
      if (d == null || d > cfg.quoteDays || d < -30) return;
      out.push({
        key: "bid-" + j.id + "-" + bi + "-" + expISO,
        kind: "quote", audience: "all",
        severity: d < 0 ? "passed" : (d <= 2 ? "urgent" : "soon"),
        days: d, when: alertDate(expISO),
        title: "Job " + (j.no || "?") + " — " + ((j.desc || "").trim() || "untitled") +
               " · " + ((b.contractor || "").trim() || "contractor not named") +
               " · " + alertMoney(b.amount),
        detail: d < 0
          ? "This quote was only good for " + days + " days and lapsed " + alertWhen(d) +
            " — ask the contractor to re-confirm the price."
          : "This quote is only good until " + alertDate(expISO) + " (" + alertWhen(d) +
            ") — get the decision made or ask for it to be held.",
      });
    });
  });

  const rank = { passed: 0, urgent: 1, soon: 2, info: 3 };
  out.sort((a, b) => (rank[a.severity] - rank[b.severity]) ||
    ((a.days == null ? 9999 : a.days) - (b.days == null ? 9999 : b.days)));
  return out;
}

const ALERT_KIND_LABEL = {
  contract: "Contracts", insurance: "Contractor insurance",
  quote: "Quotes about to lapse", housekeeping: "For the property manager",
};
function alertEmailHTML(items, cfg, todayISO, isDigest) {
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const colour = { passed: "#A03636", urgent: "#A03636", soon: "#8A6410", info: "#4A5866" };
  const groups = {};
  items.forEach((i) => { (groups[i.kind] = groups[i.kind] || []).push(i); });
  let h = '<div style="font:16px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1B2A3B;max-width:640px">';
  h += '<p style="font-size:15px;color:#4A5866;margin:0 0 4px">Waterview Condominium · NNSCC No. 292</p>';
  h += '<h1 style="font:700 22px/1.3 Georgia,serif;margin:0 0 14px">' +
       (isDigest ? "Dates coming up" : "Something needs attention") + "</h1>";
  ["contract", "insurance", "quote", "housekeeping"].forEach((k) => {
    if (!groups[k]) return;
    h += '<h2 style="font:700 13px/1.4 sans-serif;text-transform:uppercase;letter-spacing:.06em;color:#4A5866;' +
         'margin:22px 0 8px;border-bottom:1px solid #E8ECEF;padding-bottom:5px">' + ALERT_KIND_LABEL[k] + "</h2>";
    groups[k].forEach((i) => {
      h += '<div style="margin:0 0 14px;padding-left:12px;border-left:3px solid ' + colour[i.severity] + '">' +
        '<div style="font-weight:700">' + esc(i.title) + "</div>" +
        '<div style="color:#3C4A5A">' + esc(i.detail) + "</div></div>";
    });
  });
  h += '<p style="margin:26px 0 0"><a href="' + esc(cfg.reportUrl) +
       '" style="background:#24466B;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;' +
       'font-weight:700;display:inline-block">Open the report</a></p>';
  h += '<p style="font-size:13px;color:#7A8794;margin:22px 0 0;border-top:1px solid #E8ECEF;padding-top:10px">' +
       "Sent by the contractor quote report on " + alertDate(todayISO) + ". " +
       (isDigest ? "This is the weekly summary of everything outstanding."
                 : "You are told once per date; the weekly summary on Monday repeats what is still open.") +
       "</p></div>";
  return h;
}

async function sendAlertEmail(key, cfg, to, subject, html) {
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + key },
    body: JSON.stringify({ from: cfg.from, to: to, subject: subject, html: html }),
  });
  const body = await resp.text();
  if (!resp.ok) throw new Error("Resend returned HTTP " + resp.status + ": " + body.slice(0, 300));
  return body;
}

// Read everything the rules are computed from.
async function alertGather() {
  const db = admin.firestore();
  const [rep, con, dir, cfgSnap, st] = await Promise.all([
    db.doc(ALERT_PATHS.report).get(),
    db.doc(ALERT_PATHS.contracts).get(),
    db.doc(ALERT_PATHS.directory).get(),
    db.doc("nnsccQuoteTrackerConfig/main").get(),
    db.doc(ALERT_PATHS.state).get(),
  ]);
  const settings = (con.exists && con.data().alerts) || {};
  const cfg = Object.assign({}, ALERT_DEFAULTS, {
    contractDays: +settings.contractDays > 0 ? +settings.contractDays : ALERT_DEFAULTS.contractDays,
    insuranceDays: +settings.insuranceDays > 0 ? +settings.insuranceDays : ALERT_DEFAULTS.insuranceDays,
    quoteDays: +settings.quoteDays > 0 ? +settings.quoteDays : ALERT_DEFAULTS.quoteDays,
    recipients: Array.isArray(settings.recipients) ? settings.recipients : [],
    from: settings.from || ALERT_DEFAULTS.from,
    enabled: settings.enabled !== false,
  });
  return {
    cfg,
    data: {
      jobs: (rep.exists && rep.data().jobs) || [],
      contracts: (con.exists && con.data().list) || [],
      directory: (dir.exists && dir.data().list) || [],
    },
    resendKey: (cfgSnap.exists && cfgSnap.data().resendKey) || "",
    state: st.exists ? st.data() : {},
  };
}

// The daily run. Nothing is sent when nothing has changed: an item is mailed
// the first day it appears, and after that only in Monday's summary, so a
// deadline three months out does not arrive ninety times.
async function alertRun(todayISO, force) {
  const { cfg, data, resendKey, state } = await alertGather();
  const items = buildAlerts(data, cfg, todayISO);
  const to = [OWNER].concat(cfg.recipients.map((e) => String(e).trim().toLowerCase()))
    .filter((e, i, a) => e && a.indexOf(e) === i);
  const monday = new Date(todayISO + "T12:00:00Z").getUTCDay() === 1;
  const sent = state.sent || {};
  const fresh = items.filter((i) => !sent[i.key]);
  const digest = force || (monday && items.length > 0);
  const result = { items: items.length, fresh: fresh.length, digest: digest, sent: false, to: to };

  if (!cfg.enabled) { result.skipped = "alerts are switched off"; return result; }
  if (!items.length && !force) { result.skipped = "nothing to report"; return result; }
  if (!fresh.length && !digest) { result.skipped = "nothing new since the last message"; return result; }
  if (!resendKey) { result.skipped = "no Resend API key has been saved"; return result; }

  const show = digest ? items : fresh;
  const urgent = show.filter((i) => i.severity === "passed" || i.severity === "urgent").length;
  const subject = "Waterview: " + show.length + " item" + (show.length === 1 ? "" : "s") +
    " need" + (show.length === 1 ? "s" : "") + " attention" + (urgent ? " (" + urgent + " overdue or urgent)" : "");
  await sendAlertEmail(resendKey, cfg, to, subject, alertEmailHTML(show, cfg, todayISO, digest));

  const keep = {};
  items.forEach((i) => { keep[i.key] = sent[i.key] || todayISO; });
  await admin.firestore().doc(ALERT_PATHS.state).set(
    { sent: keep, lastRun: todayISO, lastSent: todayISO, lastCount: show.length }, { merge: true });
  result.sent = true;
  return result;
}

exports.nnsccAlerts = onSchedule(
  { schedule: "0 8 * * *", timeZone: "America/Toronto", region: "us-central1",
    memory: "256MiB", timeoutSeconds: 120 },
  async () => {
    const today = new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10);  // Toronto morning
    const r = await alertRun(today, false);
    console.log("alerts:", JSON.stringify(r));
  }
);

// The property manager's "send it to me now" button, and what the Settings
// panel uses to show what today's message would say.
exports.nnsccAlertNow = onCall(
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 120, maxInstances: 3 },
  async (request) => {
    const auth = request.auth;
    if (!auth || !auth.token || !auth.token.email || auth.token.email_verified !== true) {
      throw new HttpsError("unauthenticated", "Sign in with an authorized account.");
    }
    const email = auth.token.email.toLowerCase();
    const cfgSnap = await admin.firestore().doc("nnsccQuoteTrackerConfig/main").get();
    const editors = ((cfgSnap.exists ? cfgSnap.data().editors : []) || []).map((e) => String(e).toLowerCase());
    if (email !== OWNER && !editors.includes(email)) {
      throw new HttpsError("permission-denied", "This account is not the property manager.");
    }
    const today = new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10);
    if (request.data && request.data.preview === true) {
      const { cfg, data, resendKey } = await alertGather();
      const items = buildAlerts(data, cfg, today);
      return { items: items, keySet: !!resendKey, cfg: { contractDays: cfg.contractDays,
        insuranceDays: cfg.insuranceDays, quoteDays: cfg.quoteDays, recipients: cfg.recipients,
        from: cfg.from, enabled: cfg.enabled } };
    }
    try {
      return await alertRun(today, true);
    } catch (e) {
      throw new HttpsError("internal", (e && e.message) || "Could not send the message.");
    }
  }
);
