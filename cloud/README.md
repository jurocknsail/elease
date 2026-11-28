# E-Lease — Cloud Code Back4App (jobs de rappel)

Deux jobs, qui n'écrivent **jamais** aux locataires (expéditeur = destinataire = e-mail du compte propriétaire) :

- `sendMonthlyReminder` : **tous les jours à partir du 25 jusqu'à la fin du mois** (Europe/Paris), tant qu'un bail n'est pas envoyé pour la période suivante (même règle que l'app : `lastSentPeriod` / `lastSendDate`) ; aucun mail dès que tout est envoyé. « N appels de loyer à envoyer pour <mois suivant> ».
- `sendRevisionReminder` : quotidien, rappel de révision de loyer à J-45 de la date anniversaire (proposition de loyer, ou « indice pas encore publié » puis renvoi à la publication).

## Historique des baux (statistiques)

`history.js` enregistre un déclencheur `afterSave` sur `Lease` : à chaque sauvegarde d'un bail (nouvelle app **ou ancienne app**), il ajoute des lignes dans deux classes nouvelles, en ajout seul, lisibles uniquement par le propriétaire du bail et jamais modifiables par un client (`beforeSave` / `beforeDelete` refusent sans master key) :

- `RentCallLog` : un appel de loyer envoyé (`lastSendDate` a changé) : `leaseId`, `leaseName`, `period`, `sentAt`, `source` (`app` / `legacy` / `baseline`), montants du jour (`price`, `charge`, `tva`, `extras`, `total`).
- `RentChange` : un changement du montant appelé (création, modification, révision) : anciens et nouveaux loyer, total et indice de référence.

Rien n'est modifié dans `Lease` ni `Leaseholder` : compatible avec l'ancienne app. Un échec est journalisé et ne bloque jamais la sauvegarde du bail.

Job manuel `backfillLeaseHistory` (`onlyUser`, `dryRun`) : donne à chaque bail sans historique un point de départ (`baseline` : montants actuels et dernier envoi). Idempotent. Après déploiement : d'abord `{"onlyUser":"julien","dryRun":true}`, puis `{"onlyUser":"julien"}`, puis `{}` une seule fois pour tous les propriétaires.

**Avant de déployer** : vérifier que le `main.js` déployé ne définit pas déjà `afterSave('Lease')`, `beforeSave('RentCallLog')`… (Parse n'accepte qu'un déclencheur par classe et par type).

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `jobs.js` | enregistre les deux jobs (`Parse.Cloud.job`), corps testables `runMonthlyReminder` / `runRevisionReminder`, expéditeur Mailjet, accès Parse/INSEE réels |
| `lib/periods.js` `lib/amounts.js` `lib/send-status.js` `lib/revision.js` | ports de `src/app/core/{billing,revision,insee}` (lecture des dates en Europe/Paris) |
| `lib/format.js` `lib/leases.js` `lib/reminders.js` | montants/dates français, lecture des baux Parse, construction des deux e-mails |
| `history.js`, `lib/history.js` | déclencheur d'historique des baux et job `backfillLeaseHistory` |
| `main.append.js` | les lignes `require('./jobs');` et `require('./history');` à ajouter à la fin du `main.js` déployé |
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

