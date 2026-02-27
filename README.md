# E-Lease

Application de gestion de locataires et de biens locatifs avec génération automatique d'appels de loyers au format PDF.

## Fonctionnalités

- Gestion des locataires (création, modification, suppression)
- Gestion des baux (biens locatifs, loyers, charges)
- Indexation automatique des loyers via les indices INSEE (IRL/ILAT)
- Génération de notifications d'appels de loyers en PDF
- Envoi d'emails avec pièces jointes PDF
- Support multi-plateforme : Web, Android, iOS
- Authentification sécurisée avec isolation des données par utilisateur

## Stack Technique

| Technologie | Version |
|-------------|---------|
| Angular | 17.x |
| Ionic | 7.x |
| Capacitor | 5.x |
| Parse Server | Backend |
| pdfmake | Génération PDF |

## Prérequis

- Node.js >= 18.x
- npm >= 9.x
- Compte Parse Server (Back4App, Sashido, ou self-hosted)
- Clé API INSEE (optionnel, pour l'indexation automatique)

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

## Scripts disponibles

| Commande | Description |
|----------|-------------|
| `npm run start` | Serveur de développement (port 4200) |
| `npm run build` | Build de production dans `www/` |
| `npm run watch` | Build avec rechargement automatique |
| `npm run test` | Exécution des tests unitaires |
| `npm run lint` | Analyse statique du code |

## Configuration Parse Server

### Classes requises

| Classe | Champs |
|--------|--------|
| **Leaseholder** | `name`, `email`, `phone`, `leases` (Relation) |
| **Lease** | `address`, `price`, `charge`, `indexing`, `renewalDate`, `isPro` |

### Hébergement recommandé

- [Back4App](https://www.back4app.com/) - Gratuit pour petits projets
- [Sashido](https://www.sashido.io/) - Alternative simple
- Self-hosted avec Docker

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

- Les fichiers `environment.ts` et `environment.prod.ts` sont exclus du versioning
- Chaque utilisateur a ses propres données via Parse ACL
- Les credentials ne sont jamais commités

## Licence

Projet privé - Tous droits réservés

---

Développé avec Angular + Ionic