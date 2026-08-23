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
async function callClaude(key, system, user, schema, maxTokens, model, effort) {
  // These models think before they answer, and the thinking is spent out of
  // max_tokens. A budget sized for the answer alone comes back cut off with
  // nothing readable in it, so every caller here leaves room for both, and the
  // ones that don't need deep deliberation ask for less of it.
  const out = { format: { type: "json_schema", schema } };
  if (effort) out.effort = effort;
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
      output_config: out,
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
  try {
    return JSON.parse(txt);
  } catch (e) {
    console.error("Claude reply unreadable", { model: j.model, stop: j.stop_reason,
      usage: j.usage, head: txt.slice(0, 200) });
    throw new HttpsError("internal", j.stop_reason === "max_tokens"
      ? "The reply was longer than the room allowed and came back incomplete — try again, or take some items out."
      : "The reply could not be read back.");
  }
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

// Dictated speech is not a record. It arrives without punctuation, doubles back
// on itself and trails off — read it in six months and half of it is gone. This
// tidies what was said into something that reads as a record, adding nothing.
const TIDY_SYSTEM =
  "You tidy a property manager's dictated note into a clear written record for a condominium's files.\n" +
  "Keep every fact, name, number, date, time and outcome exactly as given. Add nothing — no detail, no " +
  "inference, no politeness, no heading. Remove filler, false starts and repetition. Fix punctuation, " +
  "capitalisation and obvious mis-hearings of company names only where the intent is unmistakable.\n" +
  "Write it as one to four plain sentences in the past tense, third person or first person to match what " +
  "was said. Do not summarise away detail: a longer note stays long. Return only the tidied text.";
const TIDY_SCHEMA = {
  type: "object",
  properties: { text: { type: "string" } },
  required: ["text"],
  additionalProperties: false,
};

// One line of the property manager's day, filed. She says what she did or what
// is booked; this works out which of the four it is, who it was, and when —
// "Northern Generator did the monthly testing on Monday" becomes a completed
// visit dated to that Monday. Nothing is saved until she has seen the fields.
const JOURNAL_SYSTEM =
  "You file one line from a condominium property manager's day into fields for her weekly report " +
  "to the board.\n" +
  "kind: 'done' for work already carried out, 'scheduled' for work booked or expected, " +
  "'unit' for a problem in a specific unit, 'note' for anything else (a call, a meeting, an inspection " +
  "by an authority, an errand).\n" +
  "date is ISO YYYY-MM-DD. Resolve plain speech against the date given to you: 'Monday' and 'yesterday' " +
  "mean the most recent one for work already done, the next one for work booked. Empty if no date is " +
  "stated or implied.\n" +
  "contractor is the company named, exactly as said, else empty. work is the job in three to eight words, " +
  "capitalised like a title ('Monthly generator testing'). unit is a unit number if one is named, else empty. " +
  "note is anything else worth keeping — a building, a floor, a time, a condition — else empty.\n" +
  "Never invent a contractor, a date or a unit that was not said.";
const JOURNAL_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["done", "scheduled", "unit", "note"] },
    date: { type: "string" },
    contractor: { type: "string" },
    work: { type: "string" },
    unit: { type: "string" },
    note: { type: "string" },
  },
  required: ["kind", "date", "contractor", "work", "unit", "note"],
  additionalProperties: false,
};

// The year's schedule as the contractor sends it — a letter or a table of
// visits — read into dated entries so nobody types twelve dates by hand.
const SCHEDULE_SYSTEM =
  "You read a contractor's schedule of visits to a condominium — an annual maintenance calendar, an " +
  "inspection notice, or a letter naming dates — into a list for the property manager's calendar.\n" +
  "One entry per visit. date is ISO YYYY-MM-DD; for a visit spanning days, set date to the first and " +
  "endDate to the last, otherwise leave endDate empty. Where a month is named without a day (e.g. " +
  "'monthly testing, first Monday'), work out the actual date if the document says enough to do so, " +
  "otherwise leave the date empty and say why in note.\n" +
  "work is the job in three to eight words, capitalised like a title. note carries the building, address, " +
  "floor, time of day or any condition stated. contractor is the company sending the schedule.\n" +
  "Extract only visits the document actually names. Never invent a date to fill a pattern.";
