# Primitives backend SuperBoard

Cette spécification décrit les briques génériques qui permettent à une
application cliente de stocker ses données, ses fichiers et ses vecteurs, de
recevoir des événements en temps réel et d'exécuter du code serveur, sans
passer par un module métier. Elle fixe les contrats publics, le modèle de
données, les bindings Cloudflare et l'ordre de livraison.

Le Worker Data (`superboard-files`, source `packages/plugins/superboard-data/worker`)
porte toutes ces briques. Son autorité d'écriture reste le plugin
`superboard-data`.

## Objectifs

Après le déploiement, un développeur peut :

- créer des tables typées, y lire et y écrire des lignes depuis une application,
  avec des règles d'accès par ligne ;
- s'abonner aux changements d'une table, diffuser des messages et partager une
  présence sur un canal ;
- ranger des fichiers dans des buckets publics ou privés, les envoyer en
  plusieurs parties, signer des URL et transformer des images ;
- déployer une fonction JavaScript, l'appeler par HTTP et la planifier ;
- indexer des textes ou des vecteurs et lancer une recherche par similarité ;
- piloter tout cela depuis le Front, une clé serveur, le SDK web, le SDK Flutter
  et la CLI `superboard`.

## Contraintes

- [ADR 0001](../adr/0001-plugin-autonomy-and-operator-session.md) : le plugin
  Data possède ses vues, ses commandes et ses données ; une vue désactivée est
  masquée sans perte de données.
- [ADR 0003](../adr/0003-public-sdk-routing.md) : les routes publiques restent
  dans la famille `/v1/data` du domaine `sdk`.
- [ADR 0004](../adr/0004-single-r2-bucket-per-environment.md) : les objets
  restent dans le dossier `files/` du bucket de l'environnement.
- Le rendu anonyme du Site ne reçoit aucune requête supplémentaire.
- Les migrations D1 sont uniquement ascendantes et rejouables.
- Une requête D1 accepte au plus 100 paramètres liés ; les écritures groupées
  sont donc découpées.
- Une requête HTTP vers un Worker ne dépasse pas 100 Mio ; les fichiers plus
  gros passent par l'envoi en plusieurs parties.

## Hors périmètre

- Les SMS, le SSO SAML, les organisations et la connexion Facebook ou Discord,
  retirés de l'authentification le 2026-11-06.
- Plusieurs projets par instance : une Instance SuperBoard reste un projet.
- La publication des SDK et de la CLI sur npm ou pub.dev, qui passe par le
  workflow de release protégé.

## Identités et rôles

Chaque requête publique est évaluée avec l'un de ces rôles :

| Rôle            | Preuve                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------- |
| `anon`          | En-têtes SDK (`PROJECT-KEY`, `PLATFORM`, `IDENTIFIER`) sans jeton utilisateur                |
| `authenticated` | En-têtes SDK et `Authorization: Bearer <jeton d'accès d'application>` dont le `pid` concorde |
| `service`       | `Authorization: Bearer sb_secret_…`, clé serveur du projet                                   |

Le Worker API résout le projet à partir des en-têtes SDK, puis transmet au
Worker Data un contexte de projet signé avec `FILES_INTERNAL_TOKEN`. Le Worker
Data vérifie lui-même le jeton d'application (ES256, JWKS de l'authentification)
et refuse un jeton dont le `pid` diffère du projet résolu. Une clé serveur
désigne son projet ; elle ne nécessite pas d'en-têtes SDK.

Les clés serveur sont créées dans le Front. La valeur `sb_secret_<43 caractères>`
n'est affichée qu'à la création. La base conserve son empreinte SHA-256, son
indice (`sb_secret_abcd…`) et sa date de dernière utilisation.

## Règles d'accès

Chaque table, bucket et collection de vecteurs porte une règle par opération :

| Règle           | Effet                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| `public`        | Accessible aux rôles `anon`, `authenticated` et `service`                                                |
| `authenticated` | Accessible aux rôles `authenticated` et `service`                                                        |
| `owner`         | Rôle `authenticated` limité aux lignes dont `owner_id` vaut son `sub` ; `service` voit toutes les lignes |
| `service`       | Rôle `service` uniquement                                                                                |

Une nouvelle table utilise `owner` pour les quatre opérations. Une insertion
par un rôle `authenticated` fixe `owner_id` à son `sub` ; seul le rôle
`service` peut choisir `owner_id`. Une ligne invisible pour l'appelant répond
`404`, jamais `403`. Une écriture renvoie seulement l'`id` des lignes que la
règle de lecture cache à l'appelant, et une écriture filtrée ne vise que les
lignes qu'il peut lire. Un utilisateur d'application connecté anonymement a le
rôle `authenticated`.

