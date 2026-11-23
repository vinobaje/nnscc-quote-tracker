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
   "optKey", "bidHoldsOpt", "bidReadPlan", "bidPartsOf", "bidHeldOpts", "bidSameFile", "bidOptOf", "bidOwnOpt", "bidReadQid", "optBare", "jobCalc", "bidQuoteKey", "bidTotal", "conKey", "quoteFileHeld", "bidReadApply", "bidReadAnswer", "bidReadAnswerApply", "bidReadView", "bidReadSync", "bidReadSig", "jobFilesOnce", "bidShareField", "bidShowOrder", "bidOwnFiles", "bidReadFiles", "bidOwnDocs", "bidReadPanelHTML",
   "intakeLines", "intakeRows", "intakeQuotes", "intakeTicks"].map(grab).join("\n"),
  "return { bidReadRows, partsNote, bidReadDetails, bidReadDone, optionQuotes, bidReadPlan, quoteFileHeld, bidPartsOf,",
  "  bidReadApply, bidReadAnswer, bidReadPanelHTML, intakeQuotes, intakeRows, jobCalc, jobFilesOnce, bidReadSig, bidReadFiles,",
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
is(X.bidReadPlan(tj, 0).ask, "Option #1", "pasted-text rows: reading a PDF asks first");
X.bidReadAnswer(true);
plan = X.bidReadPlan(tj, 0);
is([plan.here && plan.here.opt.label, plan.add.length, plan.dup.length], ["Option #1", 0, 1], "then the rows are recognised");

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
X.set({ jid: "ru", bi: 0, rows: readAt("qa/ru/y.pdf", q2("Y Inc"), "y.pdf") }, [ru]);
is(X.bidReadPlan(ru, 0).ask, "Option 1", "an option row read from another document with options: asked first");
X.bidReadAnswer(false); X.bidReadApply();
is([ru.bids[0].optOf.qid !== oldQ, ru.bids[0].optOf.qid === ru.bids[2].optOf.qid, ru.bids[1].optOf.qid === oldQ], [true, true, true], "Y's options get their own id; X's row keeps X's");

/* round 5: ties are taken per price group; an option with no row is still added */
const five = { contractor: "Acme", quote_number: "5", lines_include_hst: true, lines: [
  { description: "Fix", amount: 5000, for_this_job: true, line_note: "", option: "Option A" },
  { description: "Repair", amount: 5000, for_this_job: true, line_note: "", option: "Option B" },
  { description: "Patch", amount: 5000, for_this_job: true, line_note: "", option: "Option C" },
  { description: "Reline", amount: 7000, for_this_job: true, line_note: "", option: "Option D" },
  { description: "Rebuild", amount: 9000, for_this_job: true, line_note: "", option: "Option E" }] };
const fj = { id: "f5", bids: [{ contractor: "", qno: "", amount: null, hst: false, notes: "", files: [{ name: "q.pdf", path: "qa/f5/q.pdf" }] }] };
X.set({ jid: "f5", bi: 0, rows: readAt("qa/f5/q.pdf", five, "q.pdf") }, [fj]); X.bidReadApply();
const five2 = { contractor: "Acme", quote_number: "5", lines_include_hst: true, lines: [
  { description: "Repair", amount: 5000, for_this_job: true, line_note: "", option: "Option 1" },
  { description: "Patch", amount: 5000, for_this_job: true, line_note: "", option: "Option 2" },
  { description: "Reline pipes", amount: 7000, for_this_job: true, line_note: "", option: "Option 3" },
  { description: "Reline and coat", amount: 7000, for_this_job: true, line_note: "", option: "Option 4" },
  { description: "Rebuild", amount: 9000, for_this_job: true, line_note: "", option: "Option 5" }] };
X.set({ jid: "f5", bi: 4, rows: readAt("qa/f5/q.pdf", five2, "q.pdf") }, [fj]);
plan = X.bidReadPlan(fj, 4);
is(plan.dup.length + plan.add.length + (plan.here ? 1 : 0), 5, "every option is somewhere");
is(plan.dup.length === 4 && new Set(plan.dupAt).size < plan.dupAt.length, false, "no row is said to hold two options");
is(plan.add.length >= 1, true, "the $7,000 option with no row of its own is added, not lost");