const SCHEDULE_SCHEMA = {
  type: "object",
  properties: {
    contractor: { type: "string" },
    visits: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string" }, endDate: { type: "string" },
          work: { type: "string" }, note: { type: "string" },
        },
        required: ["date", "endDate", "work", "note"],
        additionalProperties: false,
      },
    },
    unclear: { type: "array", items: { type: "string" } },
  },
  required: ["contractor", "visits", "unclear"],
  additionalProperties: false,
};

// Reading a board meeting for the decisions it records about work on the
// building. Three rules make this safe enough to put in front of a director:
//   * the quote must be copied out of the page text word for word, because the
//     report finds it again in the PDF and highlights what it finds — a
//     paraphrase highlights nothing and is thrown away before she sees it;
//   * "I cannot place this" is a correct answer, not a failure. Fuzzy matching
//     of minute wording to job titles is confidently wrong: "Leak in unit
//     550-912" is not "Repairs unit 550-318", and a wrong citation shown to a
//     board is worse than no citation;
//   * nothing here changes a job. The reply is a list of proposals; the
//     property manager accepts them one at a time.
const MINUTES_SYSTEM =
  "You read the minutes of a condominium board meeting and list the decisions the board recorded " +
  "about work on the building: quotes approved, work deferred or declined, contracts awarded, " +
  "expenditure authorised, work called off.\n\n" +
  "RULES, in order of importance:\n" +
  "1. `quote` MUST be copied from the supplied page text character for character — no paraphrase, no " +
  "tidying, no ellipsis, no correcting of spelling or punctuation. Copy the whole passage that records " +
  "the decision, including its numbered heading if it has one. If you cannot copy an exact passage, omit " +
  "the item entirely.\n" +
  "2. `page` is the page number the passage was printed on, as labelled in the supplied text.\n" +
  "3. `job_id` must be exactly one of the ids in the job list, or the empty string. Use an id ONLY when " +
  "the passage is plainly about that same job — the same location, the same equipment, the same " +
  "contractor, the same amount. Unit numbers, floor numbers and amounts must match, not merely " +
  "resemble each other. If two jobs could fit, or none clearly does, return \"\" and say why in " +
  "`why`. Returning \"\" is a correct, expected answer and is much better than a plausible guess.\n" +
  "4. `decision` is what the board did: approved, deferred, rejected, cancelled, discussed (raised but " +
  "not decided) or other.\n" +
  "5. `heading` is a short plain-English label for the item, in your own words — this one is not a quote.\n" +
  "6. `why` is one short sentence: why this passage belongs to that job, or why you could not place it.\n" +
  "Skip routine business that is not about work on the building — minutes approved, meeting adjourned, " +
  "elections, correspondence noted. List at most 40 items.";
