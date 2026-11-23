/* A quotation pricing several jobs, read for one of them (Rooterworx #35607).
   Run: node .tools/tests/quote-lines.test.js */
const fs = require("fs");
const src = fs.readFileSync(require("path").join(__dirname, "../../source/beta-template.html"), "utf8");
function grab(n) { const i = src.indexOf("\nfunction " + n + "("); if (i < 0) throw new Error(n); return src.slice(i + 1, src.indexOf("\n}\n", i) + 3); }
function gv(n, end) { const i = src.indexOf("\nvar " + n + " ="); return src.slice(i + 1, src.indexOf(end, i) + end.length) + "\n"; }
const X = new Function(["var HST = 0.13, bidRead = null, JOBS = [];",
  "function findJob(id) { return JOBS.filter(function (x) { return x.id === id; })[0] || null; }",
  gv("BID_DET", '["notes", "Scope note"]];'),
  grab("bidReadRows"), grab("partsNote"), grab("intakeLines"), grab("bidReadDetails"), grab("bidReadDone"), grab("bidReadTrim"),
  grab("optLine"), grab("optionQuotes"), grab("optKey"), grab("bidHoldsOpt"), grab("bidReadPlan"), grab("bidHeldOpts"), grab("bidSameFile"), grab("bidOwnOpt"), grab("optBare"), grab("conKey"), grab("conLoose"), grab("optConOwn"),
  "return { bidReadRows, partsNote, intakeLines, bidReadDetails, bidReadDone, set: function (b, j) { bidRead = b; JOBS = j; } };"].join("\n"))();
let pass = 0, fail = 0;
const is = (g, w, t) => { JSON.stringify(g) === JSON.stringify(w) ? pass++ : (fail++, console.log("FAIL  " + t + "\n      got  " + JSON.stringify(g) + "\n      want " + JSON.stringify(w))); };

const rw = { contractor: "Rooterworx", quote_number: "35607", amount_cad: 14500, hst_included: false, lines_include_hst: false,
  lines: [
    { description: "Asphalt Replacement 90 Sq Ft", amount: 3500, for_this_job: false, line_note: "" },
    { description: "Replace Five Area Drains", amount: 14500, for_this_job: true, line_note: "" },
    { description: "Asphalt Crack Repair 16ft Long", amount: 1350, for_this_job: false, line_note: "" },
    { description: "Concrete Grinding 10ft by 20ft", amount: 2850, for_this_job: false, line_note: "" },
    { description: "Install Additional Sewer Pump", amount: 8570, for_this_job: false, line_note: "" }] };
const rows = X.bidReadRows("rw.pdf", rw, null);
is(rows.map((r) => r.ok), [false, true, false, false, false], "only the drain line is ticked");
is(rows[1].incl, 16385, "$14,500 + HST");
is(Math.round(rows.reduce((s, r) => s + r.incl, 0) * 100) / 100, 34770.1, "every line together is the document total");
is(rows.every((r) => r.of === 5), true, "each line knows it is one of five");
is(X.bidReadRows("x.pdf", { lines_include_hst: true, lines: [{ description: "A", amount: 1130, for_this_job: true, line_note: "" }] }, null)[0].incl,
   1130, "lines already including HST are not taxed twice");
const old = X.bidReadRows("old.pdf", { quote_number: "9", amount_cad: 1000, hst_included: false }, null);
is([old.length, old[0].incl, old[0].ok], [1, 1130, true], "a reply with no lines falls back to its total");
is(X.bidReadRows("e.pdf", { amount_cad: null }, null)[0].why, "no total found in it", "and says when there is none");
is(X.partsNote([{ name: "rw.pdf", line: "Drains", of: 5, amount: 1 }]), "one line of a quotation pricing 5 items", "the board is told");
is(X.partsNote([{ name: "a.pdf" }, { name: "b.pdf" }]), "total of 2 quotations", "several files read as before");
is(X.intakeLines(rw).length, 5, "intake sees the same five lines");
/* bidReadDone: the reply, whichever route brought the document */
const done = X.bidReadDone("rw.pdf", { data: Object.assign({ quote_date: "2026-10-21", scope_notes: "Replace five area drains" }, rw) });
is([done.length, done[1].det.contractor, done[1].det.qno, done[1].det.qdate], [5, "Rooterworx", "35607", "2026-10-21"], "details ride on every line");
X.set({ jid: "j10", bi: 0, rows: done }, [{ id: "j10", bids: [{ contractor: "", qno: "", qdate: "", notes: "", amount: null }] }]);
is(X.bidReadDetails().map((d) => d.f), ["contractor", "qno", "qdate", "notes"], "and are offered once, not once per line");
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