/* round 5: a tie group resolved gives the quotation id to each of its rows */
const tg = { id: "tg", bids: [
  { contractor: "Acme", qno: "77", amount: 6000, hst: true, files: [{ name: "q.pdf", path: "qa/tg/q.pdf" }],
    optOf: { opt: "Option A", okey: "optiona", nopt: 3, name: "q.pdf", path: "qa/tg/q.pdf", amount: 5000, line: "Option A \u2013 Repair" } },
  { contractor: "Acme", qno: "77", amount: 5000, hst: true, files: [{ name: "q.pdf", path: "qa/tg/q.pdf" }],
    optOf: { opt: "Option B", okey: "optionb", nopt: 3, name: "q.pdf", path: "qa/tg/q.pdf", amount: 5000, line: "Option B \u2013 Patch" } },
  { contractor: "Acme", qno: "77", amount: 7000, hst: true, files: [{ name: "q.pdf", path: "qa/tg/q.pdf" }],
    optOf: { opt: "Option C", okey: "optionc", nopt: 3, name: "q.pdf", path: "qa/tg/q.pdf", amount: 7000, line: "Option C \u2013 Replace" } }] };
const tgRead = { contractor: "Acme", quote_number: "77", lines_include_hst: true, lines: [
  { description: "Fix it", amount: 5000, for_this_job: true, line_note: "", option: "Option 1" },
  { description: "Mend it", amount: 5000, for_this_job: true, line_note: "", option: "Option 2" },
  { description: "Replace", amount: 7000, for_this_job: true, line_note: "", option: "Option 3" }] };
X.set({ jid: "tg", bi: 2, rows: readAt("qa/tg/q.pdf", tgRead, "q.pdf") }, [tg]);
plan = X.bidReadPlan(tg, 2);
is([plan.add.length, plan.dupAt.slice().sort()], [0, [0, 1]], "tied rows each hold one option");
X.bidReadApply();
is([tg.bids.length, new Set(tg.bids.map((b) => b.optOf.qid)).size, X.jobCalc(tg).saving], [3, 1, 0], "all three share one id; no saving between options");

/* rounds 5-7: a row made from pasted text has no file to tell it by. Reading a PDF into it asks first. */
const mkPt = (con) => ({ id: "pt", bids: [
  { contractor: con, qno: "1", amount: 1000, hst: true, files: [],
    optOf: { opt: "Option 1", okey: "option1", nopt: 2, name: "", amount: 1000, own: 1000, line: "Option 1 \u2013 A", qid: "QX" } },
  { contractor: con, qno: "1", amount: 2000, hst: true, files: [],
    optOf: { opt: "Option 2", okey: "option2", nopt: 2, name: "", amount: 2000, own: 2000, line: "Option 2 \u2013 B", qid: "QX" } }] });
/* reused for another firm whose name starts the same — "different" */
let pt = mkPt("Townsend Plumbing");
pt.bids[0].contractor = "Townsend Plumbing & Heating"; pt.bids[0].files = [{ name: "y.pdf", path: "qa/pt/y.pdf" }];
const th = JSON.parse(JSON.stringify(q2("Y Inc"))); th.contractor = "Townsend Plumbing & Heating Ltd.";
X.set({ jid: "pt", bi: 0, rows: readAt("qa/pt/y.pdf", th, "y.pdf") }, [pt]);
plan = X.bidReadPlan(pt, 0);
is([plan.ask, plan.here], ["Option 1", null], "asks: is this the pasted-text quotation?");
const ph = X.bidReadPanelHTML("pt", 0);
is([/data-act="readsame"/.test(ph), /data-act="readfresh"/.test(ph), /data-act="readapply"/.test(ph)], [true, true, false], "two answers, no apply button until then");
let snap = JSON.stringify(pt.bids); X.bidReadApply();
is(JSON.stringify(pt.bids), snap, "apply does nothing before the answer");
X.bidReadAnswer(false);
is([!!pt.bids[0].optOf, X.jobCalc(pt).saving], [true, 0], "answering changes nothing yet");
X.bidReadApply();
is([pt.bids[0].optOf.qid !== "QX", pt.bids[1].optOf.qid, X.jobCalc(pt).saving > 0], [true, "QX", true], "read fresh: its own quotation, and the saving against the other firm stands");
/* not renamed, a single-price quote from another firm — "different" reads normally */
pt = mkPt("X Co"); pt.bids[0].files = [{ name: "y.pdf", path: "qa/pt/y.pdf" }];
const single = { contractor: "Y Inc", quote_number: "", lines_include_hst: true, amount_cad: 1100, hst_included: true, lines: [] };
X.set({ jid: "pt", bi: 0, rows: readAt("qa/pt/y.pdf", single, "y.pdf") }, [pt]);
is(X.bidReadPlan(pt, 0).ask, "Option 1", "asks for a single-price document too");
X.bidReadAnswer(false); X.bidReadApply();
is([pt.bids[0].amount, pt.bids[0].optOf], [1100, undefined], "and once answered it is read like any quote");
/* the same quotation: Firenza pasted as "Firenza Plumbing", the PDF says "… & Heating Ltd." */
const pf = { id: "pf", bids: [{ contractor: "Firenza Plumbing", qno: "1957HTGRC", amount: 16010, hst: false, notes: "Option #2", files: [{ name: FILE, path: PATH }],
  optOf: { opt: "Option #2", okey: "option2", nopt: 2, name: "", amount: 18091.3, own: 18091.3, line: "Option #2", qid: "QP" } }] };