## Base de données

### Stockage

Les métadonnées vivent dans la D1 du Worker Data (migration
`0003_application_database.sql`) :

- `data_tables` : projet, nom, libellé, règles, temps réel activé, dates ;
- `data_columns` : projet, table, nom, type, nullabilité, défaut, unicité,
  index, position ;
- `data_service_keys` : projet, nom, empreinte, indice, créateur, dates,
  révocation.

Chaque table applicative est une table SQL réelle nommée
`adb_<projectId>_<nom>`. Elle contient les colonnes système `id` (UUID),
`owner_id`, `created_at`, `updated_at`, puis les colonnes déclarées, avec les
index `owner_id` et `created_at`. Les noms de tables et de colonnes respectent
`^[a-z][a-z0-9_]{0,47}$` et ne reprennent pas une colonne système.

| Type        | Colonne SQLite | JSON renvoyé    |
| ----------- | -------------- | --------------- |
| `text`      | `TEXT`         | chaîne          |
| `integer`   | `INTEGER`      | entier          |
| `number`    | `REAL`         | nombre          |
| `boolean`   | `INTEGER` 0/1  | booléen         |
| `json`      | `TEXT`         | valeur JSON     |
| `timestamp` | `TEXT` ISO     | chaîne ISO 8601 |
| `uuid`      | `TEXT`         | chaîne UUID     |

### API publique

| Méthode et chemin                     | Effet                                                 |
| ------------------------------------- | ----------------------------------------------------- |
| `GET /v1/data/db/:table`              | Liste paginée filtrée                                 |
| `GET /v1/data/db/:table/:id`          | Une ligne                                             |
| `POST /v1/data/db/:table`             | Insère un objet, ou un tableau de 100 objets au plus  |
| `PATCH /v1/data/db/:table/:id`        | Met à jour une ligne                                  |
| `PATCH /v1/data/db/:table?<filtres>`  | Met à jour les lignes filtrées visibles (100 au plus) |
| `DELETE /v1/data/db/:table/:id`       | Supprime une ligne                                    |
| `DELETE /v1/data/db/:table?<filtres>` | Supprime les lignes filtrées visibles (100 au plus)   |

Paramètres de requête, inspirés de PostgREST :

- `select=a,b` : colonnes renvoyées, `id` toujours inclus ;
- `<colonne>=<opérateur>.<valeur>` avec `eq`, `neq`, `gt`, `gte`, `lt`, `lte`,
  `like`, `ilike`, `in.(a,b)` et `is.null|true|false` ;
- `order=<colonne>.asc|desc` : une colonne, départage par `id`, défaut
  `created_at.asc` ;
- `limit` : 50 par défaut, 100 au plus ; `cursor` : curseur opaque ;
- `count=exact` : ajoute `count` à la réponse ;
- `upsert=true` sur `POST` : met à jour la ligne de même `id` quand la règle de
  mise à jour l'autorise, en ne modifiant que les colonnes fournies. Un lot
  refusé n'écrit aucune ligne.

Une liste renvoie `{ "items": [...], "nextCursor"?: "...", "count"?: n }`.
Une ligne renvoie l'objet seul. Une écriture filtrée sans filtre est refusée
(`filter_required`).

### Gestion

Ces routes acceptent une clé serveur. Le Front appelle les mêmes handlers par
`/internal/v1/operator/data/*` avec la session de l'Opérateur SuperBoard.

| Méthode et chemin                                      | Effet                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------- |
| `GET /v1/data/manage/tables`                           | Tables et colonnes                                             |
| `POST /v1/data/manage/tables`                          | Crée une table                                                 |
| `GET`, `PATCH`, `DELETE /v1/data/manage/tables/:table` | Lit, modifie règles et temps réel, supprime                    |
| `POST /v1/data/manage/tables/:table/columns`           | Ajoute une colonne                                             |
| `DELETE /v1/data/manage/tables/:table/columns/:column` | Supprime une colonne                                           |
| `POST /v1/data/manage/schema`                          | Applique un schéma déclaratif (`dry_run`, `allow_destructive`) |
| `GET /v1/data/manage/types`                            | Types TypeScript générés                                       |
| `GET /v1/data/openapi.json`                            | Spécification OpenAPI 3.1 du projet                            |

La suppression d'une table ou d'une colonne exige `?confirm=<nom>`. L'Opérateur
dispose aussi d'un éditeur SQL en lecture seule (`SELECT` ou `WITH`, une seule
instruction, 500 lignes au plus).

