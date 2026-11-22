/* conAiRead: the record it is handed is the document read and the name shown.
   Run: node .tools/tests/contract-read.test.js */
const fs = require("fs");
const src = fs.readFileSync(require("path").join(__dirname, "../../source/beta-template.html"), "utf8");
function grab(n) { const i = src.indexOf("\nfunction " + n + "("); if (i < 0) throw new Error(n); return src.slice(i + 1, src.indexOf("\n}\n", i) + 3); }
function gv(n, end) { const i = src.indexOf("\nvar " + n + " ="); return src.slice(i + 1, src.indexOf(end, i) + end.length) + "\n"; }
let sent = [], fails = [];
const contracts = { c1: { id: "c1", files: [
  { name: "2022 HVAC contract (colour).pdf", path: "contractFiles/c1/1-2022 HVAC contract (colour).pdf" },
  { name: "older addendum.docx", path: "contractFiles/c1/2-older addendum.docx" }] } };
const X = new Function("cloud", [
  "var conAiPending = null, conAiMsg = null, conAiBusy = '';",
  "function conById(id) { return CONTRACTS[id] || null; }",
  "function isEditor() { return true; }",
  "function renderEditor() {}",
  "function conAiFail(cid, t) { FAILS.push(t); }",
  gv("DOC_READ_WAIT_MS", ";"), grab("docReadCall"), grab("conAiRead"),
  "return { conAiRead };"].join("\n").replace("CONTRACTS[id]", "contracts[id]").replace("FAILS.push", "fails.push")
  .replace("return { conAiRead };", "return { conAiRead, set: function (c, f) { contracts = c; fails = f; } };")
  .replace("var conAiPending", "var contracts, fails; var conAiPending"))({
    fns: { httpsCallable: () => (p) => { sent.push(p); return new Promise(() => {}); } }, user: {} });
X.set(contracts, fails);
let pass = 0, fail = 0;
const is = (g, w, t) => { JSON.stringify(g) === JSON.stringify(w) ? pass++ : (fail++, console.log("FAIL  " + t + "\n      got  " + JSON.stringify(g) + "\n      want " + JSON.stringify(w))); };

/* just filed: the record handed over is read, even though it is not last in the list */
X.conAiRead("c1", contracts.c1.files[0]);
is([sent[0].path, sent[0].fileName, sent[0].mediaType], ["contractFiles/c1/1-2022 HVAC contract (colour).pdf",
   "2022 HVAC contract (colour).pdf", "application/pdf"], "the record handed over is the one read, by name and type");
is("fileB64" in sent[0], false, "by path, with no bytes");
/* re-read: the latest attachment */
sent.length = 0; X.conAiRead("c1", null);
is([sent[0].path, sent[0].mediaType], ["contractFiles/c1/2-older addendum.docx", "docx"], "a re-read takes the latest, as before");
/* nothing attached */
sent.length = 0; contracts.c2 = { id: "c2", files: [] }; X.conAiRead("c2", null);
is([sent.length, fails[fails.length - 1]], [0, "Attach the signed document first."], "nothing attached says so");
/* not a PDF or Word */
sent.length = 0; contracts.c3 = { id: "c3", files: [{ name: "photo.jpg", path: "contractFiles/c3/photo.jpg" }] };
X.conAiRead("c3", null);
is(sent.length === 0 && /neither/.test(fails[fails.length - 1]), true, "an image is refused before any call");
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