const fzLong = JSON.parse(JSON.stringify(firenza)); fzLong.contractor = "Firenza Plumbing & Heating Ltd.";
X.set({ jid: "pf", bi: 0, rows: readAt(PATH, fzLong) }, [pf]);
is(X.bidReadPlan(pf, 0).ask, "Option #2", "asks");
X.bidReadAnswer(true);
is(pf.bids[0].optOf.path, undefined, "'same' is not saved before Apply");
plan = X.bidReadPlan(pf, 0);
is([plan.here && plan.here.opt.label, plan.add.map((q) => q.opt.label)], ["Option #2", ["Option #1"]], "and the row stays Option #2");
X.bidReadApply();
is([pf.bids[0].optOf.opt, pf.bids[0].optOf.qid, pf.bids[1].optOf.qid], ["Option #2", "QP", "QP"], "its quotation id is kept");
is(pf.bids[0].optOf.path, PATH, "and Apply ties it to the file");

/* round 8: 'different' on an un-renamed row: the old quotation's rows cannot claim the new document's options */
pt = mkPt("X Co"); pt.bids[0].files = [{ name: "y.pdf", path: "qa/pt/y.pdf" }];
const y2 = JSON.parse(JSON.stringify(q2("Y Inc"))); y2.lines[0].amount = 1500; y2.lines[1].amount = 2500;
X.set({ jid: "pt", bi: 0, rows: readAt("qa/pt/y.pdf", y2, "y.pdf") }, [pt]);
X.bidReadAnswer(false);
plan = X.bidReadPlan(pt, 0);
is([plan.here && plan.here.sum, plan.add.map((q) => q.sum), plan.dup.length], [1500, [2500], 0], "Y's two options: one here, one new; none taken by X's row");
X.bidReadApply();
is([pt.bids.length, pt.bids[1].optOf.qid, pt.bids[0].optOf.qid === pt.bids[2].optOf.qid, pt.bids[0].optOf.qid !== "QX"], [3, "QX", true, true], "X's row keeps X's id; Y's rows share their own");

/* round 8: 'same' ties to the file the question was about, not the first attachment */
const twoF = { id: "tw", bids: [
  { contractor: "Firenza", qno: "1957", amount: 1000, hst: true, files: [{ name: "photos.pdf", path: "qa/tw/photos.pdf" }, { name: FILE, path: PATH }],
    optOf: { opt: "Option #1", okey: "option1", nopt: 2, name: "", amount: 12831.15, own: 12831.15, line: "Option #1", qid: "QF" } },
  { contractor: "Firenza", qno: "1957", amount: 2000, hst: true, files: [],
    optOf: { opt: "Option #2", okey: "option2", nopt: 2, name: "", amount: 18091.3, own: 18091.3, line: "Option #2", qid: "QF" } }] };
const photoRows = X.bidReadDone("photos.pdf", { data: { amount_cad: null } }).map((r) => Object.assign(r, { path: "qa/tw/photos.pdf" }));
X.set({ jid: "tw", bi: 0, rows: photoRows.concat(readAt(PATH, firenza)) }, [twoF]);
X.bidReadAnswer(true);
plan = X.bidReadPlan(twoF, 0);
is([plan.here && plan.here.opt.label, plan.add.length, plan.dup.length], ["Option #1", 0, 1], "tied to the quotation's file: Option #2's row is recognised");
X.bidReadApply();
is([twoF.bids.length, twoF.bids[0].optOf.path, twoF.bids[1].optOf.path], [2, PATH, PATH], "both rows tied to the quotation, not the photos");