## Temps réel

Un Durable Object `RealtimeHub` par projet garde les WebSockets du projet avec
l'API d'hibernation. Une connexion multiplexe plusieurs canaux.

1. `POST /v1/data/realtime/tickets` renvoie `{ ticket, url, expires_at }`. Le
   ticket, signé et valable 60 secondes, porte le projet, le rôle et le `sub`.
2. Le client ouvre `GET /v1/data/realtime/connect?ticket=…` en WebSocket.

Messages du client : `join`, `leave`, `broadcast`, `presence`,
`presence_untrack`, `ping`. Messages du serveur : `joined`, `error`,
`broadcast`, `presence_state`, `presence_diff`, `change`, `pong`.

Une connexion se ferme avec le code `4001` à l'expiration du jeton qui a servi
au ticket, au plus tard après une heure, et avec le code `4003` pour un
visiteur anonyme quand le projet cesse de les accepter. Le client se reconnecte
avec un nouveau ticket.

Les canaux `db:<table>` sont réservés aux changements d'une table dont le temps
réel est activé. Le hub filtre chaque événement `change` selon la règle de
lecture de l'abonné. Les autres canaux servent à la diffusion et à la présence ;
le rôle `anon` y accède seulement si le réglage du projet l'autorise.

## Stockage

Les buckets vivent dans `data_buckets` (public, taille maximale, types autorisés,
règles `read`, `write`, `delete`) ; les objets dans `data_objects` ; les envois
en plusieurs parties dans `data_uploads` et `data_upload_parts`. La clé R2 d'un
objet est `storage/<projectId>/<bucket>/<chemin>` dans le dossier `files/`.

| Méthode et chemin                                            | Effet                                                |
| ------------------------------------------------------------ | ---------------------------------------------------- |
| `GET /v1/data/storage/buckets`                               | Buckets du projet                                    |
| `GET /v1/data/storage/list/:bucket?prefix=&limit=&cursor=`   | Objets visibles                                      |
| `PUT /v1/data/storage/object/:bucket/<chemin>`               | Envoie un objet (`x-upsert: true` pour remplacer)    |
| `GET /v1/data/storage/object/:bucket/<chemin>`               | Lit un objet, avec `Range` et transformation d'image |
| `DELETE /v1/data/storage/object/:bucket/<chemin>`            | Supprime un objet                                    |
| `POST /v1/data/storage/sign/:bucket/<chemin>`                | Signe une URL (7 jours au plus)                      |
| `GET /v1/data/storage/signed/:token`                         | Lit un objet par URL signée                          |
| `GET /v1/data/storage/public/:projectId/:bucket/<chemin>`    | Lit un objet d'un bucket public, mis en cache        |
| `POST /v1/data/storage/uploads/:bucket`                      | Démarre un envoi en plusieurs parties                |
| `PUT /v1/data/storage/uploads/:bucket/:uploadId/:partNumber` | Envoie une partie                                    |
| `GET /v1/data/storage/uploads/:bucket/:uploadId`             | Parties reçues, pour reprendre                       |
| `POST /v1/data/storage/uploads/:bucket/:uploadId/complete`   | Termine l'envoi                                      |
| `DELETE /v1/data/storage/uploads/:bucket/:uploadId`          | Abandonne l'envoi                                    |

La gestion des buckets passe par `/v1/data/manage/buckets`. Les transformations
(`width`, `height`, `fit`, `format`, `quality`) utilisent le binding Images ;
sans ce binding, l'image originale est renvoyée.

## Fonctions

Une fonction est un module ES qui exporte `fetch` et, au besoin, `scheduled`.
Ses versions sont rangées dans `data_functions` et `data_function_versions` ;
leurs exécutions dans `data_function_runs` ; leurs planifications dans
`data_function_schedules`.

Le Worker Data charge la version active avec le binding `LOADER` (Worker Loader),
sous l'identifiant `<projectId>:<nom>:<version>`. Un module d'enveloppe
transmet l'identité de l'appelant (`x-superboard-user-id`, `x-superboard-role`,
`x-superboard-project-id`), collecte les journaux de la console et route les
exécutions planifiées vers `scheduled`.

| Méthode et chemin                                        | Effet                               |
| -------------------------------------------------------- | ----------------------------------- |
| `ANY /v1/data/functions/:name/<chemin>`                  | Appelle la fonction                 |
| `GET`, `PUT`, `DELETE /v1/data/manage/functions/:name`   | Lit, déploie une version, supprime  |
| `GET /v1/data/manage/functions`                          | Fonctions du projet                 |
| `GET /v1/data/manage/functions/:name/runs`               | Dernières exécutions et journaux    |
| `PUT`, `DELETE /v1/data/manage/functions/:name/schedule` | Planifie ou retire la planification |

