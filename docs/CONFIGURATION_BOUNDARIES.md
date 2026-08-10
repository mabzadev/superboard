# Frontières de configuration SuperBoard

Ce document définit où chaque valeur de configuration a le droit d’exister.
L’objectif n’est pas de supprimer les valeurs concrètes : un hostname, un nom
de Queue ou un identifiant D1 doit être déclaré quelque part. L’objectif est de
garantir qu’il n’existe que dans sa source d’autorité et jamais comme valeur de
secours dans le cœur partagé.

Le contrat exécutable est
`config/configuration-boundaries.json`, validé par
`schemas/configuration-boundaries.schema.json` et contrôlé avec :

```bash
npm run configuration:check
npm run configuration:test
```

Le contrôle fait partie de `cloudflare:test:targets` et donc du job CI
**Security and change plan**. Il ne contacte ni Cloudflare ni GitHub et ne lit
aucune valeur secrète.

## Les quatre catégories

### 1. Cœur commun autorisé

Le cœur partagé contient les protocoles et identités logiques réutilisables :

- services `api`, `identity`, `files`, `support`, `marketing`, etc. ;
- noms de bindings `DB`, `FILES_SERVICE`, `SUPPORT_QUEUE`, etc. ;
- routes privées comme `/internal/v1` ;
- pseudo-origines `https://<service>.internal` nécessaires pour construire une
  `Request` envoyée par un Service Binding ;
- endpoints officiels Apple, Google, Microsoft, Cloudflare et fournisseurs
  mail ;
- namespace produit logique `superboard`; namespace physique de compatibilité
  `opengrow` et noms historiques de santé comme `opengrow-api`, conservés
  jusqu'à un cutover de ressources vérifié.

La liste des services et des noms de secrets communs appartient à
`scripts/cloudflare-services.mjs`. Ces chaînes décrivent un contrat logiciel ;
elles ne sélectionnent ni un compte, ni une application, ni une ressource
Cloudflare physique.

### 2. Référence MBZA

`superboard.project.json#/development/target` sélectionne l’unique profil de
référence. Sa valeur actuelle pointe vers
`deploy/targets/mbza-development.json`.

Le validateur impose au profil de référence :

- un seul environnement `development` ;
- des domaines appartenant tous au suffixe `mbza.dev` ;
- le transport mail `capture`, sans credentials SMTP ;
- un issuer et un JWKS dérivés de `domains.api` ;
- des adresses mail MBZA cohérentes.

Les endpoints précis restent déclarés une seule fois dans le target. Le
contrat ne recopie pas `api.mbza.dev`, `in.mbza.dev` ou les identifiants D1 : il
les découvre depuis cette source canonique.

### 3. Configuration propre à une application

Tout target autre que la référence est un profil applicatif. Son fichier
`deploy/targets/<application>.json` possède exclusivement :

- les domaines publics ;
- les noms physiques des Workers ;
- les identifiants et noms D1/KV/R2 ;
- les Queues et DLQ ;
- les audiences Google/Apple et origines web ;
- les IDs publics de projets Support/Marketing ;
- l’identité d’expéditeur mail, mais jamais son mot de passe ;
- les features activées ;
- le chemin, les capacités, bindings, crons et **noms** de secrets du Custom
  Worker.

Le métier spécifique vit sous le `customWorker.packagePath` déclaré par le
target, par exemple `workers/custom/<application>`. Le scanner l’exclut du cœur
portable, mais le target reste responsable de son schéma et de ses bindings.

Les fichiers FlutterFlow générés sont des projections autorisées. Ils ne sont
pas une deuxième source de vérité : leur génération doit relire le target et
les contrats FlutterFlow.

### 4. Valeurs injectées

Les valeurs suivantes ne sont jamais stockées dans un target :

| Valeur                  | Source à l’exécution                                                                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ID de compte Cloudflare | `CLOUDFLARE_ACCOUNT_ID_<ACCOUNT_ALIAS>` puis `CLOUDFLARE_ACCOUNT_ID` dans l'environnement du contrôleur sélectionné (Workers Builds en développement, GitHub Actions en production) |
| Token Cloudflare        | token de build géré par Cloudflare en développement ; `CLOUDFLARE_API_TOKEN` dans le GitHub Environment de production                                                               |
| Identité projet SDK     | `SUPERBOARD_PROJECT_ID` et `SUPERBOARD_PROJECT_KEY`                                                                                                                                 |
| Secrets Workers communs | registres de `scripts/cloudflare-services.mjs`, valeurs dans Cloudflare Secrets                                                                                                     |
| Secrets Custom Worker   | noms dans `customWorker.secrets`, valeurs dans Cloudflare Secrets                                                                                                                   |

Un nom de secret peut être public. Sa valeur ne peut apparaître ni sous
`customWorker.vars`, ni sous `vars` d’un fichier Wrangler. Les runtime tests
injectent leurs valeurs factices avec Miniflare ; ils ne les déclarent pas
comme variables Worker.

## Ce que le gate refuse

Le contrôle échoue si :

- un fichier partagé contient un domaine appartenant à MBZA ou à une
  application ;
- un vrai ID D1/KV ou un nom de ressource physique issu d’un target est recopié
  dans le runtime partagé ;
- un ID de compte Cloudflare est assigné dans les sources ou enregistré dans un
  target ;
- un chemin absolu `/Users/<personne>/...` entre dans le runtime portable ;
- une variable Wrangler ou Custom Worker porte le nom d’un secret ;
- un script racine sélectionne silencieusement `--target <application>` ;
- le profil de référence dérive hors de son environnement, de ses domaines ou
  de son transport mail.

Les tests, fixtures, exemples, documentation, templates Wrangler locaux et
Custom Workers déclarés sont classés séparément. Ils ne peuvent pas servir de
configuration de déploiement. Les seuls fichiers Wrangler autorisés pour un
déploiement sont les artefacts ignorés `deploy/generated/*.jsonc`, produits à
partir d’un target explicite.

## Ajouter une nouvelle application

1. Ajouter `deploy/targets/<application>.json` conforme au schéma, sans ID de
   compte et sans valeur secrète.
2. Déclarer ses environnements, domaines, ressources, Workers et features.
3. Ajouter un `workers/custom/<application>` uniquement si le métier sort du
   contrat commun ; déclarer son chemin dans `customWorker.packagePath`.
4. Ajouter l’entrée de déploiement et le GitHub Environment correspondant.
5. Générer les projections FlutterFlow si l’application utilise FlutterFlow.
6. Exécuter `npm run configuration:check`, puis les tests Cloudflare complets.

Une nouvelle valeur applicative détectée dans le cœur commun doit être déplacée
vers le target ou remplacée par un binding. Elle ne doit pas être ajoutée à une
allowlist du scanner sauf si elle représente réellement un protocole commun,
un fixture local ou une source applicative déjà déclarée.

## Corrections sûres appliquées avec ce contrat

- l’aperçu de lien social construit désormais l’URL publique en HTTPS ;
- le faux `SUPPORT_WEBHOOK_ENCRYPTION_KEY` a été retiré de `vars` du Wrangler
  de test Support, puisque Miniflare l’injecte déjà comme secret de test ;
- le contrôle Legacy Messaging découvre son unique profil depuis les ressources
  déclarées au lieu d’épingler VocoStar dans `package.json` et dans Vitest.

Les IDs réels présents dans les targets restent intentionnellement versionnés :
ce sont des identifiants non secrets et des garde-fous contre l’adoption ou le
remplacement silencieux d’une ressource de production. Les IDs de compte et les
credentials restent externes.