const MINUTES_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          heading: { type: "string" },
          quote: { type: "string" },
          page: { type: ["number", "null"] },
          decision: { type: "string", enum: ["approved", "deferred", "rejected", "cancelled", "discussed", "other"] },
          job_id: { type: "string" },
          why: { type: "string" },
        },
        required: ["heading", "quote", "page", "decision", "job_id", "why"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

// Two prices for one job are not two prices for the same thing. One quote covers
// a single extinguisher, the next covers two and the cabinet; one carries ten
// years on a waterproofing membrane and the next says nothing. The report used to
// tick the smaller number and call it the lowest, which is true about the number
// and misleading about the job. This reads what each price actually buys — from
// the scope note and from the quote document itself — and says where they differ.
// It never awards anything: the board does that.
const COMPARE_SYSTEM =
  "You compare the quotes a condominium property manager has received for ONE job, for the board of " +
  "directors who must decide which to accept.\n" +
  "Read only what each quote itself says — its scope note and any document attached to it. Never carry " +
  "a detail from one quote onto another, and never add a detail no quote states.\n" +
  "covers: one line saying what that price buys, in the quote's own terms — what is supplied and " +
  "installed, not which line of the document it is and not the job's own title. Where a quote has no " +
  "scope note and no readable document, covers says exactly that and nothing more: you may not describe " +
  "it from the job title, from another quote, or from what the work would usually involve.\n" +
  "quantity and unit: only where the quote says how many. “2 -10 lb fire extinguishers plus 1 cabinet” " +
  "is quantity 2, unit “extinguisher”. Where the quote does not say, quantity is null and unit is empty. " +
  "Do not infer a quantity from the price.\n" +
  "warranty: the term the quote states, e.g. “10 years on the membrane”. Where the quote says nothing " +
  "about a warranty, write “not stated” — silence is not the absence of one, and must never be " +
  "reported as “no warranty”.\n" +
  "amount_note: which part of the document the price given corresponds to. Every price you are given " +
  "already has 13% HST added, so a line reading $1,000.00 in the document reaches you as $1,130.00 — " +
  "work in those terms before deciding whether a figure matches. Where a document prices several " +
  "locations, phases or line items and only one of them is this job, name the line the price matches: " +
  "\u201cthe $66,800.00 ramp waterproofing line, plus HST\u201d. Where it matches no line, or matches the " +
  "grand total for the whole document rather than the line for this job, report that finding and " +
  "add a caution. Show the working when you do: give the line figure, the total figure, and the price " +
  "you were given, so the reader can check the claim rather than take it on trust. Never state that a " +
  "price is a document total unless the arithmetic says so — a price that quietly carries work belonging to another job is the costliest error on " +
  "this page. Empty where there is no document, or where the document prices one thing only.\n" +
  "includes / excludes: at most four short items each, only what is written (permits, disposal, making " +
  "good, cabinet, tax). Empty arrays where the quote is silent.\n" +
  "comparable: true only where the quotes buy substantially the same thing, so that the prices can be " +
  "set against each other as they stand. False where one covers more equipment, more area, a longer " +
  "warranty, or work the others exclude.\n" +
  "difference: one plain sentence a director can read on a phone, naming the contractors and what " +
  "differs between them. Empty string when they are comparable.\n" +
  "best_index: the quote that is the better value ON WHAT IS WRITTEN — weighing quantity, warranty and " +
  "what is included, not price alone. Name one whenever what is written supports it. The cheapest quote " +
  "being also the most fully specified is a finding worth stating plainly, not an obvious one to pass " +
  "over. And a quote you cannot read does not stop you naming the best of the ones you can — say which " +
  "of the readable quotes is the better value and let a caution carry the unknown one. Use null only " +
  "where naming any of them would be a guess: where they are equally specified with nothing to choose " +
  "between them, or where too little is written about all of them to compare at all.\n" +
  "best_reason: one sentence for that choice in the quotes' own terms, e.g. “covers two extinguishers " +
  "and the cabinet at $296.63 each against $508.50 for one”. Empty when best_index is null.\n" +
  "YOU ARE NOT AWARDING THE WORK. The board of directors awards it, and may award it to a contractor " +
  "you did not name for reasons no quote shows. Never write that a contractor should be given the job, " +
  "is recommended, has won, or is the one to go with. State what the quotes say and stop.\n" +
  "cautions: what the property manager should check by hand — a quote that reads as an estimate rather " +
  "than a fixed price, a page that appears to be missing, a quantity you were unsure of. Empty when " +
  "there is nothing.\n" +
  "Every amount you are given already includes 13% HST, so any per-unit figure you work out is on the " +
  "same footing. Plain sentences, no markdown, Canadian dollars with $ and thousands separators.";
const COMPARE_SCHEMA = {
  type: "object",
  properties: {
    quotes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "number" },
          covers: { type: "string" },
          amount_note: { type: "string" },
          quantity: { type: ["number", "null"] },
          unit: { type: "string" },
          warranty: { type: "string" },
          includes: { type: "array", items: { type: "string" } },
          excludes: { type: "array", items: { type: "string" } },
        },
        required: ["index", "covers", "amount_note", "quantity", "unit", "warranty", "includes", "excludes"],
        additionalProperties: false,
      },
    },
    comparable: { type: "boolean" },
    difference: { type: "string" },
    best_index: { type: ["number", "null"] },
    best_reason: { type: "string" },
    cautions: { type: "array", items: { type: "string" } },
  },
  required: ["quotes", "comparable", "difference", "best_index", "best_reason", "cautions"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Reading the quotes with somebody else's model.
//
// The comparison is the one place where the model's accuracy is worth real
// money — it is what noticed that a $525 quote carried a $25 truck charge, and
// that a $75,484 price covered one location out of four. So it is also the one
// place worth putting a cheaper model on trial rather than assuming.
//
// All three providers are asked for the same JSON, against the same schema,
// from the same documents. What comes back is normalised to one shape, so the
// rest of the app neither knows nor cares which one answered.
const ENGINES = {
  claude: { label: "Claude Sonnet 5", model: "claude-sonnet-5", keyField: "anthropicKey" },
  gemini: { label: "Gemini Flash-Lite", model: "gemini-3.5-flash-lite", keyField: "geminiKey" },
  openai: { label: "GPT-5.6 Luna", model: "gpt-5.6-luna", keyField: "openaiKey" },
};

// Google's Interactions API. Documents and images ride inline as base64.
async function callGemini(key, model, system, blocks, schema) {
  const input = blocks.map((b) => (b.text
    ? { type: "text", text: b.text }
    : { type: b.media === "application/pdf" ? "document" : "image", data: b.b64, mime_type: b.media }));
  const resp = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      model,
      /* the Interactions API takes this as a plain string — the {parts:[...]}
         shape belongs to the older generateContent endpoint and is rejected */
      system_instruction: system,
      input,
      response_format: { type: "text", mime_type: "application/json", schema },
    }),
  });
  const j = await resp.json();
  if (!resp.ok) {
    const msg = (j.error && j.error.message) || "HTTP " + resp.status;
    throw new HttpsError(resp.status === 400 || resp.status === 403 ? "failed-precondition" : "internal",
      "Gemini: " + msg);
  }
  let txt = j.output_text || "";
  if (!txt && Array.isArray(j.steps)) {
    const last = j.steps[j.steps.length - 1] || {};
    (last.content || []).forEach((c) => { if (c && c.text) txt += c.text; });
  }
  try {
    return JSON.parse(txt);
  } catch (e) {
    console.error("Gemini reply unreadable", { model, head: String(txt).slice(0, 200) });
    throw new HttpsError("internal", "Gemini answered with something that was not the JSON asked for.");
  }
}

