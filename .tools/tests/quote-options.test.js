/* A quotation offering alternatives — Firenza #1957: a single PRV for $11,355
   or a dual one for $16,010, both plus HST, for the board to choose between.
   Both were ticked and added: $30,922.45, a price nobody quoted.
   Run: node .tools/tests/quote-options.test.js */
const fs = require("fs");
const src = fs.readFileSync(require("path").join(__dirname, "../../source/beta-template.html"), "utf8");
function grab(n) { const i = src.indexOf("\nfunction " + n + "("); if (i < 0) throw new Error(n); return src.slice(i + 1, src.indexOf("\n}\n", i) + 3); }
function gv(n, end) { const i = src.indexOf("\nvar " + n + " ="); return src.slice(i + 1, src.indexOf(end, i) + end.length) + "\n"; }
const X = new Function(["var HST = 0.13, bidRead = null, state = { jobs: [] }, LOG = [];",
  "function findJob(id) { return state.jobs.filter(function (x) { return x.id === id; })[0] || null; }",
  "function money(n) { return '$' + Number(n).toFixed(2); }",
  "function esc(s) { return String(s == null ? '' : s).replace(/[&<>\"]/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }",
  "function jobLabel(j) { return 'Job ' + j.id; }",
  "function qcTouch() {} function renderEditor() {} function renderReport() {} var _id = 0; function genId() { return 'q' + (++_id); }",
  "function persist(a, notes) { LOG = LOG.concat(notes || []); }",
  "var intakePending = null;",
  "var document = { querySelectorAll: function () { return []; } };",
  gv("BID_DET", '["notes", "Scope note"]];'),
  ["bidReadRows", "partsNote", "bidReadDetails", "bidReadDone", "bidReadTrim", "optLine", "optionQuotes",
   "optKey", "bidHoldsOpt", "bidReadPlan", "bidPartsOf", "bidHeldOpts", "bidSameFile", "bidOptOf", "bidOwnOpt", "bidReadQid", "optBare", "jobCalc", "bidQuoteKey", "bidTotal", "conKey", "quoteFileHeld", "bidReadApply", "bidReadPanelHTML",
   "intakeLines", "intakeRows", "intakeQuotes", "intakeTicks"].map(grab).join("\n"),
  "return { bidReadRows, partsNote, bidReadDetails, bidReadDone, optionQuotes, bidReadPlan, quoteFileHeld, bidPartsOf,",
  "  bidReadApply, bidReadPanelHTML, intakeQuotes, intakeRows, jobCalc,",
  "  set: function (b, jobs) { bidRead = b; state.jobs = jobs; LOG = []; }, log: function () { return LOG; }, read: function () { return bidRead; } };"].join("\n"))();
let pass = 0, fail = 0;
const is = (g, w, t) => { JSON.stringify(g) === JSON.stringify(w) ? pass++ : (fail++, console.log("FAIL  " + t + "\n      got  " + JSON.stringify(g) + "\n      want " + JSON.stringify(w))); };

const FILE = "1957HTGRC-550 North Service Rd - DHW PRV Replacement.pdf";
const firenza = { contractor: "Firenza Plumbing & Heating Ltd.", quote_number: "1957HTGRC", quote_date: "2026-11-20",
  scope_notes: "Quote presents two alternative options for the PRV replacement.",
  amount_cad: 11355, hst_included: false, lines_include_hst: false,
  lines: [
    { description: "Option #1 – Single PRV", amount: 11355, for_this_job: true, line_note: "", option: "Option #1" },
    { description: "Dual PRV (2\" and 3\" Clayton)", amount: 16010, for_this_job: true, line_note: "", option: "Option #2" }] };
const PATH = "quoteAttachments/j25/1-" + FILE;
const readAt = (path, data, name) => X.bidReadDone(name || FILE, { data }).map((r) => Object.assign(r, { path }));
const rows = readAt(PATH, firenza);

