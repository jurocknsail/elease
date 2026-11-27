# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## Project overview

E-Lease is a French rental management app for one landlord: tenants (« Locataires »), leases (« Baux »),
monthly rent calls (« Appels de loyer ») sent as PDF by e-mail, and the annual rent revision (INSEE
indices). It is an installable PWA (desktop, Android, iPhone) on **Angular 22 (zoneless, standalone
components, signals) + Tailwind CSS 4 + Angular CDK**. The backend is Parse Server on Back4App; the
reminder e-mails come from Cloud Jobs in `cloud/`. UI language: French.

The previous Ionic 7 / Angular 17 app is kept at the git tag `legacy-ionic` and still runs on
`e-lease.smarthomeserver.online` until it is retired.

## Commands

Node 24 (`.node-version`). Run from the repository root:

```bash
npm ci                       # install
npm start                    # dev server, http://localhost:4200
npm run build                # production build into www/ (ng build)
npm test                     # unit tests (Vitest through Angular's unit-test builder); CI uses: npx ng test --watch=false
cd cloud && node --test      # tests of the Cloud Code jobs (no Parse, no network)
```

There is no lint script. Format with Prettier (`npx prettier --check <files>`, config in `.prettierrc`).

### Environment files

`src/environments/environment.ts` and `environment.prod.ts` are **git-ignored** (never commit them, never
`git add -f`). Create both from the template:

```bash
cp src/environments/environment.example.ts src/environments/environment.ts
cp src/environments/environment.example.ts src/environments/environment.prod.ts
```

Fields: `production`, `parseAppId`, `parseJsKey`, `parseServerUrl`, `sandbox`, `testRecipientEmail`.
There is **no `inseeApiKey`** (the INSEE API is public). The production build swaps `environment.ts` for
`environment.prod.ts` (`fileReplacements`); the unit tests import `environment.ts`. Locally keep
`production: false`, `sandbox: true` and `testRecipientEmail: 'julien.berger1421@gmail.com'` in both files.
In CI, `environment.prod.ts` comes from the secret `ENVIRONMENT_PROD`, on `main` only.

## TEST-SAFETY RULES (binding)

- **Never e-mail a real tenant.** Manual tests are done only logged in as the Back4App user `julien`, with
  the recipient `julien.berger1421@gmail.com`. **Never use the account `christine`.**
- Dev guard (`src/app/core/email/email-guard.ts`, `parse-client.ts`): outside production only
  `testRecipientEmail` is accepted as recipient and the Mailjet sandbox is forced. Never weaken or bypass it.
  `production` comes from the build, never from user input or backend data.
- A build with `production: true` really sends e-mail. Only `main` is built with the production secret.
- Cloud jobs (`cloud/`): during development always run with `{"onlyUser":"julien"}` and `"dryRun":true`;
  drop `dryRun` only for the final check, still with `onlyUser`.
- Tests never call Back4App, Mailjet or INSEE (fakes, recorded fixtures). Never write a key, token,
  password or real tenant address in code, tests, fixtures or commit messages.

## Layout

```
src/app/
  app.config.ts, app.routes.ts, app.ts   bootstrap, lazy routes, root
  core/                                  framework-free logic and services
    models/    Lease, Leaseholder, LandlordProfile
    parse/     parse-client.ts (the ONLY importer of `parse`), repositories, mapping, with-timeout
    billing/   period.ts, amounts.ts, send-status.ts
    pdf/       rent-call-definition.ts (pdfmake), pdf-render.ts, file-name.ts
    email/     email-guard.ts, rent-call-email.ts, rent-call-sender.ts
    insee/     insee.service.ts   revision/  revision.ts (pure)
    auth/ theme/ pwa/ format/ (fr.ts)
  features/    one folder per screen: login, shell, rent-calls, tenants, settings
  shared/ui/   pill, pdf-viewer, confirm-dialog, empty-state ...
cloud/         Back4App Cloud Code jobs (sendMonthlyReminder, sendRevisionReminder), see cloud/README.md
public/        manifest, icons, _redirects, _headers (copied to www/)
docs/          superpowers/{specs,plans}/ (design and plan), deploy-cloudflare-pages.md
android/, ios/, capacitor.config.ts   DORMANT native shells (see below)
```

### Parse SDK

Parse SDK 5 (`parse@^5.0.0`, proven against Parse Server 4.10.4; do not move to 8). It sits behind the
abstract `ParseClient` seam (`src/app/core/parse/parse-client.ts`): **never `import 'parse'` anywhere
else**; repositories and `AuthService` inject `ParseClient`, specs use `FakeParseClient`. On first use it:
installs `MinimalEventEmitter` (the SDK's browser build gets none from a bundler and `Parse.initialize`
throws « EventEmitter is not a constructor »), calls `Parse.Object.disableSingleInstance()` (changes of a
failed save must not leak into the next one) and sets `REQUEST_ATTEMPT_LIMIT=1`. Every call goes through
`withTimeout` (20 s, `BackendTimeoutError`, « Réessayer » in the UI). Error 209 (invalid session) goes to
the login screen. New objects get an owner-only ACL (per-user data isolation).