/* round 8: answer, then Cancel: nothing changed */
pt = mkPt("X Co"); pt.bids[0].files = [{ name: "y.pdf", path: "qa/pt/y.pdf" }];
snap = JSON.stringify(pt.bids);
X.set({ jid: "pt", bi: 0, rows: readAt("qa/pt/y.pdf", y2, "y.pdf") }, [pt]);
X.bidReadAnswer(false);
X.set(null, [pt]);   /* Cancel: the reading is dropped */
is([JSON.stringify(pt.bids) === snap, X.jobCalc(pt).saving], [true, 0], "cancelled after answering: the job is as it was");

/* round 6: the row being read, tied, with one option left that no other row can be */
const lt = { id: "lt", bids: [{ contractor: "", qno: "", amount: null, hst: false, notes: "", files: [{ name: "a.pdf", path: "qa/lt/a.pdf" }] }] };
const fixPatch = { contractor: "Acme", quote_number: "3", lines_include_hst: true, lines: [
  { description: "Fix", amount: 5000, for_this_job: true, line_note: "", option: "Option A" },
  { description: "Patch", amount: 5000, for_this_job: true, line_note: "", option: "Option B" }] };
X.set({ jid: "lt", bi: 0, rows: readAt("qa/lt/a.pdf", fixPatch, "a.pdf") }, [lt]); X.bidReadApply();
const fp2 = JSON.parse(JSON.stringify(fixPatch)); fp2.lines[0].option = "Option 1"; fp2.lines[0].description = "Fix it"; fp2.lines[1].option = "Option 2";
X.set({ jid: "lt", bi: 0, rows: readAt("qa/lt/a.pdf", fp2, "a.pdf") }, [lt]);
plan = X.bidReadPlan(lt, 0);
is([plan.blocked, plan.here && plan.here.opt.label, plan.dupAt, plan.add.length], ["", "Option 1", [1], 0], "the one option left is this row's");

/* round 9: a row deleted above the open reading: Apply goes to the right row, or nowhere */
const rj = { id: "rj", bids: [
  { contractor: "", qno: "", amount: null, hst: false, notes: "", files: [] },
  { contractor: "Firenza", qno: "", amount: null, hst: false, notes: "", files: [{ name: "f.pdf", path: "qa/rj/f.pdf" }] },
  { contractor: "Other", qno: "", amount: 9000, hst: true, notes: "", files: [] }] };
X.set({ jid: "rj", bi: 1, bref: rj.bids[1], rows: X.bidReadDone("f.pdf", { data: { contractor: "Firenza", amount_cad: 1000, hst_included: true } }) }, [rj]);
rj.bids.splice(0, 1);                      /* the blank row is deleted */
X.bidReadApply();
is([rj.bids[0].contractor, rj.bids[0].amount, rj.bids[1].amount], ["Firenza", 1000, 9000], "the price goes to Firenza's row, not the one below");
X.set({ jid: "rj", bi: 0, bref: rj.bids[0], rows: X.bidReadDone("f.pdf", { data: { contractor: "Firenza", amount_cad: 2000, hst_included: true } }) }, [rj]);
rj.bids.splice(0, 1);                      /* the row itself is deleted */
X.bidReadApply();
is([rj.bids.length, rj.bids[0].amount, X.read()], [1, 9000, null], "its row gone: nothing written, the reading closed");

/* round 9: changing the ticks after answering asks again */
const tk = mkPt("X Co"); tk.bids[0].files = [{ name: "y.pdf", path: "qa/pt/y.pdf" }];
X.set({ jid: "pt", bi: 0, rows: readAt("qa/pt/y.pdf", y2, "y.pdf") }, [tk]);
X.bidReadAnswer(true);
is(X.bidReadPlan(tk, 0).ask, undefined, "answered");
X.read().rows[0].ok = false; delete X.read().answer;   /* what the tick handler does */
is(X.bidReadPlan(tk, 0).ask, "Option 1", "re-ticked: asked again");

/* round 9: 'different' with nothing to put in the row leaves it as it was */
const nd = mkPt("X Co"); nd.id = "nd"; nd.bids[0].files = [{ name: "y.pdf", path: "qa/nd/y.pdf" }];
nd.bids.push({ contractor: "Y Inc", qno: "22", amount: 1500, hst: true, files: [{ name: "y.pdf", path: "qa/nd/y.pdf" }],
  optOf: { opt: "Option 1", okey: "option1", nopt: 2, name: "y.pdf", path: "qa/nd/y.pdf", amount: 1500, own: 1500, line: "Option 1 \u2013 One unit", qid: "QY", con: "y inc" } });