/* reading */
is(rows.map((r) => r.opt), ["Option #1", "Option #2"], "each alternative carries its label");
is(rows.map((r) => r.nopt), [2, 2], "and knows it is one of two");
is(rows[1].line, "Option #2 – Dual PRV (2\" and 3\" Clayton)", "a heading without the label gets it");
is(rows[0].line, "Option #1 – Single PRV", "a heading with it is left alone");
is(rows.map((r) => r.incl), [12831.15, 18091.3], "each levelled to HST-included");

/* never added together */
const q = X.optionQuotes(rows);
is(q.map((x) => x.sum), [12831.15, 18091.3], "two quotes, not one of $30,922.45");
is(X.optionQuotes(rows.map((r, i) => Object.assign({}, r, { ok: i === 1 }))).map((x) => x.sum), [18091.3], "untick one, one quote");
/* a charge that comes with either option is added to each */
const withFee = X.bidReadRows("f.pdf", { lines_include_hst: true, lines: [
  { description: "Mobilisation", amount: 500, for_this_job: true, line_note: "", option: "" },
  { description: "Repair", amount: 1000, for_this_job: true, line_note: "", option: "Option A" },
  { description: "Replace", amount: 4000, for_this_job: true, line_note: "", option: "Option B" }] }, null);
is(X.optionQuotes(withFee).map((x) => x.sum), [1500, 4500], "shared lines go with every option");
/* one line marked as an option is just a line */
const lone = X.bidReadRows("g.pdf", { lines_include_hst: true, lines: [
  { description: "Work", amount: 1000, for_this_job: true, line_note: "", option: "" },
  { description: "Extra", amount: 200, for_this_job: true, line_note: "", option: "Option 1" }] }, null);
is([lone[1].opt, X.optionQuotes(lone).map((x) => x.sum)], ["", [1200]], "a lone 'option' is added like any line");
/* the Rooterworx kind — separate items, no options — is unchanged */
const items = X.bidReadRows("r.pdf", { lines_include_hst: true, lines: [
  { description: "A", amount: 100, for_this_job: true, line_note: "", option: "" },
  { description: "B", amount: 50, for_this_job: true, line_note: "", option: "" }] }, null);
is(X.optionQuotes(items).map((x) => [x.opt, x.sum]), [[null, 150]], "items still add up");

/* the row as it stands today: both options summed into it */
function liveJob() {
  return { id: "j25", bids: [
    { contractor: "", qno: "", amount: null, hst: false, notes: "", files: [] },
    { contractor: "Firenza Plumbing & Heating Ltd.", qno: "1957HTGRC", amount: 30922.45, hst: true, qdate: "2026-11-20",
      notes: "Quote presents two alternative options for the same PRV replacement job: Option #1 and Option #2",
      files: [{ name: FILE, path: "quoteAttachments/j25/1-" + FILE, url: "u" }],
      parts: [{ name: FILE, of: 2, amount: 12831.15, line: "Option #1 – Single PRV" },
              { name: FILE, of: 2, amount: 18091.3, line: "Option #2 – Dual PRV" }] }] };
}
let job = liveJob();
X.set({ jid: "j25", bi: 1, rows: rows }, [job]);
let plan = X.bidReadPlan(job, 1);
is([plan.here.sum, plan.add.map((x) => x.sum), plan.dup.length], [12831.15, [18091.3], 0], "re-reading it: option 1 here, option 2 in a new row");
const html = X.bidReadPanelHTML("j25", 1);
is(html.indexOf("$30922.45") < 0 && html.indexOf("$31") < 0, true, "the panel shows no sum of the two");
is(/Put \$12831\.15 in this row and the other option in a new row/.test(html), true, "the button says what will happen");
is(/offers 2 options/.test(html), true, "the file is said to offer options");
const det = X.bidReadDetails();
is(det.map((d) => [d.f, d.v]), [["notes", "Option #1 – Single PRV"]], "the note becomes this option's");
is(!!det[0].was, true, "and the panel shows what it replaces");
X.bidReadApply();
is(job.bids.length, 3, "one row added");
is([job.bids[1].amount, job.bids[1].notes, job.bids[1].parts.map((p) => p.opt)], [12831.15, "Option #1 – Single PRV", ["Option #1"]], "this row is option 1");
const nb = job.bids[2];
is([nb.contractor, nb.qno, nb.amount, nb.hst, nb.qdate, nb.notes],
   ["Firenza Plumbing & Heating Ltd.", "1957HTGRC", 18091.3, true, "2026-11-20", "Option #2 – Dual PRV (2\" and 3\" Clayton)"], "the new row is option 2");
