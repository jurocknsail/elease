# E-Lease — Refonte UI & parcours utilisateur

Date : 2026-11-25 · Branche : `ui-refactor`

## Intention

E-Lease sert à un propriétaire (compte `christine`) à enregistrer ses locataires et leurs baux, les mettre à jour, et surtout **envoyer chaque mois les appels de loyer en PDF par e-mail**. L'app actuelle (Angular 17 + Ionic 7) a un look et un parcours « à l'ancienne », pensés mobile, alors que l'usage principal est **sur PC**. Elle n'est pas non plus installable comme une vraie app.

Objectif : un look actuel, un parcours **très simple**, un **aperçu obligatoire des PDF avant envoi**, et une app **installable sur PC, Android et iPhone sans store**.

## Objectifs

- Parcours mensuel en un écran : voir ce qui reste à envoyer → vérifier chaque PDF → envoyer.
- Gestion locataires/baux claire : liste + fiche, édition par bloc.
- PWA installable (Chrome/Edge PC, Android Chrome, iOS Safari « Sur l'écran d'accueil »).
- Desktop-first, entièrement utilisable sur mobile.
- Mode clair/sombre automatique (suit le système) + bascule manuelle.

## Non-objectifs

- Pas de changement du backend : Back4App `elease-be` (Parse), mêmes classes `Leaseholder`, `Lease`, `_User`, même cloud code `sendEmail` (Mailjet).
- Pas de changement des règles métier : calcul des montants, indexation (IRL/ILAT via INSEE), contenu des PDF, texte et signature du mail.
- Pas de publication sur les stores, pas d'app native Capacitor dans ce lot.
- Pas de multi-langue (français uniquement).

## Anti-objectifs (échec même si « ça marche »)