nd.bids.push({ contractor: "Y Inc", qno: "22", amount: 2500, hst: true, files: [{ name: "y.pdf", path: "qa/nd/y.pdf" }],
  optOf: { opt: "Option 2", okey: "option2", nopt: 2, name: "y.pdf", path: "qa/nd/y.pdf", amount: 2500, own: 2500, line: "Option 2 \u2013 Two units", qid: "QY", con: "y inc" } });
X.set({ jid: "nd", bi: 0, rows: readAt("qa/nd/y.pdf", y2, "y.pdf"), noDet: true }, [nd]);
X.bidReadAnswer(false);
const ndBefore = JSON.stringify(nd.bids[0]); X.bidReadApply();
is([JSON.stringify(nd.bids[0]) === ndBefore, nd.bids[0].optOf.qid, X.jobCalc({ bids: nd.bids.slice(0, 2) }).saving], [true, "QX", 0], "nothing to put in it: the row keeps its option");

/* round 9: a PDF shared by two option rows is listed once */
is(X.jobFilesOnce(job).length <= 1 && X.jobFilesOnce({ bids: [{ files: [{ path: "a" }] }, { files: [{ path: "a" }, { path: "b" }] }] }).length, 2, "shared PDFs counted once");

/* round 10: the cloud hands back fresh copies of every row while Claude reads: the reading stays */
let cj = { id: "cj", bids: [
  { contractor: "", qno: "", amount: null, hst: false, notes: "", files: [] },
  { contractor: "Firenza", qno: "", amount: null, hst: false, notes: "", files: [{ name: "f.pdf", path: "qa/cj/f.pdf" }] }] };
X.set({ jid: "cj", bi: 1, bref: cj.bids[1], sig: X.bidReadSig(cj.bids[1]),
  rows: X.bidReadDone("f.pdf", { data: { contractor: "Firenza", amount_cad: 1000, hst_included: true } }) }, [cj]);
cj = JSON.parse(JSON.stringify(cj)); X.set(X.read(), [cj]);   /* a snapshot: same rows, new objects */
X.bidReadApply();
is([cj.bids[1].amount, cj.bids[0].amount], [1000, null], "a fresh copy of the job: the price still goes to the right row");

/* re-review: an option row with its own revised PDF reads only that */
const rv = { id: "rv", bids: [{ contractor: "", qno: "", amount: null, hst: false, notes: "", files: [{ name: FILE, path: PATH }] }] };
X.set({ jid: "rv", bi: 0, rows: readAt(PATH, firenza) }, [rv]); X.bidReadApply();
rv.bids[1].files.push({ name: "revised.pdf", path: "qa/rv/revised.pdf" });
is(X.bidReadFiles(rv, 1).map((f) => f.name), ["revised.pdf"], "the option row reads its revision, not the shared PDF too");
is(X.bidReadFiles(rv, 0).map((f) => f.name), [FILE], "the first row reads the quotation");
const rev = { contractor: "Firenza Plumbing & Heating Ltd.", quote_number: "1957HTGRC", amount_cad: 15000, hst_included: false, lines: [] };
X.set({ jid: "rv", bi: 1, rows: readAt("qa/rv/revised.pdf", rev, "revised.pdf") }, [rv]); X.bidReadApply();
is([rv.bids[1].amount, rv.bids[1].optOf && rv.bids[1].optOf.opt, rv.bids[1].optOf && rv.bids[1].optOf.qid === rv.bids[0].optOf.qid, X.jobCalc(rv).saving],
   [16950, "Option #2", true, 0], "a one-price revision keeps the row as Option #2, in its quotation, at the new price");

/* re-review: details read on an option row hold for the whole quotation */
const dd = { id: "dd", bids: [{ contractor: "", qno: "", amount: null, hst: false, notes: "", qdate: "", files: [{ name: FILE, path: PATH }] }] };
const noDate = JSON.parse(JSON.stringify(firenza)); noDate.quote_date = ""; noDate.contractor = "";
X.set({ jid: "dd", bi: 0, rows: readAt(PATH, noDate) }, [dd]); X.bidReadApply();
X.set({ jid: "dd", bi: 1, rows: readAt(PATH, firenza) }, [dd]); X.bidReadApply();
is(dd.bids.map((b) => [b.contractor, b.qdate]), [["Firenza Plumbing & Heating Ltd.", "2026-11-20"], ["Firenza Plumbing & Heating Ltd.", "2026-11-20"]], "contractor and date read on Option #2 reach Option #1 too");

