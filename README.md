# E-Lease
Application de gestion de locataires et de biens locatifs avec génération automatique d'appels de loyers au format PDF.

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
└── www/                     # Build de production
```

## Sécurité
* Les fichiers `environment.ts` et `environment.prod.ts` sont exclus du versioning
* Chaque utilisateur a ses propres données via Parse ACL
* Les credentials ne sont jamais commités

## Licence
Projet privé - Tous droits réservés

Développé avec Angular + Ionic
