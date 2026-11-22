/* storedDocB64, docTooLarge and docRefusal, lifted out of functions/index.js
   and run against a stubbed file store. Run: node .tools/tests/stored-doc.test.js */
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "../../functions/index.js"), "utf8");
function grab(head) {
  const i = src.indexOf(head);
  if (i < 0) throw new Error("not found: " + head);
  return src.slice(i, src.indexOf("\n}\n", i) + 3);
}
class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
let files = {};          /* path -> Buffer */
const admin = { storage: () => ({ bucket: () => ({ file: (p) => ({
  getMetadata: async () => { if (!files[p]) throw new Error("No such object"); return [{ size: String(files[p].length) }]; },
  download: async () => { if (!files[p]) throw new Error("No such object"); downloads.push(p); return [files[p]]; },
}) }) }) };
let downloads = [];
const capLine = src.slice(src.indexOf("const STORED_DOC_MAX"), src.indexOf(";", src.indexOf("const STORED_DOC_MAX")) + 1);
const code = [capLine, 'const CONTRACT_BUCKET = "b";',
  grab("async function storedDocB64("), grab("function docTooLarge("), grab("function docRefusal("),
  "return { storedDocB64, docTooLarge, docRefusal, STORED_DOC_MAX };"].join("\n");
const X = new Function("HttpsError", "admin", code)(HttpsError, admin);

let pass = 0, fail = 0;
const is = (g, w, t) => { JSON.stringify(g) === JSON.stringify(w) ? pass++ : (fail++, console.log("FAIL  " + t + "\n      got  " + JSON.stringify(g) + "\n      want " + JSON.stringify(w))); };
const rejects = async (p, t) => { try { await p; fail++; console.log("FAIL  " + t + " — resolved"); return null; } catch (e) { pass++; return e; } };

(async () => {
  is(X.STORED_DOC_MAX, 25 * 1024 * 1024, "the cap sits above every folder's upload ceiling");
  files["contractFiles/c1/123-hvac.pdf"] = Buffer.from("%PDF-1.7 hello");
  is(await X.storedDocB64("contractFiles/c1/123-hvac.pdf", "contractFiles/"),
     Buffer.from("%PDF-1.7 hello").toString("base64"), "a filed contract comes back as base64");

  /* the folder a mode may read from is the only one it reads from */
  downloads = [];
  let e = await rejects(X.storedDocB64("boardMinutes/2026-10.pdf", "contractFiles/"), "minutes refused to the contract reader");
  is(e && e.code, "invalid-argument", "with a plain refusal");
  e = await rejects(X.storedDocB64("contractFiles/c1/x.pdf", "quoteAttachments/"), "a contract refused to the quote reader");
  e = await rejects(X.storedDocB64("quoteAttachments/../contractFiles/c1/x.pdf", "quoteAttachments/"), "no climbing out with a .. segment");
  e = await rejects(X.storedDocB64("quoteAttachments/j/./a.pdf", "quoteAttachments/"), "nor a . segment");
  e = await rejects(X.storedDocB64("quoteAttachments/", "quoteAttachments/"), "nor the bare folder");
  e = await rejects(X.storedDocB64("quoteAttachments//etc", "quoteAttachments/"), "no empty segments");
  e = await rejects(X.storedDocB64("", "quoteAttachments/"), "an empty path is refused");
  e = await rejects(X.storedDocB64("xquoteAttachments/a.pdf", "quoteAttachments/"), "a lookalike prefix is refused");
  is(downloads.length, 0, "and none of those touched the file store");

  /* the review's finding: company names ending "Ltd." or "Inc." put a ".." in the
     file name, and those were all refused */
  files["contractFiles/c1/1795-Contract with ABC Ltd..pdf"] = Buffer.from("%PDF");
  is(await X.storedDocB64("contractFiles/c1/1795-Contract with ABC Ltd..pdf", "contractFiles/"),
     Buffer.from("%PDF").toString("base64"), "\"ABC Ltd..pdf\" is read");
  files["quoteAttachments/j/1-Roof quote...final.pdf"] = Buffer.from("%PDF");
  is((await X.storedDocB64("quoteAttachments/j/1-Roof quote...final.pdf", "quoteAttachments/")).length > 0, true,
     "and so is \"...final.pdf\"");

  /* gone */
  e = await rejects(X.storedDocB64("contractFiles/c1/gone.pdf", "contractFiles/"), "a missing file is refused");
  is(e && e.code, "not-found", "as not found");

  /* too big: refused from the size alone, never downloaded */
  downloads = [];
  files["contractFiles/c1/huge.pdf"] = { length: 26 * 1024 * 1024 };
  e = await rejects(X.storedDocB64("contractFiles/c1/huge.pdf", "contractFiles/"), "over the cap is refused");
  is(downloads.length, 0, "before a byte of it is downloaded");
  is(/26\.0 MB/.test(e && e.message) && /25\.0 MB/.test(e && e.message), true, "saying both sizes");
  /* the case on the screen: a 9 MB colour scan now reads */
  files["contractFiles/c1/scan.pdf"] = Buffer.alloc(9 * 1024 * 1024, 1);
  is((await X.storedDocB64("contractFiles/c1/scan.pdf", "contractFiles/")).length > 0, true, "a 9 MB scan is read");
  files["contractFiles/c1/max.pdf"] = Buffer.alloc(20 * 1024 * 1024, 1);
  is((await X.storedDocB64("contractFiles/c1/max.pdf", "contractFiles/")).length, Math.ceil(20 * 1024 * 1024 / 3) * 4,
     "and so is a contract at the folder's 20 MB ceiling");

  /* Anthropic's refusals, in her words */
  const r = (m) => X.docRefusal(new HttpsError("internal", m));
  is(/more pages/.test(r("PDF pages exceed the limit of 600").message), true, "page limit");
  is(/more pages/.test(r("A maximum of 100 PDF pages may be provided.").message), true, "Haiku's 100");
  is(/more pages/.test(r("prompt is too long: 1043211 tokens > 1000000 maximum").message), true, "context overflow reads as pages too");
  const other = new HttpsError("internal", "Overloaded");
  is(X.docRefusal(other) === other, true, "anything else passes through untouched");
  is(/page/.test(r("The saved API key was rejected").message), false, "a key error is not mistaken for pages");

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