// OpenAI's Responses API. A PDF goes as input_file with a data: URL; an image
// as input_image the same way.
async function callOpenAI(key, model, system, blocks, schema) {
  const content = blocks.map((b) => {
    if (b.text) return { type: "input_text", text: b.text };
    if (b.media === "application/pdf") {
      return { type: "input_file", filename: b.name || "quote.pdf",
        file_data: "data:application/pdf;base64," + b.b64 };
    }
    return { type: "input_image", image_url: "data:" + b.media + ";base64," + b.b64 };
  });
  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + key },
    body: JSON.stringify({
      model,
      instructions: system,
      input: [{ role: "user", content }],
      text: { format: { type: "json_schema", name: "quote_comparison", schema, strict: true } },
    }),
  });
  const j = await resp.json();
  if (!resp.ok) {
    const msg = (j.error && j.error.message) || "HTTP " + resp.status;
    throw new HttpsError(resp.status === 401 || resp.status === 400 ? "failed-precondition" : "internal",
      "OpenAI: " + msg);
  }
  let txt = j.output_text || "";
  if (!txt && Array.isArray(j.output)) {
    j.output.forEach((o) => (o.content || []).forEach((c) => {
      if (c && (c.type === "output_text" || c.text)) txt += c.text || "";
    }));
  }
  try {
    return JSON.parse(txt);
  } catch (e) {
    console.error("OpenAI reply unreadable", { model, stop: j.status, head: String(txt).slice(0, 200) });
    throw new HttpsError("internal", "GPT answered with something that was not the JSON asked for.");
  }
}