/* deep review: the same quotation sent again, or revised, under a new file */
const mkSplit = () => { const j = { id: "rs", bids: [{ contractor: "", qno: "", amount: null, hst: false, notes: "", files: [{ name: FILE, path: PATH }] }] };
  X.set({ jid: "rs", bi: 0, rows: readAt(PATH, firenza) }, [j]); X.bidReadApply(); return j; };
/* (B) the PDF removed and the very same one attached again */
let rs = mkSplit();
rs.bids.forEach((b) => { b.files = []; });
rs.bids[0].files = [{ name: FILE, path: "qa/rs/again.pdf" }];
X.set({ jid: "rs", bi: 0, rows: readAt("qa/rs/again.pdf", firenza) }, [rs]);
plan = X.bidReadPlan(rs, 0);
is([plan.ask, plan.askPasted], ["Option #1", false], "re-attached: asked whether it is the same quotation");
X.bidReadAnswer(true);
plan = X.bidReadPlan(rs, 0);
is([plan.here && plan.here.opt.label, plan.add.length, plan.dup.length], ["Option #1", 0, 1], "same: both options are still their own rows");
X.bidReadApply();
is([rs.bids.length, rs.bids.map((b) => b.amount), X.jobCalc(rs).saving, rs.bids[1].files.map((f) => f.path), rs.bids[0].optOf.qid === rs.bids[1].optOf.qid],
   [2, [12831.15, 18091.3], 0, ["qa/rs/again.pdf"], true], "two rows, no saving, and the second row holds the document too");
/* a revised quotation: every option takes the new figure */
rs = mkSplit();
rs.bids[0].files.push({ name: "rev.pdf", path: "qa/rs/rev.pdf" });
const revised = JSON.parse(JSON.stringify(firenza)); revised.lines[0].amount = 12000; revised.lines[1].amount = 17000;
is(X.bidReadFiles(rs, 0).map((f) => f.path), ["qa/rs/rev.pdf"], "the first row reads the new document only, not old + new");
X.set({ jid: "rs", bi: 0, rows: readAt("qa/rs/rev.pdf", revised, "rev.pdf") }, [rs]);
X.bidReadAnswer(true);
is(/Its own row, updated/.test(X.bidReadPanelHTML("rs", 0)), true, "the panel says the other option's row will be updated");
X.bidReadApply();
is([rs.bids.length, rs.bids.map((b) => b.amount), X.jobCalc(rs).saving], [2, [13560, 19210], 0], "revised: both rows repriced, none added, no saving");
is([X.bidReadFiles(rs, 0).map((f) => f.path), rs.bids[0].optOf.was], [["qa/rs/rev.pdf"], [PATH]], "a later read takes the revision, not the document it replaced");
/* (A) the revised two-option PDF attached to the Option #2 row */
rs = mkSplit();
rs.bids[1].files.push({ name: "rev.pdf", path: "qa/rs/rev.pdf" });
X.set({ jid: "rs", bi: 1, rows: readAt("qa/rs/rev.pdf", revised, "rev.pdf") }, [rs]);
X.bidReadAnswer(true);
plan = X.bidReadPlan(rs, 1);
is(plan.here && plan.here.opt.label, "Option #2", "read on the Option #2 row: it stays Option #2");
X.bidReadApply();
is([rs.bids.length, rs.bids.map((b) => [b.optOf.opt, b.amount])], [2, [["Option #1", 13560], ["Option #2", 19210]]], "and Option #1's row is repriced, not left stale");
/* a one-price revision on the first row is that option's new price, not added to it */
rs = mkSplit();
rs.bids[0].files.push({ name: "one.pdf", path: "qa/rs/one.pdf" });
X.set({ jid: "rs", bi: 0, rows: readAt("qa/rs/one.pdf", { contractor: "Firenza", amount_cad: 10000, hst_included: false, lines: [] }, "one.pdf") }, [rs]);
is(X.bidReadPlan(rs, 0).ask, undefined, "one price: no question");
X.bidReadApply();
is([rs.bids[0].amount, rs.bids[0].optOf.opt, rs.bids[1].amount], [11300, "Option #1", 18091.3], "Option #1 at its revised price; Option #2 untouched");
/* pasted-text rows confirmed as a PDF: every row gets the document */
const pj = { id: "pj", bids: [
  { contractor: "Firenza", qno: "1957", amount: 11355, hst: false, files: [{ name: FILE, path: PATH }],
    optOf: { opt: "Option #1", okey: "option1", nopt: 2, name: "", amount: 12831.15, own: 12831.15, line: "Option #1", qid: "QP" } },
  { contractor: "Firenza", qno: "1957", amount: 16010, hst: false, files: [],
    optOf: { opt: "Option #2", okey: "option2", nopt: 2, name: "", amount: 18091.3, own: 18091.3, line: "Option #2", qid: "QP" } }] };