is([nb.files.length, nb.files[0].path === job.bids[1].files[0].path, nb.files[0] !== job.bids[1].files[0]], [1, true, true], "it holds the same file, as its own copy");
is(X.partsNote(nb.parts), "Option #2, one of 2 options priced in the quotation", "the board is told what the price is");
is([nb.optOf.opt, nb.optOf.path, nb.optOf.amount], ["Option #2", PATH, 18091.3], "the new row knows which option it is");
is(X.log().length, 3, "the note, the amount and the new row are each logged");
is(X.read(), null, "the panel closes");

/* read either row again: nothing is duplicated, each keeps its own option */
X.set({ jid: "j25", bi: 2, rows: readAt(PATH, firenza) }, [job]);
plan = X.bidReadPlan(job, 2);
is([plan.here.opt.label, plan.add.length, plan.dup.length], ["Option #2", 0, 1], "row 2 read again stays option 2");
X.set({ jid: "j25", bi: 1, rows: readAt(PATH, firenza) }, [job]);
plan = X.bidReadPlan(job, 1);
is([plan.here.opt.label, plan.add.length, plan.dup.length], ["Option #1", 0, 1], "row 1 read again stays option 1");
/* the labels a second reading words differently still match */
const reworded = JSON.parse(JSON.stringify(firenza));
reworded.lines[0].option = "Option 1"; reworded.lines[1].option = "option #2"; reworded.lines[1].description = "Two PRVs";
X.set({ jid: "j25", bi: 1, rows: readAt(PATH, reworded) }, [job]);
is(X.bidReadPlan(job, 1).add.length, 0, "a reworded reading adds no duplicate");
/* a blank row reading the same file finds both options already have rows */
X.set({ jid: "j25", bi: 0, rows: readAt(PATH, firenza) }, [job]);
plan = X.bidReadPlan(job, 0);
is([plan.here, plan.add.length, plan.dup.length], [null, 0, 2], "nothing is put twice");

/* a file two rows share */
/* parts remember the stored file they came from */
is(job.bids[2].parts[0].path, "quoteAttachments/j25/1-" + FILE, "parts carry the file's path");
is(X.quoteFileHeld(job.bids[1].files[0].path), true, "held by both rows");
job.bids[1].files = [];
is(X.quoteFileHeld(job.bids[2].files[0].path), true, "removed from one, still held by the other");
job.bids[2].files = [];
is(X.quoteFileHeld("quoteAttachments/j25/1-" + FILE), false, "removed from both, let go");

/* a quotation with no options is read exactly as before */
job = { id: "j9", bids: [{ contractor: "", qno: "", amount: null, hst: false, notes: "", files: [] }] };
X.set({ jid: "j9", bi: 0, rows: items }, [job]);
X.bidReadApply();
is([job.bids.length, job.bids[0].amount, job.bids[0].parts.some((p) => p.opt)], [1, 150, false], "items: one row, summed");

/* review 1: an option priced over several lines is ONE quote */
const multi = X.bidReadRows("m.pdf", { lines_include_hst: true, lines: [
  { description: "Supply", amount: 5000, for_this_job: true, line_note: "", option: "Option A" },
  { description: "Install", amount: 3000, for_this_job: true, line_note: "", option: "Option A" },
  { description: "Supply", amount: 8000, for_this_job: true, line_note: "", option: "Option B" },
  { description: "Install", amount: 4000, for_this_job: true, line_note: "", option: "Option B" }] }, null);