L'accès d'appel d'une fonction est `public`, `authenticated` ou `service`.
Les fonctions partagent l'origine SDK : leurs requêtes ne reçoivent pas les
cookies, leurs réponses perdent `Set-Cookie` et portent
`Content-Security-Policy: sandbox`.
Les variables sont stockées en clair ; les secrets sont chiffrés en AES-GCM avec
une clé dérivée de `DATA_ENCRYPTION_KEY`, ne sont jamais relus par l'API et ne
sont disponibles que si ce secret est configuré. Le déclencheur Cron du Worker
Data s'exécute chaque minute et lance les planifications échues.

## Vecteurs

Une collection de vecteurs déclare ses règles `read` et `write` dans
`data_vector_collections`. Les éléments et leur texte sont rangés dans
`data_vector_items`. Les vecteurs vivent dans l'index Vectorize de
l'environnement (1024 dimensions, cosinus), sous l'espace de noms
`p<projectId>:<collection>`. Le texte est vectorisé avec Workers AI
(`@cf/baai/bge-m3`, multilingue).

| Méthode et chemin                          | Effet                                           |
| ------------------------------------------ | ----------------------------------------------- |
| `POST /v1/data/vectors/:collection/upsert` | Indexe 50 éléments au plus (`text` ou `values`) |
| `POST /v1/data/vectors/:collection/query`  | Recherche par texte ou vecteur (`top_k` ≤ 50)   |
| `DELETE /v1/data/vectors/:collection/:id`  | Retire un élément                               |
| `POST /v1/data/ai/embeddings`              | Vectorise un ou plusieurs textes                |
| `/v1/data/manage/vector-collections`       | Gestion des collections                         |

Sans les bindings `AI` et `VECTORS`, ces routes répondent `503`
`vectors_unavailable`.

## Authentification

Un CAPTCHA Cloudflare Turnstile facultatif protège l'inscription et la
connexion par mot de passe, sur les pages hébergées et sur les routes SDK. Il
se règle dans l'onglet Avancé des paramètres d'authentification. La clé de site
s'y saisit ; le secret `TURNSTILE_SECRET_KEY` est un secret de déploiement du
Worker d'identité, dont le Front affiche seulement la présence.

## Bindings et déploiement

Le générateur `scripts/cloudflare/config.mjs` ajoute au Worker Data :

| Binding    | Ressource                                                 |
| ---------- | --------------------------------------------------------- |
| `REALTIME` | Durable Object `RealtimeHub` (classe SQLite)              |
| `LOADER`   | Worker Loader                                             |
| `IMAGES`   | Cloudflare Images                                         |
| `AI`       | Workers AI, hors environnement local                      |
| `VECTORS`  | Index Vectorize `moduleVectorize.dataVectors`, hors local |
| Cron       | `* * * * *`                                               |

`DATA_ENCRYPTION_KEY` est un secret facultatif. Son absence désactive les
secrets de fonctions et l'affiche dans le Front.

## Effacement d'un compte

L'effacement d'un Utilisateur d'application passe par
`DELETE /internal/v1/users/:id` du Worker Data. En plus de ses fichiers, cet
appel supprime ses lignes dans toutes les tables applicatives, ses objets, ses
envois en plusieurs parties et ses éléments vectoriels, puis renvoie leur
décompte.

## Pannes

- Un binding absent rend sa brique indisponible (`503`) sans affecter les autres.
- Une écriture de ligne valide sa transaction avant de publier le changement
  temps réel ; la publication est différée avec `waitUntil` et peut être perdue,
  jamais anticipée.
- Une fonction qui dépasse son délai répond `504` et son exécution est
  journalisée en échec.
- Un envoi en plusieurs parties non terminé expire après 24 heures ; le Cron
  l'abandonne dans R2.

## Livraison

1. Base de données, clés serveur, règles d'accès, OpenAPI et types.
2. Temps réel.
3. Stockage.
4. Fonctions et planification.
5. Vecteurs et Workers AI.
6. Turnstile.
7. Front : Base de données, Stockage, Fonctions, Vecteurs, API et clés.
8. SDK web, SDK Flutter et CLI.

Chaque brique ajoute ses tests dans `tests/checks/plugins/superboard-data/`.
Les tests d'exécution utilisent le pool Workers de Vitest avec D1, R2 et Durable
Objects réels ; Vectorize et Workers AI sont remplacés par des implémentations
locales de leur interface.
