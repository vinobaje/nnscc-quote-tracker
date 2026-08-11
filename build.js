#!/usr/bin/env node
/* Build the two copies of the tracker from the single source template.
 *
 *   node build.js beta   -> quote-tracker-beta.html   (beta Firestore collections)
 *   node build.js live   -> public/index.html         (live Firestore collections)
 *   node build.js        -> both
 *
 * source/beta-template.html is the ONLY place to edit. It carries three
 * placeholders — __SEED_JSON__, __LOGO_SRC__, __PHOTO_SRC__, __BUILD__ — which are filled
 * from whatever the target file already contains, so the seed data and the
 * embedded logo/photo of each copy survive a rebuild untouched.
 *
 * The live build additionally rewrites every Firestore path from the beta
 * sandbox to the live collections. The two copies must never share data:
 *   nnsccQuoteTrackerBeta/main  ->  nnsccQuoteTracker/main
 *   nnsccQuoteReportsBeta       ->  nnsccQuoteReports
 *   nnsccBoardVotesBeta         ->  nnsccBoardVotes
 *   nnsccDecisionLogBeta        ->  nnsccDecisionLog
 * and drops the BETA badge and title.
 */
const fs = require("fs");
const path = require("path");
const ROOT = __dirname;
const SRC = path.join(ROOT, "source", "beta-template.html");

const TARGETS = {
  beta: { file: path.join(ROOT, "quote-tracker-beta.html"), live: false },
  live: { file: path.join(ROOT, "public", "index.html"), live: true }
};

/* beta -> live substitutions, applied in order. Each must match at least once. */
const LIVE_SWAPS = [
  ['"nnsccQuoteTrackerBeta/main"', '"nnsccQuoteTracker/main"'],
  ['"nnsccQuoteReportsBeta"', '"nnsccQuoteReports"'],
  ['"nnsccQuoteTrackerBeta/contractors"', '"nnsccQuoteTracker/contractors"'],
  ['"nnsccQuoteTrackerBeta/contracts"', '"nnsccQuoteTracker/contracts"'],
  ['"nnsccQuoteSnapshotsBeta"', '"nnsccQuoteSnapshots"'],
  ['"nnsccActivityBeta"', '"nnsccActivity"'],
  ['"nnsccQuoteTrackerBeta/brand"', '"nnsccQuoteTracker/brand"'],
  ['"nnsccQuoteTrackerBeta/weeklyDraft"', '"nnsccQuoteTracker/weeklyDraft"'],
  ['"nnsccWeeklyReportsBeta"', '"nnsccWeeklyReports"'],
  ['"nnsccQuoteTrackerBeta/board"', '"nnsccQuoteTracker/board"'],
  ['"nnsccBoardVotesBeta"', '"nnsccBoardVotes"'],
  ['"nnsccDecisionLogBeta"', '"nnsccDecisionLog"'],
  ["<title>Waterview Condominium — Quote Tracker (BETA PREVIEW)</title>",
   "<title>Waterview Condominium — Contractor Quote Tracker</title>"],
  ['" — Quote Tracker · BETA PREVIEW"', '" — Contractor Quote Tracker"'],
  ['<span class="betachip">BETA</span>', ""],
  ["/* BETA sandbox — live/current report */", "/* the live/current report */"],
  ["/* BETA sandbox — archived reports */", "/* archived past-period reports */"],
  ["Send them the beta link", "Send them the report link"],
  ["nnsccQuoteTrackerBeta/board)", "nnsccQuoteTracker/board)"]
];

function carryOver(existing, template) {
  function grab(re, what) {
    const m = existing.match(re);
    if (!m) throw new Error("could not read the existing " + what + " — refusing to overwrite it");
    return m[1];
  }
  const seed = grab(/<script id="seed" type="application\/json">([\s\S]*?)<\/script>/, "seed data");
  const logo = grab(/var ASSET_LOGO = "([^"]*)"/, "logo");
  const photo = grab(/var ASSET_PHOTO = "([^"]*)"/, "building photo");
  return template.split("__SEED_JSON__").join(seed)
                 .split("__LOGO_SRC__").join(logo)
                 .split("__PHOTO_SRC__").join(photo)
                 .split("__BUILD__").join(buildStamp());
}

/* The stamp shown in the report footer: enough to tell one deploy from the
   next when someone says a change is not showing on their phone. */
function buildStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " +
         p(d.getHours()) + ":" + p(d.getMinutes());
}

function build(name) {
  const t = TARGETS[name];
  if (!t) throw new Error("unknown target: " + name);
  const template = fs.readFileSync(SRC, "utf8");
  const existing = fs.readFileSync(t.file, "utf8");
  let out = carryOver(existing, template);
  if (/__(SEED_JSON|LOGO_SRC|PHOTO_SRC|BUILD)__/.test(out)) throw new Error("a placeholder was left unfilled");

  if (t.live) {
    LIVE_SWAPS.forEach(function (pair) {
      if (out.indexOf(pair[0]) < 0) throw new Error("live swap not found in the source: " + pair[0]);
      out = out.split(pair[0]).join(pair[1]);
    });
    /* nothing may point at the beta sandbox once this file is live */
    const stray = out.match(/nnscc\w*Beta/g);
    if (stray) throw new Error("beta collection left in the live build: " + [...new Set(stray)].join(", "));
  } else if (out.indexOf('"nnsccQuoteTrackerBeta/main"') < 0) {
    throw new Error("the beta build lost its beta collections");
  }

  fs.writeFileSync(t.file, out);
  console.log("built " + name + " -> " + path.relative(ROOT, t.file) +
    " (" + out.length.toLocaleString() + " bytes)");
}

const which = process.argv[2];
(which ? [which] : ["beta", "live"]).forEach(build);
