# E-Lease

Application de gestion de locataires et de biens locatifs, avec génération et envoi des appels de loyer
en PDF par e-mail et suivi de la révision annuelle des loyers (indices INSEE). Application web installable
(PWA) : Angular 22, Tailwind CSS 4, backend Parse Server (Back4App).

Adresse de l'application : <https://e-lease-app.smarthomeserver.online>

## Installer l'application

| Appareil      | Navigateur     | Comment                                                                   |
| ------------- | -------------- | ------------------------------------------------------------------------- |
| PC / Mac      | Chrome ou Edge | Icône « Installer » dans la barre d'adresse (ou menu → Installer E-Lease) |
| Android       | Chrome         | Menu ⋮ → « Installer l'application »                                      |
| iPhone / iPad | Safari         | Bouton Partager → « Sur l'écran d'accueil » (iOS 16.4 ou plus récent)     |

L'application s'ouvre ensuite en plein écran, avec son icône. Une connexion est nécessaire pour lire et
enregistrer les données.

## Lancer en local

Prérequis : Node 24 (voir `.node-version`) et un compte Parse Server (Back4App).

```bash
npm ci
cp src/environments/environment.example.ts src/environments/environment.ts
cp src/environments/environment.example.ts src/environments/environment.prod.ts
# renseigner parseAppId, parseJsKey, parseServerUrl dans les deux fichiers
npm start        # http://localhost:4200
```

Les deux fichiers `environment*.ts` sont ignorés par git. Garder `production: false`, `sandbox: true` et
`testRecipientEmail` (votre propre adresse) : hors production, aucun e-mail ne part ailleurs qu'à cette
adresse. Ne tester qu'avec un compte de test, jamais avec des locataires réels.

## Tests et build

```bash
npm test                  # tests unitaires
npm run build             # build de production dans www/
cd cloud && node --test   # tests des jobs Back4App
```

## Déploiement

- **Nouvelle application** : GitHub Actions (`.github/workflows/pages-deploy.yml`) déploie sur
  Cloudflare Pages (projet `e-lease-app`) à chaque push sur `main`. Les autres branches sont seulement
  testées et compilées, sans déploiement. Mise en place pas à pas : [`docs/deploy-cloudflare-pages.md`](docs/deploy-cloudflare-pages.md).
- **Rappels par e-mail** (rappel mensuel du 25, rappel de révision) : jobs Back4App, voir
  [`cloud/README.md`](cloud/README.md).

## Ancienne version

L'ancienne application (Angular 17 + Ionic 7) a été retirée de cette branche. Son code reste dans
l'historique git, au tag `legacy-ionic`.

## Pour les développeurs

Conventions, règles de sécurité des tests et règles métier : [`CLAUDE.md`](CLAUDE.md). Conception et plan :
`docs/superpowers/`.

Projet privé, tous droits réservés.
