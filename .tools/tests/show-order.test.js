/* The order quote rows are shown in: a quotation's options together, an empty
   row last, every entry keeping its true position.
   Run: node .tools/tests/show-order.test.js */
const fs = require("fs");
const src = fs.readFileSync(require("path").join(__dirname, "../../source/beta-template.html"), "utf8");
function grab(n) { const i = src.indexOf("\nfunction " + n + "("); if (i < 0) throw new Error(n); return src.slice(i + 1, src.indexOf("\n}\n", i) + 3); }
const X = new Function(["var HST = 0.13;", ["bidShowOrder", "bidQuoteKey", "conKey", "jobCalc", "bidTotal"].map(grab).join("\n"),
  "return { bidShowOrder, jobCalc };"].join("\n"))();
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
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
