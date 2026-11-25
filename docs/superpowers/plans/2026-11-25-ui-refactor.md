# E-Lease UI Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Ionic 7 / Angular 17 app with a desktop-first Angular 22 PWA (style A, light/dark), one-screen monthly rent-call flow with mandatory PDF preview, tenant list+detail editing, landlord profile, monthly and revision e-mail reminders, hosted on Cloudflare Pages at `e-lease-app.smarthomeserver.online`.

**Architecture:** Fresh Angular 22 standalone app in the existing repo (branch `ui-refactor`); business logic lives in pure, unit-tested modules under `src/app/core/` (periods, amounts, send status, PDF definition, revision), Parse access in repositories, screens under `src/app/features/`. Reminders are Back4App Cloud Jobs in `cloud/` (CommonJS, tested with `node --test`). Back4App schema is only extended with additive fields and one new class.

**Tech Stack:** Angular 22.3, Node 24 (fnm), Tailwind CSS 4, Angular CDK (dialog), Vitest via `ng test`, Parse JS SDK 5 (existing), pdfmake 0.2.x (existing, not upgraded), pdfjs-dist 6 for preview, `@angular/pwa`, Back4App cloud code (Parse Server 4.10.4, node-mailjet 3), Cloudflare Pages + wrangler 4.

**Spec:** `docs/superpowers/specs/2026-11-25-ui-refactor-design.md`

## Global Constraints

