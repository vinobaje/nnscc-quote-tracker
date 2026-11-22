/* AI intake: which quotation file is kept, which removed, and when — every case
   the review found. The real handler and functions, a stubbed page and store.
   Run: node .tools/tests/intake-lifecycle.test.js */
const fs = require("fs");
const src = fs.readFileSync(require("path").join(__dirname, "../../source/beta-template.html"), "utf8");
function grab(n) { const i = src.indexOf("\nfunction " + n + "("); if (i < 0) throw new Error(n); return src.slice(i + 1, src.indexOf("\n}\n", i) + 3); }
function gv(n, end) { const i = src.indexOf("\nvar " + n + " ="); return src.slice(i + 1, src.indexOf(end, i) + end.length) + "\n"; }
const hs = src.indexOf('document.getElementById("aiIntakeFile").addEventListener("change", function () {');
const handlerBody = src.slice(src.indexOf("{", hs + 60) + 1, src.indexOf("\n});", hs));

/* a store whose uploads and reads finish only when the test says so */
let deleted = [], pending = [], statusText = "";
const settle = () => new Promise((r) => setTimeout(r, 0));
const store = { ref: (p) => ({
  put: () => Promise.resolve(),
  getDownloadURL: () => Promise.resolve("https://f/" + p),
  delete: () => { deleted.push(p); return Promise.resolve(); } }) };
const fns = { httpsCallable: () => (payload) => new Promise((res, rej) => pending.push({ payload, res, rej })) };
const el = { intakePreview: { innerHTML: "", style: {}, scrollIntoView() {} }, intakeStatus: { textContent: "" } };
const document = { getElementById: (id) => el[id] || null, querySelectorAll: () => [] };
const X = new Function("cloud", "document", "esc", "money", "todayISO", [
  "var intakePending = null;", gv("intakeSeq", "0;"), "var HST = 0.13;",
  gv("DOC_FILE_MAX", "};"), gv("DOC_FILE_KIND", "};"), gv("DOC_READ_WAIT_MS", ";"),
  grab("docFileFirst"), grab("docUnfile"), grab("docReadCall"),
  grab("intakeStatus"), grab("aiIntakeErr"), grab("aiIntakeShowPreview"), grab("intakePreviewHTML"),
  grab("intakeLines"), grab("intakeLinesHTML"), grab("aiIntakeCancel"), grab("aiIntakeRun"),
  "function pick(file) { (function () {" + handlerBody + "}).call({ files: [file], value: '' }); }",
  "return { pick, aiIntakeRun, aiIntakeCancel, pending: function () { return intakePending; }," +
  " commit: function () { var f = intakePending && intakePending.file; aiIntakeCancel(true); return f; } };",
].join("\n"))({ store, fns, user: {} }, document, (s) => String(s), (n) => "$" + n, () => "2026-11-21");

let pass = 0, fail = 0;
const is = (g, w, t) => { JSON.stringify(g) === JSON.stringify(w) ? pass++ : (fail++, console.log("FAIL  " + t + "\n      got  " + JSON.stringify(g) + "\n      want " + JSON.stringify(w))); };
const pdf = (n, mb) => ({ name: n, type: "application/pdf", size: (mb || 1) * 1024 * 1024 });
const fileOf = () => (X.pending() && X.pending().file && X.pending().file.name) || null;
const readFor = (name) => pending.find((p) => p.payload.fileName === name);
const reset = () => { deleted.length = 0; pending.length = 0; X.aiIntakeCancel(); deleted.length = 0; };

