# Reprise de l'exécution du plan (état au 2026-11-26)

Le dossier `.superpowers/` est ignoré par git : ce fichier est la copie versionnée du registre d'avancement.

## Pour reprendre (Claude Code sur le web)
- Branche : `ui-refactor`. Plan : `docs/superpowers/plans/2026-11-25-ui-refactor.md`, spec : `docs/superpowers/specs/2026-11-25-ui-refactor-design.md`.
- Mode d'exécution choisi : sous-agents (skill `superpowers:subagent-driven-development`), un implémenteur par tâche + relecteur de tâche, puis relecture globale.
- `src/environments/environment.ts` est ignoré par git (clés Back4App) : à recréer depuis `environment.example.ts` (`sandbox: true`, `testRecipientEmail: 'julien.berger1421@gmail.com'`). Ne jamais tester en `christine`, ne jamais envoyer à un vrai locataire.
- Node 24 requis (`.node-version`). `parse` reste en `^5.0.0` (ruling R2).
- Tâche 1 faite (commits c07b25c, ba4f837), **relecture de tâche pas encore faite** : points à vérifier : suppression de `src/assets/` et `.browserslistrc`, icône maskable sans marge de sécurité, scripts d'installation npm approuvés (esbuild, @parcel/watcher, lmdb, msgpackr-extract).
- Ensuite : tâches 2 à 14.

## Registre
# SDD ledger — plan: docs/superpowers/plans/2026-11-25-ui-refactor.md
Spec: docs/superpowers/specs/2026-11-25-ui-refactor-design.md
Branch: ui-refactor (working dir /Users/julienberger/DEV/ELEASE/elease, not a worktree: git-ignored environment.ts lives here)

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