1. **Clés Mailjet** : RÉSOLU. `main.append.js` partage le client Mailjet déjà créé par le `main.js` déployé (`global.eleaseMailjet = mailjet;`) ; `createMailjetSender` l'utilise quand `MJ_APIKEY_PUBLIC` / `MJ_APIKEY_PRIVATE` ne sont pas définies. Aucune clé n'est copiée dans `jobs.js` ni dans git. Si un jour les clés passent en variables d'environnement Back4App, ces deux variables prennent le relais sans autre changement.
2. **Format du message Mailjet** : API v3.1 (`Messages: [{ From, To, Subject, TextPart }]`), vérifié le 2026-11-27 : envoi en sandbox puis envoi réel vers julien acceptés. L'adresse du propriétaire doit être un expéditeur validé chez Mailjet (comme pour `sendEmail`, qui envoie déjà depuis l'e-mail de l'utilisateur).
3. **Version de Node** de Back4App inconnue : le code est en ES2019 (pas d'`?.`, `??`, `.at()`, `replaceAll`).
4. **INSEE** (vérifié le 2026-11-27 depuis Back4App : ILAT T2 2026 = 138,01 lu correctement) : appel serveur à `https://api.insee.fr/series/BDM/V1/data/SERIES_BDM/<série>?lastNObservations=12` sans clé, via `Parse.Cloud.httpRequest` (repli sur `fetch`). Non vérifié depuis Back4App ; les fixtures de test sont synthétiques. En cas d'échec le bail est ignoré et signalé dans `inseeFailures` (jamais de proposition inventée).
5. **Propriétaire** : l'utilisateur avec droit d'écriture dans l'ACL du `Leaseholder` (un seul attendu). Un locataire sans propriétaire unique est ignoré (`skippedHoldersWithoutOwner`).
6. **Lecture** : `Leaseholder` avec `include('leases')`, master key, par pages de 100.

## Paramètres des jobs (corps JSON de la requête)

`dryRun`, `force` et `sandbox` n'acceptent que de vrais booléens JSON (`true` / `false`) ; absents, ils valent `false`. Toute autre valeur (`"true"`, `"yes"`, `1`…) fait échouer le job avec un message clair, sans rien faire.

| Paramètre | Effet |
| --- | --- |
| `onlyUser` | nom d'utilisateur : seul ce propriétaire est traité. **Toujours `"julien"` en développement.** Présent mais vide/non texte : le job échoue (jamais élargi à tous). |
| `dryRun` | `true` : le résultat contient les messages (`messages`), rien n'est envoyé, rien n'est écrit. Absent ou `false` : **envoi réel**. |
| `force` | mensuel seulement : `true` agit même avant le 25 (Europe/Paris). Sans lui, avant le 25 le job ne fait rien. |
| `sandbox` | `true` : mode bac à sable Mailjet (le message est accepté, pas livré). Le job révision n'écrit alors **pas** `revisionReminderSentFor` (l'essai ne supprime pas le vrai rappel). |

Les jobs sans `dryRun` envoient réellement ; avec `onlyUser:"julien"` ils n'écrivent qu'à l'adresse e-mail de julien. Le job révision écrit sur le bail **uniquement** `revisionReminderSentFor`, **après** un envoi réussi : `AAAA-MM-JJ` (proposition envoyée) ou `AAAA-MM-JJ:pending` (indice pas encore publié, renvoi à la publication).

## Déploiement (depuis le Mac)

1. Récupérer le `main.js` déployé (version 16) avec le MCP Back4App `get_file_content`, ou depuis le dashboard (Cloud Code → Functions) ; le sauvegarder en `cloud/main.js` **sans le modifier**. Idem pour le `package.json` déployé : y **fusionner** `elease-cloud/package.json` (garder les dépendances existantes, s'assurer que `node-mailjet` y est) plutôt que l'écraser.
2. Ajouter à la fin de `cloud/main.js` la ligne de `main.append.js` : `require('./jobs');` (`cat main.append.js >> main.js`).
3. Déployer `main.js`, `jobs.js`, `history.js`, `lib/*.js` et `package.json` à la racine du Cloud Code : MCP `deploy_cloud_code_files`, ou dashboard → Cloud Code → Functions → ajouter les fichiers → Deploy. Si besoin régénérer `package-lock.json` : `cd cloud && npm install`.
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

Le forfait gratuit de Back4App n'autorise **qu'un seul job planifié** : le job `sendReminders` exécute les deux rappels (mensuel puis révision ; l'échec de l'un n'empêche pas l'autre). Il est planifié (Cloud Code → Jobs → Scheduled Jobs) **tous les jours à 08:00 UTC** (09:00 Paris en hiver, 10:00 en été), paramètres `{}`, à partir du 28 novembre 2026. Effet : le rappel mensuel part chaque jour **à partir du 25 jusqu'à la fin du mois, tant qu'un bail n'est pas envoyé pour la période suivante** ; le rappel de révision part à J-45 de la date anniversaire.

Si la planification devenait indisponible, le crontab de l'Odroid peut déclencher le même job (clés lues dans `~/elease-backup/.env`, jamais commitées) :

```cron
0 9 * * * . $HOME/elease-backup/.env && curl -s -X POST -H "X-Parse-Application-Id: $APP_ID" -H "X-Parse-Master-Key: $MASTER_KEY" -H "Content-Type: application/json" -d '{}' https://parseapi.back4app.com/jobs/sendReminders
```

**Ne jamais lancer un job sans `onlyUser` pendant le développement** : sans lui, tous les propriétaires reçoivent leur mail. Seules les exécutions planifiées (`{}`) tournent sans `onlyUser`, une fois les essais terminés.

## État du déploiement (2026-11-27)

Cloud code déployé (version `v20`) sur `elease-be` (`sendEmail` inchangé ; sauvegarde du `main.js` v16 conservée hors dépôt). Essais faits uniquement avec `onlyUser:"julien"` : dry runs, sandbox, puis un envoi réel de chaque job vers l'adresse de julien (bail de test restauré ensuite). **Le job combiné `sendReminders` est planifié** : voir « Planification ».