- Un e-mail part vers un vrai locataire pendant le développement ou les tests.
- Un PDF peut être envoyé sans avoir pu être prévisualisé.
- Une donnée de production est perdue ou altérée par la migration (les objets Parse existants doivent être lus et écrits à l'identique).
- Sur PC, l'app ressemble encore à une app mobile agrandie.

## Contraintes

- Données réelles : 2 comptes. `christine` = 6 vrais locataires ; `julien` = locataire fictif « Julien Berger » (`julien.berger1421@gmail.com`, bail « Commerce »). Isolation par ACL Parse par utilisateur. **Tous les tests se font connecté en `julien`.**
- Garde-fou dev existant (à conserver tel quel) : dans `ParseService.sendEmail`, hors `environment.production`, envoi bloqué sauf vers `environment.testRecipientEmail`, et sandbox Mailjet forcée.
- Déploiement inchangé : GitHub Actions (`.github/workflows/docker-build.yml`, build Angular sur le runner, environnement prod injecté par secret `ENVIRONMENT_PROD`) → image `jurocknsail/elease:latest` (nginx) → conteneur `elease` sur l'Odroid, exposé via Cloudflare tunnel sur `e-lease.smarthomeserver.online`. Le workflow doit passer de Node 20 à Node 24.
- Node 24 LTS en local (fnm, `.node-version` = 24).
- Échelle : ~7 locataires, ~12 baux. Pas besoin de pagination ni de recherche serveur.

## Approches envisagées

1. **Garder Ionic, moderniser (Angular 20+, Ionic 8)** — moins de travail, mais Ionic impose une esthétique mobile ; rejeté car l'usage principal est PC.
2. **Angular récent sans Ionic, desktop-first + PWA** — **retenue**. On conserve modèles, services (Parse, INSEE) et génération pdfmake ; on réécrit la couche écrans avec un layout sidebar et un design system léger.
3. **Réécriture React + shadcn/ui** — rejetée : jette du code métier qui fonctionne pour un résultat visuel équivalent.

## Décisions prises avec l'utilisateur

- **Style A « clair & sobre »** : fond blanc / gris doux, un accent indigo, typo Inter, look outil de travail moderne (Linear/Notion). **Mode sombre livré dès la v1** (auto + bascule).
- **Les étiquettes (statut, Pro/Habitation, révision…) tiennent toujours sur une ligne** — jamais de retour à la ligne (`white-space: nowrap`), quelle que soit la largeur.
- **Navigation** : barre latérale sur PC (Appels de loyer, Locataires, + Réglages/compte en bas) ; barre d'onglets en bas sur mobile.
- **Accueil = Appels de loyer du mois** : titre « Décembre 2026 », indicateurs (à envoyer, envoyés, total du mois), liste des baux avec statut et montant, bouton « Préparer les envois ».
- **Parcours d'envoi A « tout sur un écran »** : liste des baux à gauche (cases à cocher, montant, statut ; ceux déjà envoyés ce mois-ci décochés par défaut), **aperçu PDF à droite** qui suit la ligne cliquée, date d'échéance modifiable en haut, pied de page « N sélectionnés · total » + bouton unique « Envoyer N appels » avec confirmation. Mobile : liste ; tap → aperçu plein écran ; bouton d'envoi collant en bas.
- **Locataires A « liste + fiche à côté »** : liste à gauche avec recherche locale ; fiche à droite = bloc Contact + un bloc par bail (adresse, loyer HC, charges, charges additionnelles, Pro/Habitation, date anniversaire, indice, dernier envoi), chaque bloc avec son bouton « Modifier » (édition en place, Enregistrer/Annuler). « + Ajouter un bail », « + Nouveau locataire ». Étiquette « Révision dans N j » quand la date anniversaire approche. Mobile : liste → fiche plein écran.
- **Installation sans store** : PWA (manifeste + service worker Angular). Pas d'APK dans ce lot.

## Choix faits par Claude (à corriger si besoin)

- **Stack** : Angular 22 (dernière stable, compatible Node 24), composants standalone + signals, nouveau control flow ; **Tailwind CSS 4** pour le style ; **Angular CDK** (dialogues, overlay) et Angular Material uniquement là où un composant riche aide (date picker). Retrait d'Ionic, de `@ionic/storage`, des plugins Cordova (`preview-any-file`, `email-composer`) et de `@capacitor/filesystem` du parcours principal. Capacitor reste dans le repo mais n'est plus utilisé par l'app web.
- **Aperçu PDF** : généré en mémoire avec pdfmake (`getBlob`) et affiché dans l'app (iframe/objet `blob:` sur PC ; rendu fiable sur mobile — iOS Safari n'affiche que la 1re page d'un PDF en iframe, donc rendu via `pdf.js` ou ouverture plein écran dans un nouvel onglet). Plus d'écriture sur le système de fichiers ni d'explorateur de fichiers.
- **Mise à jour de pdfmake 0.2 → 0.3** seulement si le rendu PDF reste identique ; sinon rester en 0.2.
- **Export/Import JSON** (menu actuel) : conservés dans « Réglages ». Déconnexion dans le même menu.
- **Login** : écran centré simple, même mécanisme Parse.
- **Dates** : locale `fr-FR`, montants formatés `1 900 €`.
- **Statut « Envoyé »** d'un bail : les appels partent vers le 25 du mois M pour la période M+1 (données réelles : `lastSendDate` = 25/10 pour la période de novembre). Le statut se base donc sur la **période facturée**, pas sur la date d'envoi : nouveau champ additif `lastSentPeriod` (`"YYYY-MM"`) écrit à l'envoi ; pour les baux qui ne l'ont pas encore, repli sur `lastSendDate` ∈ mois précédant la période.
- **Montant affiché** = celui que le PDF facture (loyer + charges + charges additionnelles), calculé par la même fonction que la génération PDF — une seule source de vérité.
- **Regroupement des envois inchangé** : un e-mail par locataire, avec un PDF par bail en pièce jointe ; `lastSendDate` mis à jour après succès, comme aujourd'hui.
- **« Révision dans N j »** : purement informatif (date anniversaire dans les 30 prochains jours). Aucune réindexation automatique (règle métier inchangée).
- **Après envoi** : résumé (envoyés / échecs par locataire) affiché sur le même écran, sans redirection.
- **Accessibilité** : contrastes AA dans les deux thèmes, navigation clavier sur la liste d'envoi.

## Rappel mensuel d'envoi (ajout)

- **Canal : e-mail** (choix utilisateur), au **propriétaire** (e-mail du compte Parse `_User`), jamais aux locataires.
- **Quand** : le 25 de chaque mois à 9 h (Europe/Paris), via un **Cloud Job Back4App planifié** (`sendMonthlyReminder`) dans le cloud code, envoi par Mailjet (déjà utilisé).
- **Contenu** : « N appels de loyer à envoyer pour <mois M+1> », liste des baux non encore envoyés pour cette période (même règle que le statut ci-dessus), montant total, lien vers `https://e-lease.smarthomeserver.online`. Aucun mail si tout est déjà envoyé.
- **Pour qui** : chaque utilisateur ayant au moins un bail « À envoyer » (le job lit avec la master key, filtre par ACL propriétaire).
- **Sécurité test** : le job accepte un paramètre `onlyUser` ; tous les tests se font avec `onlyUser=julien`. Ne jamais déclencher le job sans ce paramètre pendant le développement.
- **Dans l'app** : bandeau sur l'accueil à partir du 25 tant qu'il reste des appels « À envoyer » pour M+1.
- Le cloud code passe de 1 à 2 fonctions ; déploiement via le MCP Back4App ou le dashboard, en conservant `sendEmail` à l'identique.

## Profil bailleur (ajout, décision utilisateur)

- Aujourd'hui en dur : en-tête PDF « SCI LA CHARINE / 41 CHEMIN DES BAGNOLS / 13600 LA CIOTAT », lieu « LA CIOTAT, le … », auteur PDF, mentions légales (« SCI LA CHARINE au capital de 2000 euros, RCS MARSEILLE n° 507 834 117 »), signature du mail « Pierre MARGERIT ».
- Devient une fiche **« Profil bailleur »** dans Réglages, un par utilisateur : nom/raison sociale, adresse (lignes), ville d'émission, mentions légales, signature du mail.
- Stockage : nouvelle classe Parse `LandlordProfile` (ACL propriétaire), pointeur vers l'utilisateur.
- **Migration sans changement visible** : si l'utilisateur n'a pas de profil, l'app en crée un pré-rempli avec les valeurs actuelles exactes, de sorte que les PDF et mails restent identiques au caractère près.

## PDF : contenu inchangé (décision utilisateur)

Calculs, libellés (« Loyer HT », « T.V.A. 20% », « Avance sur charges », « Total TTC »), TVA sur le loyer seul pour les baux pro, mentions : **strictement identiques**. Seules les données du profil bailleur deviennent paramétrables.

## Rappel de révision annuelle (ajout)

But : ne plus oublier l'indexation annuelle, et proposer le nouveau loyer.

Cadre légal retenu (à faire valider si besoin par un professionnel)
- Habitation (IRL, loi du 6/7/1989 art. 17-1 modifiée ALUR) : révision une fois par an à la date prévue au bail ou à la date anniversaire ; le bailleur a **1 an** pour la demander, **sans rétroactivité** (effet à la date de la demande). Formule : loyer HC × IRL du trimestre de référence de l'année N ÷ IRL du même trimestre N-1.
- Commercial / professionnel (ILC pour commerce-artisanat, ILAT pour les autres activités) : avec une clause d'échelle mobile, indexation **automatique** à la date prévue, sans formalité ; rappel des arriérés possible mais à ne pas laisser traîner (prescription débattue : 5 ans selon 2224 C. civ., 2 ans selon certains via L.145-60).
- Conséquence pratique : aucun préavis légal à respecter, mais le nouveau loyer doit figurer dans l'**appel envoyé le 25 du mois précédant** l'anniversaire.

Comportement
- **E-mail au propriétaire à J-45** avant la date anniversaire (laisse au moins un cycle d'appel du 25 avant l'échéance), via un Cloud Job Back4App quotidien (`sendRevisionReminder`, 9 h) ; anti-doublon par champ `revisionReminderSentFor` (`"YYYY-MM-DD"` de l'anniversaire visé).
- Contenu : bail, locataire, date anniversaire, indice applicable (type + trimestre), ancien indice → nouvel indice INSEE, **loyer actuel → loyer proposé**, lien vers l'app. Si l'indice du trimestre attendu n'est pas encore publié par l'INSEE, le mail le dit et donne la date de publication probable ; le job renvoie la proposition dès publication.
- Dans l'app, sur le bloc du bail : étiquette « Révision le 01/03 », proposition « 1 091,08 € → 1 120,45 € (ILAT T2 2026) » et bouton **« Appliquer la révision »** (met à jour le loyer et l'indice de référence ; rien n'est appliqué automatiquement).
- Même garde-fou de test que le rappel mensuel : paramètre `onlyUser=julien`.

Données nécessaires (nouveaux champs additifs sur `Lease`)
- `indexType` : `IRL` | `ILC` | `ILAT` (défaut proposé : IRL si habitation, ILAT si pro — à confirmer bail par bail).
- `referenceIndexQuarter` (ex. `2025-T2`) et `referenceIndexValue` : l'indice de référence **inscrit au bail / de la dernière révision**. Le champ actuel `indexing` (même valeur 133,69 sur tous les baux pro, issue d'un import) n'est pas fiable : il est conservé en base mais ignoré.
- Baux sans date anniversaire (5 sur 9 aujourd'hui) ou sans indice de référence : signalés « À compléter » dans l'app, pas de rappel tant que ce n'est pas renseigné.
- Séries INSEE (API BDM publique) : IRL `001515333`, ILC `001532540`, ILAT `001617112`.

## Passe de cohérence (app actuelle) — corrections incluses dans la refonte

Calculs et dates
- `computeDefaultSendDate` construit `"2026-1-25"` (mois non complété) : **date invalide sur Safari/iPhone** → bug bloquant pour la PWA iOS. Utiliser `new Date(y, m, 25)`.
- L'écran appelle « Date d'échéance » ce qui est en fait la **date de l'appel** (imprimée « La Ciotat, le … ») ; l'échéance réelle est le 1er du mois facturé. Renommer « Date de l'appel » et afficher « Échéance : 1er janvier 2027 ».
- Objet du mail « Facture de loyer pour le mois de 01/2027 » → « Appel de loyer — janvier 2027 ».
- Nom de fichier PDF : `replace(" ", "_")` ne remplace que le 1er espace → remplacer tous les espaces/accents.

Envoi
- Si un envoi échoue, la promesse ne se résout jamais : l'écran reste bloqué et **les envois réussis ne mettent pas à jour leur date**. Gérer chaque locataire indépendamment, puis résumé succès/échecs.
- Cocher/décocher un bail réécrit tout le locataire et tous ses baux en base (`updateLeaseholder`). La sélection devient un état d'écran (non persisté) ; `isSelected` n'est plus écrit (champ conservé en base pour compatibilité).
- Confirmation d'envoi : récapitulatif explicite (« 6 e-mails à 5 locataires, total 8 420 € ») au lieu de « Es-tu sûr(e) ? ».

Données et formulaires
- Ajout d'un bail : la **date anniversaire n'est pas demandée** et vaut la date de création → la demander (optionnelle).
- `lot` obligatoire à la création alors que le PDF le traite comme optionnel (lot 0 = pas de lot, ex. « Restaurant ») → optionnel.
- Téléphone : le validateur exige 10 chiffres collés, alors que le formulaire suggère « +33 6 00 00 00 00 » → accepter espaces/points/+33, normaliser à l'enregistrement ; téléphone optionnel (non utilisé ailleurs).
- Code postal stocké en nombre : les codes `01xxx`–`09xxx` perdraient leur 0 → afficher/imprimer sur 5 chiffres (`padStart`), type de colonne inchangé (schéma Parse).
- Nom limité à 30 caractères à la création mais pas à la modification → même règle partout (pas de limite stricte, 80 car.).
- Import JSON : crée des doublons à chaque import et remet `lastSendDate` à 0 → l'import devient une **restauration contrôlée** (aperçu, ignore les objets déjà présents par `objectId`), ou est retiré (voir questions).

Textes et ton
- Mélange « tu » (« Es-tu sûr(e) », « recommence ! ») et « vous » ; emojis dans les toasts. → Vouvoiement neutre partout, sans emojis.
- Vocabulaire unifié : « Appels de loyer » (pas « Envois », « Envois PDF », « Factures ») ; « Locataire », « Bail / Baux ».
- Message d'erreur INSEE mentionnant une « clé API non configurée » alors qu'aucune clé n'est utilisée → message réseau simple. Retrait de `inseeApiKey` des environnements.

Données
- 3 baux orphelins (rattachés à aucun locataire) du compte de test `julien` : **supprimés le 2026-11-25** avec accord de l'utilisateur. Il reste 9 baux.

Nettoyage technique
- Code mort : `message`/`onWillDismiss` d'exemple Ionic, `isBrowser`, ouverture PDF commentée, dossier `elease_pdfs` sur disque.

## Laissé au builder

- Découpage exact en composants, nommage des fichiers, organisation des routes (garder `AuthGuard`).
- Choix précis de l'implémentation de l'aperçu mobile (pdf.js vs nouvel onglet), tant que le PDF entier est lisible avant envoi.
- Migration Angular (ng update pas à pas 17→22, ou nouveau projet + reprise des services) selon ce qui est le plus sûr.
- Tests : au minimum, tests unitaires sur le calcul des montants/sélection d'envoi et sur le garde-fou e-mail ; vérification manuelle du parcours complet connecté en `julien`.
