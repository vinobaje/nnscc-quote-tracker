# Waterview Condominium — Contractor Quote Tracker

A single-file web app for tracking contractor quotes for **Waterview Condominium (NNSCC No. 292)**,
managed by CPO Property Management, and presenting them as a board-ready report.

Live: https://nnscc-quote-tracker.web.app  (Firebase Hosting, project `condo-super`)

## Files
- `quote-tracker.html` — the currently deployed build.
- `quote-tracker-v2.html` — work-in-progress build (position-based job ordering, drag-and-drop).
- `firestore.rules.BACKUP-2026-07-21` — snapshot of the Firestore security rules before the tracker's rules were added.
- `firebase.json`, `.firebaserc` — Firebase hosting config.

## How it works
- Single self-contained HTML file (styles, logic, and embedded assets inline).
- Reads/writes live data from Cloud Firestore (`nnsccQuoteTracker/main`). Public read; writes require
  Google sign-in by an allow-listed editor.
- Editing is gated by a PIN plus Google authentication; viewers see a read-only report.
- Optional AI-written narrative via a Cloud Function that holds the Anthropic API key server-side.

> Private repository — contains board-confidential contractor pricing. Do not make public.
