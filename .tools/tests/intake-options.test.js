/* AI intake with a quotation of options: what the preview starts with, and
   what the amount, note and HST box do when the ticks change.
   Run: node .tools/tests/intake-options.test.js */
const fs = require("fs");
const src = fs.readFileSync(require("path").join(__dirname, "../../source/beta-template.html"), "utf8");
function grab(n) { const i = src.indexOf("\nfunction " + n + "("); if (i < 0) throw new Error(n); return src.slice(i + 1, src.indexOf("\n}\n", i) + 3); }
const el = {}, boxes = [];
const document = { getElementById: (id) => el[id] || null, querySelectorAll: () => boxes };
const X = new Function("document", ["var HST = 0.13, intakePending = null;",
  "function esc(s) { return String(s == null ? '' : s); } function money(n) { return '$' + n; } function todayISO() { return '2026-11-22'; }",
  ["intakePreviewHTML", "intakeLines", "intakeLinesHTML", "intakeRows", "intakeQuotes", "intakeTicks", "intakeLinesSync",
   "optLine", "optionQuotes", "optKey"].map(grab).join("\n"),
  "return { intakePreviewHTML, intakeLinesSync, setPending: function (d) { intakePending = d; } };"].join("\n"))(document);
let pass = 0, fail = 0;
const is = (g, w, t) => { JSON.stringify(g) === JSON.stringify(w) ? pass++ : (fail++, console.log("FAIL  " + t + "\n      got  " + JSON.stringify(g) + "\n      want " + JSON.stringify(w))); };

const d = { contractor: "Firenza", amount_cad: 11355, hst_included: true /* the reading's flag for its total, wrong here */,
  lines_include_hst: false, scope_notes: "Two options for the PRV.", file: { name: "f.pdf", path: "p" },
  lines: [{ description: "Option #1 – Single PRV", amount: 11355, for_this_job: true, option: "Option #1" },
          { description: "Option #2 – Dual PRV", amount: 16010, for_this_job: true, option: "Option #2" }] };
const html = X.intakePreviewHTML(d);
X.setPending(d);
is(/id="ipHst">/.test(html) && !/id="ipHst" checked/.test(html), true, "HST box starts from the lines' footing (not included)");
is(/<textarea id="ipNotes"[^>]*>Option #1 – Single PRV</.test(html), true, "note starts as option 1");
is(/value="11355"/.test(html), true, "amount starts as option 1");
/* untick option 1 */
el.ipAmount = { value: "11355" }; el.ipHst = { checked: true }; el.ipNotes = { value: "Option #1 – Single PRV" };
boxes.length = 0;
boxes.push({ checked: false, getAttribute: () => "0" }, { checked: true, getAttribute: () => "1" });
X.intakeLinesSync();
is([el.ipAmount.value, el.ipNotes.value, el.ipHst.checked], ["16010.00", "Option #2 – Dual PRV", false], "untick option 1: amount, note and HST box follow option 2");
/* a note she typed herself is hers */
el.ipNotes.value = "her own words";
boxes[0].checked = true;
X.intakeLinesSync();
is([el.ipAmount.value, el.ipNotes.value], ["11355.00", "her own words"], "her note stands");
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