is(multi.map((r) => r.nopt), [2, 2, 2, 2], "four lines, two options");
is(X.optionQuotes(multi).map((x) => [x.opt.label, x.sum]), [["Option A", 8000], ["Option B", 12000]], "each option's lines together");
is(X.intakeQuotes({ file: { name: "m.pdf" }, lines: [
  { description: "Supply", amount: 5000, for_this_job: true, option: "Option A" },
  { description: "Install", amount: 3000, for_this_job: true, option: "Option A" },
  { description: "Supply", amount: 8000, for_this_job: true, option: "Option B" },
  { description: "Install", amount: 4000, for_this_job: true, option: "Option B" }] }, null).map((x) => x.sum), [8000, 12000], "intake groups the same way");
/* two files in one row, one per building, the same options: Option 1 of each together */
const bA = X.bidReadRows("A.pdf", { lines_include_hst: true, lines: [
  { description: "Bldg A single", amount: 100, for_this_job: true, line_note: "", option: "Option 1" },
  { description: "Bldg A dual", amount: 200, for_this_job: true, line_note: "", option: "Option 2" }] }, null);
const bB = X.bidReadRows("B.pdf", { lines_include_hst: true, lines: [
  { description: "Bldg B single", amount: 10, for_this_job: true, line_note: "", option: "Option 1" },
  { description: "Bldg B dual", amount: 20, for_this_job: true, line_note: "", option: "Option 2" }] }, null);
is(X.optionQuotes(bA.concat(bB)).map((x) => x.sum), [110, 220], "per-building files: option 1 with option 1");

/* review 2: two contractors, both sending "Quote.pdf" with Option 1 / Option 2 */
const q2 = (c) => ({ contractor: c, quote_number: c === "X Ltd" ? "11" : "22", lines_include_hst: true, lines: [
  { description: "One unit", amount: c === "X Ltd" ? 1000 : 1100, for_this_job: true, line_note: "", option: "Option 1" },
  { description: "Two units", amount: c === "X Ltd" ? 2000 : 2100, for_this_job: true, line_note: "", option: "Option 2" }] });
const two = { id: "j7", bids: [
  { contractor: "", qno: "", amount: null, hst: false, notes: "", files: [{ name: "Quote.pdf", path: "qa/j7/1-Quote.pdf" }] },
  { contractor: "", qno: "", amount: null, hst: false, notes: "", files: [{ name: "Quote.pdf", path: "qa/j7/2-Quote.pdf" }] }] };
X.set({ jid: "j7", bi: 0, rows: readAt("qa/j7/1-Quote.pdf", q2("X Ltd"), "Quote.pdf") }, [two]);
X.bidReadApply();
X.set({ jid: "j7", bi: 1, rows: readAt("qa/j7/2-Quote.pdf", q2("Y Inc"), "Quote.pdf") }, [two]);
plan = X.bidReadPlan(two, 1);
is([!!plan.here, plan.add.length, plan.dup.length], [true, 1, 0], "Y's options are Y's, not taken for X's");
X.bidReadApply();
is(two.bids.map((b) => [b.contractor, b.amount]), [["X Ltd", 1000], ["Y Inc", 1100], ["X Ltd", 2000], ["Y Inc", 2100]], "four quotes, two each");
/* parts saved before paths: same name is the same file only for the same contractor */
const legacy = { id: "j8", bids: [
  { contractor: "X Ltd", qno: "11", amount: 1000, parts: [{ name: "Quote.pdf", opt: "Option 1", amount: 1000, line: "One unit" }], files: [] },
  { contractor: "X Ltd", qno: "11", amount: 2000, parts: [{ name: "Quote.pdf", opt: "Option 2", amount: 2000, line: "Two units" }], files: [] },
  { contractor: "Y Inc", qno: "", amount: null, notes: "", files: [] }] };