X.set({ jid: "pj", bi: 0, rows: readAt(PATH, firenza) }, [pj]); X.bidReadAnswer(true); X.bidReadApply();
is(pj.bids[1].files.map((f) => f.path), [PATH], "pasted text confirmed: the sibling row holds the PDF too");

/* verification pass: a row priced from two documents re-reads both */
const A = "qa/mf/A.pdf", B = "qa/mf/B.pdf";
const two2 = (o1, o2) => ({ contractor: "Acme", quote_number: "5", lines_include_hst: true, lines: [
  { description: "single", amount: o1, for_this_job: true, line_note: "", option: "Option #1" },
  { description: "dual", amount: o2, for_this_job: true, line_note: "", option: "Option #2" }] });
let mf = { id: "mf", bids: [{ contractor: "", qno: "", amount: null, hst: false, notes: "", files: [{ name: "A.pdf", path: A }, { name: "B.pdf", path: B }] }] };
X.set({ jid: "mf", bi: 0, rows: readAt(A, two2(1000, 2000), "A.pdf").concat(readAt(B, two2(3000, 5000), "B.pdf")) }, [mf]); X.bidReadApply();
is([mf.bids.map((b) => b.amount), X.bidReadFiles(mf, 0).map((f) => f.name), X.bidReadFiles(mf, 1).map((f) => f.name)],
   [[4000, 7000], ["A.pdf", "B.pdf"], ["A.pdf", "B.pdf"]], "one PDF per building: both are the row's own, and both are read again");
X.set({ jid: "mf", bi: 0, rows: readAt(A, two2(1000, 2000), "A.pdf").concat(readAt(B, two2(3000, 5000), "B.pdf")) }, [mf]);
plan = X.bidReadPlan(mf, 0);
is([plan.ask, plan.here && plan.here.sum, plan.add.length, plan.dup.length], [undefined, 4000, 0, 1], "read again: no question, nothing changes");
/* a quotation and a charge that goes with either option */
mf = { id: "mf", bids: [{ contractor: "", qno: "", amount: null, hst: false, notes: "", files: [{ name: "A.pdf", path: A }, { name: "B.pdf", path: B }] }] };
const fee500 = { contractor: "Acme", amount_cad: 500, hst_included: true, lines: [] };
X.set({ jid: "mf", bi: 0, rows: readAt(A, two2(1000, 2000), "A.pdf").concat(readAt(B, fee500, "B.pdf")) }, [mf]); X.bidReadApply();
is([mf.bids.map((b) => b.amount), X.bidReadFiles(mf, 0).map((f) => f.name)], [[1500, 2500], ["A.pdf", "B.pdf"]], "options + a shared charge: re-read together, not the charge alone");
/* one-price revisions, one after another */
let rv2 = { id: "rv2", bids: [{ contractor: "", qno: "", amount: null, hst: false, notes: "", files: [{ name: "A.pdf", path: A }] }] };
X.set({ jid: "rv2", bi: 0, rows: readAt(A, two2(1000, 2000), "A.pdf") }, [rv2]); X.bidReadApply();
const one = (n) => ({ contractor: "Acme", amount_cad: n, hst_included: true, lines: [] });
rv2.bids[0].files.push({ name: "r1.pdf", path: "qa/mf/r1.pdf" });
is(X.bidReadFiles(rv2, 0).map((f) => f.name), ["r1.pdf"], "the first revision is read on its own");
X.set({ jid: "rv2", bi: 0, rows: readAt("qa/mf/r1.pdf", one(900), "r1.pdf") }, [rv2]); X.bidReadApply();
rv2.bids[0].files.push({ name: "r2.pdf", path: "qa/mf/r2.pdf" });
is(X.bidReadFiles(rv2, 0).map((f) => f.name), ["r2.pdf"], "the second revision is read on its own, not added to the first");
X.set({ jid: "rv2", bi: 0, rows: readAt("qa/mf/r2.pdf", one(800), "r2.pdf") }, [rv2]); X.bidReadApply();
is([rv2.bids[0].amount, rv2.bids[0].optOf.opt, X.bidReadFiles(rv2, 0).map((f) => f.name)], [800, "Option #1", ["r2.pdf"]], "Option #1 at $800; a later read takes the latest revision");
/* an attachment that is not a quotation does not stop the quotation being read again */
let cert = { id: "ct", bids: [{ contractor: "", qno: "", amount: null, hst: false, notes: "", files: [{ name: "A.pdf", path: A }] }] };
X.set({ jid: "ct", bi: 0, rows: readAt(A, two2(1000, 2000), "A.pdf") }, [cert]); X.bidReadApply();
cert.bids[0].files.push({ name: "site-photo.jpg", path: "qa/mf/photo.jpg" });
is(X.bidReadFiles(cert, 0).map((f) => f.name), ["A.pdf"], "a photo is not something new to read");
cert.bids[0].files.push({ name: "wsib.pdf", path: "qa/mf/wsib.pdf" });
X.set({ jid: "ct", bi: 0, rows: [{ name: "wsib.pdf", path: "qa/mf/wsib.pdf", incl: null, ok: false, why: "no total found in it", det: {} }].concat(readAt(A, two2(1000, 2000), "A.pdf")) }, [cert]);
X.bidReadApply();
is([cert.bids[0].amount, X.bidReadFiles(cert, 0).map((f) => f.name)], [1000, ["A.pdf"]], "a certificate, once read and found to hold no price, is not taken for new again");
/* 'different', then read again: the earlier quotation's file is not taken for new */
let df = { id: "df", bids: [{ contractor: "", qno: "", amount: null, hst: false, notes: "", files: [{ name: "A.pdf", path: A }] }] };
X.set({ jid: "df", bi: 0, rows: readAt(A, two2(1000, 2000), "A.pdf") }, [df]); X.bidReadApply();
df.bids[0].files.push({ name: "Y.pdf", path: "qa/mf/Y.pdf" }); df.bids[0].contractor = "Y Inc";
X.set({ jid: "df", bi: 0, rows: readAt("qa/mf/Y.pdf", two2(1500, 2500), "Y.pdf") }, [df]);
X.bidReadAnswer(false); X.bidReadApply();
is([df.bids[0].optOf.path, X.bidReadFiles(df, 0).map((f) => f.name)], ["qa/mf/Y.pdf", ["Y.pdf"]], "after 'different' the row re-reads its own quotation, not the earlier one");

