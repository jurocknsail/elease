# E-Lease

[![Docker Build](https://img.shields.io/github/actions/workflow/status/jurocknsail/elease/docker-build.yml?style=flat-square&logo=github&label=docker%20build)](https://github.com/jurocknsail/elease/actions/workflows/docker-build.yml)
[![Docker Pulls](https://img.shields.io/docker/pulls/jurocknsail/elease?style=flat-square&logo=docker&color=2496ED)](https://hub.docker.com/r/jurocknsail/elease)
[![Docker Image](https://img.shields.io/badge/image-jurocknsail%2Felease-2496ED?style=flat-square&logo=docker)](https://hub.docker.com/r/jurocknsail/elease)
[![Platforms](https://img.shields.io/badge/platforms-amd64%20%7C%20arm64-lightgrey?style=flat-square&logo=linux)](https://hub.docker.com/r/jurocknsail/elease)
[![Angular](https://img.shields.io/badge/Angular-17-DD0031?style=flat-square&logo=angular)](https://angular.io)
[![Ionic](https://img.shields.io/badge/Ionic-7-3880FF?style=flat-square&logo=ionic)](https://ionicframework.com)
[![Capacitor](https://img.shields.io/badge/Capacitor-5-119EFF?style=flat-square&logo=capacitor)](https://capacitorjs.com)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-339933?style=flat-square&logo=nodedotjs)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-Private-lightgrey?style=flat-square)]()

> Application de gestion de locataires et de biens locatifs avec génération automatique d'appels de loyers au format PDF.

## Fonctionnalités
* Gestion des locataires (création, modification, suppression)
* Gestion des baux (biens locatifs, loyers, charges)
* Indexation automatique des loyers via les indices INSEE (IRL/ILAT)
* Génération de notifications d'appels de loyers en PDF
* Envoi d'emails avec pièces jointes PDF
* Support multi-plateforme : Web, Android, iOS
* Authentification sécurisée avec isolation des données par utilisateur

## Stack Technique

| Technologie | Version |
|---|---|
| Angular | 17.x |
| Ionic | 7.x |
| Capacitor | 5.x |
| Parse Server | Backend |
| pdfmake | Génération PDF |

## Prérequis
* Node.js >= 18.x
* npm >= 9.x
* Compte Parse Server (Back4App, Sashido, ou self-hosted)
* Clé API INSEE (optionnel, pour l'indexation automatique)

## Installation

### 1. Cloner le repository

```bash
git clone https://github.com/jurocknsail/elease.git
cd elease
```

### 2. Installer les dépendances

```bash
npm install
```

### 3. Configuration des variables d'environnement

Copier le fichier template et remplir avec vos identifiants :

```bash
cp src/environments/environment.example.ts src/environments/environment.ts
cp src/environments/environment.example.ts src/environments/environment.prod.ts
```

Éditer les fichiers avec vos identifiants :

```typescript
export const environment = {
  production: false,
  parseAppId: 'VOTRE_PARSE_APP_ID',
  parseJsKey: 'VOTRE_PARSE_JS_KEY',
  parseServerUrl: 'https://votre-parse-server.com/parse',
  inseeApiKey: 'VOTRE_CLE_API_INSEE',
  sandbox: true
};
```

### 4. Lancer l'application

```bash
npm run start
```

L'application est accessible sur `http://localhost:4200`

---

## Backends Parse Server

### Option A — Back4App (cloud)

1. Créer un compte sur [back4app.com](https://www.back4app.com) et créer une nouvelle application.
2. Récupérer les clés dans **App Settings > Security & Keys** : `Application ID`, `JavaScript Key`, `Master Key`.
3. Renseigner ces valeurs dans `environment.ts` :

```typescript
export const environment = {
  production: false,
  parseAppId: 'VOTRE_APP_ID_BACK4APP',
  parseJsKey: 'VOTRE_JS_KEY_BACK4APP',
  parseServerUrl: 'https://parseapi.back4app.com',
  sandbox: true
};
```

4. Lancer l'application normalement :

```bash
npm run start
```

---

### Option B — Parse Server local

Cette option permet de travailler entièrement hors-ligne avec MongoDB et Parse Server installés localement.

#### 1. Installer MongoDB manuellement

Si vous êtes derrière un proxy d'entreprise, `mongodb-runner` ne fonctionnera pas. Télécharger le binaire directement :

```bash
# Adapter la version et l'OS si nécessaire
curl -L "https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu2204-7.0.14.tgz" -o mongodb.tgz
tar -xzf mongodb.tgz
mkdir -p ~/data/db

# Ajouter au PATH
echo 'export PATH="$PATH:$HOME/mongodb-linux-x86_64-ubuntu2204-7.0.14/bin"' >> ~/.bashrc
source ~/.bashrc
```

#### 2. Démarrer MongoDB

Ouvrir un terminal dédié et laisser tourner :

```bash
mongod --dbpath ~/data/db
```

#### 3. Installer Parse Server et Parse Dashboard

```bash
npm install -g parse-server parse-dashboard
```

#### 4. Créer le fichier de configuration Parse Server

Créer `parse-config.json` à la racine du projet e-lease (hors du dossier `elease/`) :

```json
{
  "appId": "VOTRE_APP_ID",
  "masterKey": "VOTRE_MASTER_KEY",
  "clientKey": "VOTRE_CLIENT_KEY",
  "javascriptKey": "VOTRE_JS_KEY",
  "databaseURI": "mongodb://localhost/elease",
  "serverURL": "http://localhost:1337/parse",
  "port": 1337
}
```

#### 5. Démarrer Parse Server

Ouvrir un terminal dédié et laisser tourner :

```bash
parse-server parse-config.json
```

#### 6. (Optionnel) Démarrer Parse Dashboard

```bash
parse-dashboard \
  --dev \
  --appId VOTRE_APP_ID \
  --masterKey VOTRE_MASTER_KEY \
  --serverURL http://localhost:1337/parse \
  --appName elease
```

Le dashboard est accessible sur `http://localhost:4040`

#### 7. Configurer l'application Angular

Mettre à jour `environment.ts` pour pointer vers le serveur local :

```typescript
export const environment = {
  production: false,
  parseAppId: 'VOTRE_APP_ID',
  parseJsKey: 'VOTRE_JS_KEY',
  parseServerUrl: 'http://localhost:1337/parse',
  sandbox: true
};
```

#### 8. Lancer l'application

```bash
npm run start
```

#### Résumé des processus à démarrer

| Terminal | Commande | Rôle |
|---|---|---|
| 1 | `mongod --dbpath ~/data/db` | Base de données |
| 2 | `parse-server parse-config.json` | API backend |
| 3 | `parse-dashboard --dev ...` | Interface admin (optionnel) |
| 4 | `npm run start` | Application Angular |

---

## Docker

L'application est disponible en image Docker multi-architecture (amd64 + arm64) sur Docker Hub : `jurocknsail/elease:latest`

### Lancer l'application avec Docker

```bash
docker pull jurocknsail/elease:latest
docker run -p 80:80 jurocknsail/elease:latest
```

L'application est accessible sur `http://localhost`

### Build manuel de l'image

```bash
# Build simple (architecture locale)
docker build -t jurocknsail/elease:latest .

# Build multi-architecture (amd64 + arm64)
docker buildx build --platform linux/amd64,linux/arm64 -t jurocknsail/elease:latest --push .
```

> **Prérequis build multi-arch** : QEMU doit être installé pour l'émulation ARM. À faire une fois (à refaire après reboot) :
> ```bash
> docker run --privileged --rm tonistiigi/binfmt --install all
> ```
> Le CI GitHub Actions le gère automatiquement via `setup-qemu-action`.

### Structure du build Docker

Le build utilise un **multi-stage Dockerfile** :

1. **Stage build** — Node 20 Alpine compile l'application Angular/Ionic (`npm ci` + `npm run build`)
2. **Stage serve** — Nginx Alpine sert le dossier `www/` buildé

La configuration Nginx est optimisée pour les SPA Angular avec une stratégie de cache adaptée :
- `index.html` : jamais mis en cache (rechargement garanti à chaque déploiement)
- Assets JS/CSS (avec hash) : cache navigateur 1 an (`immutable`)

---

## CI/CD — GitHub Actions

Le build et le push Docker sont automatisés via GitHub Actions. Chaque push sur `main` déclenche un build multi-architecture et met à jour `jurocknsail/elease:latest` sur Docker Hub.

### Configuration requise

Dans **Settings → Secrets and variables → Actions** du repo GitHub, ajouter :

| Secret | Valeur |
|---|---|
| `DOCKERHUB_USERNAME` | Login Docker Hub |
| `DOCKERHUB_TOKEN` | Token Docker Hub (Account Settings → Personal Access Tokens) |
| `ENVIRONMENT_PROD` | Contenu complet du fichier `src/environments/environment.prod.ts` |

Exemple de valeur pour `ENVIRONMENT_PROD` :
```typescript
export const environment = {
  production: true,
  parseAppId: 'VOTRE_APP_ID',
  parseJsKey: 'VOTRE_JS_KEY',
  parseServerUrl: 'https://votre-parse-server.com/parse',
  inseeApiKey: 'VOTRE_CLE_API_INSEE',
  sandbox: false
};
```

> Les fichiers `environment.ts` et `environment.prod.ts` sont git-ignorés. Le CI recrée automatiquement `environment.prod.ts` depuis le secret, et génère un `environment.ts` factice (remplacé par `environment.prod.ts` pendant le build Angular).


### Workflow `.github/workflows/docker-build.yml`

```yaml
name: Docker Build & Push

on:
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Create environment files
        run: |
          echo "export const environment = {};" > src/environments/environment.ts
          echo "${{ secrets.ENVIRONMENT_PROD }}" > src/environments/environment.prod.ts

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to Docker Hub
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}

      - name: Build & Push multi-arch
        uses: docker/build-push-action@v5
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: jurocknsail/elease:latest
```

---

## Scripts disponibles

| Commande | Description |
|---|---|
| `npm run start` | Serveur de développement (port 4200) |
| `npm run build` | Build de production dans `www/` |
| `npm run watch` | Build avec rechargement automatique |
| `npm run test` | Exécution des tests unitaires |
| `npm run lint` | Analyse statique du code |

## Configuration Parse Server

### Classes requises

| Classe | Champs |
|---|---|
| Leaseholder | `name`, `email`, `phone`, `leases` (Relation) |
| Lease | `address`, `price`, `charge`, `indexing`, `renewalDate`, `isPro` |

### Hébergement recommandé
* [Back4App](https://www.back4app.com) — Gratuit pour petits projets
* [Sashido](https://www.sashido.io) — Alternative simple
* Self-hosted avec Docker

## Build Mobile

### Android

```bash
npm run build
npx cap sync android
npx cap open android
```

### iOS

```bash
npm run build
npx cap sync ios
npx cap open ios
```

## Structure du projet

```
elease/
├── src/
│   ├── app/
│   │   ├── model/           # Modèles de données
│   │   ├── pages/           # Composants/pages
│   │   ├── services/        # Services (Parse, INSEE)
│   │   └── validators/      # Validateurs personnalisés
│   ├── environments/        # Configuration (git-ignored)
│   └── assets/              # Ressources statiques
├── android/                 # Projet Android natif
├── ios/                     # Projet iOS natif
├── www/                     # Build de production
├── Dockerfile               # Build multi-stage Docker
├── nginx.conf               # Config Nginx pour SPA Angular
└── .github/
    └── workflows/
        └── docker-build.yml # CI/CD GitHub Actions
```

## Sécurité
* Les fichiers `environment.ts` et `environment.prod.ts` sont exclus du versioning
* Chaque utilisateur a ses propres données via Parse ACL
* Les credentials ne sont jamais commités
* Les secrets Docker Hub sont stockés dans GitHub Secrets (jamais dans le code)
* Le multi-stage Docker garantit que le code source et les clés ne se retrouvent pas dans l'image finale — seul le bundle `www/` buildé est embarqué

## Licence
Projet privé - Tous droits réservés

Développé avec Angular + Ionic
