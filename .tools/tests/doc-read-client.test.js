/* The browser side of document reads: what each reader sends, and what it no
   longer does. Run: node .tools/tests/doc-read-client.test.js */
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "../../source/beta-template.html"), "utf8");
function grab(n) { const i = src.indexOf("\nfunction " + n + "("); if (i < 0) throw new Error(n); return src.slice(i + 1, src.indexOf("\n}\n", i) + 3); }
function gv(n, end) { const i = src.indexOf("\nvar " + n + " ="); return src.slice(i + 1, src.indexOf(end, i) + end.length) + "\n"; }

let calls = [], fetches = [], puts = [], deletes = [], failNext = null;
const harness = {
  calls, fetches, puts, deletes,
  cloud: {
    fns: { httpsCallable: (name, opts) => (payload) => {
      calls.push({ name, opts, payload });
      if (failNext) { const e = failNext; failNext = null; return Promise.reject(e); }
      return Promise.resolve({ data: { contractor: "Rooterworx", quote_number: "35607", lines_include_hst: false,
        lines: [{ description: "Drains", amount: 14500, for_this_job: true, line_note: "" }] } });
    } },
    store: { ref: (p) => ({
      put: () => { puts.push(p); return Promise.resolve(); },
      getDownloadURL: () => Promise.resolve("https://files/" + p),
      delete: () => { deletes.push(p); return Promise.resolve(); },
    }) },
  },
};
const code = [
  "var HST = 0.13;",
  gv("DOC_FILE_MAX", "};"), gv("DOC_FILE_KIND", "};"), gv("DOC_READ_WAIT_MS", ";"),
  grab("docFileFirst"), grab("docUnfile"), grab("docReadCall"),
  grab("bidReadOne"), grab("bidReadOneBytes"), grab("bidReadDone"), grab("bidReadRows"), grab("bidReadTrim"),
  "return { docFileFirst, docUnfile, docReadCall, bidReadOne, DOC_READ_WAIT_MS };",
].join("\n");
const X = new Function("cloud", "fetch", "FileReader", code)(
  harness.cloud,
  (u) => { fetches.push(u); return Promise.resolve({ ok: true, blob: () => Promise.resolve({ size: 10 }) }); },
  function () { this.readAsDataURL = () => { this.result = "data:application/pdf;base64,QUJD"; this.onload(); }; });

let pass = 0, fail = 0;
const is = (g, w, t) => { JSON.stringify(g) === JSON.stringify(w) ? pass++ : (fail++, console.log("FAIL  " + t + "\n      got  " + JSON.stringify(g) + "\n      want " + JSON.stringify(w))); };
const reset = () => { calls.length = 0; fetches.length = 0; puts.length = 0; deletes.length = 0; };
const MB = 1024 * 1024;

(async () => {
  /* every document read waits past the function's five minutes, not the SDK's 70 s */
  reset(); await X.docReadCall({ contract: true, path: "contractFiles/a.pdf" });
  is(calls[0].opts, { timeout: 310000 }, "a document read waits 310 s");
  is(X.DOC_READ_WAIT_MS > 300000, true, "longer than the function's own 300 s, so its error is the one she sees");

  /* a filed quote is read by path: no download, no bytes in the call */
  reset();
  const rows = await X.bidReadOne({ name: "rw.pdf", path: "quoteAttachments/j10/rw.pdf", url: "https://x" },
    { desc: "Parking lot drains", others: ["Job 41: Ramp crack repair"] });
  is(fetches.length, 0, "nothing is downloaded into the browser");
  is(calls.length, 1, "one call");
  is(calls[0].payload.path, "quoteAttachments/j10/rw.pdf", "carrying the path");
  is("fileB64" in calls[0].payload, false, "and no file bytes");
  is([calls[0].payload.jobDesc, calls[0].payload.otherJobs], ["Parking lot drains", ["Job 41: Ramp crack repair"]],
     "with the job it is read for");
  is(calls[0].opts, { timeout: 310000 }, "on the long wait");
  is([rows.length, rows[0].incl, rows[0].ok], [1, 16385, true], "and the reply parses as before");

  /* an old attachment with no path: the old way, still capped */
  reset();
  await X.bidReadOne({ name: "old.pdf", url: "https://old" }, null);
  is(fetches, ["https://old"], "an attachment without a path is fetched as before");
  is(calls[0].payload.fileB64, "QUJD", "and sent as bytes");

  /* a failed read is a row that says why, not an exception */
  reset(); failNext = { message: "That document has more pages than Claude can read at once" };
  const bad = await X.bidReadOne({ name: "long.pdf", path: "quoteAttachments/j/long.pdf" }, null);
  is([bad.length, bad[0].ok, /more pages/.test(bad[0].why)], [1, false, true], "a refusal reaches the panel in words");

  /* filing first: under each folder's own ceiling, refused above it */
  reset();
  const fd = await X.docFileFirst({ name: "HVAC contract (colour).pdf", size: 9 * MB }, "contractFiles/schedules/");
  is(puts.length, 1, "a 9 MB schedule is filed");
  is(/^contractFiles\/schedules\/\d+-HVAC contract \(colour\)\.pdf$/.test(fd.path), true, "under its folder, name kept readable");
  is([fd.size, fd.url.indexOf("https://files/") === 0], [9 * MB, true], "with its size and a link");
  reset();
  let err = null;
  try { await X.docFileFirst({ name: "big.pdf", size: 16 * MB }, "quoteAttachments/intake/"); } catch (e) { err = e; }
  is([!!err, puts.length], [true, 0], "a 16 MB quote is refused before uploading (quotes stop at 15)");
  is(err.message, "That file is 16 MB \u2014 a quotation can be up to 15 MB. Attach a smaller copy (a black-and-white scan is usually a fraction of the size).", "saying both figures, in her terms");
  err = null;
  try { await X.docFileFirst({ name: "c.pdf", size: 19 * MB }, "contractFiles/schedules/"); } catch (e) { err = e; }
  is(err, null, "a 19 MB contract-folder file is allowed (contracts stop at 20)");
  reset();
  try { await X.docFileFirst({ name: "a/b?.pdf", size: 1 }, "quoteAttachments/intake/"); } catch (e) {}
  is(/^quoteAttachments\/intake\/\d+-a_b_\.pdf$/.test(puts[0]), true, "slashes and odd characters cannot leave the folder");

  /* removing a file is quiet about one that is already gone */
  reset(); X.docUnfile("contractFiles/schedules/1-x.pdf"); X.docUnfile(""); X.docUnfile(null);
  is(deletes, ["contractFiles/schedules/1-x.pdf"], "only a real path is removed");

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
