# NNSCC 292 quote tracker — scope boundaries (read this first)

This repo is the **single-building Waterview Condominium / NNSCC 292 contractor
quote report ONLY** (prod: quote-report.web.app, beta: quote-report-beta.web.app).

The **multi-tenant CondoQuote SaaS platform is a SEPARATE product** in a
separate repo: `/Users/vino/SAAS` → github.com/vinobaje/SAAS, live at
condoquote.web.app. Do **not** build SaaS features (orgs, buildings, tenants,
plans, Stripe, saas* functions or collections) here.

Two more products are also separate repos, sharing only the Firebase project:

- **Per-building quote trackers** (Chateau Ridge, The Conservatory, Keelesdale,
  The Odyssey): `/Users/vino/Documents/CondoSites` → github.com/vinobaje/condo-sites.
  They are BUILT from `source/beta-template.html` in this repo, each into its own
  Firebase project. Change the source here, then rebuild them there.
- **Arrears letters** (Waterview, nnscc292.web.app):
  `/Users/vino/Documents/Arrears` → github.com/vinobaje/arrears-letters.
  Its `nnsccArrears*` rules live in THIS repo's `firestore.rules` (one project,
  one rules file) — everything else about it belongs there, not here.

Shared infrastructure (all of these live in Firebase project quote-tracker-ce2ba):

- `firestore.rules` + `firestore.indexes.json` in THIS repo are the canonical,
  deployed copies for the whole project. They contain both the `nnscc*` rules
  (this product) and the `saasOrgs` rules (the SaaS product). Edit the section
  that belongs to the product you're working on; deploy from here with
  `firebase deploy --only firestore:rules,firestore:indexes`.
- Functions here are codebase **default** (`nnsccTrackerAi` only). The saas*
  functions are codebase **saas**, deployed from the SAAS repo. Deploying
  `--only functions:default` cannot touch them.
- After changing the `saasOrgs` rules section, run the SaaS isolation tests
  from the SAAS repo (`test/`) before deploying.
