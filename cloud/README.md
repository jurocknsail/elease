# E-Lease — Cloud Code Back4App (jobs de rappel)

Deux jobs, qui n'écrivent **jamais** aux locataires (expéditeur = destinataire = e-mail du compte propriétaire) :

- `sendMonthlyReminder` : le 25 (Europe/Paris), « N appels de loyer à envoyer pour <mois suivant> ».
- `sendRevisionReminder` : quotidien, rappel de révision de loyer à J-45 de la date anniversaire (proposition de loyer, ou « indice pas encore publié » puis renvoi à la publication).

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `jobs.js` | enregistre les deux jobs (`Parse.Cloud.job`), corps testables `runMonthlyReminder` / `runRevisionReminder`, expéditeur Mailjet, accès Parse/INSEE réels |
| `lib/periods.js` `lib/amounts.js` `lib/send-status.js` `lib/revision.js` | ports de `src/app/core/{billing,revision,insee}` (lecture des dates en Europe/Paris) |
| `lib/format.js` `lib/leases.js` `lib/reminders.js` | montants/dates français, lecture des baux Parse, construction des deux e-mails |
| `main.append.js` | la ligne `require('./jobs');` à ajouter à la fin du `main.js` déployé |
| `package.json` | `node-mailjet ^3.1.0` (chargé uniquement à l'envoi réel) |
| `test/` | tests `node --test`, sans Parse, sans Mailjet, sans réseau |

Il n'y a volontairement **pas** de `main.js` ici : le `main.js` déployé (version 16, fonction `sendEmail`) n'est pas dans le dépôt et ne doit pas être réécrit de mémoire.

## Tests

```bash
cd cloud
node --test                      # Node >= 18 ; sans argument de dossier (« node --test test/ » échoue sur Node 22+)
TZ=UTC node --test               # Back4App tourne en UTC
TZ=Pacific/Auckland node --test  # les dates ne dépendent pas du fuseau du processus
```

## Hypothèses non vérifiées (à contrôler avant le premier envoi)

1. **Variables Mailjet** : `createMailjetSender` (dans `jobs.js`) lit `MJ_APIKEY_PUBLIC` et `MJ_APIKEY_PRIVATE` dans `process.env`. Les noms réels utilisés par `sendEmail` dans le `main.js` déployé sont inconnus : les vérifier et, si besoin, modifier ces deux noms dans `jobs.js` (une ligne chacun). Si les clés sont écrites en dur dans `main.js`, les déclarer plutôt en variables d'environnement Back4App (Server Settings → Environment Variables) ; ne jamais copier de clé dans `jobs.js` ni dans git.
2. **Format du message Mailjet** : API v3.1 (`Messages: [{ From, To, Subject, TextPart }]`), jamais testé contre le vrai compte. L'adresse du propriétaire doit être un expéditeur validé chez Mailjet (comme pour `sendEmail`, qui envoie déjà depuis l'e-mail de l'utilisateur).
3. **Version de Node** de Back4App inconnue : le code est en ES2019 (pas d'`?.`, `??`, `.at()`, `replaceAll`).
4. **INSEE** : appel serveur à `https://api.insee.fr/series/BDM/V1/data/SERIES_BDM/<série>?lastNObservations=12` sans clé, via `Parse.Cloud.httpRequest` (repli sur `fetch`). Non vérifié depuis Back4App ; les fixtures de test sont synthétiques. En cas d'échec le bail est ignoré et signalé dans `inseeFailures` (jamais de proposition inventée).
5. **Propriétaire** : l'utilisateur avec droit d'écriture dans l'ACL du `Leaseholder` (un seul attendu). Un locataire sans propriétaire unique est ignoré (`skippedHoldersWithoutOwner`).
6. **Lecture** : `Leaseholder` avec `include('leases')`, master key, par pages de 100.

## Paramètres des jobs (corps JSON de la requête)

`dryRun`, `force` et `sandbox` n'acceptent que de vrais booléens JSON (`true` / `false`) ; absents, ils valent `false`. Toute autre valeur (`"true"`, `"yes"`, `1`…) fait échouer le job avec un message clair, sans rien faire.

| Paramètre | Effet |
| --- | --- |
| `onlyUser` | nom d'utilisateur : seul ce propriétaire est traité. **Toujours `"julien"` en développement.** Présent mais vide/non texte : le job échoue (jamais élargi à tous). |
| `dryRun` | `true` : le résultat contient les messages (`messages`), rien n'est envoyé, rien n'est écrit. Absent ou `false` : **envoi réel**. |
| `force` | mensuel seulement : `true` agit même si on n'est pas le 25 (Europe/Paris). Sans lui, un autre jour ne fait rien. |
| `sandbox` | `true` : mode bac à sable Mailjet (le message est accepté, pas livré). Le job révision n'écrit alors **pas** `revisionReminderSentFor` (l'essai ne supprime pas le vrai rappel). |

Les jobs sans `dryRun` envoient réellement ; avec `onlyUser:"julien"` ils n'écrivent qu'à l'adresse e-mail de julien. Le job révision écrit sur le bail **uniquement** `revisionReminderSentFor`, **après** un envoi réussi : `AAAA-MM-JJ` (proposition envoyée) ou `AAAA-MM-JJ:pending` (indice pas encore publié, renvoi à la publication).

## Déploiement (depuis le Mac)

1. Récupérer le `main.js` déployé (version 16) avec le MCP Back4App `get_file_content`, ou depuis le dashboard (Cloud Code → Functions) ; le sauvegarder en `cloud/main.js` **sans le modifier**. Idem pour le `package.json` déployé : y **fusionner** `elease-cloud/package.json` (garder les dépendances existantes, s'assurer que `node-mailjet` y est) plutôt que l'écraser.
2. Ajouter à la fin de `cloud/main.js` la ligne de `main.append.js` : `require('./jobs');` (`cat main.append.js >> main.js`).
3. Déployer `main.js`, `jobs.js`, `lib/*.js` et `package.json` à la racine du Cloud Code : MCP `deploy_cloud_code_files`, ou dashboard → Cloud Code → Functions → ajouter les fichiers → Deploy. Si besoin régénérer `package-lock.json` : `cd cloud && npm install`.
4. Vérifier que le déploiement n'a pas d'erreur (logs Back4App) et que `sendEmail` fonctionne toujours.

## Essai à blanc (dry run, master key, valeurs à remplacer)

```bash
export APP_ID=...        # Application Id Back4App (ne jamais le commiter)
export MASTER_KEY=...    # Master Key (idem)

curl -s -X POST -H "X-Parse-Application-Id: $APP_ID" -H "X-Parse-Master-Key: $MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"onlyUser":"julien","dryRun":true,"force":true}' \
  https://parseapi.back4app.com/jobs/sendMonthlyReminder

curl -s -X POST -H "X-Parse-Application-Id: $APP_ID" -H "X-Parse-Master-Key: $MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"onlyUser":"julien","dryRun":true}' \
  https://parseapi.back4app.com/jobs/sendRevisionReminder
```

Lire le résultat dans `_JobStatus` (dashboard → Core → Browser → `_JobStatus`, ou) :

```bash
curl -s -H "X-Parse-Application-Id: $APP_ID" -H "X-Parse-Master-Key: $MASTER_KEY" \
  "https://parseapi.back4app.com/classes/_JobStatus?order=-createdAt&limit=3"
```

`status` doit être `succeeded` ; `message` est le JSON du résultat : compteurs, `subjects`, `messages` (dry run), `errors`, `inseeFailures`. Contrôler que seuls les baux de julien apparaissent.

### Données de test pour julien (révision)

Dans l'app, connecté en `julien`, bail « Commerce » : date anniversaire = aujourd'hui + 40 jours, type d'indice `ILAT`, trimestre de référence `2025-T2`, valeur de référence `133,69` (l'indice cible `2026-T2` est publié : mail avec proposition). Pour tester le mail « pas encore publié », prendre la référence `2026-T3` (cible `2027-T3`, non publiée). Après un envoi réel, effacer `revisionReminderSentFor` du bail (dashboard → Browser → `Lease`) pour pouvoir recommencer. Remettre les valeurs d'origine ensuite.

### Envoi réel de contrôle

`{"onlyUser":"julien"}` (révision) ou `{"onlyUser":"julien","force":true}` (mensuel), sans `dryRun` : un seul mail, à l'adresse de julien.

## Planification

- Dashboard Back4App → Server Settings → Background Jobs → planifier `sendMonthlyReminder` et `sendRevisionReminder`, chacun tous les jours à 09:00 (Europe/Paris), paramètres `{}`. Le mensuel agit seulement le 25.
- Si la planification n'est pas disponible sur le forfait : crontab de l'Odroid (clés lues dans `~/elease-backup/.env`, jamais commitées ; vérifier les noms `APP_ID` / `MASTER_KEY` dans ce fichier) :

```cron
CRON_TZ=Europe/Paris
0 9 * * * . $HOME/elease-backup/.env && curl -s -X POST -H "X-Parse-Application-Id: $APP_ID" -H "X-Parse-Master-Key: $MASTER_KEY" -H "Content-Type: application/json" -d '{}' https://parseapi.back4app.com/jobs/sendMonthlyReminder
5 9 * * * . $HOME/elease-backup/.env && curl -s -X POST -H "X-Parse-Application-Id: $APP_ID" -H "X-Parse-Master-Key: $MASTER_KEY" -H "Content-Type: application/json" -d '{}' https://parseapi.back4app.com/jobs/sendRevisionReminder
```

**Ne jamais lancer un job sans `onlyUser` pendant le développement** : sans lui, tous les propriétaires reçoivent leur mail. Seules les exécutions planifiées (`{}`) tournent sans `onlyUser`, une fois les essais terminés.