// The week in the board's words. The figures and the tables are assembled from
// the data before this is called — what is wanted here is the paragraph a
// director reads first, and it must not contain a number the data did not give.
const WEEKLY_SYSTEM =
  "You write the opening of a weekly report from a condominium property manager to her board of " +
  "directors. The board is elderly and reads this once, on a phone.\n" +
  "summary: 3 to 5 short sentences covering what was carried out, what is booked, anything decided or " +
  "waiting on the board, and any money committed. Name contractors and jobs plainly. Every figure must " +
  "come from the data given.\n" +
  "attention: one or two sentences naming only what the board must act on or know before the next " +
  "meeting. Empty if there is nothing.\n" +
  "closing: one sentence inviting questions, in the manager's voice.\n" +
  "quoteChanges: one sentence for each entry in quoteChanges, in the same order and the same number — " +
  "what the quote tracker recorded, said the way a director would say it rather than the way a database " +
  "records it. Use only the fields that entry carries.\n" +
  "WHO THE WORK WENT TO: an entry names a contractor ONLY in its own contractor field. If that field is " +
  "empty, no company may appear in that sentence — not from another entry, not from a quote received for " +
  "the same job, not from anywhere. A board approving a job is not the same as awarding it to the company " +
  "that quoted lowest, and the corporation may award it to someone else entirely. So 'status changed' to " +
  "approved with no contractor reads as: the board approved that job — and nothing about who will carry it " +
  "out or for how much. With a contractor named, it reads as awarded to that company at that amount.\n" +
  "A quote received is a price now in hand from the contractor named on that entry, and says nothing about " +
  "who will get the work. Do not merge two entries, do not add one that is not there, and do not invent a " +
  "meeting, a date, a reason, an amount or a person.\n" +
  "Say what a change means, not what fields moved: write \"The board approved the tank replacement at 560\", " +
  "never \"moved from quoted to approved\". The previous state is worth a mention only where it changes the " +
  "meaning, as when work already approved has now been awarded to a company.\n" +
  "DATES: write them as a person speaks them — 17 August, or 17 August 2027 when the year is not this one. " +
  "Never print a date in the 2026-08-17 form anywhere.\n" +
  "The same rule governs the summary: it may not say who a job went to unless the data says so, and it " +
  "may not attach a quoted price to an approval as though it were the awarded price.\n" +
  "MONEY: an amount is only money where the data already shows it with a $ sign. Every other number is " +
  "an address, a building, a unit, a floor or a count — 550 and 560 are the two buildings of this " +
  "corporation, 560-905 is a unit, 11 is a floor. Never put a $ in front of a number that did not " +
  "already carry one, and never turn a building or unit number into an amount.\n" +
  "Plain sentences, no markdown, no bullet points, no headings, no first-person plural, no hype. " +
  "Canadian dollars with $ and thousands separators.";
