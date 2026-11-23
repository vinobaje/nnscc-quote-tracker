/* The order quote rows are shown in: a quotation's options together, an empty
   row last, every entry keeping its true position.
   Run: node .tools/tests/show-order.test.js */
const fs = require("fs");
const src = fs.readFileSync(require("path").join(__dirname, "../../source/beta-template.html"), "utf8");
function grab(n) { const i = src.indexOf("\nfunction " + n + "("); if (i < 0) throw new Error(n); return src.slice(i + 1, src.indexOf("\n}\n", i) + 3); }
const X = new Function(["var HST = 0.13;", ["bidShowOrder", "bidQuoteKey", "conKey", "jobCalc", "bidTotal", "bidShareField", "bidOwnFiles"].map(grab).join("\n"),
  "return { bidShowOrder, jobCalc, bidShareField, bidOwnFiles, bidQuoteKey };"].join("\n"))();
let pass = 0, fail = 0;
const is = (g, w, t) => { JSON.stringify(g) === JSON.stringify(w) ? pass++ : (fail++, console.log("FAIL  " + t + "\n      got  " + JSON.stringify(g) + "\n      want " + JSON.stringify(w))); };
const opt = (c, amt, label, qid) => ({ contractor: c, qno: "1", amount: amt, hst: true, files: [{ path: "p/" + c }],
  optOf: { opt: label, okey: label.toLowerCase().replace(/[^a-z0-9]/g, ""), nopt: 2, qid: qid } });
/* job 21 as it is live: blank, Firenza #1, CJM #1, Firenza #2, CJM #2 */
const j21 = { bids: [{ contractor: "", qno: "", amount: null, hst: false, notes: "", files: [] },
  opt("Firenza", 12831.15, "Option #1", "QF"), opt("CJM", 14755.82, "Option #1", "QC"),
  opt("Firenza", 18091.3, "Option #2", "QF"), opt("CJM", 20805, "Option #2", "QC")] };
const o = X.bidShowOrder(j21, X.jobCalc(j21));
is(o.map((g) => g.bi), [1, 3, 2, 4, 0], "Firenza's options together, then CJM's, the empty row last");
is(o.map((g) => g.first), [true, false, true, false, true], "the first row of each quotation is marked");
is(o.map((g) => g.head), [1, 1, 2, 2, 0], "each option row knows its quotation's first row");
/* rows that are not options keep their stored order */
const plain = { bids: [{ contractor: "A", amount: 1, hst: true }, { contractor: "", amount: null }, { contractor: "B", amount: 2, hst: true }] };
is(X.bidShowOrder(plain, X.jobCalc(plain)).map((g) => [g.bi, g.first]), [[0, true], [2, true], [1, true]], "plain quotes in order, blank last");
/* a shared field set on one row holds for its quotation */
const sj = JSON.parse(JSON.stringify(j21));
let k0 = X.bidQuoteKey(sj.bids[1], 1); sj.bids[1].qno = "1957HTGRC"; X.bidShareField(sj, 1, k0, "qno");
is(sj.bids.map((b) => b.qno), ["", "1957HTGRC", "1", "1957HTGRC", "1"], "Firenza's quote # changes on both its options, not CJM's");
/* rows from before the quotation id: keyed by contractor, still found by the key as it was */
const lg = { bids: [
  { contractor: "Acme", qno: "7", amount: 1, hst: true, files: [{ path: "p/x" }], optOf: { opt: "A", okey: "a", nopt: 2, path: "p/x" } },
  { contractor: "Acme", qno: "7", amount: 2, hst: true, files: [{ path: "p/x" }], optOf: { opt: "B", okey: "b", nopt: 2, path: "p/x" } }] };
k0 = X.bidQuoteKey(lg.bids[0], 0); lg.bids[0].contractor = "Acme Plumbing Ltd."; X.bidShareField(lg, 0, k0, "contractor");
is([lg.bids[1].contractor, X.bidQuoteKey(lg.bids[0], 0) === X.bidQuoteKey(lg.bids[1], 1)], ["Acme Plumbing Ltd.", true], "a renamed contractor stays one quotation");
/* the files a row shows */
const fj = { bids: [opt("Firenza", 1, "Option #1", "QF"), opt("Firenza", 2, "Option #2", "QF")] };
fj.bids[1].files.push({ path: "p/revised" });
is(X.bidOwnFiles(fj, { bi: 0, first: true, head: 0 }).map((o) => o.f.path), ["p/Firenza"], "first row: the shared PDF");
is(X.bidOwnFiles(fj, { bi: 1, first: false, head: 0 }).map((o) => [o.f.path, o.fi]), [["p/revised", 1]], "option row: only its own file, with its true index");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
