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
    ["conDaysUntil", "conMoney", "conNum", "conAddMonths", "conTermEnd", "conAmountNow", "conAnnual", "conNoticeBy", "conCalc", "conFieldSame"].map(grab).join("\n"),
    "return { conTermEnd, conAmountNow, conAnnual, conNoticeBy, conCalc, conNum, conMoney, conFieldSame };"].join("\n"))(D);
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
/* review: what she types in the boxes */
X = at("2026-11-22");
const typed = Object.assign({}, hvac, { amount: "8688", escPct: "2.7%", renewYears: "3 years", noticeDays: "60" });
is([X.conAmountNow(typed).amount, X.conCalc(typed).label], [9664.99, "Renewed to 2028-08-31"], "'2.7%' and '3 years' are read as 2.7 and 3");
is(X.conAmountNow(Object.assign({}, hvac, { escPct: "2,7" })).amount, 9664.99, "a comma decimal too");
is([X.conAmountNow(Object.assign({}, hvac, { amount: "8,688" })).amount, X.conAmountNow(Object.assign({}, hvac, { amount: "$8,688.00" })).amount], [9664.99, 9664.99], "an amount's comma is thousands");
/* review: Feb 29, and terms that are not whole years */
const leap = { end: "2024-02-29", renew: true, renewYears: 3, noticeDays: 60, amount: 1, period: "year", start: "2021-03-01" };
is([X.conTermEnd(leap), X.conNoticeBy(leap)], ["2027-02-28", "2026-12-30"], "Feb 29 rolls to Feb 28, a real day");
is(X.conTermEnd({ end: "2025-06-30", renew: true, renewYears: 1.5 }), "2026-12-30", "an 18-month renewal steps in months");
/* review: a renewing contract inside its last 90 days renews, it does not end */
X = at("2028-07-15");
is(X.conCalc(hvac).label, "Renews 2028-08-31", "notice passed: it renews");
X = at("2028-06-15");
is(X.conCalc(Object.assign({}, hvac, { noticeDays: "" })).label, "Renews in 77 days", "no notice period: 'Renews in N days'");
X = at("2028-08-31");
is(X.conCalc(Object.assign({}, hvac, { noticeDays: "" })).label, "Renews today", "on its last day it renews today");
X = at("2026-11-22");
is(X.conNoticeBy(Object.assign({}, hvac, { noticeDays: "60 days" })), "2028-07-02", "'60 days' is 60 days");
/* review: an ended contract stops rising when it ends */
X = at("2030-01-01");
const ended = { start: "2022-09-01", end: "2025-08-31", renew: false, amount: 8688, period: "month", escPct: 2.7 };
is(X.conAmountNow(ended), { amount: 9163.49, year: 3 }, "ended in year 3: its last price, not 2030's");
/* the alert emails agree with the page */
const fsrc = fs.readFileSync(require("path").join(__dirname, "../../functions/index.js"), "utf8");
function fgrab(n) { const i = fsrc.indexOf("\nfunction " + n + "("); if (i < 0) throw new Error(n); return fsrc.slice(i + 1, fsrc.indexOf("\n}\n", i) + 3); }
const S = new Function(["alertDaysUntil", "alertNum", "alertAddMonths", "alertTermEnd", "alertNoticeBy"].map(fgrab).join("\n") + "return { alertTermEnd, alertNoticeBy };")();
const T = Date.UTC(2026, 10, 22);
X = at("2026-11-22");
[hvac, typed, leap, { end: "2025-06-30", renew: true, renewYears: 1.5, noticeDays: 30 }, Object.assign({}, hvac, { noticeDays: "60 days" })].forEach((c, i) => {
  is([S.alertTermEnd(c, T), S.alertNoticeBy(c, T)], [X.conTermEnd(c), X.conNoticeBy(c)], "emails and page agree (" + i + ")");
});

/* deep review */
X = at("2026-11-23");
const brock = { start: "2020-06-01", end: "2025-05-31", renew: true, renewYears: "", amount: "1300", period: "month" };
is([X.conCalc(brock).state, X.conCalc(brock).label, X.conAnnual(brock)], ["open", "Renewed \u2014 term not recorded", 15600], "renews, length unknown: not 'Expired', and still counted");
is([X.conNum("60 or 90 days"), X.conNum("2.7%"), X.conMoney("$8,688.00 monthly"), X.conMoney("1,450.50"), X.conMoney("8688")], [60, 2.7, 8688, 1450.5, 8688], "the first number typed, commas as thousands");
is([X.conFieldSame("escPct", "2.7%", "2.7"), X.conFieldSame("noticeDays", "60 days", "60"), X.conFieldSame("amount", "$8,688.00", "8688"), X.conFieldSame("amount", "9664.99", "8688")], [true, true, true, false], "the register's value and the document's compared as numbers");

/* verification pass */
is([X.conNum(".5"), X.conNum(".5%"), X.conMoney("8 688.00"), X.conMoney(".75"), X.conMoney("1,450.50")], [0.5, 0.5, 8688, 0.75, 1450.5], "a leading point, and a space for thousands");
const brock2 = Object.assign({}, brock, { start: "2020-06-01", escPct: 3 });
is(X.conAmountNow(brock2).year, 7, "renewed with the length unknown: the price still rises with the years");
is(X.conAmountNow({ start: "2020-06-01", end: "2022-05-31", renew: false, amount: 100, period: "month", escPct: 3 }).year, 2, "one that really ended stops where it ended");
[{ end: "2025-06-30", renew: true, renewYears: ".5", noticeDays: "60 or 90 days" }, Object.assign({}, hvac, { noticeDays: "60 or 90 days" })].forEach((c, i) => {
  is([S.alertTermEnd(c, T), S.alertNoticeBy(c, T)], [at("2026-11-22").conTermEnd(c), at("2026-11-22").conNoticeBy(c)], "emails and page agree on typed values (" + i + ")");
});

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
