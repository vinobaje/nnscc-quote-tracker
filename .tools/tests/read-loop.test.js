/* The read loop: a reading closed while Claude is still reading is let go
   quietly, and a cloud refresh mid-read keeps it.
   Run: node .tools/tests/read-loop.test.js */
const fs = require("fs");
const src = fs.readFileSync(require("path").join(__dirname, "../../source/beta-template.html"), "utf8");
function grab(n) { const i = src.indexOf("\nfunction " + n + "("); if (i < 0) throw new Error(n); return src.slice(i + 1, src.indexOf("\n}\n", i) + 3); }
let resolve = [];
const X = new Function(["var bidRead = null, state = { jobs: [] }, cloud = { fns: {}, user: {} };",
  "function renderEditor() { if (bidRead) bidReadSync(state.jobs.filter(function (x) { return x.id === bidRead.jid; })[0]); }",
  "function liveJobs() { return state.jobs; } function countsAsSpend() { return true; }",
  "function findJob(id) { return state.jobs.filter(function (x) { return x.id === id; })[0] || null; }",
  "var PENDING; function bidReadOne(f) { return new Promise(function (r) { PENDING.push(function () { r([{ name: f.name, incl: 1130, ok: true, why: '' }]); }); }); }",
  grab("bidReadRun"), grab("bidReadSync"), grab("bidReadSig"), grab("conKey"), grab("bidReadFiles"), grab("bidShowOrder"), grab("bidOwnFiles"), grab("bidQuoteKey"), grab("jobCalc"), grab("bidTotal"), "var HST = 0.13;",
  "return { run: bidReadRun, setPending: function (p) { PENDING = p; }, jobs: function (j) { state.jobs = j; }, read: function () { return bidRead; }, close: function () { bidRead = null; } };"].join("\n"))();
let pass = 0, fail = 0;
const is = (g, w, t) => { JSON.stringify(g) === JSON.stringify(w) ? pass++ : (fail++, console.log("FAIL  " + t + "\n      got  " + JSON.stringify(g) + "\n      want " + JSON.stringify(w))); };
const tick = () => new Promise((r) => setTimeout(r, 0));
(async () => {
  const mk = () => ({ id: "j1", bids: [{ contractor: "A", qno: "", amount: null, files: [{ name: "a.pdf", path: "qa/a.pdf" }] }] });
  /* closed mid-read: the result is let go, no crash */
  let jobs = [mk()]; X.jobs(jobs); X.setPending(resolve = []);
  X.run(jobs[0], 0); X.close();
  let crashed = false; process.once("unhandledRejection", () => { crashed = true; });
  resolve.forEach((f) => f()); await tick(); await tick();
  is([crashed, X.read()], [false, null], "closed mid-read: no crash, nothing written");
  /* a cloud refresh mid-read: same rows, new objects — the reading finishes on the right row */
  jobs = [mk()]; X.jobs(jobs); X.setPending(resolve = []);
  X.run(jobs[0], 0);
  const fresh = JSON.parse(JSON.stringify(jobs)); X.jobs(fresh);
  resolve.forEach((f) => f()); await tick(); await tick();
  is([!!X.read(), X.read() && X.read().busy, X.read() && X.read().rows.length, X.read() && X.read().bref === fresh[0].bids[0]], [true, "", 1, true], "refreshed mid-read: the reading completes, anchored to the new row");
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