(async () => {
  /* 1. the review's case: A on screen, B too big — A must still be addable, file intact */
  reset();
  X.pick(pdf("A.pdf")); await settle(); readFor("A.pdf").res({ data: { contractor: "A Co" } }); await settle();
  is(fileOf(), "A.pdf", "A is previewed with its file");
  X.pick(pdf("B.pdf", 16)); await settle();
  is(deleted, [], "choosing a too-big B removes nothing");
  is(fileOf(), "A.pdf", "and A is still the preview");
  const kept = X.commit();
  is([kept && kept.name, deleted.length], ["A.pdf", 0], "adding A keeps A's file on the job");

  /* 2. B succeeds: A was never added, so A's file goes when B replaces it */
  reset();
  X.pick(pdf("A.pdf")); await settle(); readFor("A.pdf").res({ data: {} }); await settle();
  const aPath = X.pending().file.path;
  X.pick(pdf("B.pdf")); await settle();
  is(deleted, [], "nothing is removed while B is still being read");
  readFor("B.pdf").res({ data: {} }); await settle();
  is([deleted, fileOf()], [[aPath], "B.pdf"], "A's file goes the moment B's preview replaces it");

  /* 3. B fails after A is on screen: A untouched, B's own file removed */
  reset();
  X.pick(pdf("A.pdf")); await settle(); readFor("A.pdf").res({ data: {} }); await settle();
  X.pick(pdf("B.pdf")); await settle();
  const bPath = readFor("B.pdf").payload.path;
  readFor("B.pdf").rej({ message: "That document has more pages than Claude can read at once" }); await settle();
  is([deleted, fileOf()], [[bPath], "A.pdf"], "a failed B removes only B");

  /* 4. pasted text replaces a file preview: the file is let go */
  reset();
  X.pick(pdf("A.pdf")); await settle(); readFor("A.pdf").res({ data: {} }); await settle();
  const a4 = X.pending().file.path;
  el.aiIntakeText = { value: "Lobby ceiling, $4,850 + HST" };
  X.aiIntakeRun(); await settle();
  pending[pending.length - 1].res({ data: { contractor: "Paste Co" } }); await settle();
  is([deleted, fileOf()], [[a4], null], "a pasted quote's preview lets the file preview's quotation go");

  /* 5a. B chosen before A has even finished filing: A is dropped before Claude
     is asked, so nobody pays for a reading nobody will see */
  reset();
  X.pick(pdf("A.pdf")); X.pick(pdf("B.pdf")); await settle();
  is([!!readFor("A.pdf"), !!readFor("B.pdf")], [false, true], "only B is sent to Claude");
  is(deleted.length === 1 && /-A\.pdf$/.test(deleted[0]), true, "and A's file is removed");
  readFor("B.pdf").res({ data: {} }); await settle();
  is(fileOf(), "B.pdf", "B is shown");

  /* 5b. both being read, the first landing last: the stale reply is dropped */
  reset();
  X.pick(pdf("A.pdf")); await settle();
  const a5 = readFor("A.pdf").payload.path;
  X.pick(pdf("B.pdf")); await settle();
  readFor("B.pdf").res({ data: {} }); await settle();
  readFor("A.pdf").res({ data: {} }); await settle();
  is([fileOf(), deleted], ["B.pdf", [a5]], "the overtaken reply is dropped and its file removed");

  /* 6. cancel while a read is running: when it lands, nothing is shown and its file goes */
  reset();
  X.pick(pdf("A.pdf")); await settle();
  const a6 = readFor("A.pdf").payload.path;
  X.aiIntakeCancel(); readFor("A.pdf").res({ data: {} }); await settle();
  is([X.pending(), deleted], [null, [a6]], "a cancelled read leaves no preview and no file");

  /* 7. added while another is being read: the added job's file is never removed */
  reset();
  X.pick(pdf("A.pdf")); await settle(); readFor("A.pdf").res({ data: {} }); await settle();
  X.pick(pdf("B.pdf")); await settle();
  const added = X.commit();
  readFor("B.pdf").res({ data: {} }); await settle();
  is([added.name, deleted, fileOf()], ["A.pdf", [], "B.pdf"], "A's job keeps its file; B is shown when it lands");

  /* 8. a plain cancel removes the previewed file */
  reset();
  X.pick(pdf("A.pdf")); await settle(); readFor("A.pdf").res({ data: {} }); await settle();
  const a8 = X.pending().file.path; X.aiIntakeCancel();
  is(deleted, [a8], "Cancel removes the quotation filed for the preview");

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