const WEEKLY_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" }, attention: { type: "string" }, closing: { type: "string" },
    quoteChanges: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "attention", "closing", "quoteChanges"],
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

    // ----- mode: the week's report to the board -----
    if (request.data && request.data.weekly === true) {
      const facts = request.data.facts;
      if (!facts || JSON.stringify(facts).length > 200000) {
        throw new HttpsError("invalid-argument", "Bad weekly payload.");
      }
      return await callClaude(key, WEEKLY_SYSTEM,
        "The corporation is " + String(request.data.buildings || "one building") + ". " +
        "The period is " + String(request.data.from || "") + " to " + String(request.data.to || "") +
        ".\n\nEverything known about it:\n" + JSON.stringify(facts) +
        "\n\nWrite the summary, the attention line, the closing, and a sentence for each change.",
        /* room for a sentence per change as well as the prose. The model's own
           reasoning is spent out of this same allowance — a quiet week already
           uses two thirds of 2500, and a truncated reply is not JSON at all. */
        WEEKLY_SCHEMA, 6000, CONTRACT_MODEL);
    }

    // ----- mode: tidy a dictated note into a record -----
    if (request.data && request.data.tidy === true) {
      const text = String(request.data.text || "").slice(0, 6000);
      if (!text.trim()) throw new HttpsError("invalid-argument", "Nothing to tidy.");
      const out = await callClaude(key, TIDY_SYSTEM, "Dictated:\n\n" + text, TIDY_SCHEMA, 900);
      return { text: out.text };
    }

    // ----- mode: file one spoken line of the day -----
    if (request.data && request.data.journal === true) {
      const text = String(request.data.text || "").slice(0, 4000);
      if (!text.trim()) throw new HttpsError("invalid-argument", "Nothing to file.");
      const today = /^\d{4}-\d{2}-\d{2}$/.test(String(request.data.today || ""))
        ? request.data.today : new Date().toISOString().slice(0, 10);
      return await callClaude(key, JOURNAL_SYSTEM,
        "Today is " + today + ". The property manager said:\n\n" + text, JOURNAL_SCHEMA, 400);
    }

    // ----- mode: read a contractor's schedule of visits -----
    if (request.data && request.data.schedule === true) {
      const b64 = String(request.data.fileB64 || "");
      const media = String(request.data.mediaType || "");
      const ask = "Read every visit this schedule names, for the property manager's calendar. " +
        "Today is " + new Date().toISOString().slice(0, 10) + ".";
      if (b64 && media === "application/pdf") {
        return await callClaude(key, SCHEDULE_SYSTEM, [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
          { type: "text", text: ask },
        ], SCHEDULE_SCHEMA, 2500, CONTRACT_MODEL);
      }
      if (b64 && media === "docx") {
        let text = "";
        try {
          const mammoth = require("mammoth");
          const out = await mammoth.extractRawText({ buffer: Buffer.from(b64, "base64") });
          text = String((out && out.value) || "").slice(0, 60000);
        } catch (e) {
          throw new HttpsError("invalid-argument", "Could not read that Word document — try saving it as a PDF.");
        }
        if (!text.trim()) throw new HttpsError("invalid-argument", "That document looks empty or image-only — save it as a PDF.");
        return await callClaude(key, SCHEDULE_SYSTEM, ask + "\n\nSchedule:\n\n" + text,
          SCHEDULE_SCHEMA, 2500, CONTRACT_MODEL);
      }
      const pasted = String(request.data.text || "").slice(0, 30000);
      if (!pasted.trim()) throw new HttpsError("invalid-argument", "Upload a PDF or paste the schedule.");
      return await callClaude(key, SCHEDULE_SYSTEM, ask + "\n\nSchedule:\n\n" + pasted,
        SCHEDULE_SCHEMA, 2500, CONTRACT_MODEL);
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

    // ----- mode: read a filed meeting for the decisions it records -----
    // The pages arrive as text the browser already pulled out of the PDF with
    // pdf.js — the very text layer the highlighter searches. Sending that
    // rather than the PDF means the model is quoting from the same copy the
    // highlight is found in, so a quote that comes back either matches or is
    // discarded before anyone sees it.
    if (request.data && request.data.minutes === true) {
      const pages = Array.isArray(request.data.pages) ? request.data.pages : [];
      if (!pages.length) throw new HttpsError("invalid-argument", "No pages were provided.");
      let body = "", used = 0;
      for (const pg of pages) {
        const t = String((pg && pg.text) || "").trim();
        if (!t) continue;
        const chunk = "\n\n===== PAGE " + (Number(pg.n) || used + 1) + " =====\n" + t;
        if (body.length + chunk.length > 140000) break;
        body += chunk; used++;
      }
      if (!body.trim()) {
        throw new HttpsError("invalid-argument",
          "There is no readable text in that PDF — it is a scan of a printed page. " +
          "Highlighting cannot work on a scan either, so file a copy saved from Word.");
      }
      const jobs = (Array.isArray(request.data.jobs) ? request.data.jobs : []).slice(0, 200);
      const jobList = jobs.length
        ? jobs.map((j) => "  " + String(j.id || "") + " | job " + String(j.no || "") + " | " +
            String(j.desc || "(untitled)") + " | now: " + String(j.status || "") +
            (j.who ? " | quoted by " + String(j.who) : "") +
            (j.amount ? " | " + String(j.amount) : "")).join("\n")
        : "  (no jobs are open)";
      return await callClaude(key, MINUTES_SYSTEM,
        "The meeting is " + String(request.data.label || "a board meeting") + ".\n\n" +
        "The jobs currently tracked, as `id | job no | description | status`:\n" + jobList +
        "\n\nThe minutes, page by page:" + body +
        "\n\nList the decisions this meeting recorded about work on the building. " +
        "Copy each passage word for word from the text above.",
        MINUTES_SCHEMA, 12000, CONTRACT_MODEL);
    }

    // ----- mode: compare the quotes on one job (what each price actually buys) -----
    if (request.data && request.data.compare === true) {
      const eng = ENGINES[String(request.data.engine || "claude")] || ENGINES.claude;
      const engKey = cfg[eng.keyField];
      if (!engKey) {
        throw new HttpsError("failed-precondition",
          "No API key has been saved for " + eng.label + " — the owner saves it under Overview.");
      }
      const engModel = String(request.data.model || "").trim() || eng.model;
      const job = request.data.job || {};
      const bids = Array.isArray(job.bids) ? job.bids.slice(0, 8) : [];
      const priced = bids.filter((b) => b && b.total != null);
      if (priced.length < 2) {
        throw new HttpsError("invalid-argument", "Two priced quotes are needed before there is anything to compare.");
      }
      const lines = ["Job: " + String(job.desc || "").slice(0, 400),
        "", "The quotes received (every amount includes 13% HST):"];
      bids.forEach((b) => {
        if (b.total == null) return;
        lines.push("");
        lines.push("Quote " + b.i + " — " + (String(b.contractor || "").trim() || "unnamed contractor"));
        lines.push("  price: $" + Number(b.total).toFixed(2));
        if (b.qno) lines.push("  quote number: " + String(b.qno).slice(0, 60));
        if (b.date) lines.push("  quoted: " + String(b.date).slice(0, 20));
        lines.push("  scope note as the manager typed it: " +
          (String(b.scope || "").trim().slice(0, 1200) || "(nothing typed)"));
      });
      const blocks = [{ text: lines.join("\n") }];

      // The quote documents themselves — the scope note is the manager's
      // shorthand, the attachment is what the contractor actually wrote.
      let budget = 14 * 1024 * 1024, taken = 0;
      for (const b of bids) {
        if (b.total == null) continue;
        const files = Array.isArray(b.files) ? b.files.slice(0, 2) : [];
        for (const f of files) {
          if (taken >= 6 || !f || !f.path) continue;
          const path = String(f.path);
          if (!path.startsWith("quoteAttachments/")) continue;   // only ever a quote attachment
          const name = String(f.name || "");
          const ext = name.toLowerCase().split(".").pop();
          const media = ext === "pdf" ? "application/pdf"
            : ext === "png" ? "image/png"
            : (ext === "jpg" || ext === "jpeg") ? "image/jpeg"
            : ext === "webp" ? "image/webp" : "";
          if (!media) continue;                                   // .docx/.heic and the rest: scope note only
          let buf;
          try {
            [buf] = await admin.storage().bucket(CONTRACT_BUCKET).file(path).download();
          } catch (e) { continue; }                               // a missing file is not a failed comparison
          if (buf.length > 6 * 1024 * 1024 || buf.length > budget) continue;
          budget -= buf.length; taken++;
          blocks.push({ text: "Attached to quote " + b.i + " (" +
            (String(b.contractor || "").trim() || "unnamed contractor") + "): " + name });
          blocks.push({ media: media, b64: buf.toString("base64"), name: name });
        }
      }
      blocks.push({ text: "Compare these quotes now. Report only what they say." });

      let out;
      if (eng === ENGINES.gemini) {
        out = await callGemini(engKey, engModel, COMPARE_SYSTEM, blocks, COMPARE_SCHEMA);
      } else if (eng === ENGINES.openai) {
        out = await callOpenAI(engKey, engModel, COMPARE_SYSTEM, blocks, COMPARE_SCHEMA);
      } else {
        /* Anthropic wants its own block shapes */
        const content = blocks.map((b) => (b.text
          ? { type: "text", text: b.text }
          : { type: b.media === "application/pdf" ? "document" : "image",
              source: { type: "base64", media_type: b.media, data: b.b64 } }));
        out = await callClaude(engKey, COMPARE_SYSTEM, content, COMPARE_SCHEMA,
          12000, engModel, "medium");
      }
      return { ok: true, read: taken, engine: eng.label, model: engModel, compare: out };
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

// ---------------------------------------------------------------------------
// The weekly report to the board, as one document
//
// The manager's report is written in the browser; the superintendent's own
// weekly highlights arrive as a PDF he generates elsewhere. Until now those
// were joined by screenshotting his six pages into a Word file. Here the report
// is printed by the same headless Chrome the arrears letters use, and his pages
// are appended whole — full quality, selectable text, one document.
// ---------------------------------------------------------------------------
exports.nnsccWeeklyPdf = onCall(
  { region: "us-central1", memory: "1GiB", timeoutSeconds: 240, maxInstances: 2, concurrency: 1 },
  async (request) => {
    await requireArrearsEditor(request);          // same editor test as the letters
    const html = String((request.data && request.data.html) || "");
    if (!html) throw new HttpsError("invalid-argument", "No report markup was sent.");
    if (html.length > 4000000) throw new HttpsError("invalid-argument", "That report is too large to render.");
    /* his own reports — the weekly highlights, the month-end one, whatever else
       belongs behind hers — appended in the order she put them in */
    const appends = Array.isArray(request.data && request.data.appendB64s)
      ? request.data.appendB64s.map((x) => String(x || "")).filter(Boolean)
      : (request.data && request.data.appendB64 ? [String(request.data.appendB64)] : []);

    const chromium = require("@sparticuz/chromium");
    const puppeteer = require("puppeteer-core");
    let browser, ours;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: [...chromium.args, "--font-render-hinting=none"],
        defaultViewport: { width: 1100, height: 1400 },
        executablePath: await chromium.executablePath(),
      });
      const page = await browser.newPage();
      /* our own markup, but still content over the wire: no scripts, and
         nothing fetched except the data: URIs the logo and photos ride in */
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const u = req.url();
        if (u.startsWith("data:") || u === "about:blank") req.continue(); else req.abort();
      });
      await page.setContent(html, { waitUntil: "load", timeout: 45000 });
      await page.emulateMediaType("print");
      /* a running foot on the pages we print: which corporation, which period,
         and where you are in it — his own pages keep whatever footer they came
         with, which is how a reader tells the two reports apart */
      const foot = String((request.data && request.data.footer) || "");
      ours = await page.pdf({
        format: "letter", printBackground: true, preferCSSPageSize: true,
        displayHeaderFooter: !!foot,
        headerTemplate: "<span></span>",
        footerTemplate: foot
          ? '<div style="width:100%;font:8.5px -apple-system,Segoe UI,Helvetica,Arial,sans-serif;' +
            'color:#8894A3;padding:0 12mm;display:flex;justify-content:space-between">' +
            "<span>" + foot.replace(/[<>]/g, "") + "</span>" +
            '<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>'
          : "<span></span>",
      });
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      throw new HttpsError("internal", "Could not render the report: " + ((e && e.message) || "unknown error"));
    } finally {
      if (browser) { try { await browser.close(); } catch (_) { /* nothing to do */ } }
    }

    if (!appends.length) return { pdf: Buffer.from(ours).toString("base64"), pages: null, joined: 0 };

    const { PDFDocument } = require("pdf-lib");
    const out = await PDFDocument.load(ours);
    let joined = 0;
    for (let i = 0; i < appends.length; i++) {
      try {
        const theirs = await PDFDocument.load(Buffer.from(appends[i], "base64"));
        const copied = await out.copyPages(theirs, theirs.getPageIndices());
        copied.forEach((p) => out.addPage(p));
        joined++;
      } catch (e) {
        throw new HttpsError("invalid-argument",
          "The report was produced, but attachment " + (i + 1) + " could not be joined to it (" +
          ((e && e.message) || "unreadable") + ").");
      }
    }
    const merged = await out.save();
    return { pdf: Buffer.from(merged).toString("base64"), pages: out.getPageCount(), joined: joined };
  }
);

