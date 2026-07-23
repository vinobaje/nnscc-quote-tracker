# HANDOFF — NNSCC 292 "beta" quote-report features (board voting, e-sign, +10 more)

**Purpose:** a complete spec of everything built into
**https://quote-report-beta.web.app** so another agent can either **copy it
verbatim** or **rebuild the same functionality** elsewhere. This is the
single-building Waterview / NNSCC 292 contractor-quote report — NOT the
multi-tenant CondoQuote SaaS (that's a separate repo/product; see
`/Users/vino/SAAS/HANDOFF.md`).

---

## 0. The fastest path: COPY, don't rebuild

Everything already exists as source in the `nnscc-quote-tracker` repo
(`/Users/vino/NNSCC`):

| File | What it is |
|---|---|
| `source/beta-template.html` | **The source of truth** — full app with all beta features, using placeholders `__SEED_JSON__`, `__LOGO_SRC__`, `__PHOTO_SRC__` |
| `quote-tracker-beta.html` | The **built** beta (placeholders filled) — this is what's deployed |
| `firestore.rules` | Security rules (contains the beta rule blocks — see §5) |
| `functions/index.js` | Cloud Function `nnsccTrackerAi` (parse/memo/narrative modes) |
| `source/app-template.html` | The **production** template (beta was forked from this; the merge target) |

To copy the running app: deploy `quote-tracker-beta.html` as `index.html` to any
Firebase Hosting site on a project that has the beta Firestore collections +
rules + the `nnsccTrackerAi` function. To rebuild from source, string-replace
the three placeholders in `source/beta-template.html` (values are in the last
built file / scratchpad `_seed.txt`, `_logo.txt`, `_photo.txt`). **There is no
build script** — it's literal find-and-replace of those three tokens.

