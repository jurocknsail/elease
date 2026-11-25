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
- **Statut « Envoyé »** d'un bail = son `lastSendDate` tombe dans le mois de la période sélectionnée (déduite de la date d'échéance, comme aujourd'hui) ; sinon « À envoyer ».
- **Montant affiché** = celui que le PDF facture (loyer + charges + charges additionnelles), calculé par la même fonction que la génération PDF — une seule source de vérité.
- **Regroupement des envois inchangé** : un e-mail par locataire, avec un PDF par bail en pièce jointe ; `lastSendDate` mis à jour après succès, comme aujourd'hui.
- **« Révision dans N j »** : purement informatif (date anniversaire dans les 30 prochains jours). Aucune réindexation automatique (règle métier inchangée).
- **Après envoi** : résumé (envoyés / échecs par locataire) affiché sur le même écran, sans redirection.
- **Accessibilité** : contrastes AA dans les deux thèmes, navigation clavier sur la liste d'envoi.

## Laissé au builder

- Découpage exact en composants, nommage des fichiers, organisation des routes (garder `AuthGuard`).
- Choix précis de l'implémentation de l'aperçu mobile (pdf.js vs nouvel onglet), tant que le PDF entier est lisible avant envoi.
- Migration Angular (ng update pas à pas 17→22, ou nouveau projet + reprise des services) selon ce qui est le plus sûr.
- Tests : au minimum, tests unitaires sur le calcul des montants/sélection d'envoi et sur le garde-fou e-mail ; vérification manuelle du parcours complet connecté en `julien`.