// Send the finished report to the board, with the PDF attached.
exports.nnsccWeeklySend = onCall(
  { region: "us-central1", memory: "512MiB", timeoutSeconds: 120, maxInstances: 2 },
  async (request) => {
    await requireArrearsEditor(request);
    const db = admin.firestore();
    const [cfgSnap, boardSnap, conSnap] = await Promise.all([
      db.doc("nnsccQuoteTrackerConfig/main").get(),
      db.doc("nnsccQuoteTracker/board").get(),
      db.doc(ALERT_PATHS.contracts).get(),
    ]);
    const key = cfgSnap.exists && cfgSnap.data().resendKey;
    if (!key) throw new HttpsError("failed-precondition", "No Resend API key has been saved yet.");
    const settings = (conSnap.exists && conSnap.data().alerts) || {};
    const from = settings.from || ALERT_DEFAULTS.from;
    const members = ((boardSnap.exists && boardSnap.data().members) || []).map((e) => String(e).toLowerCase());
    const extra = Array.isArray(request.data && request.data.to)
      ? request.data.to.map((e) => String(e).trim().toLowerCase()) : [];
    const to = members.concat(extra).filter((e, i, a) => e && a.indexOf(e) === i);
    if (!to.length) throw new HttpsError("failed-precondition", "No board members are listed to send to.");
    const pdf = String((request.data && request.data.pdfB64) || "");
    if (!pdf) throw new HttpsError("invalid-argument", "No report was attached.");
    const subject = String((request.data && request.data.subject) || "Weekly report");
    const body = String((request.data && request.data.html) || "<p>The weekly report is attached.</p>");
    const name = String((request.data && request.data.filename) || "weekly-report.pdf")
      .replace(/[^\w.\-]+/g, "-");
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + key },
      body: JSON.stringify({ from: from, to: to, subject: subject, html: body,
        attachments: [{ filename: name, content: pdf }] }),
    });
    const text = await resp.text();
    if (!resp.ok) throw new HttpsError("internal", "Resend returned HTTP " + resp.status + ": " + text.slice(0, 300));
    return { ok: true, to: to };
  }
);