**Live deployment:** Firebase project `quote-tracker-ce2ba` (#1346683787),
hosting site `quote-report-beta`, Firestore Native @ northamerica-northeast1.
Web config (public-safe): apiKey `AIzaSyDj3v0HtJ6g8UzfMoftCyEl3KPxsaOzrIs`,
authDomain `quote-tracker-ce2ba.firebaseapp.com`,
appId `1:1346683787:web:be618e56f3bb9b3b67a58e`.

---

## 1. What the app is

A single-file HTML app (Firebase compat SDK) that renders a **contractor-quote
report for a condo Board of Directors**: jobs with competing bids, HST-included
totals, lowest-bid-carried logic, executive summary, sections A–E, print/PDF.
The **beta** adds 10 workflow features **plus** board voting + e-signed
resolutions + a tamper-evident decision log. It's a **preview sandbox** awaiting
the user + property manager's review before merging into production
(quote-report.web.app / `source/app-template.html`).

**Editing gate:** no PIN. Any signed-in Google account whose email is in the
allowlist can edit; everyone else is read-only. Client allowlist
`EDITOR_EMAILS = ["mvinobaje@gmail.com","nnscc292connect@cpomanagement.ca"]`
MIRRORS the Firestore rules (the rules are the real enforcement;
`isEditor()` = signed in && not server-denied && email in allowlist).

**Business rules (must preserve):** totals include **13% HST** (gross up bids
marked HST-excluded); when a job has multiple priced bids only the **lowest** is
carried (ties → all carried); **pending** bids (contractor named, no amount)
are excluded from totals.

---

## 2. Data model — beta collections (Firestore)

All beta data is **separate from production** so preview edits never touch the
live report.

```
nnsccQuoteTrackerBeta/main          the current report (public read) — jobs, bids, meta, ai
nnsccQuoteTrackerBeta/contractors   contractor directory {list:[{name,phone,email,insuranceExp,wsibExp}]}
nnsccQuoteTrackerBeta/board         board allowlist {members:[email,...]}  (any signed-in user may READ)
nnsccQuoteReportsBeta/{id}          archived period reports (editor-only)
  main/audit/{id}, {id}/audit/{id}  immutable audit trail (create-only)

nnsccBoardVotesBeta/{voteId}        a vote session (see §4)
  ballots/{email}                   one recorded ballot per director
  signatures/{email}                one e-signature per director
nnsccDecisionLogBeta/{id}           APPEND-ONLY tamper-evident log (nobody can edit/delete)
```

**Report doc shape** (`nnsccQuoteTrackerBeta/main`): jobs array — each job
`{id, no, desc, priority, status, statusDate, statusNote, bids:[...]}`; bid
`{contractor, amount, hst, notes, qdate, validDays, files:[{name,url,size}]}`;
plus `meta` (title, condoName, regNo, buildings, manager, budget, section
ledes/headings) and `ai` (summary/spendNote/openNote). Storage bucket holds bid
attachments at `quoteAttachments/**`.

---

## 3. The 10 workflow features (each independently portable)

1. **Job status lifecycle** — `status`: quoted → approved/rejected/deferred →
   scheduled → inprogress → completed. Constants `STATUSES`, `APPROVED_SET`.
   Status chips `.stchip.st-*` render when status ≠ quoted.
2. **Board decisions per job** — per-job `statusDate` + `statusNote` (in the
   editor `.strow`); a "Status & board decisions" list in Section E; a "Board
   approved" summary tile (`approvedTotal`); a pipeline line.
3. **Board package** — AI cover memo (`More → ✨ AI board memo`, `memoOverlay`)
   + print.
4. **Bid attachments** — Firebase Storage (default bucket, region
   northamerica-northeast1). `storage.rules`: `quoteAttachments/**` public read,
   editor write ≤15MB (2 hardcoded editor emails). `b.files[]`; 📎 Attach button
   in `.ebrow.extra`; links rendered in report via `bidMetaHTML`.
5. **Contractor directory** — doc `.../contractors`; `dirCard` in the editor;
   lapsed-coverage warnings from `insuranceExp` / `wsibExp` dates.
6. **Quote expiry** — bid `qdate` + `validDays` (default 60); `bidExpired()`;
   ⚠ flags in report; `staleBids` count.
7. **YTD dashboard** — 📊 button (editor-only), `dashOverlay`,
   `calcJobsTotals()` across current + archived reports, per-contractor rollup,
   budget compare.
8. **Budget** — `meta.budget` field (Settings); budget bar in the exec summary.
9. **AI quote intake** — `intakeCard` textarea → function `{parse:true,text}` →
   structured job added to the report.
10. **AI board memo** — function `{memo:true,stats}` → cover memo text.

All 10 were mock-tested (see §7), including sign-out gating (0 editable
elements, dashboard hidden for anonymous viewers).

---

## 4. Board voting + e-signed resolutions + decision log (the "genuine" feature)

**Goal (user's words):** make board decisions *genuine* — real polling + a
DocuSign-style signature. **Legal framing given to the user (Ontario):** a condo
board decision is a meeting vote OR a written resolution signed by all
directors; e-signatures are valid under the Ontario *Electronic Commerce Act*.
In-app signing is fine for routine items; for big-ticket, a real e-sign provider
(SignWell/DocuSign) is recommended later. (A DocuSign MCP connector exists in
this environment but needs interactive OAuth.)

### Roles
New role **board member** = email listed in `nnsccQuoteTrackerBeta/board.members`
(seeded with the two editor emails; managed via a "Board members" card in the
Edit tab). Rules helper `nnsccBoardBeta()` reads it via `get()`. Client helpers
`isBoardMember()`, `canVoteView()` = board member OR editor. `cloudLine()` shows
"board member (voting enabled)". `subscribeBoard(u)` in `onAuthStateChanged`
listens to the board doc + an open-votes `where("status","==","open")` query.

### Vote session (`nnsccBoardVotesBeta/{voteId}`)
Fields: `jobId, jobNo, jobDesc, question, contractor, amountText, reportName,
snapshot, snapshotHash, boardSize, status(open|closed), result, tally, resText,
resHash, openedBy, closedBy`.
- Subcollection `ballots/{email}`: `{choice: approve|reject|abstain, comment}`.
  Rule: a director may write only their **own** email doc, only while the vote
  is **open**.
- Subcollection `signatures/{email}`: `{name, sig(canvas PNG dataURL), docHash}`.
  Rule: own email only, only when vote is **closed**, `update:false` (a placed
  signature can never be altered).
- Editor delete is allowed on votes/ballots/signatures **for beta cleanup only**
  — the permanent record is the decision log below.

### Tamper-evidence (SHA-256 via `crypto.subtle`, helper `sha256Hex`)
- At **open**: `jobSnapshotStr()` builds canonical JSON of the job + its bids →
  hashed → `snapshotHash` (proves what the board was voting on).
- At **close**: `resolutionTextOf()` builds the formal **WHEREAS / BE IT
  RESOLVED** text including the tally + quorum → hashed → `resHash`.
- Signatures record `docHash` so each signature is bound to the exact resolution
  text. Quorum = `floor(boardSize/2)+1`; `result` = approved/rejected/tied +
  `quorumMet` flag.

### Decision log (`nnsccDecisionLogBeta/{id}`) — APPEND-ONLY for everyone
Immutable audit record: entries for every vote **OPENED / CLOSED / SIGNED**,
each carrying the relevant hash. Rules: create allowed (board or editor),
`update`+`delete: if false` for ALL — including the owner. This is the
tamper-evident spine of the whole feature.

### UI
- 🗳 **Votes** toolbar button (board members + editors only; shows open-vote
  count). A vote banner appears in the report when there are open votes.
- **`votesOverlay`**: editors pick a job + "Open a vote" (question via
  `prompt()`); everyone with vote access sees live tally + recorded per-director
  votes & comments; editors get **Close**; board members get **Sign**.
- **`signOverlay`**: a pointer-drawn signature pad (`<canvas id="sigPad">`,
  pointer events) + typed name.
- 🖨 **Printable resolution** opens a new window with the formal resolution text,
  the signature images, and **both hashes**.
- `More → 📜 Decision log` overlay lists the append-only log.
- Editors also get a per-job **🗳 Board vote** button in the `.strow`.

### Real-world use
Add real director emails in the "Board members" card; directors sign in with
Google at the beta link, then vote and sign. (Apple "Hide My Email" relay
addresses won't match email-based allowlists — directors must use a real email.)

---

## 5. Firestore rules (the beta blocks)

Canonical file: `/Users/vino/NNSCC/firestore.rules`. Key helpers/blocks:

- `nnsccEditor()` — owner `mvinobaje@gmail.com` OR email in
  `nnsccQuoteTrackerConfig/main.editors`, email_verified required.
- `nnsccBoardBeta()` — email in `nnsccQuoteTrackerBeta/board.members`.
- `nnsccQuoteTrackerBeta/{docId}`: read if `docId=="main"` (public) OR
  (`docId=="board"` && signed in) OR editor; write editor.
- `nnsccQuoteReportsBeta/{id}`: editor read+write.
- `nnsccBoardVotesBeta/{voteId}`: read board|editor; create/update editor;
  `ballots/{email}` create/update if board && own email && vote open;
  `signatures/{email}` create if board && own email && vote closed,
  `update:false`; editor delete allowed (beta cleanup).
- `nnsccDecisionLogBeta/{id}`: read board|editor; create board|editor;
  `update,delete:if false`.
- Config doc `nnsccQuoteTrackerConfig/main`: `read:if false` (holds the
  Anthropic key — no client may read it); write owner-only.

⚠️ **This one file is SHARED with the CondoQuote SaaS product** (both live in
project `quote-tracker-ce2ba`, and a project has one ruleset). It also contains
the `saasOrgs`/`saasPlatformConfig` blocks. Edit only the `nnscc*` blocks here;
never touch the `saas*` blocks (that's the other product). Deploy:
`firebase deploy --only firestore:rules`.

---

## 6. Cloud Function `nnsccTrackerAi`

v2 `onCall`, us-central1, codebase **default**, `functions/index.js`. Auth-gates
against the editor allowlist, reads the Anthropic key from
`nnsccQuoteTrackerConfig/main.anthropicKey` via the Admin SDK, calls
`claude-haiku-4-5` with structured JSON-schema output. Modes:
`{check:true}`→keySet; `{parse:true,text}`→quote-email→job fields;
`{memo:true,stats}`→board memo; default→report narrative
{summary,spendNote,openNote}. Shared between prod and beta (additive/safe).
**Needs an Anthropic key saved** (owner writes it via the app's key field) to
work. The SaaS product's `saas*` functions are a SEPARATE codebase (`saas`) in
the SAAS repo — don't confuse them.

Deploy: `firebase deploy --only functions:default`.

---

## 7. Testing approach (no real auth needed)

Signed-in Firestore writes can't be exercised headlessly (Google popup), so the
project uses a **mock-Firebase harness**: scratchpad `mockfb.js` (v2 — supports
nested collections, `where`/`orderBy` queries, collection `onSnapshot`, canned
`httpsCallable` responses, and `window.__MOCK_AUTH.signInAs(email,name)` for
role-switching). Build a test page by injecting `mockfb.js` and removing the
gstatic Firebase `<script>` tags, seed the board doc, then drive flows in a
headless browser.

All flows were verified this way: editor open→vote→close→sign→print→log;
director gating (can vote, no close/delete, 0 editable elements); signed-out
(nothing visible, 🗳 hidden). Zero console errors. For any rules change, prefer
the `@firebase/rules-unit-testing` emulator (as the SaaS repo does).

---

## 8. Merge-to-production plan (when user + PM approve)

The beta is a **fork** of `source/app-template.html`. To ship: port the feature
diffs from `source/beta-template.html` into `source/app-template.html`, switch
the collection names from `*Beta` to production (`nnsccQuoteTracker/main`,
`nnsccQuoteReports`, and new prod names for board votes/decision log/board doc),
add the corresponding production rule blocks, rebuild, and deploy to the
`quote-report` hosting site. Keep the sandbox/beta running until parity is
confirmed.

---

## 9. Gotchas already solved (don't relearn)

- `firestore.rules` and `functions/index.js` are **shared with the SaaS
  product** — see the boundary note in this repo's `CLAUDE.md`. Deploying
  `functions:default` cannot touch the SaaS functions (codebase `saas`).
- The Anthropic key was pasted in chat once (2026-07-21) — treat as compromised;
  the user was told to rotate it. Never store keys client-side or accept them in
  chat.
- Amount fields are the **HST-included total**; `commitEdit` stores typed value
  with `b.hst=true` and compares against `bidTotal(b)` to avoid spurious
  rewrites; blank amount → pending; blank contractor on a pending bid is
  restored (no vanishing rows).
- Template has no `<head>`/DOCTYPE and starts with `<meta charset="utf-8">`
  (relied on Firebase's charset header before).
- Working tree for the beta files is committed at `1a4fa0f`
  ("Beta: board voting + e-signed resolutions with tamper-evident decision log").
