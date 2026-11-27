# Déployer E-Lease sur Cloudflare Pages

Guide pas à pas, depuis votre Mac. La nouvelle application est un site statique hébergé sur le projet
Cloudflare Pages `e-lease-app`, servi sur `https://e-lease-app.smarthomeserver.online`.
L'ancienne application reste sur `e-lease.smarthomeserver.online` : ni son tunnel, ni son conteneur Docker, ni
son nom de domaine ne sont modifiés par ce guide.

La fusion de `ui-refactor` dans `main`, la publication et le rattachement du domaine sont **vos décisions** :
rien de tout cela n'est fait automatiquement.

## Ce que fait le workflow

`.github/workflows/pages-deploy.yml` se lance à chaque push sur `main` (et à la demande) :

| Branche                                | Environnement compilé                          | Tests + build | Déploiement                |
| -------------------------------------- | ---------------------------------------------- | ------------- | -------------------------- |
| `main`                                 | secret `ENVIRONMENT_PROD` (`production: true`) | oui           | oui, vers Cloudflare Pages |
| toute autre branche (lancement manuel) | `environment.example.ts` (`production: false`) | oui           | **non**                    |

Règle de sécurité : un build `production: true` envoie de vrais e-mails. Le secret de production n'est donc
jamais utilisé hors de `main`. Le job échoue si le fichier écrit depuis le secret ne contient pas
`production: true` ou contient `inseeApiKey`, sans jamais afficher son contenu.

Un lancement manuel (« Run workflow ») n'apparaît dans l'onglet Actions qu'une fois le workflow présent sur
`main`.

## 1. Créer le projet Pages `e-lease-app`

Dans le Terminal, dans le dossier du dépôt (Node 24 actif) :

```bash
npx wrangler@4 login                      # ouvre le navigateur : autoriser l'accès
npx wrangler@4 whoami                     # affiche le nom du compte et son Account ID
npx wrangler@4 pages project create e-lease-app --production-branch main
```

