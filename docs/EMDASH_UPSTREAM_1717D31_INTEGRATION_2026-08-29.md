# Enquête d’intégration racine d’EmDash au commit `1717d31`

- Carte parente : [Migration complète de SuperBoard vers EmDash CMS](https://github.com/mabzadev/superboard/issues/33)
- Date de l’enquête : 29 août 2026
- Source amont exclusive : [`emdash-cms/emdash`](https://github.com/emdash-cms/emdash) au commit immuable [`1717d31b351164a5f78e95fe004ee582c7c50f40`](https://github.com/emdash-cms/emdash/commit/1717d31b351164a5f78e95fe004ee582c7c50f40)
- Arbre Git amont vérifié : `965779c9b2aa987b8bb8457e338c3ff3d7b2cb94`
- Source SuperBoard exclusive : checkout local à `HEAD=a7c879b76e14fa5c20598f8ff6bbe56a87ad0553`, complété par l’état non commité observé pendant l’enquête

## Résultat

Le commit amont demandé existe, se résout exactement vers l’arbre annoncé et contient la source complète d’EmDash : 3 836 blobs, 924 arbres, 4 760 entrées au total, 21 liens symboliques et aucun sous-module. La réponse de l’arbre GitHub est marquée `truncated=false`; l’inventaire ne repose donc pas sur un extrait. L’arbre comprend le CMS, l’administration, les adapters, tous les plugins présents, les applications de registre, les démos, les templates, les fixtures, l’E2E, la documentation, l’infrastructure et les outils du dépôt.[^upstream-commit][^upstream-tree]

Une intégration complète à la racine est possible au niveau des chemins, mais elle n’est pas une simple copie exécutable. Les deux arbres partagent cinq répertoires racine (`.github`, `apps`, `docs`, `packages`, `scripts`) sans collision de blob interne, sauf deux fichiers sous `.github`. En comptant aussi les fichiers SuperBoard non suivis mais non ignorés, dix chemins de fichiers entrent en collision et les dix contenus diffèrent. Trois d’entre eux sont modifiés localement et deux autres sont non suivis; le checkout courant ne convient donc pas à une importation d’historique ou à une écriture de l’arbre amont.[^collision-method][^local-status]

Le blocage structurel principal est le control plane du monorepo : EmDash exige un workspace pnpm épinglé à `11.9.0` et Node `>=22.16`, tandis que SuperBoard installe actuellement sa racine avec npm, un `package-lock.json` v3 et des workflows `npm ci`. SuperBoard ignore même explicitement `/pnpm-lock.yaml`. Importer le `package.json` amont sans overlay supprime les scripts, 36 workspaces et overrides SuperBoard; conserver le manifeste SuperBoard sans overlay supprime les scripts, dépendances de développement, moteur Node et identité pnpm nécessaires à EmDash.[^upstream-root-package][^upstream-workspace][^local-root-package][^local-gitignore][^local-ci]

Enfin, intégrer la source ne livre pas encore le Site EmDash SuperBoard. EmDash est une intégration Astro qui fournit contenu, admin, API, auth et plugins à un site dont les pages et composants restent écrits par l’intégrateur. Le Dashboard actuel est une application Next/OpenNext. Les migrations core EmDash et son stockage document plugin ne satisfont pas non plus, tels quels, la propriété de Store et le Graphe de migrations définis par SuperBoard.[^upstream-architecture][^local-dashboard][^upstream-core-migrations][^upstream-plugin-storage][^local-domain-storage]

## 1. Provenance et méthode de vérification

Le commit GitHub a été résolu par son SHA complet, sans branche flottante. L’objet commit indique :

| Propriété                            | Valeur vérifiée                            |
| ------------------------------------ | ------------------------------------------ |
| Commit                               | `1717d31b351164a5f78e95fe004ee582c7c50f40` |
| Arbre                                | `965779c9b2aa987b8bb8457e338c3ff3d7b2cb94` |
| Parent                               | `70c487c1b1cfce3cd9356a7669dfd9abadad6354` |
| Auteur/committer                     | `2026-08-28T14:58:54Z`                     |
| Message                              | `chore: extract locale catalogs [skip ci]` |
| Arbre récursif                       | 4 760 entrées, non tronqué                 |
| Sous-modules                         | 0 entrée Git de type `commit`              |
| Liens symboliques                    | 21 blobs Git en mode `120000`              |
| Merge-base avec SuperBoard `a7c879…` | aucun                                      |

Le contrôle Git a aussi été répété dans un clone temporaire détaché : `HEAD`, l’arbre et le parent correspondent aux objets ci-dessus. Le seul objet SuperBoard `a7c879…` a ensuite été fetché dans ce clone temporaire; `git merge-base` a terminé avec le code 1 et sans SHA. Les deux historiques n’ont donc aucun ancêtre commun. Aucun remote, ref ou objet n’a été ajouté au dépôt SuperBoard local.

La comparaison de chemins a utilisé l’arbre récursif de ce commit et, côté SuperBoard, `git ls-files --cached --others --exclude-standard`. Elle inclut donc les fichiers suivis et les fichiers non suivis qui pourraient être écrasés, tout en excluant `.git`, les dépendances et les artefacts ignorés. Chaque collision a ensuite été comparée par blob SHA-1 avec `git hash-object` côté local et l’objet blob de l’arbre GitHub côté amont.[^collision-method]

Le checkout SuperBoard n’était pas propre : 175 changements suivis et 124 chemins non suivis ont été observés. Cette enquête n’a modifié aucun de ces éléments. Les citations locales distinguent le commit de base des blobs du working tree lorsque leur contenu diffère de `HEAD`.[^local-status]

## 2. Structure racine et workspaces amont

### Arbre fonctionnel

L’arbre amont complet au SHA épinglé contient notamment :

| Chemin racine amont                            | Contenu constaté                                                                                                                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`                                | package `emdash`, intégration Astro, API, CLI, bases, migrations, auth wiring et runtime plugins                                                                                    |
| `packages/admin`                               | SPA et composants React de l’administration                                                                                                                                         |
| `packages/auth`, `packages/blocks`             | authentification et types/blocs Portable Text                                                                                                                                       |
| `packages/cloudflare`                          | adapters D1, R2, Hyperdrive/DO, cache, auth et sandbox Worker Loader                                                                                                                |
| `packages/plugin-types`, `packages/plugin-cli` | contrat wire du manifest et outillage de build/publication                                                                                                                          |
| `packages/plugins/*`                           | douze plugins ou fixtures first-party : AI moderation, API test, ATProto, audit log, color, embeds, field kit, forms, marketplace test, MCP smoke, sandbox test et webhook notifier |
| `packages/registry-*`, `packages/marketplace`  | client, lexicons, modération, vérification et Worker de marketplace                                                                                                                 |
| `packages/workerd`                             | runner sandbox workerd pour Node                                                                                                                                                    |
| `apps/aggregator`, `apps/labeler`              | applications privées du registre et de sa modération                                                                                                                                |
| `demos/*`                                      | six sites ou environnements de démonstration, dont Cloudflare, PostgreSQL et plugins                                                                                                |
| `templates/*`                                  | neuf starters Cloudflare/Node : blank, blog, marketing, portfolio et starter                                                                                                        |
| `e2e`, `fixtures`                              | fixtures Node/Cloudflare, tests Playwright et site de performance                                                                                                                   |
| `docs`, `i18n`                                 | site de documentation et dashboard de traduction                                                                                                                                    |
| `infra/*`                                      | neuf projets d’infrastructure ou démonstration associés                                                                                                                             |
| `assets`, `patches`, `scripts`, `skills`       | assets, patches pnpm, automatisations du dépôt et skills livrés par EmDash                                                                                                          |

Les listes ci-dessus sont dérivées de l’[arbre racine exact](https://github.com/emdash-cms/emdash/tree/1717d31b351164a5f78e95fe004ee582c7c50f40), de la [structure documentée dans le README](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/README.md#L169-L188) et des manifests des [applications aggregator](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/apps/aggregator/package.json), [labeler](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/apps/labeler/package.json) et [packages](https://github.com/emdash-cms/emdash/tree/1717d31b351164a5f78e95fe004ee582c7c50f40/packages).

### Workspace pnpm

`pnpm-workspace.yaml` déclare onze groupes :

```text
packages/*
packages/plugins/*
apps/*
demos/*
templates/*
packages/blocks/playground
e2e/fixture
e2e/fixture-cloudflare
fixtures/*
docs
i18n
infra/*
```

Ces motifs sélectionnent exactement 63 manifests de packages dans l’arbre étudié. Le fichier porte également la politique d’installation et de supply chain (`minimumReleaseAge`, `strictDepBuilds`, `blockExoticSubdeps`, intégrité du store, allowlist de builds), les overrides, trois patches et le catalogue commun des versions.[^upstream-workspace]

La racine SuperBoard déclare actuellement 36 workspaces npm explicites. Seuls quatre sont couverts accidentellement par les motifs EmDash (`apps/dashboard`, `apps/mcp`, `packages/contracts`, `packages/email-transport`); les 32 workspaces sous `workers/*` et `sdks/*` sont absents des motifs amont. Inversement, le motif amont `apps/*` absorberait `apps/reference`, alors que SuperBoard l’installe aujourd’hui séparément avec son propre lockfile. Le workspace fusionné doit donc être une union délibérée et conserver explicitement, ou supprimer explicitement, cette frontière de lockfile; le YAML amont inchangé n’est pas une définition complète de SuperBoard.[^local-root-package][^local-monorepo]

## 3. Package manager et versions

| Sujet                | EmDash au SHA épinglé                                                                                                               | SuperBoard local                                                                   | Conséquence d’intégration                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Manager racine       | `pnpm@11.9.0` avec hash d’intégrité dans `packageManager`                                                                           | Aucun champ `packageManager`; installation racine documentée et exécutée par npm   | Une autorité racine unique doit être choisie et câblée dans CI                                                                     |
| Lock racine          | `pnpm-lock.yaml` suivi dans l’arbre amont                                                                                           | `package-lock.json` v3; `/pnpm-lock.yaml` ignoré                                   | Le lock pnpm fusionné ne peut pas être suivi sans corriger `.gitignore`; conserver deux locks racine crée deux graphes concurrents |
| Node                 | `>=22.16`                                                                                                                           | Workflows sur Node 22, sans moteur racine                                          | Node 22 générique ne prouve pas `22.16+`; CI doit satisfaire le moteur exact                                                       |
| Module racine        | `"type": "module"`                                                                                                                  | champ absent                                                                       | Le manifeste fusionné change le package scope racine; les packages enfants avec leur propre manifeste gardent leur scope           |
| Versions CMS         | `emdash`, `@emdash-cms/admin`, `@emdash-cms/cloudflare` : `0.35.0`; `@emdash-cms/plugin-types` : `0.3.0`; sandbox workerd : `0.5.1` | aucune de ces dépendances dans le graphe racine actuel                             | Le SHA, et non seulement le numéro `0.35.0`, reste l’identité de source                                                            |
| Framework de site    | catalogue Astro `^7.0.0`, adapter Cloudflare `^14.0.0`, React `19.2.4`, Wrangler `^4.124.0`                                         | Dashboard Next `^16.3.0`, OpenNext `^1.20.2`, React `^18.3.1`, Wrangler `^4.120.0` | Deux graphes d’application existent; ce n’est pas une substitution de dépendance dans le Dashboard                                 |
| TypeScript/outillage | racine `typescript 6.0.0-beta`, catalogue `^6.0.3`, tsdown/tsgo, oxlint/oxfmt                                                       | TypeScript `^5` dans le Dashboard, ESLint/Prettier/Husky à la racine               | Les lanes doivent rester package-scoped; imposer un seul compilateur à tous les packages n’est pas prouvé                          |

Sources amont : [manifeste racine, scripts, manager et moteur](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/package.json#L1-L58), [catalogue et workspace](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/pnpm-workspace.yaml#L1-L160), [core](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/core/package.json#L1-L5), [admin](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/admin/package.json#L1-L5), [Cloudflare](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/cloudflare/package.json#L1-L5), [types plugin](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/plugin-types/package.json#L1-L8) et [workerd](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/workerd/package.json#L1-L5). Sources locales : [manifeste racine](../package.json#L1-L271), [lock racine](../package-lock.json), [Dashboard](../apps/dashboard/package.json#L1-L133), [CI](../.github/workflows/ci.yml#L1-L155) et [procédure monorepo](./MONOREPO.md#L39-L51).

## 4. Collisions de chemins exactes

La comparaison exhaustive a trouvé dix collisions de fichiers. Aucun blob n’est identique entre les deux côtés.

| Chemin                     | État SuperBoard observé | Blob SuperBoard local                      | Blob EmDash `1717d31`                      | Impact immédiat                                                              |
| -------------------------- | ----------------------- | ------------------------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------- |
| `.github/dependabot.yml`   | suivi, propre           | `06381b8c1b6bda8d0eddbe104df5c4f13c00cf7b` | `b08ac6aa88a4a770c3a9ef0b6f4259344f2504e3` | catalogues de dépendances et lockfiles différents                            |
| `.github/workflows/ci.yml` | suivi, propre           | `0bff11a7604012cf1c4b1e59e9549bcee5f4c57f` | `a6444587f25d13cf322e554f462a87877a0f2303` | chacun contient le gate principal de son dépôt                               |
| `.gitignore`               | suivi, modifié          | `4e84528cb1da6fff5a03af42110db6d6586d7d19` | `759db2b59d387e1ead0551f912a713b701af1d05` | SuperBoard ignore le lock pnpm; EmDash doit ignorer DB, uploads et `.emdash` |
| `.prettierrc`              | non suivi               | `0bd86d9151f89c2bb98ae0c718a2f1d939c99100` | `997044361c5579afe74e3b8e517f029af0ee2ff6` | écriture amont sur un fichier local non suivi                                |
| `AGENTS.md`                | non suivi               | `aeac375d17060734a9160527b5efdf1bf2f11406` | `6f0f08ec9614dde6169c181ceca619725613ff7c` | consignes de dépôt concurrentes; écriture sur un fichier non suivi           |
| `CONTRIBUTING.md`          | suivi, propre           | `8af4f54aa7315b63dcb1b4f406fc7906e63223ca` | `f0d00ab2e8fbb91ef6a26d031e36543b3a533be0` | workflows de contribution différents                                         |
| `LICENSE`                  | suivi, propre           | `be0d0614b7ddf796efec0625d6198a3f4b893793` | `02cc4b8b0a5f883c5243927e683b00c10588bf4c` | collision de contenu racine à résoudre mécaniquement                         |
| `README.md`                | suivi, modifié          | `14219b6d4bbf66736fa21e81615a919cfca19d3a` | `b6aabaf83f2709c90694f04c9278f840ae25ab55` | identité, layout et commandes du dépôt                                       |
| `SECURITY.md`              | suivi, propre           | `549e88f8c4275120c4bc236d2bd11049060e5ec2` | `195548d8f591bb10578127d9e289acfe592725cd` | procédures de sécurité différentes                                           |
| `package.json`             | suivi, modifié          | `edc0143b349981af10909130915a75b9f761bd81` | `84795041185e45010e4d901ef5bc4f11017c3fc4` | identité, scripts, workspaces, versions et manager racine                    |

Les répertoires communs `apps`, `docs`, `packages` et `scripts` n’ont aucun chemin de fichier identique dans les deux inventaires au moment de l’enquête. Ils peuvent être unis sans résolution fichier par fichier pour ce SHA, mais une synchronisation amont future doit recalculer l’inventaire au lieu de supposer cette propriété permanente.[^collision-method]

### Collisions sémantiques à l’intérieur de `package.json`

Les seuls noms de scripts communs sont `test` et `typecheck`, mais leur portée diffère : EmDash filtre ses packages, alors que SuperBoard agrège Dashboard, Workers, contrats et modules. Les métadonnées `name`, `version`, `description`, `scripts` et `devDependencies` entrent également en concurrence. Le manifeste fusionné doit conserver l’identité `superboard`, ajouter `type: module`, `packageManager`, `engines` et les dépendances de tooling EmDash, puis exposer des commandes namespacées ou une agrégation explicite. Choisir un fichier entier détruit nécessairement l’une des deux surfaces.[^upstream-root-package][^local-root-package]

## 5. Commandes build, test et développement

| Besoin                | EmDash exact                                                                                | SuperBoard actuel                                                 | Contrainte après intégration                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Installation racine   | `pnpm install --frozen-lockfile` en CI                                                      | `npm ci`                                                          | la lane racine doit utiliser le lock choisi; `apps/reference` peut rester une installation séparée seulement si exclue du workspace pnpm |
| Build packages        | `pnpm build` → `pnpm run --filter {./packages/**} build`                                    | pas de `build` racine global; builds par service                  | conserver le build EmDash et les builds SuperBoard sans redéfinition ambiguë                                                             |
| Typecheck             | `pnpm typecheck` sur packages + aggregator + labeler; lanes démos/templates distinctes      | `npm run typecheck` sur Workers et Dashboard                      | collision exacte du nom `typecheck`                                                                                                      |
| Tests packages        | `pnpm test`, `test:unit`, `test:browser`                                                    | `npm test`, `npm run test:all`                                    | collision exacte du nom `test`; les deux gates doivent être appelés par le gate fusionné                                                 |
| E2E                   | `pnpm test:e2e` et matrice CI Node/Cloudflare en huit shards                                | Playwright Dashboard via `npm run test:e2e:real` ou package local | fixtures et serveurs différents; ne pas fusionner les configs Playwright par simple remplacement                                         |
| Dev package core      | `pnpm --filter emdash dev` → `tsdown --watch`                                               | aucun équivalent core                                             | lane indépendante                                                                                                                        |
| Dev site              | `cd demos/simple && pnpm dev`; Cloudflare : `pnpm --filter @emdash-cms/demo-cloudflare dev` | `npm run dashboard:dev` → Next sur le port 3001                   | le Site Astro et le Dashboard historique sont deux processus                                                                             |
| Build Site Cloudflare | `pnpm --filter @emdash-cms/demo-cloudflare build:all` puis éventuellement `wrangler deploy` | `npm run dashboard:cf-build:reference` produit OpenNext           | artefacts, entrypoints et bindings distincts                                                                                             |

Sources : [scripts racine EmDash](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/package.json#L7-L31), [README développement](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/README.md#L145-L168), [scripts core](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/core/package.json#L217-L227), [démo Cloudflare](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/demos/cloudflare/package.json#L1-L38), [CI EmDash](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/.github/workflows/ci.yml), [scripts SuperBoard](../package.json#L15-L216), [Dashboard](../apps/dashboard/package.json#L16-L35) et [CI SuperBoard](../.github/workflows/ci.yml#L35-L155).

### Divergences internes de l’amont à ce SHA

Trois commandes ou versions amont ne doivent pas être reprises aveuglément :

1. Le README demande `pnpm --filter emdash-demo seed`, mais le [manifest réel de `demos/simple`](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/demos/simple/package.json) ne possède aucun script `seed`. Le [guide contributeur](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/CONTRIBUTING.md#L21-L40) donne la commande valide `cd demos/simple && pnpm dev` et précise que le seed s’applique automatiquement à la première requête sur une base vide.
2. L’exemple principal du README importe `d1` depuis `emdash/db`, mais l’[export réel de `emdash/db`](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/core/src/db/index.ts) ne contient que `sqlite`, `libsql` et `postgres`. L’adapter D1 est réellement exporté par [`@emdash-cms/cloudflare`](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/cloudflare/src/index.ts#L20-L32), comme l’utilise la démo Cloudflare.
3. Le manifeste racine épingle pnpm `11.9.0`, tandis que le [`Dockerfile`](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/Dockerfile#L1-L4) active pnpm `10.28.0`. Le pipeline fusionné doit sélectionner et tester une seule version au lieu de présumer que le Dockerfile respecte `packageManager`.

Ces divergences ne changent pas l’inventaire de capacités; elles empêchent seulement de traiter README et Dockerfile comme des commandes canoniques cohérentes sans vérification contre les manifests et exports du même SHA.

## 6. CMS, administration et plugins

### CMS et administration fournis

EmDash s’ajoute à un site Astro. Il fournit le contenu live, l’administration, la base et le stockage, mais le site conserve ses propres pages et composants. Les bases documentées sont SQLite/libSQL, D1 et PostgreSQL; les médias peuvent utiliser le filesystem, R2 ou S3.[^upstream-architecture]

L’administration est servie dans le Site à `/_emdash/admin/`. Elle génère sa navigation depuis les collections et plugins installés et fournit dashboard, listes/édition de contenu, médiathèque, schema builder, menus, widgets, taxonomies, réglages et pages plugins. Elle exige une session. Les pages d’un plugin restent sous `/_emdash/admin/plugins/:pluginId/` et ne peuvent pas remplacer les écrans core.[^upstream-admin]

Les trois paquets structurants `emdash`, `@emdash-cms/admin` et `@emdash-cms/cloudflare` déclarent tous `0.35.0` à ce commit. `@emdash-cms/admin` est construit comme package React; le runtime du Site reste Astro.[^upstream-versions]

### Surface plugins fournie

Les plugins peuvent déclarer hooks, stockage, réglages, pages/widgets admin, routes API, accès réseau et email. Deux formats existent :

- les plugins sandboxed sont exécutés dans un runtime isolé avec capacités déclarées;
- les plugins native s’exécutent dans le host, peuvent fournir UI React admin, blocs Portable Text et fragments publics, mais nécessitent un changement de code et un déploiement.[^upstream-plugins]

Le wire `PluginManifest` exact contient `id`, `version`, `declaredAccess`, `capabilities`, `allowedHosts`, `storage`, `hooks`, `routes`, `mcp` et `admin`. Le `PluginDescriptor` natif ajoute notamment entrypoint, options, admin entry/pages/widgets, composants Astro, blocs et field widgets. Il ne contient pas de Worker Descriptor, de ressource Cloudflare, de version de Store, de migration métier, de health check, de lease, de circuit breaker, de Renderer Descriptor ou de Graphe de migrations.[^upstream-plugin-manifest][^upstream-plugin-descriptor]

Cette absence est un écart direct avec le `SuperBoard Plugin Manifest` local, défini comme le contrat commun fermé des exécutions, contributions, Stores, Workers, capacités, migrations et pannes. L’import du core ne suffit donc pas à représenter les plugins `supbrd-*` et `supbrd-plugmod-*`; une extension contractuelle reste nécessaire avant leur activation cible.[^local-domain-plugin]

## 7. Migrations et stockages

### Migrations EmDash core

Les migrations core modifient les tables internes et les colonnes standard des tables de contenu; elles ne modifient pas les collections et champs métier. Le mode runtime par défaut est `auto`. Un build ou sync Astro écrit `.emdash/migrations.json`, qui lie version exacte, migrations ordonnées, locales et exécuteur d’adapter. Le workflow documenté est : build, `emdash migrate --status`, apply, déploiement, puis `emdash migrate --check`. L’apply non interactif exige une empreinte de cible et le manifest doit rester associé au même artefact.[^upstream-core-migrations]

L’adapter de migration couvre SQLite, libSQL, PostgreSQL, D1 et Hyperdrive. Pour D1, le provisionnement est séparé de la migration et une seule migration doit être exécutée à la fois par couple compte/base. Cela ne correspond pas encore au registre local : `D1_SCHEMA_OWNERS` accepte une liste fermée de services SuperBoard et exige un répertoire SQL par owner; aucun owner EmDash n’y figure.[^upstream-core-migrations][^local-d1-registry]

### Stockage CMS et Cloudflare

La démo Cloudflare au SHA exact configure explicitement un binding D1 `DB`, un bucket R2 `MEDIA`, un Worker Loader `LOADER`, un namespace `AI_SEARCH`, un cron et l’observabilité. Son intégration Astro active les sessions D1, Cloudflare Access, des providers média, deux plugins natifs et un plugin sandboxed. Son entrypoint exporte le handler Astro, `PluginBridge` et un handler scheduled.[^upstream-cloudflare-demo]

Ces fichiers sont une démonstration, pas un manifest SuperBoard : le registre local des services connaît `dashboard` mais aucun service `emdash` ou `cms`, et les cibles locales ne déclarent pas ce nouveau Site. L’intégration doit donc ajouter ces ressources au control plane SuperBoard au lieu de déployer directement le `wrangler.jsonc` de démonstration.[^local-services]

### Stockage plugin

`ctx.storage` utilise une table `_plugin_storage` partagée mais namespacée par `plugin_id` et `collection`, avec documents JSON et index d’expression créés depuis le manifest. La documentation dit explicitement que ce design ne possède pas de migrations de données; ajouter ou retirer des indexes est convergé au démarrage.[^upstream-plugin-storage]

Le modèle cible local demande au contraire qu’un Store de plugin possède son schéma, ses écritures, ses migrations et ses sauvegardes, et qu’un Graphe de migrations ordonne les migrations des plugins. Le stockage document EmDash peut convenir à de l’état opérationnel simple, mais ne prouve pas la propriété et les migrations des Stores autoritatifs SuperBoard.[^local-domain-storage]

## 8. Contraintes et écarts immédiatement bloquants

### Avant toute importation racine

1. **Histoires sans ancêtre commun.** `git merge-base` ne trouve aucun SHA entre les deux commits exacts. Une intégration qui conserve l’historique doit donc employer explicitement une opération autorisant les histoires sans relation dans un checkout isolé; un merge ordinaire ne peut pas inférer de base à trois voies.
2. **Sémantique Git à préserver.** L’arbre amont contient 21 liens symboliques, dont `CLAUDE.md → AGENTS.md`, `.agents/skills → skills` et `.claude/skills → skills`; une copie qui les déréférence ou les transforme en fichiers ordinaires n’importe pas le même arbre.[^upstream-symlinks]
3. **Checkout non isolé.** Les cinq collisions sales (`.gitignore`, `.prettierrc`, `AGENTS.md`, `README.md`, `package.json`) et les autres changements préexistants doivent être préservés dans un checkout ou worktree dédié. Écrire l’arbre amont dans le checkout observé risquerait de remplacer des fichiers non suivis et de mêler l’import aux travaux en cours.[^local-status]
4. **Manifest racine sans résolution automatique correcte.** Aucun des deux `package.json` ne peut gagner en entier. Les deux scripts communs `test` et `typecheck` ont des sens différents; les scripts et workspaces SuperBoard doivent être réappliqués sur la base pnpm EmDash, ou inversement fusionnés par un générateur déterministe.[^upstream-root-package][^local-root-package]
5. **Lock et ignore contradictoires.** Le lock amont est `pnpm-lock.yaml`, précisément ignoré à la racine SuperBoard. La politique doit suivre le lock pnpm fusionné et décider du sort du `package-lock.json` racine, tout en maintenant le lock indépendant d’`apps/reference` si cette frontière subsiste.[^local-gitignore][^local-monorepo]
6. **Workspace incomplet et trop large à la fois.** Le YAML amont omet 32 workspaces SuperBoard mais inclut implicitement `apps/reference`. Une liste fusionnée ou des exclusions explicites sont obligatoires avant `pnpm install`.[^upstream-workspace][^local-root-package]
7. **CI en collision.** Les deux dépôts possèdent exactement `.github/workflows/ci.yml`. L’amont exécute pnpm build/typecheck/lint/tests et ses matrices E2E; SuperBoard exécute npm, sa planification de changements, Workers, Dashboard, SDK et référence. Conserver un seul fichier supprime un gate entier.[^upstream-ci][^local-ci]
8. **Policies racine à unir.** `.gitignore`, Dependabot, Prettier, README, contribution, sécurité et consignes agent portent des règles actives des deux arbres. L’overlay doit être explicite et reproductible pour chacun des dix chemins, pas une résolution manuelle non enregistrée.

### Après importation, avant de qualifier le Site de fonctionnel

1. **Aucun Site SuperBoard Astro n’existe encore.** L’amont fournit core, templates et démos; SuperBoard fournit un Dashboard Next/OpenNext. Il faut sélectionner ou créer l’application Astro du Site EmDash et définir la coexistence ou le remplacement du Dashboard historique.[^upstream-architecture][^local-dashboard]
2. **Control plane absent.** Aucun service Site/CMS EmDash, D1 core, R2 média, loader ou migration EmDash n’est enregistré dans les services et cibles SuperBoard actuels.[^local-services][^local-d1-registry]
3. **Deux systèmes de migrations non orchestrés.** Le manifest généré EmDash doit être transporté avec l’artefact et sérialisé, tandis que SuperBoard ordonne aujourd’hui des répertoires SQL par service. Aucun appel racine ne coordonne les deux.[^upstream-core-migrations][^local-d1-registry]
4. **Store plugin insuffisant pour le modèle cible.** Le stockage upstream sans migrations de données ne satisfait pas le Store de plugin autoritatif et son Graphe de migrations.[^upstream-plugin-storage][^local-domain-storage]
5. **Manifest plugin incomplet pour SuperBoard.** Les Workers métier, ressources, health, leases, failure policies, renderers et releases demandés localement n’ont pas de champs dans les deux interfaces amont exhaustives.[^upstream-plugin-manifest][^upstream-plugin-descriptor][^local-domain-plugin]
6. **Front produit non fourni par le CMS.** EmDash admin compose l’administration et les contributions de plugins sous leurs namespaces; les pages et composants publics restent du code Astro. L’import ne fournit donc ni la Présentation EmDash ni une Release Front SuperBoard atomique.[^upstream-architecture][^upstream-admin]

## 9. Overlay racine minimal à rendre déterministe

Sans choisir ici l’implémentation finale, tout overlay capable de produire un workspace installable doit au minimum enregistrer ces résolutions :

| Fichier ou domaine                       | Résolution minimale prouvable                                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                           | identité SuperBoard; `private`; `type: module`; manager/moteur EmDash; union des devDependencies et overrides; scripts EmDash et SuperBoard namespacés; gate agrégé |
| `pnpm-workspace.yaml`                    | politique et catalogue amont; 63 workspaces EmDash; 36 workspaces SuperBoard ou équivalents; décision explicite pour `apps/reference`                               |
| lockfiles                                | `pnpm-lock.yaml` régénéré depuis l’union et suivi; politique explicite pour le `package-lock.json` racine; lock indépendant de référence si conservé                |
| `.gitignore`                             | union des outputs SuperBoard et des DB/uploads/`.emdash` EmDash; suppression de l’exclusion du lock pnpm                                                            |
| `.github/workflows/ci.yml`               | lanes pnpm EmDash plus plan/gates npm ou migrés de SuperBoard; déclencheurs `dev` et `main`; caches liés au bon lock                                                |
| `.github/dependabot.yml`                 | surveillance du workspace pnpm fusionné, des lockfiles indépendants et des écosystèmes non Node SuperBoard                                                          |
| `README`, contribution, sécurité, agents | SuperBoard reste l’autorité produit; la provenance et les commandes amont restent accessibles sans remplacer les règles locales                                     |
| control plane Cloudflare                 | nouveau service Site, ressources, bindings, migrations et artefact Astro reconnus par les manifests SuperBoard                                                      |
| plugins                                  | extension versionnée du manifest amont pour les contrats SuperBoard, sans prétendre que les champs absents existent déjà                                            |

## Commandes de contrôle reproductibles

Les commandes suivantes sont en lecture seule vis-à-vis du dépôt SuperBoard et ne créent aucun remote permanent :

```bash
gh api repos/emdash-cms/emdash/commits/1717d31b351164a5f78e95fe004ee582c7c50f40
gh api 'repos/emdash-cms/emdash/git/trees/1717d31b351164a5f78e95fe004ee582c7c50f40?recursive=1'
git rev-parse HEAD
git status --porcelain=v1
git ls-files --cached --others --exclude-standard
git hash-object <path>
```

La collision peut être reproduite en triant `.tree[].path` du JSON amont, puis en appliquant `comm -12` avec la liste `git ls-files` locale. Le comptage des workspaces amont filtre les `package.json` correspondant exactement aux motifs de `pnpm-workspace.yaml`; les manifests de fixtures internes qui ne correspondent pas aux motifs ne sont pas comptés comme workspaces.

## Conclusion factuelle

Le SHA demandé est une base complète, précise et exploitable pour intégrer tout EmDash. Le chevauchement de code métier est faible : les packages, applications et scripts des deux dépôts occupent aujourd’hui des sous-chemins distincts. Le chevauchement du control plane est en revanche total aux dix fichiers racine les plus importants.

La première unité de travail sûre n’est donc pas encore le CMS ou un plugin : c’est un import d’historique isolé suivi d’un overlay racine déterministe qui rend pnpm, l’union des workspaces, les locks, la CI et les policies cohérents. Après ce bootstrap, quatre chantiers restent bloquants pour la destination du ticket : créer le Site Astro SuperBoard, inscrire ses ressources dans le control plane, relier les migrations EmDash aux migrations SuperBoard et étendre le contrat plugin/Store/Worker au-delà du manifest amont existant.

[^upstream-commit]: [Commit EmDash `1717d31b351164a5f78e95fe004ee582c7c50f40`](https://github.com/emdash-cms/emdash/commit/1717d31b351164a5f78e95fe004ee582c7c50f40).

[^upstream-tree]: [Arbre complet EmDash au SHA](https://github.com/emdash-cms/emdash/tree/1717d31b351164a5f78e95fe004ee582c7c50f40); inventaire via l’API Git trees, arbre `965779c9b2aa987b8bb8457e338c3ff3d7b2cb94`, `truncated=false`.

[^upstream-symlinks]: Arbre Git exact : 21 blobs en mode `120000`; les liens racine sont confirmés par [`AGENTS.md`, lignes 1–7](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/AGENTS.md#L1-L7).

[^collision-method]: Comparaison locale reproductible entre l’[arbre Git amont](https://github.com/emdash-cms/emdash/tree/1717d31b351164a5f78e95fe004ee582c7c50f40) et `git ls-files --cached --others --exclude-standard` au commit SuperBoard `a7c879b76e14fa5c20598f8ff6bbe56a87ad0553`; hashes détaillés dans la section 4.

[^local-status]: `git status --porcelain=v1` dans `/Users/appmonster/Workspace/superboard` à `HEAD=a7c879b76e14fa5c20598f8ff6bbe56a87ad0553`; les cinq statuts des collisions sont détaillés section 4.

[^upstream-root-package]: [`package.json` EmDash, lignes 1–58](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/package.json#L1-L58).

[^upstream-workspace]: [`pnpm-workspace.yaml` EmDash, politique, motifs et catalogue](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/pnpm-workspace.yaml#L1-L160).

[^local-root-package]: [`package.json` SuperBoard local, lignes 1–271](../package.json#L1-L271), blob working tree `edc0143b349981af10909130915a75b9f761bd81`, base `HEAD=a7c879b76e14fa5c20598f8ff6bbe56a87ad0553`.

[^local-gitignore]: [`.gitignore` SuperBoard local, lignes 1–45](../.gitignore#L1-L45), blob working tree `4e84528cb1da6fff5a03af42110db6d6586d7d19`.

[^local-ci]: [`.github/workflows/ci.yml` SuperBoard, lignes 1–155](../.github/workflows/ci.yml#L1-L155), blob `0bff11a7604012cf1c4b1e59e9549bcee5f4c57f` au commit local étudié.

[^upstream-architecture]: [Architecture EmDash, lignes 8–98](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/concepts/architecture.mdx#L8-L98).

[^local-dashboard]: [`apps/dashboard/package.json` SuperBoard, scripts et dépendances](../apps/dashboard/package.json#L16-L133), blob working tree `3dd095d90c5e07119c394d34620ee014005d12f1`.

[^upstream-core-migrations]: [Migrations core EmDash, lignes 8–193](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/deployment/core-migrations.mdx#L8-L193).

[^upstream-plugin-storage]: [Stockage plugin EmDash, usages et implémentation, lignes 279–320](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/plugins/creating-plugins/storage.mdx#L279-L320).

[^local-domain-storage]: [`CONTEXT.md` SuperBoard, Store de plugin lignes 39–49 et Graphe de migrations lignes 203–217](../CONTEXT.md#L39-L49), blob working tree `f3954871c1fed9a04dbfa8109616eacc2d0f1dd7`.

[^local-monorepo]: [`docs/MONOREPO.md`, layout et installation séparée, lignes 6–51](./MONOREPO.md#L6-L51), commit local `a7c879b76e14fa5c20598f8ff6bbe56a87ad0553`.

[^upstream-admin]: [Administration EmDash, écrans, rôles et namespace plugin, lignes 8–74](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/concepts/admin-panel.mdx#L8-L74).

[^upstream-versions]: [`emdash` `0.35.0`](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/core/package.json#L1-L5), [`@emdash-cms/admin` `0.35.0`](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/admin/package.json#L1-L5) et [`@emdash-cms/cloudflare` `0.35.0`](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/cloudflare/package.json#L1-L5).

[^upstream-plugins]: [Vue d’ensemble des plugins EmDash, lignes 8–77](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/plugins/overview.mdx#L8-L77).

[^upstream-plugin-manifest]: [`PluginManifest`, surface wire exhaustive, lignes 291–434](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/plugin-types/src/index.ts#L291-L434).

[^upstream-plugin-descriptor]: [`PluginDescriptor`, surface native/sandbox, lignes 50–154](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/core/src/astro/integration/runtime.ts#L50-L154).

[^local-domain-plugin]: [`CONTEXT.md` SuperBoard, manifest, Worker, lifecycle et installation, lignes 107–160](../CONTEXT.md#L107-L160), blob working tree `f3954871c1fed9a04dbfa8109616eacc2d0f1dd7`.

[^local-d1-registry]: [`scripts/cloudflare-d1-registry.mjs`, owners, répertoires et validation, lignes 10–149](../scripts/cloudflare-d1-registry.mjs#L10-L149), commit local `a7c879b76e14fa5c20598f8ff6bbe56a87ad0553`.

[^upstream-cloudflare-demo]: [Wrangler de la démo, lignes 1–57](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/demos/cloudflare/wrangler.jsonc#L1-L57), [configuration Astro](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/demos/cloudflare/astro.config.mjs) et [entrypoint Worker](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/demos/cloudflare/src/worker.ts).

[^local-services]: [`scripts/cloudflare-services.mjs`, registres domain/platform, lignes 1–176](../scripts/cloudflare-services.mjs#L1-L176) et [`deploy/targets/mbza-development.json`](../deploy/targets/mbza-development.json), commit local `a7c879b76e14fa5c20598f8ff6bbe56a87ad0553`.

[^upstream-ci]: [`.github/workflows/ci.yml` EmDash au SHA](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/.github/workflows/ci.yml).