X.set({ jid: "j8", bi: 2, rows: X.bidReadDone("Quote.pdf", { data: q2("Y Inc") }) }, [legacy]);
is(X.bidReadPlan(legacy, 2).dup.length, 0, "old parts: another contractor's same-named file is not a match");
X.set({ jid: "j8", bi: 0, rows: X.bidReadDone("Quote.pdf", { data: q2("X Ltd") }) }, [legacy]);
is(X.bidReadPlan(legacy, 0).dup.length, 1, "old parts: the same contractor's is");
/* a re-read whose label changed but whose money did not */
const relabel = JSON.parse(JSON.stringify(firenza));
relabel.lines[0].option = "Single PRV"; relabel.lines[1].option = "Dual PRV";
X.set({ jid: "j25", bi: 1, rows: readAt(PATH, relabel) }, [liveJob()]);
const lj = liveJob(); X.set({ jid: "j25", bi: 1, rows: readAt(PATH, firenza) }, [lj]); X.bidReadApply();
X.set({ jid: "j25", bi: 1, rows: readAt(PATH, relabel) }, [lj]);
plan = X.bidReadPlan(lj, 1);
is([plan.here && plan.here.sum, plan.add.length, plan.dup.length], [12831.15, 0, 1], "relabelled options are matched by their money");

/* re-review A: two options at the same price, re-read: each keeps its own */
const same = { contractor: "Acme", quote_number: "Q1", lines_include_hst: false, lines: [
  { description: "Repair riser", amount: 5000, for_this_job: true, line_note: "", option: "Option A" },
  { description: "Replace riser", amount: 5000, for_this_job: true, line_note: "", option: "Option B" }] };
const sj = { id: "s1", bids: [{ contractor: "", qno: "", amount: null, hst: false, notes: "", files: [{ name: "a.pdf", path: "qa/s1/a.pdf" }] }] };
X.set({ jid: "s1", bi: 0, rows: readAt("qa/s1/a.pdf", same, "a.pdf") }, [sj]); X.bidReadApply();
X.set({ jid: "s1", bi: 1, rows: readAt("qa/s1/a.pdf", same, "a.pdf") }, [sj]);
plan = X.bidReadPlan(sj, 1);
is([plan.here.opt.label, plan.add.length, plan.dup.map((q) => q.opt.label)], ["Option B", 0, ["Option A"]], "same price: row 2 stays Option B");
X.bidReadApply();
is(sj.bids.map((b) => b.optOf.opt), ["Option A", "Option B"], "and nothing is lost");

/* re-review B: labels alike for 40 characters are still two options */
const longL = X.bidReadRows("l.pdf", { lines_include_hst: true, lines: [
  { description: "x", amount: 1000, for_this_job: true, line_note: "", option: "Alternate 1 - replace the full riser stack in copper type L" },
  { description: "y", amount: 3000, for_this_job: true, line_note: "", option: "Alternate 1 - replace the full riser stack in PEX-a with sleeves" }] }, null);
is(X.optionQuotes(longL).map((q) => q.sum), [1000, 3000], "long labels: two quotes");

/* re-review C: an option's own extra lines are not 'shared' */
const own = X.bidReadRows("o.pdf", { lines_include_hst: true, lines: [
  { description: "Supply A", amount: 1000, for_this_job: true, line_note: "", option: "Option A" },
  { description: "Install A", amount: 500, for_this_job: true, line_note: "", option: "Option A" },
  { description: "Supply B", amount: 2000, for_this_job: true, line_note: "", option: "Option B" }] }, null);
is(X.partsNote(X.bidPartsOf(X.optionQuotes(own)[0])), "Option A, one of 2 options priced in the quotation", "no phantom shared line");
const fee = X.optionQuotes(withFee);
is(X.partsNote(X.bidPartsOf(fee[1])), "Option B, one of 2 options priced in the quotation, with 1 line that come with every option", "a real shared line is counted");

