/* The report's arithmetic with option rows: Firenza's two options are one
   quote, not two bids, and the gap between them is not a saving.
   Run: node .tools/tests/job-calc-options.test.js */
const fs = require("fs");
const src = fs.readFileSync(require("path").join(__dirname, "../../source/beta-template.html"), "utf8");
function grab(n) { const i = src.indexOf("\nfunction " + n + "("); if (i < 0) throw new Error(n); return src.slice(i + 1, src.indexOf("\n}\n", i) + 3); }
const X = new Function(["var HST = 0.13;",
  ["jobCalc", "bidQuoteKey", "bidTotal", "conKey", "bidsWord"].map(grab).join("\n"),
  "return { jobCalc, bidsWord };"].join("\n"))();
let pass = 0, fail = 0;
const is = (g, w, t) => { JSON.stringify(g) === JSON.stringify(w) ? pass++ : (fail++, console.log("FAIL  " + t + "\n      got  " + JSON.stringify(g) + "\n      want " + JSON.stringify(w))); };
const P = "qa/j25/f.pdf", C = "qa/j25/c.pdf";
const opt = (c, q, amt, label, path) => ({ contractor: c, qno: q, amount: amt, hst: true, files: [{ path }],
  optOf: { opt: label, okey: label.toLowerCase().replace(/[^a-z0-9]/g, ""), path, name: "x", nopt: 2, amount: amt } });
const fir = [opt("Firenza Plumbing & Heating Ltd.", "1957HTGRC", 12831.15, "Option #1", P), opt("Firenza Plumbing & Heating Ltd.", "1957HTGRC", 18091.3, "Option #2", P)];
let c = X.jobCalc({ bids: fir });
is([c.cost, c.saving, c.invited, c.rows, c.priced], [12831.15, 0, 1, 2, 1], "Firenza alone: one quote, two options, no saving");
is(c.bids.map((x) => x.lowest), [false, false], "nor a 'lowest price' within one quote");
is(X.bidsWord(c), "2 options", "the chip says options");
const cjm = [opt("C.J.M. Mechanical Ltd.", "1279", 14755.82, "Option #1", C), opt("C.J.M. Mechanical Ltd.", "1279", 20805, "Option #2", C)];
c = X.jobCalc({ bids: fir.concat(cjm) });
is([c.cost, c.saving, c.invited, c.rows, c.priced], [12831.15, 1924.67, 2, 4, 2], "with CJM: two bids, saving against CJM only");
is(X.bidsWord(c), "2 bids", "and the chip says bids");
/* rows without options behave as ever */
c = X.jobCalc({ bids: [{ contractor: "A", amount: 100, hst: true }, { contractor: "B", amount: 150, hst: true }, { contractor: "", amount: null }] });
is([c.cost, c.saving, c.invited, c.rows, c.priced, c.bids[0].lowest], [100, 50, 2, 2, 2, true], "plain quotes unchanged");
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
