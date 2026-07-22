# Waterview Condominium — Contractor Quote Tracker

**Private repository — contains board-confidential contractor pricing. Do not make public.**

Live quote-tracking web app for Waterview Condominium (NNSCC No. 292, buildings 550 & 560),
managed by CPO Property Management. Presents contractor quotes as a board-ready report with
editing, multi-period report library, audit history, and AI-drafted narrative.

## Links
- **Production:** https://quote-report.web.app
- **Beta preview** (new features, sandbox data): https://quote-report-beta.web.app
- Firebase project: `quote-tracker-ce2ba` (dedicated; migrated off the Condo Super project 2026-07-22)

## Layout
| Path | What it is |
|---|---|
| `source/app-template.html` | Source template for the production app (placeholders: `__SEED_JSON__`, `__LOGO_SRC__`, `__PHOTO_SRC__`) |
| `source/beta-template.html` | Beta template — adds job status lifecycle, board decisions, attachments, contractor directory, quote expiry, YTD dashboard, budget, AI intake & board memo |
| `public/index.html` | Built production app (deployed to the `quote-report` hosting site) |
| `quote-tracker-beta.html` | Built beta app (deployed to the `quote-report-beta` hosting site) |
| `quote-tracker.html` / `quote-tracker-v2.html` | Reference copies of the built production app |
| `functions/index.js` | Cloud Function `nnsccTrackerAi` — narrative / quote-parse / board-memo modes; reads the Anthropic key from Firestore config (never exposed to clients) |
| `firestore.rules`, `storage.rules`, `firebase.json`, `.firebaserc` | Firebase config for the dedicated project |
| `firestore.rules.BACKUP-2026-07-21` | Historical: Condo Super's original rules (pre-quote-tracker), used for the cleanup restore |

## Security model
- Public can **view** the current report. All editing (including click-to-edit) requires Google
  sign-in by an allowlisted editor (owner + property manager).
- Firestore rules enforce the allowlist server-side; the Anthropic API key lives in a Firestore
  doc no client may read, consumed only by the Cloud Function.
- Past reports (report library) and the cross-period dashboard are editor-only.

## Deploying
```
firebase deploy --only hosting:quote-report --project quote-tracker-ce2ba        # production
firebase deploy --only hosting:quote-report-beta --project quote-tracker-ce2ba   # beta
firebase deploy --only firestore:rules,storage,functions --project quote-tracker-ce2ba
```
Builds are produced by substituting the seed/logo/photo placeholders in the templates.