/* re-review E: an amount typed over (parts removed) still knows its option */
const ej = liveJob(); X.set({ jid: "j25", bi: 1, rows: readAt(PATH, firenza) }, [ej]); X.bidReadApply();
ej.bids[2].amount = 18091.31; delete ej.bids[2].parts;
X.set({ jid: "j25", bi: 1, rows: readAt(PATH, firenza) }, [ej]);
plan = X.bidReadPlan(ej, 1);
is([plan.add.length, plan.dup.length], [0, 1], "typed-over row is still option 2: no duplicate");

/* re-review F: rows made from pasted text (no file), then a PDF attached and read */
const tj = { id: "t1", bids: [
  { contractor: "Firenza Plumbing & Heating Ltd.", qno: "1957HTGRC", amount: 11355, files: [],
    parts: [{ name: "", opt: "Option #1", okey: "option1", amount: 12831.15, line: "Option #1 \u2013 Single PRV" }],
    optOf: { opt: "Option #1", okey: "option1", nopt: 2, name: "", amount: 12831.15 } },
  { contractor: "Firenza Plumbing & Heating Ltd.", qno: "1957HTGRC", amount: 16010, files: [],
    parts: [{ name: "", opt: "Option #2", okey: "option2", amount: 18091.3, line: "Option #2" }],
    optOf: { opt: "Option #2", okey: "option2", nopt: 2, name: "", amount: 18091.3 } }] };
tj.bids[0].files = [{ name: FILE, path: PATH }];
X.set({ jid: "t1", bi: 0, rows: readAt(PATH, firenza) }, [tj]);
plan = X.bidReadPlan(tj, 0);
is([plan.here && plan.here.opt.label, plan.add.length, plan.dup.length], ["Option #1", 0, 1], "pasted-text rows are recognised once a PDF is read");

/* re-review G: an old attachment with no path, blank contractor, details unticked */
const gj = { id: "g1", bids: [{ contractor: "", qno: "", amount: null, hst: false, notes: "", files: [{ name: "old.pdf", url: "u" }] }] };
const gRead = () => X.bidReadDone("old.pdf", { data: firenza });
X.set({ jid: "g1", bi: 0, rows: gRead(), noDet: true }, [gj]); X.bidReadApply();
X.set({ jid: "g1", bi: 0, rows: gRead(), noDet: true }, [gj]);
plan = X.bidReadPlan(gj, 0);
is([gj.bids.length, plan.add.length, plan.dup.length], [2, 0, 1], "no-path attachment: second read adds nothing");

/* round 3: a quotation with a shared line, relabelled on a re-read: no duplicate */
const shq = { contractor: "Acme", quote_number: "9", lines_include_hst: true, lines: [
  { description: "Mobilisation", amount: 500, for_this_job: true, line_note: "", option: "" },
  { description: "Repair", amount: 1000, for_this_job: true, line_note: "", option: "Option A" },
  { description: "Replace", amount: 4000, for_this_job: true, line_note: "", option: "Option B" }] };
const shj = { id: "h1", bids: [{ contractor: "", qno: "", amount: null, hst: false, notes: "", files: [{ name: "s.pdf", path: "qa/h1/s.pdf" }] }] };
X.set({ jid: "h1", bi: 0, rows: readAt("qa/h1/s.pdf", shq, "s.pdf") }, [shj]); X.bidReadApply();
is([shj.bids.map((b) => b.amount), shj.bids.map((b) => b.optOf.own)], [[1500, 4500], [1000, 4000]], "own price kept apart from the total");
is(shj.bids[0].optOf.qid && shj.bids[0].optOf.qid === shj.bids[1].optOf.qid, true, "both rows carry one quotation id");
const shq2 = JSON.parse(JSON.stringify(shq)); shq2.lines[1].option = "Option 1"; shq2.lines[2].option = "Option 2";
X.set({ jid: "h1", bi: 0, rows: readAt("qa/h1/s.pdf", shq2, "s.pdf") }, [shj]);
plan = X.bidReadPlan(shj, 0);
is([plan.here && plan.here.sum, plan.add.length, plan.dup.length], [1500, 0, 1], "relabelled with a shared line: matched by own price");

