# Reprise de l'exécution du plan (état au 2026-11-26, fin de session 2)

Le dossier `.superpowers/` est ignoré par git : ce fichier est la copie versionnée du registre d'avancement.

## Pour reprendre (Claude Code sur le web)
- Branche : `ui-refactor`. Plan : `docs/superpowers/plans/2026-11-25-ui-refactor.md`, spec : `docs/superpowers/specs/2026-11-25-ui-refactor-design.md` (autorité en cas de conflit).
- Mode d'exécution : sous-agents, un implémenteur par tâche + un relecteur de tâche (le skill `superpowers:subagent-driven-development` n'est pas installé sur le web : même flux fait à la main), puis relecture globale. Ne pas passer à la tâche suivante tant qu'il reste un point Critique ou Important.
- Environnement à recréer dans un conteneur neuf : Node 24 (`.node-version`), `npm ci`, `src/environments/environment.ts` et `environment.prod.ts` (git-ignorés) = copies de `environment.example.ts` avec `sandbox: true` et `testRecipientEmail: 'julien.berger1421@gmail.com'`. Ne jamais tester en `christine`, ne jamais envoyer à un vrai locataire, ne jamais écrire de clé dans un commit.
- `parse` reste en `^5.0.0` (ruling R2).
- Tâches 1 à 3 : faites, relues, corrigées (voir Registre). Prochaine : tâche 4, puis 5 à 14.
- Le push vers GitHub a échoué (403 : l'app GitHub de Claude n'a pas l'accès en écriture à `jurocknsail/elease`). Les commits restent locaux tant que l'accès n'est pas rétabli (https://claude.ai/customize/connectors).

## Amendements au plan décidés pendant l'exécution (à valider par l'utilisateur)
- **A1 — nouveau champ additif `Lease.lastSentPeriodAt` (ms)**, écrit dans la même sauvegarde que `lastSentPeriod` (= `lastSendDate` écrit). Il s'ajoute à la liste « additive only » des Global Constraints. Raison : sans lui, un envoi tardif du nouvel outil (appel de janvier envoyé le 3 janvier) ferait lire février comme « envoyé » et l'appel de février serait sauté en silence. À porter dans le job cloud de la tâche 12.
- **A2 — règle `isSentForPeriod`** (écart voulu au texte de la spec) : envoyé si `lastSentPeriod === période`, ou si `lastSentPeriod` est postérieur (envois d'avance), ou si `lastSendDate` tombe dans le mois précédant la période, sauf si `lastSentPeriodAt === lastSendDate` (date écrite par le nouvel outil). Raison : l'ancienne app, encore utilisée, n'écrit que `lastSendDate` ; sans repli, un envoi fait depuis l'ancienne app réafficherait « À envoyer » (double envoi possible à un vrai locataire). Voir le JSDoc de `src/app/core/billing/send-status.ts`. Le repli peut être supprimé quand l'ancienne app sera retirée.
- **A3 — couche Parse** : `ParseClient` abstrait (injectable, `FakeParseClient` pour les tests), `Parse.Object.disableSingleInstance()` à l'initialisation (sinon les modifications d'une sauvegarde échouée fuient dans la suivante), `updateLease` n'écrit jamais `lastSendDate`/`lastSentPeriod`/`lastSentPeriodAt`/`revisionReminderSentFor` et n'envoie que les champs modifiés, `deleteLease` refuse un bail qui n'appartient pas au locataire, `deleteLeaseholder` supprime d'abord ses baux (plus de baux orphelins).
- **A4 — validateur de téléphone** plus permissif que prévu (numéros étrangers acceptés, forme E.164) ; `formatEuro` arrondit comme le PDF (`toFixed(2)`).

## Points à reporter sur les tâches suivantes (issus des relectures)
- **T4** : importer `computeTVA`/`computeTotalPrice` de `core/billing/amounts`, imprimer les valeurs brutes via `.toFixed(2)` ; lignes de période `'01/' + legacyPeriodMonth(p)` et `periodLastDay(p) + '/' + legacyPeriodMonth(p)` ; date d'appel `formatDate(callDate.getTime())` ; nom de fichier : `legacyPeriodMonth` avec `/` -> `_` ; code postal via `formatPostalCode` (seule différence voulue avec l'ancien, pour 01xxx-09xxx) ; l'en-tête historique est UNE chaîne avec l'indentation du source : la reproduire à l'identique ; charger pdfmake en import dynamique (budget 500 kB).
- **T5** : `markLeasesSent` peut échouer APRÈS l'envoi du mail : le sender doit rendre `ok: true` avec un avertissement et ne jamais proposer de renvoi ; étendre `ParseClient` (Cloud.run) et `FakeParseClient`.
- **T6** : `AuthService` passe par `ParseClient` (logIn/logOut/currentUser) et n'importe jamais `parse` directement ni ne crée d'objet SDK avant le premier appel `ParseClient` ; `angular.json` : `allowedCommonJsDependencies: ["parse"]` et `maximumWarning` initial ~650 kB (le premier import de parse coûte +321 kB) ; jeton `--color-on-accent` (#ffffff clair, #0f1115 sombre) et bordure de champ renforcée (>= 3:1) ; `handleSessionError` (code 209).
- **T7/T9** : afficher « Jamais » si `lastSendDate === 0` ; après tout `BackendTimeoutError` sur une mutation, `load()` avant de réessayer ; téléphone non obligatoire, `normalizePhone` à l'enregistrement.
- **T8** : pdfjs-dist en import dynamique.
- **T11** : arrondir le loyer proposé au centime.
- **T12** : le cloud code tourne en UTC : convertir les epochs en (année, mois) avec `Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' })`, arithmétique sur entiers, `renewalDate` lue en Europe/Paris, tests aux frontières (`2027-01-31T23:30:00Z` = février) sous `TZ=UTC` et `TZ=Pacific/Auckland` ; porter la règle A2 avec `lastSentPeriodAt` ; champs `LandlordProfile` : `name`, `addressLines`, `issueCity`, `legalNotice`, `emailSignature`, `user` (Pointer vers `_User`) ; U+00A0 seul (pas U+202F) pour les montants dans les e-mails.
- **T13** : workflow : créer `environment.ts` avant `ng test` et écrire `environment.prod.ts` depuis le secret avant le build (`fileReplacements`) ; supprimer `.eslintrc.json` (mort) et les restes Ionic de `.vscode` ; CLAUDE.md/README : coquilles Capacitor (`android/`, `ios/`) dormantes, plus de `npm run lint` ; un passage de tests sous `TZ=America/Los_Angeles` si la CI lance les tests.
- **À faire par l'utilisateur sur son Mac (Back4App)** : (a) vérifier que les clients peuvent créer la classe `LandlordProfile` et les nouveaux champs de `Lease` (`lastSentPeriod`, `lastSentPeriodAt`, `indexType`, `referenceIndexQuarter`, `referenceIndexValue`, `revisionReminderSentFor`), sinon créer le schéma d'abord ; (b) vérifier `AddUnique`/`Remove` avec des pointeurs sur Parse Server 4.10.4 ; (c) audit ACL en lecture seule (master key) des classes `Leaseholder` et `Lease` : les objets antérieurs au commit legacy `ca7e98c` peuvent ne pas avoir d'ACL propriétaire (le job de la tâche 12 les ignorerait) ; (d) `npm install-scripts ls` sur le Mac (`fsevents@2.3.3` est refusable sans risque) ; (e) vérifier sur un vrai iPhone (iOS >= 16.4) le comportement de `apple-mobile-web-app-status-bar-style: default` en mode sombre.
- **Coexistence avec l'ancienne app** : les baux créés par la nouvelle app n'ont pas `isSelected` ni `indexing` ; l'ancienne app les affiche décochés et son formulaire d'édition exige `indexing` (prévu par la spec ; ne compte que tant que les deux apps sont utilisées). Limite connue de la règle A2 : un envoi tardif depuis l'ancienne app, fait dans le mois facturé lui-même, reste affiché « À envoyer ».
- `npm audit` : 4 vulnérabilités (3 modérées, 1 haute) toutes transitives via `parse@5.3.0` ; seul correctif = parse 8 (contraire à R2) ; exposition nulle pour un client navigateur ; à revoir avec une montée de `parse`.

## Registre
# SDD ledger — plan: docs/superpowers/plans/2026-11-25-ui-refactor.md
Spec: docs/superpowers/specs/2026-11-25-ui-refactor-design.md
Branch: ui-refactor (local clone in the web session, /home/user/elease; git-ignored environment.ts recreated from environment.example.ts)

## Pre-flight scan
| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T1→T6 | app.routes.ts created T1, routes added T6 | ok |
| T2↔T4 | DEFAULT_LANDLORD_PROFILE declared T2, values listed T4 | conflict: T2 needs values → Ruling R1 |
| T2↔T5 | markLeasesSent(ids, periodKey, at) | ok |
| T3↔T4/T5/T7/T12 | period/amount/status names | ok, names consistent |
| T5↔T8 | groupByEmail, RentCallSender.send, GeneratedPdf | ok |
| T6↔T10 | InstallService | ok |
| T7↔T8 | send-state.ts created T7, extended T8 | ok |
| T9↔T11 | lease-block created T9, modified T11 | ok |
| T11↔T12 | revision functions ported to cloud | ok, same test values (1113.36 verified) |
| T1 self | deps list says parse@^8; tech stack says Parse SDK 5 (existing, 5.0.0 works with Parse Server 4.10.4) | conflict → Ruling R2 |
| T1 self | `ng new --zoneless --test-runner=vitest` flags exist in CLI 22.3.0 | ok (verified) |
| T3 self | TVA 246.8 / total 1653.8 | ok (verified) |
| T11 self | proposeRent → 1113.36 | ok (verified) |
| T14 self | prod build sends for real while logged as julien → only julien's own leaseholder exists | ok, consistent with Global Constraints |
| others | each task's tests vs code vs files | no contradictions found |

Ruling R1: Task 2 defines DEFAULT_LANDLORD_PROFILE with the exact values from Task 4's Interfaces — a const needs values; Task 4 only verifies them against the legacy fixture — cost if wrong: trivial edit in T4.
Ruling R2: keep parse at the existing ^5.0.0 (not ^8) — SDK 5 is proven against Parse Server 4.10.4; newer SDKs may need server ≥5 — cost if wrong: missing newer SDK features (none needed).

## Tasks
Task 1: dispatched (BASE 3df1672, implementer a5681a46e9bf9c768, sonnet)
Task 1: implemented DONE_WITH_CONCERNS (commits 3df1672..ba4f837); review NOT yet dispatched — filtered diff at .superpowers/sdd/2026-11-25-ui-refactor/review-task1-filtered.diff (lockfile excluded). NEXT: dispatch task reviewer for Task 1, then Task 2. Stopped: usage limit.

## Session 2 (Claude Code web, 2026-11-26) — resumed
Env: Node v24.22.3 (tarball in scratchpad, `source <scratchpad>/node24-env.sh`), npm 11.19.1, `npm ci` OK. environment.ts recreated (placeholders, sandbox true, testRecipientEmail julien). Baseline on ba4f837: ng test 5/5 pass, ng build OK (ngsw.json present).
Skill superpowers:subagent-driven-development is NOT installed here -> same workflow done by hand (implementer subagent + task reviewer per task, global review at the end).
Tag legacy-ionic exists on origin (b474755).
Push policy: no push to main, no merge, no publish. Backup push only to claude/tender-wright-v2mgix (session branch); origin/ui-refactor is NOT touched without the user's go.
Blocked here (user to run on the Mac): Back4App MCP (deploy cloud code, _JobStatus, schedule), Odroid, wrangler login, manual tests as julien.

## Task 1 review (session 2, reviewer a6edceb1631043e14): CHANGES_REQUIRED — 0 Critical, 3 Important
Verified by controller: I1 (no fileReplacements in angular.json), I2 (maskable == any, 38.5% transparent; apple-touch 39.8% transparent), I3 (status-bar-style black -> black-translucent).
Point A (src/assets + .browserslistrc deletion): justified, harmless, nothing references them; recoverable from main/legacy-ionic.
Point B (maskable): real defect (Important) -> fix with opaque bg + safe-zone padding (ImageMagick recipe).
Point C (allowScripts): 4 approvals correct and harmless (prebuilt binaries); core-js-pure postinstall = donation banner -> deny; fsevents@2.3.3 (macOS) unverifiable here -> user checks `npm install-scripts ls` on the Mac. npm audit 4 vulns (3 moderate, 1 high) all via parse@5.3.0 transitive (@babel/runtime-corejs3, uuid, ws); only fix = parse 8 (breaks R2) -> ACCEPTED, recorded, revisit with parse upgrade. Practical exposure nil for a browser client.
Fixer dispatched: ab35135b12362345c (F1..F7). NEXT: re-check fixes (controller + quick re-review), then Task 2.

### Carry-forward items (from Task 1 review)
- T2: parse-client is the first importer of `environment`; parse@5 + EBADENGINE warning harmless.
- T4/T8: pdfmake and pdfjs-dist MUST be lazy-loaded (dynamic import) — initial budget 500 kB warn / 1 MB error.
- T6: add `--color-on-accent` token (#ffffff light, #0f1115 dark): white on dark accent #818cf8 is 2.98:1. Add a stronger input/control border token (>= 3:1, WCAG 1.4.11); --color-border is only 1.26/1.41:1.
- T6/T14: iOS status-bar `default` behaviour in dark mode to verify on a real iPhone. iPhone needs iOS >= 16.4 (Tailwind 4).
- T13: workflow must create `environment.ts` (cp example) before `ng test` and write environment.prod.ts from the secret before build (fileReplacements). Also: delete dead `.eslintrc.json` (angular-eslint v17, no deps, no lint script) and `.vscode` Ionic leftovers; CLAUDE.md/README rewrite must say Capacitor shells (android/, ios/) are dormant (all @capacitor/* deps removed); drop `npm run lint` from CLAUDE.md.
- Step 1 of Task 1 (`git tag legacy-ionic main`) was not done by the subagent but the tag already exists on origin (b474755 = main). OK.
- Commit trailers of c07b25c/ba4f837 say "Claude Opus 5.5" and have no Claude-Session line; history is not rewritten.

Task 1 fixes: DONE (fixer ab35135b12362345c, commits bfd48f7 + 6d5a587), re-verified by controller: tree clean, ng test 10/10, ng build prod 204.78 kB + dev OK, fileReplacements present, icons opaque RGB (maskable max dist ratio 0.394), allowScripts + core-js-pure:false, parse ^5.0.0. No open Critical/Important => TASK 1 CLOSED.
Local-only files (git-ignored, recreated this session): src/environments/environment.ts and environment.prod.ts (placeholders from environment.example.ts). Dev build has no ngsw.json by design (SW prod only).
Task 2: dispatching implementer.

## PUSH BLOCKED (session 2)
Stop hook asked to push ui-refactor. `git push` -> HTTP 403 "Claude doesn't have GitHub access to jurocknsail/elease" (GitHub App / account link lacks write; fetch/read works). Retried 4x (not transient). add_repo(access=push) was DENIED by the auto-mode classifier. No workaround attempted (no API re-creation of commits).
=> All commits stay LOCAL in this container (ephemeral). Unpushed at this point: bfd48f7, 6d5a587 (+ everything after). User must fix GitHub access (https://claude.ai/connect-github, install the Claude GitHub App on jurocknsail/elease) or pull the work another way; then `git push -u origin ui-refactor` (fast-forward of origin/ui-refactor 2a022ea).
Work continues locally (tasks do not depend on push).

## Task 2
Implementer a79f03dac09efe4e4: DONE, commit eb1d043 (14 files: models x3, parse/{parse-client,with-timeout,mapping,leaseholder.repository,landlord-profile.repository} + specs + parse/testing/fake-parse-client.ts). 84 tests pass (74 new). prod build 204.81 kB (parse not imported by the app yet). Reviewer: dispatching.
Carry-forward from T2:
- T6: first import of parse into the bundle = +321 kB raw (+85 kB transfer) (parse 174, core-js-pure 91, crypto-js 18, uuid 16) => crosses 500 kB warn + warning "Module 'parse' is not ESM". T6 must add `"allowedCommonJsDependencies": ["parse"]` in angular.json and raise the initial warn budget (~650 kB) or lazy-load. `import Parse from 'parse'` (default import) bundles OK.
- T5: extend abstract ParseClient (Cloud.run, login/logout) — T6 too. FakeParseClient lives in src/app/core/parse/testing/.
- T6: repositories let Parse errors propagate unchanged; handleSessionError(209) hooks in; NoSessionError (code 209) thrown by adapter when no current user.
- T12: LandlordProfile fields: name, addressLines(Array<String>), issueCity, legalNotice, emailSignature, user (Pointer<_User>), owner-only ACL. Lease.leases = Array<Pointer<Lease>> on Leaseholder (no back-pointer, no relation).
- Never grep www/ (dev bundle inlines environment values).
Open questions for reviewer: (a) ACL set on create only (legacy re-set on every holder save), (b) stale-write risk: updateLease writes lastSendDate/lastSentPeriod/revisionReminderSentFor from memory -> controller leans to SKIP those 3 bookkeeping fields in updateLease, (c) targeted writes vs legacy rewrite-all, (d) deleteLeaseholder order.

## Task 2 review (reviewer a9232d3a4184f95ca): CHANGES_REQUIRED — 0 Critical, 2 Important (84/84 tests, builds, prettier, tsc green; 16/17 mutants killed; layout faithful to legacy on the wire with real SDK 5.3 + REST stub)
I-1: Parse SDK single-instance mode (browser default) leaks a failed save's pending ops into the next save of the same object (cancelled edit written later by markLeasesSent; AddUnique merge error after failed unlink). Fix: Parse.Object.disableSingleInstance() in ensureSdk().
I-2: updateLease overwrote lastSendDate/lastSentPeriod/revisionReminderSentFor (+ unset of index fields) from stale memory -> double-send risk. Fix: bookkeeping never written by updateLease; diff vs state().
Minor taken now: m1 deleteLease membership guard, m2 assert query params, m3 tests (oldest profile, same-email holders), plan-literal round-trip assertion.
Fixer = same implementer a79f03dac09efe4e4 resumed via SendMessage.
Answers: null handling acceptable & documented; ACL create-only = Minor (do a read-only master-key ACL audit in T12/T14, no silent re-ACL); delete semantics = no new loss/orphan mode vs legacy, strictly safer.
### Carry-forwards from T2 review
- T3: legacy app sends write ONLY lastSendDate (never lastSentPeriod) and the old app stays in use => after a legacy send isSentForPeriod would show stale "todo" (double-send risk to a tenant). DECISION: implement isSentForPeriod as `lastSentPeriod === key || lastSendDate in the calendar month preceding p` (errs toward "sent" = safe direction); keep the plan's test values; report as a (small) deviation from spec wording.
- T5: markLeasesSent can reject AFTER the e-mail went out => RentCallSender must report ok:true + `warning` (status not recorded) and never offer a resend.
- T5/T6: extend abstract ParseClient (+FakeParseClient) with logIn/logOut/Cloud.run; do not import Parse elsewhere; ensureSdk not exported.
- T6: bundle: allowedCommonJsDependencies ["parse"] + raise initial maximumWarning (~650 kB); dynamic import not worth it (login needs Parse at first nav).
- T7/T9: after any BackendTimeoutError on a mutation, screen must load() before retry (server may have applied it; repository state deliberately unchanged).
- T4: legacy header is ONE string with the source indentation embedded; the definition builder must reproduce that whitespace exactly (JSON-equality test).
- T12/T14 (USER, needs Back4App): (a) verify clients may create class LandlordProfile and the new Lease fields (else create schema first); (b) check AddUnique/Remove with pointers on real Parse Server 4.10.4; (c) read-only master-key ACL audit of Leaseholder and Lease (objects created before legacy commit ca7e98c may lack an owner ACL; Task 12 'owner = ACL user' would skip them).
- Coexistence note for the user: leases created by the NEW app lack isSelected/indexing; the legacy app shows them unchecked and its edit form requires `indexing`. Per spec; matters only while both apps are used.

Task 2 fixes: DONE (commit fa8069d), re-verified by controller: tree clean, ng test 100/100, prod 204.83 kB + dev OK, prettier + tsc (app, spec) clean, no env/www tracked. Mutation checks done by the fixer (each fix removed => tests fail). Code read by controller: ensureSdk() calls disableSingleInstance() after initialize; updateLease diffs vs state() base, never writes the 3 bookkeeping fields; deleteLease ownership guard. No open Critical/Important => TASK 2 CLOSED.
Residual minor (accepted): `base` in updateLease is state()'s lease, not the instance the form started from (edge: stale value written if state refreshed under an open form). updateLease sends no save when nothing changed.
T6 CONSTRAINT: AuthService must NEVER import `parse` directly nor create SDK objects (incl. Parse.User.current()) before the first ParseClient call, else they are orphaned by disableSingleInstance() in ensureSdk(). Add logIn/logOut/currentUser to ParseClient (calling ensureSdk) + FakeParseClient. Session restore under the SDK cannot be tested in Vitest (Node mode: current() null) -> verify manually in T14.
UNPUSHED commits (403): bfd48f7, 6d5a587, eb1d043, fa8069d.
Task 3: dispatching implementer.

## Task 3
Implementer a165c5767e4da19d4: DONE_WITH_CONCERNS, commit 4662d13 (period/amounts/send-status/fr + 4 specs). 166 tests pass (also under TZ Pacific/Auckland, America/Los_Angeles, UTC, Asia/Kolkata, Pacific/Kiritimati). 7 mutations all killed. Amount maths matched to legacy tab-send.page.ts:127-141 (Object.is grid test vs verbatim legacy copy); period matched to legacy computePeriod/daysInNextMonth for every call date 2025-2030. isSentForPeriod = lastSentPeriod===key || lastSendDate in month preceding p (deliberate deviation from spec wording; legacy updateLeaseSendDate writes real send time and never lastSentPeriod — verified). Remaining gap (accepted, minor): legacy send made late inside the billed month still shows todo.
Reviewer: dispatching.

## Task 3 review (reviewer a1f654806dc85a62d): APPROVED_WITH_MINOR on code + D1 (Important by impact, from the CONTROLLER's own rule)
Equivalence proven: amounts 204,158 cases Object.is vs verbatim legacy; periods 8,574 call dates 1990-2100; formatEuro == PDF toFixed(2) on 300k random leases; Node ICU == Chromium 158 output; specs green under 12 time zones; 47 mutants (38 killed everywhere, 4 only in some TZ, 5 survived: 4 equivalent + 1 gap M5).
Legacy bug found: legacy computeDefaultSendDate gave the 24th west of UTC (string-built date) — new defaultCallDate is correct.
D1: controller's isSentForPeriod rule shows false "SENT" after a LATE new-app send inside the billed month (S2/S3) => next period silently skipped (no highlight/banner/reminder). Indistinguishable from legit S5 with stored data alone. DECISION: option B = new additive Lease field `lastSentPeriodAt` (ms) written in the same save as lastSentPeriod (== lastSendDate written); date fallback blocked only when lastSentPeriodAt === lastSendDate. PLAN DEVIATION to flag to the user (additive field; touches T2 mapping/repo, T3 rule, T12 port).
Fixer = Task 3 implementer a165c5767e4da19d4 resumed (D1 + M1 phone validator, M2 bidi chars, M3 non-finite, M4 toFixed rounding, M5 tests, M8 comment).
### Carry-forwards from T3 review
- T4: import computeTVA/computeTotalPrice from core/billing/amounts; print RAW unrounded values via .toFixed(2); period lines: '01/' + legacyPeriodMonth(p), periodLastDay(p) + '/' + legacyPeriodMonth(p); call date: formatDate(callDate.getTime()); file name: legacyPeriodMonth with '/' -> '_'; postal code via formatPostalCode (deliberate difference vs legacy only for 01xxx-09xxx — note in the fixture).
- T7/T9: print « Jamais » when lastSendDate === 0 (formatDate(0) is 01/01/1970); home uses leaseStatus + computeTotalPrice + formatEuro. T7 visual check: Inter glyph for U+202F (falls back harmlessly if missing).
- T9: phone has no `required`; call normalizePhone on save; validator per M1.
- T11: round proposed rent to cents.
- T12 (IMPORTANT): cloud runs in UTC => do NOT use getMonth()/getFullYear() on epochs; convert epoch -> (year, month) with Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Paris'}).formatToParts; integer (year, month) arithmetic only; date-only values (renewalDate = Paris local midnight = previous day in UTC) also read in Europe/Paris; boundary tests: 2027-01-31T23:30:00Z must be Feb; run cloud tests under TZ=UTC and TZ=Pacific/Auckland. Port the NEW isSentForPeriod rule incl. lastSentPeriodAt. In e-mail text prefer U+00A0 only (no U+202F) for amounts.
- T13: if CI runs tests, run one TZ=America/Los_Angeles pass; date fallback in isSentForPeriod can be removed once the legacy app is retired.
- Plan/spec amendments to write after the fixer: lastSentPeriodAt, isSentForPeriod rule, R1/R2 (see docs "Amendments (execution)").

Task 3 fixes: DONE (commit 72113df), re-verified by controller: tree clean, ng test 187/187 under default, America/Los_Angeles, Pacific/Auckland, Europe/Paris; prod 204.93 kB + dev OK; prettier + tsc clean; no literal invisible chars in src. send-status.ts read by controller. 14 mutations killed (fixer). No open Critical/Important => TASK 3 CLOSED.
Fixer added RULE 2 to isSentForPeriod (lastSentPeriod LATER than p => p sent; needed so send-ahead Feb+Mar on 26 Jan does not re-show Feb as todo once the date fallback is blocked). Controller ACCEPTS it as a conscious trade-off (errs toward "sent", same as before; cannot cover descending send order; a later period sent while an earlier one was skipped would hide the earlier one). To remove: delete 2nd `if` in isSentForPeriod + its 3 specs.
Known limit: a lease with lastSentPeriod but no lastSentPeriodAt (written by something else) uses the old rule.
UNPUSHED commits (403): bfd48f7, 6d5a587, eb1d043, fa8069d, 4662d13, 72113df.
Next: write amendments into the versioned progress note, then Task 4 (PDF).
