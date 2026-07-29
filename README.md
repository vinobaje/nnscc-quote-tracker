# Waterview Condominium — Contractor Quote Tracker

**Private repository — contains board-confidential contractor pricing. Do not make public.**

Live quote-tracking web app for Waterview Condominium (NNSCC No. 292, buildings 550 & 560),
managed by CPO Property Management. Presents contractor quotes as a board-ready report with
editing, multi-period report library, audit history, and AI-drafted narrative.

A second, separate tool for the same building — **Arrears Letters** — lives in `arrears/`.
It generates the property manager's collection notices and keeps the record of what was sent.

## Links
- **Production:** https://quote-report.web.app
- **Beta preview** (new features, sandbox data): https://quote-report-beta.web.app
- **Arrears letters** (editor-only, no public view): https://nnscc292.web.app
- Firebase project: `quote-tracker-ce2ba` (dedicated; migrated off the Condo Super project 2026-07-22)

## Layout
| Path | What it is |
|---|---|
| `source/app-template.html` | Source template for the production app (placeholders: `__SEED_JSON__`, `__LOGO_SRC__`, `__PHOTO_SRC__`) |
| `source/beta-template.html` | Beta template — adds job status lifecycle, board decisions, attachments, contractor directory, quote expiry, YTD dashboard, budget, AI intake & board memo |
| `public/index.html` | Built production app (deployed to the `quote-report` hosting site) |
| `quote-tracker-beta.html` | Built beta app (deployed to the `quote-report-beta` hosting site) |
| `quote-tracker.html` / `quote-tracker-v2.html` | Reference copies of the built production app |
| `arrears/index.html` | Arrears letter tool (deployed to the `nnscc292` hosting site) — self-contained, no build step; the CPO logo is embedded as a data URI |
| `functions/index.js` | Cloud Function `nnsccTrackerAi` — narrative / quote-parse / board-memo modes; reads the Anthropic key from Firestore config (never exposed to clients) |
| `firestore.rules`, `storage.rules`, `firebase.json`, `.firebaserc` | Firebase config for the dedicated project |
| `firestore.rules.BACKUP-2026-07-21` | Historical: Condo Super's original rules (pre-quote-tracker), used for the cleanup restore |

## Security model
- Public can **view** the current report. All editing (including click-to-edit) requires Google
  sign-in by an allowlisted editor (owner + property manager).
- Firestore rules enforce the allowlist server-side; the Anthropic API key lives in a Firestore
  doc no client may read, consumed only by the Cloud Function.
- Past reports (report library) and the cross-period dashboard are editor-only.

### Arrears letters
This tool pairs owner names with what they owe, so unlike the quote report it has **no public
view and no passcode path** — it renders nothing at all until an allowlisted editor signs in.

- `nnsccArrearsRoster/main` — unit → owner of record + mailing address. Editor read/write.
- `nnsccArrearsTemplates/main` — the letter wording, editable by the manager in-app.
- `nnsccArrearsLetters/{id}` — one doc per letter generated. **Append-only**: no deletes, and
  the only permitted update is marking a letter void, which leaves the original figures intact.
  This is the record the Corporation relies on to show a demand was made and when.

The roster is built from two exports, selected together in one go — **Unit Manager** (unit,
owner of record, tenant, parking, locker, entry-access instructions, notes) and **User Manager**
(one row per person: contacts, mailing address, vehicle, permit, emergency contact). The
importer identifies each file from its header and always applies Unit Manager first, so the
selection order in the file dialog does not matter. Importing Unit Manager alone leaves the
roster with no people; the Units tab shows a standing warning until both have been read. Every field
from both files is kept and shown in the expandable unit detail; the roster doc runs ~264 KB
for 280 units and 485 people, against Firestore's 1 MB limit.

Only owner-type rows decide *who the letter is addressed to* — tenants and agents are stored
and displayed but never addressed, because a notice of arrears is the owner's and 58% of these
units are tenanted. Owners with no address on file fall back to their building address, built
in the house style the export itself uses (`1001 - 550 North Service Road`, with 550 → L3M 0H9
and 560 → L3M 0G3).

The tool generates and records letters; it never sends them. Banking details for the one-time
pre-authorized debit form are left blank for the owner to complete by hand — no account number
is ever entered into or stored by this app.

## Deploying
```
firebase deploy --only hosting:quote-report --project quote-tracker-ce2ba        # production
firebase deploy --only hosting:quote-report-beta --project quote-tracker-ce2ba   # beta
firebase deploy --only hosting:nnscc292 --project quote-tracker-ce2ba            # arrears letters
firebase deploy --only firestore:rules,storage,functions --project quote-tracker-ce2ba
```
Builds are produced by substituting the seed/logo/photo placeholders in the templates.

`firebase.json` lists hosting as an array with an explicit `site` on each entry, so the
`--only hosting:<site>` commands above resolve unambiguously. A bare `--only hosting`
deploys every configured site at once.
