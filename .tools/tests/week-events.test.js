/* The weekly report's "changes in this period": each quote against itself.
   Run: node .tools/tests/week-events.test.js */
const fs = require("fs");
const src = fs.readFileSync(require("path").join(__dirname, "../../source/beta-template.html"), "utf8");
function grab(n) { const i = src.indexOf("\nfunction " + n + "("); if (i < 0) throw new Error(n); return src.slice(i + 1, src.indexOf("\n}\n", i) + 3); }
const X = new Function(["var HST = 0.13;", "function jobLabel(j) { return 'Job ' + j.no; } function money(n) { return '$' + Number(n).toFixed(2); }",
  "function statusLabel(s) { return s; }",
  ["actWeekEvents", "jobCalc", "bidQuoteKey", "bidTotal", "conKey"].map(grab).join("\n"), "return { actWeekEvents };"].join("\n"))();
let pass = 0, fail = 0;
const is = (g, w, t) => { JSON.stringify(g) === JSON.stringify(w) ? pass++ : (fail++, console.log("FAIL  " + t + "\n      got  " + JSON.stringify(g) + "\n      want " + JSON.stringify(w))); };
const J = (bids, extra) => Object.assign({ id: "j5", no: 5, desc: "Roof", status: "quoted", bids }, extra || {});
const texts = (a, b) => X.actWeekEvents([a], [b]).map((e) => e.text);
/* a row removed above: nobody changed a price */
is(texts(J([{ contractor: "Alpha", amount: 10000, hst: true }, { contractor: "Beta", amount: 12000, hst: true }]),
         J([{ contractor: "Beta", amount: 12000, hst: true }])), [], "a removed row is not a price change on the next one");
/* an option row removed */
const o = (c, amt, opt, qid) => ({ contractor: c, qno: "1", amount: amt, hst: true, optOf: { opt, okey: opt.toLowerCase().replace(/[^a-z0-9]/g, ""), qid, nopt: 2 } });
is(texts(J([o("Firenza", 12831.15, "Option #1", "QF"), o("Firenza", 18091.3, "Option #2", "QF"), { contractor: "CJM", amount: 14755.82, hst: true }]),
         J([o("Firenza", 18091.3, "Option #2", "QF"), { contractor: "CJM", amount: 14755.82, hst: true }])), [], "nor when an option row is removed");
/* a real change, HST included */
is(texts(J([{ contractor: "Alpha", amount: 10000, hst: false }]), J([{ contractor: "Alpha", amount: 11000, hst: false }])),
   ["Price changed on Job 5 — Alpha, $11300.00 to $12430.00."], "a real price change, with HST as the report's tables have it");
is(texts(J([{ contractor: "", amount: null }]), J([{ contractor: "Alpha", amount: 10000, hst: false }])),
   ["Quote received for Job 5 — Alpha, $11300.00."], "a blank row filled in is a quote received");
is(X.actWeekEvents([J([{ contractor: "Alpha", amount: 10000, hst: false }])], [J([{ contractor: "Alpha", amount: 10000, hst: false }], { awardedTo: "Alpha", status: "approved" })]).map((e) => e.amount),
   [11300], "the award figure includes HST");
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