Variante sans ligne de commande : tableau de bord Cloudflare → Workers & Pages → Create → Pages →
Upload assets (Direct Upload) → nom `e-lease-app`, puis déposer n'importe quel dossier (il sera remplacé).
Le nom du projet doit être exactement `e-lease-app` (le workflow l'utilise).

## 2. Secrets GitHub

Dépôt GitHub → Settings → Secrets and variables → Actions → New repository secret.

1. **Avant toute modification de `ENVIRONMENT_PROD`** : si vous comptez encore reconstruire l'ancienne image
   Docker, copiez la valeur actuelle de `ENVIRONMENT_PROD` (elle contient `inseeApiKey`, nécessaire à
   l'ancienne application) dans un nouveau secret `ENVIRONMENT_PROD_LEGACY`. L'ancien workflow le préfère à
   `ENVIRONMENT_PROD`. Sinon, la prochaine reconstruction de l'ancienne app perdrait sa clé INSEE.
2. **`ENVIRONMENT_PROD`** : remplacer le contenu par le fichier `environment.prod.ts` de la nouvelle
   application. Champs attendus (noms seulement) : `production: true`, `parseAppId`, `parseJsKey`,
   `parseServerUrl`, `sandbox: false`. **Pas de `inseeApiKey`.** Utilisez
   `src/environments/environment.example.ts` comme modèle, avec vos vraies valeurs et `production: true`.
3. **`CLOUDFLARE_API_TOKEN`** : tableau de bord Cloudflare → My Profile → API Tokens → Create Token →
   Create Custom Token, permission `Account` / `Cloudflare Pages` / `Edit`, limitée à votre compte.
4. **`CLOUDFLARE_ACCOUNT_ID`** : l'identifiant affiché par `npx wrangler@4 whoami`
   (ou dans Workers & Pages, colonne de droite).

Ne collez jamais ces valeurs dans une conversation, un fichier du dépôt ou un message de commit.

## 3. Premier déploiement d'essai (aperçu), à la main

Ce déploiement n'utilise **pas** le workflow : il compile avec **votre** `src/environments/environment.prod.ts`
local.

1. Vérifiez ses valeurs (cette commande n'affiche que ces lignes, pas les clés) :

   ```bash
   grep -E "production|sandbox|testRecipientEmail" src/environments/environment.prod.ts
   ```

   Pour un aperçu sans risque : `production: false`, `sandbox: true`, `testRecipientEmail` = votre adresse.
   Avec `production: true` et `sandbox: false`, l'aperçu enverrait de vrais e-mails.

2. Compilez et déployez la branche d'aperçu :

   ```bash
   npx ng build && npx wrangler@4 pages deploy www --project-name e-lease-app --branch ui-refactor
   ```

   Wrangler affiche l'adresse de l'aperçu (de la forme `https://<identifiant>.e-lease-app.pages.dev`, et
   `https://ui-refactor.e-lease-app.pages.dev` pour la branche).

3. Sur l'aperçu, **connectez-vous uniquement avec le compte `julien`** (jamais `christine`) et n'envoyez
   des e-mails qu'à `julien.berger1421@gmail.com`.

Vérifications :

- Rechargez la page sur `/locataires` : l'application doit s'afficher (repli SPA), pas une erreur 404.
- Les fichiers du service worker ne sont pas servis comme des pages :
  `curl -sI https://ui-refactor.e-lease-app.pages.dev/ngsw.json` doit répondre `content-type: application/json`
  et `cache-control: no-cache`.
- Installabilité : Chrome → DevTools (F12) → Application → Manifest : aucune erreur, section « Installability »
  complète. Si votre version de Lighthouse propose encore la catégorie « Progressive Web App » (elle a été retirée
  des versions récentes), le contrôle « Installable » doit être vert.
- Si la connexion échoue avec une erreur réseau/CORS dans la console, vérifier côté Back4App que l'origine de
  l'aperçu n'est pas filtrée.

## 4. Domaine personnalisé

Tableau de bord Cloudflare → Workers & Pages → `e-lease-app` → Custom domains → Set up a custom domain →
`e-lease-app.smarthomeserver.online`. Cloudflare crée l'enregistrement DNS (la zone `smarthomeserver.online`
doit être sur le même compte Cloudflare) et émet le certificat ; attendre le statut « Active ».

Ce nom est définitif : une PWA installée est liée à son adresse, en changer obligerait à réinstaller
l'application sur chaque appareil. Le nom `e-lease.smarthomeserver.online` (tunnel `cloudflared`) n'est pas touché.

## 5. Passage en production

1. Les secrets de l'étape 2 sont en place et le projet Pages existe.
2. Vous décidez de fusionner `ui-refactor` dans `main` (pull request GitHub, à votre rythme).
3. Le push sur `main` lance le workflow « Deploy to Cloudflare Pages » (onglet Actions) : tests, build, déploiement
   en production sur le domaine personnalisé. Un échec arrête tout avant le déploiement.
4. Installez ensuite l'application (PC : « Installer » ; Android Chrome : « Installer l'application » ;
   iPhone Safari : Partager → « Sur l'écran d'accueil », iOS 16.4 ou plus récent) et contrôlez les écrans.

## 6. Retirer plus tard l'ancienne application

Quand l'ancienne application n'est plus utilisée :

1. Dans Cloudflare Zero Trust → Networks → Tunnels : retirer le hostname `e-lease.smarthomeserver.online` du
   tunnel ; arrêter et supprimer le conteneur `elease` sur l'Odroid.
2. Supprimer `.github/workflows/docker-build.yml` et les secrets `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`,
   `ENVIRONMENT_PROD_LEGACY` ; ne plus utiliser l'image Docker.
3. Facultatif : une redirection 301 de `e-lease.smarthomeserver.online` vers `e-lease-app.smarthomeserver.online`
   (Cloudflare → Rules → Redirect Rules, une fois le hostname retiré du tunnel et un enregistrement DNS
   proxifié recréé). Les appareils où l'ancienne PWA était installée devront de toute façon installer la nouvelle.
4. Le repli sur `lastSendDate` de `isSentForPeriod` (`src/app/core/billing/send-status.ts`) n'a plus de raison
   d'être et peut être supprimé.

Le tag `legacy-ionic` reste dans le dépôt : l'ancienne version peut toujours être reconstruite.

## Durcissement facultatif : Content-Security-Policy

Aucune CSP n'est envoyée aujourd'hui (`public/_headers`) : elle ne peut pas être testée sans déploiement réel,
et une CSP erronée casse l'application. Si vous en voulez une, l'essayer d'abord en
`Content-Security-Policy-Report-Only` sur l'aperçu, avec au minimum :

- `default-src 'self'`
- `script-src 'self'` + les empreintes `'sha256-…'` des scripts en ligne de `www/index.html` (script anti-flash du
  thème dans `src/index.html` et, après build, le petit script de chargement des styles ajouté par Angular).
  À recalculer à chaque modification de ces scripts.
- `style-src 'self' 'unsafe-inline'` (Angular insère du CSS critique en ligne)
- `connect-src 'self'` + l'adresse du serveur Parse (`parseServerUrl`, Back4App) + `https://api.insee.fr`
- `worker-src 'self' blob:` (service worker et worker de pdf.js, servi depuis `/assets/pdfjs/`)
- `img-src 'self' data: blob:`, `font-src 'self'`, `manifest-src 'self'`
- `frame-ancestors 'none'`, `base-uri 'self'`, `object-src 'none'`

Calcul d'une empreinte :

```bash
printf '%s' "<contenu exact du script, sans les balises>" | openssl dgst -sha256 -binary | openssl base64
```