/* round 3/4: equal prices relabelled: the unchanged wording settles which is which */
const eq = JSON.parse(JSON.stringify(same)); eq.lines[0].option = "Option 1"; eq.lines[1].option = "Option 2";
X.set({ jid: "s1", bi: 1, rows: readAt("qa/s1/a.pdf", eq, "a.pdf") }, [sj]);
plan = X.bidReadPlan(sj, 1);
is([plan.blocked, plan.here && plan.here.opt.line, plan.add.length, plan.dup.length], ["", "Option 2 \u2013 Replace riser", 0, 1], "equal prices relabelled: Replace stays Replace");
/* equal prices, relabelled AND reworded: no guess — the row is left alone */
const eq2 = JSON.parse(JSON.stringify(eq)); eq2.lines[0].description = "Fix the riser"; eq2.lines[1].description = "New riser";
X.set({ jid: "s1", bi: 1, rows: readAt("qa/s1/a.pdf", eq2, "a.pdf") }, [sj]);
plan = X.bidReadPlan(sj, 1);
is([plan.blocked, plan.here, plan.add.length], ["Option B", null, 0], "cannot tell: refuses to guess");
is(/could not tell which of its options/.test(X.bidReadPanelHTML("s1", 1)), true, "and says so");
const before = JSON.stringify(sj.bids); X.bidReadApply();
is(JSON.stringify(sj.bids), before, "nothing changes");

/* round 3: an option row re-read by a reading that found no options */
const noopt = JSON.parse(JSON.stringify(firenza)); noopt.lines.forEach((l) => { l.option = ""; });
const nj2 = liveJob(); X.set({ jid: "j25", bi: 1, rows: readAt(PATH, firenza) }, [nj2]); X.bidReadApply();
X.set({ jid: "j25", bi: 2, rows: readAt(PATH, noopt) }, [nj2]);
plan = X.bidReadPlan(nj2, 2);
is([plan.blocked, plan.here], ["Option #2", null], "no options found: an option row is not summed");

/* round 3: another contractor's old same-named file, contractor blank: not a match */
const bl = { id: "b1", bids: [
  { contractor: "", qno: "", amount: 1000, files: [{ name: "Quote.pdf", url: "u" }],
    parts: [{ name: "Quote.pdf", opt: "Option 1", okey: "option1", amount: 1000, line: "x" }] },
  { contractor: "", qno: "", amount: null, notes: "", files: [{ name: "Quote.pdf", path: "qa/b1/new.pdf" }] }] };
X.set({ jid: "b1", bi: 1, rows: readAt("qa/b1/new.pdf", q2("Y Inc"), "Quote.pdf") }, [bl]);
is(X.bidReadPlan(bl, 1).dup.length, 0, "a stored file is not matched by name to an old one");

/* round 4: three options, two at one price, relabelled: re-reading the third adds nothing */
const tri = { contractor: "Acme", quote_number: "77", lines_include_hst: true, lines: [
  { description: "Repair", amount: 5000, for_this_job: true, line_note: "", option: "Option A" },
  { description: "Patch", amount: 5000, for_this_job: true, line_note: "", option: "Option B" },
  { description: "Replace", amount: 7000, for_this_job: true, line_note: "", option: "Option C" }] };
const tj3 = { id: "t3", bids: [{ contractor: "", qno: "", amount: null, hst: false, notes: "", files: [{ name: "q.pdf", path: "qa/t3/q.pdf" }] }] };
X.set({ jid: "t3", bi: 0, rows: readAt("qa/t3/q.pdf", tri, "q.pdf") }, [tj3]); X.bidReadApply();
const tri2 = JSON.parse(JSON.stringify(tri)); tri2.lines.forEach((l, i) => { l.option = "Option " + (i + 1); });
X.set({ jid: "t3", bi: 2, rows: readAt("qa/t3/q.pdf", tri2, "q.pdf") }, [tj3]);
plan = X.bidReadPlan(tj3, 2);
is([plan.here && plan.here.sum, plan.add.length, plan.dup.length], [7000, 0, 2], "tied and relabelled: matched by wording, nothing added");
const tri3 = JSON.parse(JSON.stringify(tri2)); tri3.lines[0].description = "Fix it"; tri3.lines[1].description = "Mend it";
X.set({ jid: "t3", bi: 2, rows: readAt("qa/t3/q.pdf", tri3, "q.pdf") }, [tj3]);
plan = X.bidReadPlan(tj3, 2);
is([plan.add.length, plan.dup.length], [0, 2], "tied, relabelled and reworded: the two rows still hold the two options");