/* second verification: a typed-over amount keeps both documents the row's own */
mf = { id: "mf", bids: [{ contractor: "", qno: "", amount: null, hst: false, notes: "", files: [{ name: "A.pdf", path: A }, { name: "B.pdf", path: B }] }] };
X.set({ jid: "mf", bi: 0, rows: readAt(A, two2(1000, 2000), "A.pdf").concat(readAt(B, fee500, "B.pdf")) }, [mf]); X.bidReadApply();
mf.bids[0].amount = 1600; delete mf.bids[0].parts;
is(X.bidReadFiles(mf, 0).map((f) => f.name), ["A.pdf", "B.pdf"], "amount typed over: both documents are still read together");
/* a repriced sibling does not take its old second document for new */
mf = { id: "mf", bids: [{ contractor: "", qno: "", amount: null, hst: false, notes: "", files: [{ name: "A.pdf", path: A }, { name: "B.pdf", path: B }] }] };
X.set({ jid: "mf", bi: 0, rows: readAt(A, two2(1000, 2000), "A.pdf").concat(readAt(B, two2(3000, 5000), "B.pdf")) }, [mf]); X.bidReadApply();
mf.bids[0].files.push({ name: "A2.pdf", path: "qa/mf/A2.pdf" });
X.set({ jid: "mf", bi: 0, rows: readAt("qa/mf/A2.pdf", two2(1100, 2100), "A2.pdf") }, [mf]); X.bidReadAnswer(true); X.bidReadApply();
is([mf.bids.map((b) => b.amount), X.bidReadFiles(mf, 1).map((f) => f.name), X.bidReadFiles(mf, 0).map((f) => f.name)], [[1100, 2100], ["A2.pdf"], ["A2.pdf"]], "after a revision both rows read the revision, not an old building PDF");

/* AI intake: the same rule */
const d = Object.assign({ file: { name: FILE, path: "p" } }, firenza);
is(X.intakeQuotes(d, null).map((x) => [x.opt.label, x.sum]), [["Option #1", 11355], ["Option #2", 16010]], "intake: one quote per option, on the lines' footing");
is(X.intakeQuotes(d, { 0: false, 1: true }).map((x) => x.sum), [16010], "intake: ticks choose");
is(X.intakeQuotes({ lines: firenza.lines.map((l) => Object.assign({}, l, { option: "" })) }, null).map((x) => x.sum), [27365], "intake without options adds as before");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