- Never e-mail a real tenant. Outside `environment.production`, every send goes only to `environment.testRecipientEmail` (`julien.berger1421@gmail.com`) with Mailjet sandbox forced. All manual tests are done logged in as Back4App user `julien`, never `christine`.
- Cloud jobs: during development always run with `{"onlyUser":"julien"}` (and `"dryRun":true` until the final check).
- Back4App data: existing `Leaseholder` / `Lease` fields are read and written with the same names and types. New fields are additive only: `lastSentPeriod`, `indexType`, `referenceIndexQuarter`, `referenceIndexValue`, `revisionReminderSentFor` on `Lease`; new class `LandlordProfile`. `isSelected` and `indexing` are no longer written (kept in DB). `postalCode`, `streetNumber`, `lot` stay Number columns.
- PDF content (calculations, labels « Loyer HT », « T.V.A. 20% », « Avance sur charges », « Total TTC », TVA on rent only for pro leases, legal text) is strictly unchanged; only landlord data comes from `LandlordProfile`, whose defaults are the current hard-coded values verbatim.
- UI copy: French, neutral « vous », no emojis. Vocabulary: « Appels de loyer », « Locataire », « Bail / Baux ». Dates `fr-FR`, amounts `1 900 €` (or `1 900,50 €`).
- Style A: white / soft grey, indigo accent (`#4f46e5` light, `#818cf8` dark), Inter. Light/dark follows system with a manual toggle. AA contrast in both themes.
- Tags/pills never wrap: `white-space: nowrap` always.
- Desktop: left sidebar (Appels de loyer, Locataires; Réglages at bottom). Mobile (< 768 px): bottom tab bar, detail and PDF preview full-screen.
- Mobile usability (every screen): touch targets ≥ 44×44 px; inputs ≥ 16 px font (prevents iOS zoom); `inputmode="decimal"` for amounts, `"numeric"` for postal code/lot, `type="email"`/`"tel"`; safe areas via `viewport-fit=cover` + `env(safe-area-inset-*)` (bottom bar and sticky send button stay above the iPhone home indicator); no action reachable only by hover; no horizontal scroll at 360 px; long names truncate with ellipsis, pills never wrap.
- Installed-app feel: standalone display, theme-colour status bar in both themes, app opens on « Appels de loyer », the last screen is restored on reload (router), offline shell loads with a clear « Connexion requise » message when Back4App is unreachable.
- « Révision » pill and in-app proposal appear 45 days before the anniversary (aligned on the e-mail reminder; supersedes the spec's earlier 30-day mention).
- Hostname of the new app: `https://e-lease-app.smarthomeserver.online` (used in reminder e-mails). Old app stays on `e-lease.smarthomeserver.online`, untouched.
- Node 24 everywhere (local `.node-version`, CI).

## Review Focus

- A lease with `renewalDate` null, `lot` 0/null, `charge` null and no additional charges (5 of 9 real leases) must render in lists, PDF and revision UI without errors → test in Task 4 (PDF fixture) and Task 11 (revision state `incomplete`).
- A tenant with zero leases (exists in real data) must appear in Locataires and be skipped in rent calls → test in Task 7.
- Back4App hanging (today's incident: requests hang 60 s) must show an error with « Réessayer », never an endless spinner → test in Task 2 (20 s timeout).
- Two tenants sharing one e-mail address get one e-mail with all their PDFs (legacy grouping by e-mail) → test in Task 5.
- Expired/invalid Parse session (error code 209) sends the user to the login screen → test in Task 6.

## File Structure

```
src/app/
  app.config.ts, app.routes.ts, app.ts           bootstrap, routes, root
  core/
    models/  lease.ts leaseholder.ts landlord-profile.ts
    parse/   parse-client.ts  with-timeout.ts  leaseholder.repository.ts  landlord-profile.repository.ts  mapping.ts
    billing/ period.ts  amounts.ts  send-status.ts
    format/  fr.ts                                 euro, postal code, phone, dates
    pdf/     rent-call-definition.ts  pdf-render.ts  file-name.ts
    email/   email-guard.ts  rent-call-email.ts  rent-call-sender.ts
    insee/   insee.service.ts
    revision/revision.ts
    auth/    auth.service.ts  auth.guard.ts  session-error.ts
    theme/   theme.service.ts
  shared/ui/ pill.ts  pdf-viewer.ts  confirm-dialog.ts  empty-state.ts
  features/
    shell/       shell.ts                          sidebar + bottom bar + router-outlet
    login/       login.page.ts
    rent-calls/  rent-calls.page.ts (accueil)  send.page.ts  send-state.ts
    tenants/     tenants.page.ts  tenant-detail.ts  contact-block.ts  lease-block.ts  lease-form.ts  new-tenant-dialog.ts
    settings/    settings.page.ts  landlord-profile-form.ts  backup.ts
cloud/           main.js  lib/periods.js  lib/revision.js  lib/reminders.js  jobs.js  package.json  test/*.test.js
public/          manifest.webmanifest  icons/  _redirects
.github/workflows/pages-deploy.yml  (new)   docker-build.yml (pinned to tag legacy-ionic)
```

Tests sit next to their file as `*.spec.ts` (Vitest through `ng test`).

---

### Task 1: Fresh Angular 22 shell (Tailwind, theme tokens, PWA, Vitest)

**Files:**
- Delete: Ionic app sources under `src/app/**` except `src/environments/*` (old code stays on `main` and tag `legacy-ionic`), `ionic.config.json`, `karma.conf.js`, `src/theme/`, `src/global.scss`, `src/polyfills.ts`, `src/test.ts`
- Replace: `package.json`, `angular.json`, `tsconfig*.json`, `src/index.html`, `src/main.ts`, `src/styles.css`
- Create: `src/app/app.ts`, `src/app/app.config.ts`, `src/app/app.routes.ts`, `src/app/core/theme/theme.service.ts` (+ spec), `public/manifest.webmanifest`, `public/icons/*`, `ngsw-config.json`
- Keep untouched: `android/`, `ios/`, `capacitor.config.ts`, `src/environments/environment*.ts`, `.github/workflows/docker-build.yml` (edited in Task 13)

**Interfaces:**
- Produces: `ThemeService` with `mode: Signal<'system'|'light'|'dark'>`, `effective: Signal<'light'|'dark'>`, `setMode(mode): void` (persists in `localStorage['elease.theme']` inside try/catch, sets `data-theme` on `<html>`).
- Produces: CSS tokens in `src/styles.css` under `@theme` / `:root` / `[data-theme=dark]`: `--color-bg`, `--color-surface`, `--color-border`, `--color-text`, `--color-muted`, `--color-accent`, `--color-accent-soft`, `--color-ok`, `--color-ok-soft`, `--color-warn`, `--color-warn-soft`, `--color-danger`.

- [ ] **Step 1: Tag the legacy app** — `git tag legacy-ionic main` (the old Docker image is built from this tag in Task 13).
- [ ] **Step 2: Generate** a throwaway project with `npx @angular/cli@22.3.0 new elease --standalone --routing --style=css --ssr=false --zoneless --test-runner=vitest --skip-git` in the scratchpad, then copy its `package.json`, `angular.json`, `tsconfig*.json`, `src/main.ts`, `src/app/app.*` into the repo, keeping project name `e-lease`, output path `www`.
- [ ] **Step 3: Dependencies** — add `parse@^8`, `pdfmake@^0.2.15`, `@types/pdfmake`, `fast-xml-parser`, `pdfjs-dist@^6`, `@angular/cdk@^22`, `tailwindcss@^4`, `@tailwindcss/postcss`, `@fontsource-variable/inter`; run `npx ng add @angular/pwa --skip-confirmation`. Do not add Ionic, Material, Cordova or `@capacitor/filesystem`. `npm install` must finish without peer errors on Node 24.
- [ ] **Step 4: Manifest** — `name` « E-Lease », `short_name` « E-Lease », `lang` « fr », `start_url` « / », `display` « standalone », `theme_color` `#4f46e5`, `background_color` `#ffffff`; icons 192, 512 and 512 maskable generated from `src/assets/icon/favicon.png` with `sips -z`. `index.html`: `lang="fr"`, title « E-Lease », remove `user-scalable=no`/`maximum-scale`, keep `apple-mobile-web-app-capable`, add `apple-touch-icon`.
- [ ] **Step 5: Write failing test** `theme.service.spec.ts`: `setMode('dark')` → `document.documentElement.dataset.theme === 'dark'` and `effective() === 'dark'`; with `mode 'system'` and a stubbed `matchMedia('(prefers-color-scheme: dark)').matches = true` → `effective() === 'dark'`; when `localStorage.setItem` throws, `setMode` still applies the theme.
- [ ] **Step 6: Run** `npx ng test --watch=false` → FAIL (ThemeService missing).
- [ ] **Step 7: Implement** `ThemeService` and the tokens; `body` uses `bg-[var(--color-bg)] text-[var(--color-text)]`, font Inter.
- [ ] **Step 8: Verify** `npx ng test --watch=false` PASS and `npx ng build` succeeds with `ngsw.json` in `www/`.
- [ ] **Step 9: Commit** `chore: replace Ionic app with Angular 22 shell (Tailwind, PWA, theme)`.

### Task 2: Models, Parse client, repositories

**Files:**
- Create: `src/app/core/models/{lease,leaseholder,landlord-profile}.ts`, `src/app/core/parse/{parse-client,with-timeout,mapping,leaseholder.repository,landlord-profile.repository}.ts` + specs for `mapping`, `with-timeout`, `leaseholder.repository`

**Interfaces:**
- Produces:
  ```ts
  export type IndexType = 'IRL' | 'ILC' | 'ILAT';
  export interface AdditionalCharge { title: string; amount: number }
  export interface Lease {
    objectId?: string; isPro: boolean; name: string; lot: number | null;
    streetNumber: number; streetName: string; optionalAddressInfo: string;
    postalCode: number; city: string; price: number; charge: number | null;
    additionalCharges: AdditionalCharge[];
    lastSendDate: number;            // ms, 0 = never
    lastSentPeriod?: string;         // 'YYYY-MM'
    renewalDate: number | null;      // ms
    indexType?: IndexType; referenceIndexQuarter?: string /* 'YYYY-Tn' */; referenceIndexValue?: number;
    revisionReminderSentFor?: string; // 'YYYY-MM-DD'
  }
  export interface Leaseholder { objectId?: string; name: string; email: string; phone: string; leases: Lease[] }
  export interface LandlordProfile { objectId?: string; name: string; addressLines: string[]; issueCity: string; legalNotice: string; emailSignature: string }
  export const DEFAULT_LANDLORD_PROFILE: LandlordProfile; // values in Task 4
  ```
- Produces: `withTimeout<T>(p: Promise<T>, ms = 20000): Promise<T>` rejecting with `BackendTimeoutError`.
- Produces: `leaseFromParse(json: Record<string, unknown>): Lease`, `leaseToParseFields(lease: Lease): Record<string, unknown>` (writes exactly: `isPro,name,lot,streetNumber,streetName,optionalAddressInfo,postalCode,city,lastSendDate,renewalDate,price,charge,additionalCharges` + new fields only when defined; never `isSelected`, never `indexing`).
- Produces: `LeaseholderRepository` (`providedIn: 'root'`): `leaseholders: Signal<Leaseholder[]>`, `load(): Promise<void>`, `createLeaseholder(input: Omit<Leaseholder,'objectId'|'leases'>): Promise<Leaseholder>`, `updateContact(id: string, c: {name: string; email: string; phone: string}): Promise<void>`, `addLease(holderId: string, lease: Lease): Promise<Lease>`, `updateLease(lease: Lease): Promise<void>`, `deleteLease(holderId: string, leaseId: string): Promise<void>`, `deleteLeaseholder(id: string): Promise<void>`, `markLeasesSent(leaseIds: string[], periodKey: string, at: number): Promise<void>`. Every Parse call wrapped in `withTimeout`. New objects get ACL owner-only read/write as today.
- Produces: `LandlordProfileRepository`: `get(): Promise<LandlordProfile>` (creates from `DEFAULT_LANDLORD_PROFILE` with owner ACL and a `user` pointer if none exists), `save(p: LandlordProfile): Promise<void>`.

- [ ] **Step 1: Failing tests** — `mapping.spec.ts`: a real-shaped JSON (`charge` missing, `renewalDate` missing, `lot` 0, `isSelected` true, `indexing` 133.69) maps to `charge: null`, `renewalDate: null`, `lot: 0`, `additionalCharges: []`; `leaseToParseFields` of that lease has no `isSelected`/`indexing` key and round-trips the legacy fields unchanged. `with-timeout.spec.ts`: a never-resolving promise rejects with `BackendTimeoutError` after the fake-timer delay. `leaseholder.repository.spec.ts` (Parse SDK stubbed through `parse-client.ts`): `markLeasesSent(['a'],'2026-12',t)` sets `lastSendDate=t` and `lastSentPeriod='2026-12'` and saves.
- [ ] **Step 2: Run** `npx ng test --watch=false` → FAIL.
- [ ] **Step 3: Implement** models, `parse-client.ts` (initialize with `environment.parseAppId`, `parseJsKey`, `serverURL = environment.parseServerUrl`; export a thin wrapper the specs can stub), mapping and repositories.
- [ ] **Step 4: Run** tests → PASS.
- [ ] **Step 5: Commit** `feat(core): models, Parse mapping and repositories`.

### Task 3: Billing periods, amounts, send status, French formatting

**Files:**
- Create: `src/app/core/billing/{period,amounts,send-status}.ts`, `src/app/core/format/fr.ts` + specs

**Interfaces:**
- Produces (`period.ts`): `type BillingPeriod = { year: number; month: number /*1-12*/ }`; `defaultCallDate(now: Date): Date` (= `new Date(y, m, 25)`); `billingPeriod(callDate: Date): BillingPeriod` (month after the call date); `periodKey(p): string` (`'2027-01'`); `legacyPeriodMonth(p): string` (`'01/2027'`, used by PDF and file names); `periodLabel(p): string` (`'janvier 2027'`); `periodLastDay(p): number`; `dueDate(p): Date` (1st of period).
- Produces (`amounts.ts`): `computeTVA(lease: Lease): number` (= `price * 0.2`); `computeTotalPrice(lease: Lease): number` — identical to legacy: `(isPro ? price + TVA : price) + (charge ? charge : 0) + Σ additionalCharges.amount`.
- Produces (`send-status.ts`): `isSentForPeriod(lease: Lease, p: BillingPeriod): boolean` — `lastSentPeriod === periodKey(p)`; if `lastSentPeriod` absent, true when `lastSendDate` falls in the calendar month preceding `p`. `leaseStatus(lease, p): 'sent' | 'todo'`.
- Produces (`fr.ts`): `formatEuro(n: number): string` (`Intl` fr-FR currency, `1 900 €` / `1 900,50 €`, narrow no-break spaces allowed); `formatPostalCode(n: number): string` (5 digits, `padStart`); `normalizePhone(input: string): string` (`+33 6 12 34 56 78`, `06.12.34.56.78`, `0612345678` → `0612345678`); `isValidPhone(input: string): boolean` (empty allowed); `formatDate(ms: number): string` (`dd/MM/yyyy`).

- [ ] **Step 1: Failing tests** — `defaultCallDate(new Date(2026,0,3))` is 25 Jan 2026 and valid (`!isNaN`); `billingPeriod(new Date(2026,11,25))` = `{year:2027, month:1}`; `legacyPeriodMonth` → `'01/2027'`; `periodLabel` → `'janvier 2027'`; `periodLastDay({2027,2})` = 28. Amounts: pro lease price 1234, charge 123, extra 50 → TVA 246.8, total 1653.8; habitation price 300 charge null → 300. Status: `lastSendDate` = 25 Oct 2026 without `lastSentPeriod` → sent for Nov 2026, todo for Dec 2026; `lastSentPeriod '2026-12'` → sent for Dec. Formatting: `formatPostalCode(1000)` = `'01000'`; phone cases above; `isValidPhone('12')` false.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(core): billing periods, amounts, send status, fr formatting`.

### Task 4: PDF definition identical to legacy, parameterised by landlord profile

**Files:**
- Create: `src/app/core/pdf/{rent-call-definition,pdf-render,file-name}.ts`, `src/app/core/pdf/legacy-definition.fixture.ts` (verbatim copy of the legacy `docDefinition` construction from `main:src/app/tab-send/tab-send.page.ts:201-306`, as a function of `(leaseholder, lease, now, callDate)`), `rent-call-definition.spec.ts`, `file-name.spec.ts`
- Modify: `src/app/core/models/landlord-profile.ts` (default values)

**Interfaces:**
- Consumes: `Lease`, `Leaseholder`, `LandlordProfile`, `computeTVA`, `computeTotalPrice`, `billingPeriod`, `legacyPeriodMonth`, `periodLastDay`.
- Produces: `DEFAULT_LANDLORD_PROFILE = { name: 'SCI LA CHARINE', addressLines: ['41 CHEMIN DES BAGNOLS', '13600 LA CIOTAT'], issueCity: 'LA CIOTAT', legalNotice: 'SCI LA CHARINE au capital de 2000 euros, inscrite au RCS de MARSEILLE sous le n° 507 834 117.', emailSignature: 'Pierre MARGERIT' }`.
- Produces: `buildRentCallDefinition(args: { leaseholder: Leaseholder; lease: Lease; profile: LandlordProfile; callDate: Date; now: Date }): TDocumentDefinitions`; postal codes printed via `formatPostalCode` (only visible difference allowed vs legacy, for codes < 10000).
- Produces: `renderPdf(def): Promise<{ blob: Blob; base64: string }>` (pdfmake 0.2 `getBlob` + `getBase64`, vfs fonts set once).
- Produces: `rentCallFileName(leaseholder: Leaseholder, lease: Lease, p: BillingPeriod): string` — lower-case, accents stripped, every run of spaces → `_`, pattern `<holder>-<lease>-MM_YYYY.pdf`.

- [ ] **Step 1: Failing test** — for 3 fixtures (pro with charge + additional charge; habitation with `charge` null and `lot` 0; lease with `optionalAddressInfo` ''), `JSON.stringify(buildRentCallDefinition({... profile: DEFAULT_LANDLORD_PROFILE}))` equals `JSON.stringify(legacyDefinition(...))` with the same inputs (postal code 13600). A custom profile `{name:'SCI TEST', addressLines:['1 RUE A','75001 PARIS'], issueCity:'PARIS', ...}` appears in the header, in « Établie par la SCI TEST », in « PARIS \n Le … », in `info.author` and in the legal text. `rentCallFileName` for `'Agi Martin'`, `'Garage n° 13'`, Jan 2027 → `'agi_martin-garage_n°_13-01_2027.pdf'` with accents stripped from `é/è/à`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (keep the legacy whitespace in template strings so the JSON comparison holds). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(pdf): rent-call definition identical to legacy, landlord profile`.

### Task 5: E-mail guard, rent-call e-mail and sender

**Files:**
- Create: `src/app/core/email/{email-guard,rent-call-email,rent-call-sender}.ts` + specs
- Modify: `src/environments/environment.example.ts` (remove `inseeApiKey`), local `src/environments/environment.ts` (same; git-ignored)

**Interfaces:**
- Consumes: `LeaseholderRepository.markLeasesSent`, `periodKey`, `periodLabel`, `LandlordProfile`.
- Produces: `assertRecipientAllowed(recipient: string, env: { production: boolean; testRecipientEmail?: string }): void` (throws `RecipientBlockedError` outside production unless case-insensitive equal); `effectiveSandbox(env): boolean` (true outside production, else `env.sandbox`).
- Produces: `rentCallSubject(p): string` = `` `Appel de loyer — ${periodLabel(p)}` ``; `rentCallBody(profile): string` = `'Bonjour,\n\nMerci de trouver ci-joint le(s) appel(s) de loyer(s) pour la prochaine période.\nBonne reception,\n\n' + profile.emailSignature`.
- Produces: `interface GeneratedPdf { lease: Lease; fileName: string; base64: string }`, `interface SendResult { email: string; holderNames: string[]; ok: boolean; error?: string; leaseIds: string[] }`, `RentCallSender.send(groups: Map<string /*email*/, { holderNames: string[]; pdfs: GeneratedPdf[] }>, p: BillingPeriod, profile: LandlordProfile): Promise<SendResult[]>` — one `Parse.Cloud.run('sendEmail', {senderEmail, recipientEmail, subject, text, attachments, sandbox})` per e-mail, run with `Promise.allSettled`, guard applied before each call, `markLeasesSent` only for successful groups; `groupByEmail(items: {holder: Leaseholder; pdf: GeneratedPdf}[])` builds the map (two holders with the same e-mail → one entry, both names).

- [ ] **Step 1: Failing tests** — guard: dev + other address → throws; dev + `JULIEN.berger1421@gmail.com` → ok; prod → ok. Sender with stubbed cloud call failing for group B: result has A ok / B error, `markLeasesSent` called only with A's lease ids, promise resolves (no hang); every call has `sandbox: true` in dev; a blocked recipient yields `ok:false` with the guard message and no cloud call. `groupByEmail` merges two holders sharing an address. Subject for Jan 2027 = `'Appel de loyer — janvier 2027'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(email): guarded rent-call sender with per-recipient results`.

### Task 6: Auth, login, shell layout, shared UI

**Files:**
- Create: `src/app/core/auth/{auth.service,auth.guard,session-error}.ts` (+ spec for session-error), `src/app/features/login/login.page.ts`, `src/app/features/shell/shell.ts`, `src/app/shared/ui/{pill,confirm-dialog,empty-state}.ts`
- Modify: `src/app/app.routes.ts`

**Interfaces:**
- Produces: `AuthService`: `user: Signal<{ username: string; email: string } | null>`, `login(u: string, p: string): Promise<void>`, `logout(): Promise<void>`; `authGuard: CanActivateFn` (→ `/login`).
- Produces: `handleSessionError(err: unknown, router: Router): boolean` — Parse code 209 (`INVALID_SESSION_TOKEN`) → logout + navigate `/login`, returns true; repositories call it in their catch.
- Produces: routes `/login`, and under `Shell` + `authGuard`: `/appels` (default), `/appels/envoi`, `/locataires`, `/locataires/:id`, `/reglages`.
- Produces: `InstallService`: `canPrompt: Signal<boolean>` (captured `beforeinstallprompt` on Chrome/Edge/Android), `prompt(): Promise<void>`, `isStandalone: Signal<boolean>` (`display-mode: standalone` or `navigator.standalone`), `platform: 'ios'|'android'|'desktop'`. Used by the « Installer l'application » entry in Réglages (Task 10): a button when `canPrompt`, otherwise step-by-step help for iPhone (Safari → Partager → « Sur l'écran d'accueil »); hidden when `isStandalone`.
- Produces: `<app-pill tone="ok|warn|accent|neutral">` (always `whitespace-nowrap`, rounded-full, 11 px semibold); `ConfirmDialog.open({ title, message, confirmLabel, danger? }): Promise<boolean>` (CDK Dialog); `<app-empty-state>`.

- [ ] **Step 1: Failing test** `session-error.spec.ts`: error `{code: 209}` → logout called and router navigated to `/login`, returns true; `{code: 101}` → false, no navigation.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** auth, login page (centred card, « Identifiant », « Mot de passe », error « Identifiant ou mot de passe incorrect »), shell (sidebar ≥ 768 px with logo « E-Lease », items « Appels de loyer », « Locataires », bottom « Réglages » + theme toggle; bottom tab bar < 768 px), pill, dialog. **Step 4: Run** → PASS.
- [ ] **Step 5: Verify manually** `npm start`: login as `julien` → shell visible, theme toggle switches light/dark, at 390 px width the bottom bar replaces the sidebar.
- [ ] **Step 6: Commit** `feat(ui): auth, login, responsive shell, shared UI`.

### Task 7: Accueil « Appels de loyer du mois »

**Files:**
- Create: `src/app/features/rent-calls/rent-calls.page.ts`, `src/app/features/rent-calls/send-state.ts` + `send-state.spec.ts`

**Interfaces:**
- Consumes: `LeaseholderRepository.leaseholders`, `defaultCallDate`, `billingPeriod`, `leaseStatus`, `computeTotalPrice`.
- Produces (`send-state.ts`, pure): `interface RentCallRow { holder: Leaseholder; lease: Lease; amount: number; status: 'sent'|'todo' }`; `buildRows(holders: Leaseholder[], p: BillingPeriod): RentCallRow[]` (holders without leases produce no row; sorted by holder then lease name, `localeCompare('fr')`); `summary(rows): { todo: number; sent: number; total: number }` (total = sum of all rows); `showReminderBanner(today: Date, rows): boolean` (day ≥ 25 and at least one `todo`).

- [ ] **Step 1: Failing tests** — holder with 0 leases → no row; `summary` counts; banner false on the 24th, true on the 25th with a todo, false on the 25th when all sent.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `send-state.ts` and the page: title `periodLabel` capitalised (« Janvier 2027 »), three KPI cards (« À envoyer », « Envoyés », « Total du mois »), banner « Les appels de loyer de janvier 2027 sont à envoyer. », row list (lease name, holder name, pill « À envoyer »/« Envoyé », amount), primary button « Préparer les envois » → `/appels/envoi`; loading skeleton; error state with « Réessayer » on `BackendTimeoutError`. **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(rent-calls): monthly overview with reminder banner`.

### Task 8: Send screen with mandatory PDF preview

**Files:**
- Create: `src/app/features/rent-calls/send.page.ts`, `src/app/shared/ui/pdf-viewer.ts`; extend `send-state.ts` (+ spec)
- Modify: `angular.json` (copy `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` to `assets/pdfjs/`)

**Interfaces:**
- Consumes: `buildRows`, `buildRentCallDefinition`, `renderPdf`, `rentCallFileName`, `groupByEmail`, `RentCallSender.send`, `LandlordProfileRepository.get`, `ConfirmDialog`.
- Produces (`send-state.ts`): `initialSelection(rows): Set<string /*lease objectId*/>` (all `todo` rows); `selectionSummary(rows, selected): { count: number; emails: number; holders: number; total: number }`; `canSend(selected, previewed): boolean` — every selected lease must have had its PDF generated (preview available) before sending.
- Produces: `<app-pdf-viewer [blob]="Blob | null">` rendering every page with pdf.js to canvases (same code path on desktop and mobile), with « Ouvrir dans un onglet » fallback link.

- [ ] **Step 1: Failing tests** — `initialSelection` excludes sent rows; `selectionSummary` for 3 leases of 2 holders sharing no e-mail = `{count:3, emails:2, holders:2, total:…}`; `canSend` false while one selected lease has no generated PDF.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** page: header « Appels de loyer — janvier 2027 », date input « Date de l'appel » (default `defaultCallDate(now)`, native `type=date`) and text « Échéance : 1er janvier 2027 »; left list (checkbox, lease, holder, amount, pill), clicking a row selects it for preview; right `<app-pdf-viewer>`; all selected PDFs are generated up-front when the page opens or the date changes; sticky footer « N sélectionnés · total » and button « Envoyer N appels »; confirm dialog message « {emails} e-mails à {holders} locataires, total {total}. » with button « Envoyer »; after send, inline summary listing each e-mail ok/échec and reloading statuses; mobile: tapping a row opens the viewer full-screen with « Retour ». Keyboard: ↑/↓ moves preview, Space toggles selection. **Step 4: Run** → PASS.
- [ ] **Step 5: Verify manually** as `julien`: select « Commerce », preview shows the whole PDF, send → summary « Envoyé » (sandbox, nothing delivered), status pill becomes « Envoyé »; in Back4App, `Commerce.lastSentPeriod` = next month key.
- [ ] **Step 6: Commit** `feat(rent-calls): one-screen send flow with PDF preview`.

### Task 9: Locataires list + detail with per-block editing

**Files:**
- Create: `src/app/features/tenants/{tenants.page,tenant-detail,contact-block,lease-block,lease-form,new-tenant-dialog}.ts` + `lease-form.spec.ts`

**Interfaces:**
- Consumes: `LeaseholderRepository` (all methods), `formatEuro`, `formatPostalCode`, `normalizePhone`, `isValidPhone`, `ConfirmDialog`, `Pill`.
- Produces (`lease-form.ts`): `buildLeaseForm(fb: FormBuilder, lease?: Lease): FormGroup` and `leaseFromForm(value, base?: Lease): Lease`. Validators: required `name`, `streetNumber`, `streetName`, `postalCode` (5 digits), `city`, `price` (≥ 0); optional `lot`, `charge`, `renewalDate`, `optionalAddressInfo`, additional charges (title + amount both required per row); `indexType` default `isPro ? 'ILAT' : 'IRL'`; `referenceIndexQuarter` pattern `^\d{4}-T[1-4]$`; `referenceIndexValue` > 0. Contact: `name` required max 80, `email` required email, `phone` optional `isValidPhone`, saved via `normalizePhone`.

- [ ] **Step 1: Failing tests** — form without `lot`/`renewalDate` is valid; postal code `'1000'` invalid, `'01000'` valid; `leaseFromForm` keeps `lastSendDate`/`lastSentPeriod` of `base`; quarter `'2025-T5'` invalid; `isPro` true → default `indexType` `'ILAT'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** list (search on name/e-mail, « + Nouveau locataire » dialog), detail (Contact block and one block per lease, each read-only with « Modifier » → inline form « Enregistrer »/« Annuler »; pills « Pro »/« Habitation », « À compléter » when `renewalDate` or reference index missing; « + Ajouter un bail »; delete lease / tenant via confirm dialog « Supprimer définitivement … ? »), mobile list → full-screen detail with « Retour ». Holders with 0 leases show « Aucun bail ». **Step 4: Run** → PASS.
- [ ] **Step 5: Verify manually** as `julien`: edit Commerce charge then cancel (unchanged), edit and save (persisted after reload), add and delete a test lease.
- [ ] **Step 6: Commit** `feat(tenants): list + detail with per-block editing`.

### Task 10: Réglages — profil bailleur, sauvegarde/restauration, compte

**Files:**
- Create: `src/app/features/settings/{settings.page,landlord-profile-form,backup}.ts` + `backup.spec.ts`

**Interfaces:**
- Consumes: `LandlordProfileRepository`, `LeaseholderRepository`, `AuthService.logout`, `ThemeService`.
- Produces (`backup.ts`, pure + repo calls): `exportBackup(holders): Blob` (same JSON shape as legacy export, file `elease-backup-<username>-<YYYY-MM-DD>.json`); `planRestore(file: Leaseholder[], existing: Leaseholder[]): { toCreate: Leaseholder[]; skipped: number }` (skip holders whose `objectId` exists, and leases whose `objectId` exists); `applyRestore(plan)` creates via repository, preserving `lastSendDate`/`lastSentPeriod`.

- [ ] **Step 1: Failing tests** — `planRestore` with a file equal to existing data → `toCreate` empty, `skipped` = count; a file with one unknown holder → only it is created; restored lease keeps `lastSendDate`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** settings page sections « Profil bailleur » (fields: Nom ou raison sociale, Adresse (2 lignes), Ville d'émission, Mentions légales, Signature des e-mails; « Enregistrer »), « Apparence » (Système / Clair / Sombre), « Sauvegarde » (« Exporter les données », « Restaurer depuis un fichier » with preview « N locataires seront ajoutés, M déjà présents ignorés » + confirm), « Application » (« Installer l'application » via `InstallService`), « Compte » (username, « Se déconnecter »). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(settings): landlord profile, backup/restore, account`.

### Task 11: Révision annuelle (logic + INSEE + in-app proposal)

**Files:**
- Create: `src/app/core/revision/revision.ts` + spec; replace `src/app/core/insee/insee.service.ts` (+ spec with recorded XML fixtures in `src/app/core/insee/fixtures/*.xml`)
- Modify: `src/app/features/tenants/lease-block.ts`

**Interfaces:**
- Produces (`revision.ts`, pure): `REMINDER_DAYS_BEFORE = 45`; `INSEE_SERIES: Record<IndexType, string> = { IRL: '001515333', ILC: '001532540', ILAT: '001617112' }`; `nextAnniversary(renewalDate: number, today: Date): Date`; `targetQuarter(referenceQuarter: string): string` (+1 year, `'2025-T2'` → `'2026-T2'`); `toInseePeriod(q: string): string` (`'2026-T2'` → `'2026-Q2'`); `proposeRent(price: number, refValue: number, newValue: number): number` (2 decimals, `Math.round(x*100)/100`); `probablePublication(type: IndexType, q: string): Date` (IRL: 15th of the month after quarter end; ILC/ILAT: last day of the 3rd month after quarter end); `revisionState(lease: Lease, today: Date, observations: Map<string, number> | undefined): { kind: 'incomplete' } | { kind: 'none' } | { kind: 'upcoming'; anniversary: Date; days: number; targetQuarter: string; newIndex?: number; proposedRent?: number; publication?: Date }` — `incomplete` when `renewalDate`, `indexType`, `referenceIndexQuarter` or `referenceIndexValue` missing; `upcoming` when anniversary within 45 days.
- Produces (`InseeService`): `observations(type: IndexType): Promise<Map<string /*'YYYY-Qn'*/, number>>` (fetches `https://api.insee.fr/series/BDM/V1/data/SERIES_BDM/<id>?lastNObservations=12`, cached per session).

- [ ] **Step 1: Failing tests** — `proposeRent(1091.08, 133.69, 136.42)` = `1113.36`; `targetQuarter('2025-T4')` = `'2026-T4'`; anniversary 1 Mar, today 15 Jan → upcoming, days 45; today 14 Jan → none; missing `referenceIndexValue` → incomplete; observations lacking the target quarter → `newIndex` undefined and `publication` set; InSEE fixture parsing returns `'2026-Q2' → 138.01` for ILAT.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**; in `lease-block` show pill « Révision le 01/03 » when upcoming, line « 1 091,08 € → 1 113,36 € (ILAT T2 2026) » and button « Appliquer la révision » (confirm dialog; then `updateLease` with `price = proposedRent`, `referenceIndexQuarter = targetQuarter`, `referenceIndexValue = newIndex`); when not yet published: « Indice ILAT T2 2026 attendu vers le 30/09/2026 ». **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(revision): annual revision proposal with INSEE indices`.

### Task 12: Cloud jobs — monthly and revision reminders

**Files:**
- Create: `cloud/package.json` (`node-mailjet ^3.1.0`, `"test": "node --test test/"`), `cloud/lib/{periods,revision,reminders}.js`, `cloud/jobs.js`, `cloud/test/{periods,revision,reminders}.test.js`
- Create: `cloud/main.js` = current deployed `main.js` (fetch with the Back4App MCP `get_file_content`, version 16) unchanged + `require('./jobs')` at the end

**Interfaces:**
- Produces (`periods.js`, `revision.js`): CommonJS ports of `billingPeriod`, `periodKey`, `periodLabel`, `isSentForPeriod`, `computeTotalPrice`, `nextAnniversary`, `targetQuarter`, `toInseePeriod`, `proposeRent`, `probablePublication` with the same semantics and the same test values as Tasks 3 and 11.
- Produces (`reminders.js`, pure): `buildMonthlyReminder({ owner: {email, username}, leases: Array<{holderName, lease}>, today: Date }): {to, subject, text} | null` — subject `N appels de loyer à envoyer pour janvier 2027`, text lists lease, tenant, amount, total and the link `https://e-lease-app.smarthomeserver.online/appels`; null when nothing is todo. `buildRevisionReminder({ owner, holderName, lease, today, newIndex?, publication? }): {to, subject, text}` — subject `Révision du loyer — <lease> — <dd/MM/yyyy>`, text with index type/quarter, old → new index, current → proposed rent, or the expected publication date.
- Produces (`jobs.js`): `Parse.Cloud.job('sendMonthlyReminder', …)` (acts only when today is the 25th unless `params.force`), `Parse.Cloud.job('sendRevisionReminder', …)` (daily; sends when the anniversary is within 45 days and `revisionReminderSentFor !== anniversaryISO`; if the index is not yet published, sends the "pending" mail once and re-sends with the proposal once published, tracked with `revisionReminderSentFor = anniversaryISO + ':pending'`). Both: read with `useMasterKey`, owner = user id in the object ACL, params `onlyUser` (username) and `dryRun` (return messages, send nothing, write nothing). Mail via Mailjet like `sendEmail`, From = To = owner e-mail.

- [ ] **Step 1: Failing tests** (`cd cloud && npm test`) — same period/amount/revision values as Tasks 3/11; monthly reminder null when all sent, subject/total for 2 todo leases; revision reminder text contains `1 091,08 € → 1 113,36 €` and, when unpublished, the expected date.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Deploy** with MCP `deploy_cloud_code_files` (`main.js`, `jobs.js`, `lib/*.js`, `package.json`; `package-lock.json` regenerated). Run `POST /jobs/sendMonthlyReminder` with master key and body `{"onlyUser":"julien","dryRun":true,"force":true}`, then `sendRevisionReminder` with `{"onlyUser":"julien","dryRun":true}` (after giving `Commerce` a renewal date 40 days ahead and a reference index): job status `succeeded` in `_JobStatus`, message lists only julien's lease.
- [ ] **Step 6: Schedule** in Back4App dashboard → Server Settings → Background Jobs: `sendMonthlyReminder` daily 09:00 Europe/Paris, `sendRevisionReminder` daily 09:00, both with params `{}`. If scheduling is unavailable on the Free plan, add to the Odroid crontab instead (`~/elease-backup/.env` already holds the master key): `0 9 * * * curl -s -X POST -H "X-Parse-Application-Id: $APP_ID" -H "X-Parse-Master-Key: $MASTER_KEY" -H "Content-Type: application/json" -d '{}' https://parseapi.back4app.com/jobs/sendRevisionReminder` and the same for `sendMonthlyReminder`, and record that fallback in the spec.
- [ ] **Step 7: Commit** `feat(cloud): monthly and revision reminder jobs`.

### Task 13: Cloudflare Pages deployment, legacy workflow pin, docs

**Files:**
- Create: `.github/workflows/pages-deploy.yml`, `public/_redirects` (`/* /index.html 200`)
- Modify: `.github/workflows/docker-build.yml` (checkout `ref: legacy-ionic`, Node 24 not needed there), `CLAUDE.md` (new stack, commands, test-safety rules, deployment), `README.md` (install as app on PC/Android/iPhone)

**Interfaces:**
- Consumes: GitHub secrets `ENVIRONMENT_PROD` (must now contain `production: true`, `parseAppId`, `parseJsKey`, `parseServerUrl`, `sandbox: false` — no `inseeApiKey`), new secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (added by the user).

- [ ] **Step 1: Workflow** — on `workflow_dispatch` and push to `main`: checkout, `actions/setup-node` with `node-version-file: .node-version`, write `src/environments/environment.prod.ts` from the secret, `npm ci`, `npx ng test --watch=false`, `npx ng build`, `npx wrangler@4 pages deploy www --project-name e-lease-app --branch ${{ github.ref_name }}`.
- [ ] **Step 2: Verify locally** `npx ng build && npx wrangler@4 pages deploy www --project-name e-lease-app --branch ui-refactor` (user runs `npx wrangler login` first) → preview URL serves the app; reloading `/locataires` works (SPA fallback); Lighthouse « Installable » passes.
- [ ] **Step 3: Custom domain** — user attaches `e-lease-app.smarthomeserver.online` to project `e-lease-app` in the Cloudflare dashboard (Workers & Pages → e-lease-app → Custom domains). Old hostname `e-lease.smarthomeserver.online` is not touched.
- [ ] **Step 4: Commit** `ci: deploy to Cloudflare Pages; pin legacy Docker build to legacy-ionic`.

### Task 14: End-to-end verification as `julien`

- [ ] **Step 1:** On the deployed preview, logged in as `julien`: install the PWA on the Mac (Chrome « Installer »), check light and dark themes, at 390 px check bottom bar and full-screen detail/preview.
- [ ] **Step 1b: Real phones** (user-assisted): install on an Android phone (Chrome « Installer l'application ») and an iPhone (Safari → « Sur l'écran d'accueil »). On each: app opens standalone with its icon; bottom bar clear of the home indicator; editing an amount opens the numeric keypad without zoom; the full PDF (all pages) is readable in preview; the send button is reachable with the thumb. Note any issue and fix before Step 2.
- [ ] **Step 2:** Rent calls: preview the « Commerce » PDF and compare it visually with a PDF generated by the old app (`npm start` on tag `legacy-ionic` is not needed — use the PDF fixture test from Task 4 as the proof, plus one visual check); send (production build sends for real → only to julien's own address; confirm receipt in Gmail with the PDF attached and subject « Appel de loyer — … »).
- [ ] **Step 3:** Revision: set Commerce `renewalDate` 40 days ahead, `indexType` ILC, reference `2025-T2` / `133.70`; the lease block shows the proposal; run `sendRevisionReminder` with `{"onlyUser":"julien"}` (no dryRun) → mail received at julien's address only.
- [ ] **Step 4:** Monthly reminder: `sendMonthlyReminder` with `{"onlyUser":"julien","force":true}` → mail received at julien's address only. Restore Commerce values afterwards.
- [ ] **Step 5:** Report results to the user; merging `ui-refactor` into `main` and attaching the custom domain are the user's call.