/* round 4: rows split before the quotation id: a re-read gives the id to both */
const lq = { id: "lq", bids: [
  { contractor: "X Co", qno: "1", amount: 1000, hst: true, files: [{ name: "x.pdf", path: "qa/lq/x.pdf" }],
    optOf: { opt: "Option 1", okey: "option1", nopt: 2, name: "x.pdf", path: "qa/lq/x.pdf", amount: 1000, line: "Option 1 \u2013 A" } },
  { contractor: "X Co", qno: "1", amount: 2000, hst: true, files: [{ name: "x.pdf", path: "qa/lq/x.pdf" }],
    optOf: { opt: "Option 2", okey: "option2", nopt: 2, name: "x.pdf", path: "qa/lq/x.pdf", amount: 2000, line: "Option 2 \u2013 B" } }] };
const lqRead = { contractor: "X Co", quote_number: "1", lines_include_hst: true, lines: [
  { description: "A", amount: 1000, for_this_job: true, line_note: "", option: "Option 1" },
  { description: "B", amount: 2000, for_this_job: true, line_note: "", option: "Option 2" }] };
is(X.jobCalc(lq).saving, 0, "before: one quotation");
X.set({ jid: "lq", bi: 0, rows: readAt("qa/lq/x.pdf", lqRead, "x.pdf") }, [lq]); X.bidReadApply();
is([!!lq.bids[0].optOf.qid, lq.bids[0].optOf.qid === lq.bids[1].optOf.qid, X.jobCalc(lq).saving], [true, true, 0], "after a re-read: both rows share the id, still no saving");

/* round 4: a split row reused for another contractor starts its own quotation */
const ru = { id: "ru", bids: [{ contractor: "", qno: "", amount: null, hst: false, notes: "", files: [{ name: "x.pdf", path: "qa/ru/x.pdf" }] }] };
X.set({ jid: "ru", bi: 0, rows: readAt("qa/ru/x.pdf", lqRead, "x.pdf") }, [ru]); X.bidReadApply();
const oldQ = ru.bids[0].optOf.qid;
ru.bids[0].files = [{ name: "y.pdf", path: "qa/ru/y.pdf" }]; ru.bids[0].contractor = "Y Inc"; ru.bids[0].qno = "";
X.set({ jid: "ru", bi: 0, rows: readAt("qa/ru/y.pdf", q2("Y Inc"), "y.pdf") }, [ru]); X.bidReadApply();
is([ru.bids[0].optOf.qid !== oldQ, ru.bids[0].optOf.qid === ru.bids[2].optOf.qid, ru.bids[1].optOf.qid === oldQ], [true, true, true], "Y's options get their own id; X's row keeps X's");

/* AI intake: the same rule */
const d = Object.assign({ file: { name: FILE, path: "p" } }, firenza);
is(X.intakeQuotes(d, null).map((x) => [x.opt.label, x.sum]), [["Option #1", 11355], ["Option #2", 16010]], "intake: one quote per option, on the lines' footing");
is(X.intakeQuotes(d, { 0: false, 1: true }).map((x) => x.sum), [16010], "intake: ticks choose");
is(X.intakeQuotes({ lines: firenza.lines.map((l) => Object.assign({}, l, { option: "" })) }, null).map((x) => x.sum), [27365], "intake without options adds as before");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