### Dormant native shells

`android/`, `ios/` and `capacitor.config.ts` are kept but **dormant**: every `@capacitor/*` dependency was
removed, and nothing builds them. Native builds would need Capacitor re-added first. The PWA is the product.

## Business rules (short)

- **Period** = the month AFTER the call date (call sent on 25 Dec 2026 bills January 2027). Default call
  date: the 25th (`new Date(y, m, 25)`, never string-built dates: invalid on Safari). Due date: the 1st.
- **Status « envoyé »** (rule A2, `send-status.ts`): sent when `lastSentPeriod` equals the period or is
  later, or when `lastSendDate` falls in the month before the period, unless the date was written by this
  app (`lastSentPeriodAt` equals `lastSendDate`). The date fallback exists because the legacy app writes
  only `lastSendDate`; remove it once that app is retired. A new send writes `lastSendDate`,
  `lastSentPeriod` and `lastSentPeriodAt` in one save.
- **Amounts**: total = (isPro ? price + TVA : price) + charge + additional charges, TVA 20 % on the rent
  only and only for professional leases. Values are rounded to whole cents like the PDF (`toCents`,
  `toFixed(2)`); `formatEuro` prints `1 900 €` / `1 900,50 €`.
- **PDF**: identical to the legacy one (labels « Loyer HT », « T.V.A. 20% », « Avance sur charges »,
  « Total TTC », legal text); only the landlord data come from `LandlordProfile` (defaults = the former
  hard-coded values). Mail subject « Appel de loyer — <mois année> ». Tenants sharing an e-mail address get
  one e-mail with all their PDFs. A tenant without leases is skipped.
- **Revision**: reminder 45 days before the anniversary (`renewalDate`); index type IRL (housing), ILC
  (shops), ILAT (offices/other); proposed rent = rent × new index ÷ reference index, rounded to the cent;
  nothing is applied automatically. A lease without anniversary or reference index is « À compléter ».
- **Data**: existing Back4App fields keep their names and types; new ones are additive
  (`lastSentPeriod`, `lastSentPeriodAt`, `indexType`, `referenceIndexQuarter`, `referenceIndexValue`,
  `revisionReminderSentFor`, class `LandlordProfile`). `isSelected` and `indexing` are no longer written.

## Conventions

- UI copy in French, neutral « vous », no emojis. Vocabulary: « Appels de loyer », « Locataire », « Bail / Baux ».
  Dates `fr-FR`, amounts `1 900 €`.
- Multi-column layouts from the `lg` breakpoint; below it, one column (bottom bar, full-screen detail and
  PDF preview under 768 px). Touch targets at least 44 px; the `dense` variant (fine pointer, wide screen)
  may shrink them. Inputs at least 16 px (no iOS zoom). Pills never wrap (`white-space: nowrap`).
  Safe areas with `env(safe-area-inset-*)`. No action reachable by hover only.
- Components: standalone, signals, new control flow, class suffix `Page` for routed screens (selector prefix
  `app-`). Strict TypeScript. Style A: white / soft grey, indigo accent, Inter, light and dark themes.
- Tests live next to the code (`*.spec.ts`). Keep them deterministic (injected clock, no network); dates
  must not depend on the machine time zone (CI also runs the suite under `America/Los_Angeles`).

## Deployment

- **New app**: GitHub Actions `.github/workflows/pages-deploy.yml`, on push to `main` (or manual run):
  tests, `ng build`, then `wrangler pages deploy www --project-name e-lease-app` to **Cloudflare Pages**,
  served on `https://e-lease-app.smarthomeserver.online` (custom domain; the address must stay stable
  because an installed PWA is tied to it). Secrets: `ENVIRONMENT_PROD`, `CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID`. Branches other than `main` are only tested and built, with a non-production
  environment, and never deployed. SPA fallback and headers: `public/_redirects`, `public/_headers`.
  Step-by-step for the owner: `docs/deploy-cloudflare-pages.md`.
- **Legacy app**: `.github/workflows/docker-build.yml`, manual only, always builds the tag `legacy-ionic`
  into the Docker image `jurocknsail/elease:latest` (`Dockerfile`, `nginx.conf`), served on
  `e-lease.smarthomeserver.online` through a cloudflared tunnel. Do not touch it; retire it later.
- Merging `ui-refactor` into `main`, publishing and attaching the domain are the owner's decisions.

## Where things are written down

- Design (authority on conflicts): `docs/superpowers/specs/2026-11-25-ui-refactor-design.md`
- Plan: `docs/superpowers/plans/2026-11-25-ui-refactor.md`
- Progress, amendments and carry-forwards: `docs/superpowers/plans/2026-11-25-ui-refactor-progress.md`
- Cloud jobs: `cloud/README.md`
