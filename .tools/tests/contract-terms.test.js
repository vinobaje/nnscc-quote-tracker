/* A contract's current term and price: M.C. Mechanical's HVAC agreement —
   $8,688 a month from Sep 1 2022, +2.7% a year, three-year terms that renew.
   Run: node .tools/tests/contract-terms.test.js */
const fs = require("fs");
const src = fs.readFileSync(require("path").join(__dirname, "../../source/beta-template.html"), "utf8");
function grab(n) { const i = src.indexOf("\nfunction " + n + "("); if (i < 0) throw new Error(n); return src.slice(i + 1, src.indexOf("\n}\n", i) + 3); }
function at(iso) {   /* the register's functions, run as if today were iso */
  const RealDate = Date;
  const fixed = new RealDate(iso + "T12:00:00");
  function D(...a) { return a.length ? new RealDate(...a) : new RealDate(fixed.getTime()); }
  D.prototype = RealDate.prototype; D.now = () => fixed.getTime(); D.UTC = RealDate.UTC;
  return new Function("Date", ["function jdDate(s) { return s; }",
    ["conDaysUntil", "conTermEnd", "conAmountNow", "conAnnual", "conNoticeBy", "conCalc"].map(grab).join("\n"),
    "return { conTermEnd, conAmountNow, conAnnual, conNoticeBy, conCalc };"].join("\n"))(D);
}
let pass = 0, fail = 0;
const is = (g, w, t) => { JSON.stringify(g) === JSON.stringify(w) ? pass++ : (fail++, console.log("FAIL  " + t + "\n      got  " + JSON.stringify(g) + "\n      want " + JSON.stringify(w))); };
const hvac = { start: "2022-09-01", end: "2025-08-31", renew: true, renewYears: 3, noticeDays: 60, amount: 8688, period: "month", escPct: 2.7 };
let X = at("2026-11-23");
is(X.conTermEnd(hvac), "2028-08-31", "renewed: the current term ends Aug 31, 2028");
const k = X.conCalc(hvac);
is([k.state, k.label, k.rolled], ["active", "Renewed to 2028-08-31", true], "active, not 'Expired Aug 31, 2025'");
is(X.conAmountNow(hvac), { amount: 9664.99, year: 5 }, "year 5 (from Sep 2026): $8,688 × 1.027⁴");
is(X.conAnnual(hvac), 115979.88, "a year at today's price");
is(X.conNoticeBy(hvac), "2028-07-02", "notice before the current term renews");
X = at("2023-03-01");
is([X.conAmountNow(hvac).amount, X.conTermEnd(hvac)], [8688, "2025-08-31"], "year 1: the stated price, the first term");
X = at("2023-09-01");
is(X.conAmountNow(hvac).amount, 8922.58, "year 2 starts on the anniversary");
/* no increase, no renewal: unchanged */
X = at("2026-11-23");
const plain = { start: "2024-01-01", end: "2025-12-31", renew: false, amount: 1200, period: "year" };
is([X.conCalc(plain).state, X.conAnnual(plain), X.conTermEnd(plain)], ["expired", 1200, "2025-12-31"], "a contract that does not renew still expires");
const noYrs = { start: "2024-01-01", end: "2025-12-31", renew: true, amount: 100, period: "month" };
is(X.conTermEnd(noYrs), "2025-12-31", "renews, but for how long unknown: the date is left as entered");
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
