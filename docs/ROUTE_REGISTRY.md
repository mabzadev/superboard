# Registre des routes SuperBoard

Le registre associe chaque endpoint à son handler, son propriétaire, son service et sa politique d’accès. Il alimente le dispatch et l’inventaire du runtime exécuté. Les domaines viennent de la cible de déploiement.

## Ajouter une route

1. Utilisez le routeur du module, créé avec `registerRouter(new Hono(), group)` ou `createFetchRouter(group)`.
2. Déclarez le handler avec `get`, `post`, `put`, `patch`, `delete` ou `on`. Le groupe fournit `service`, `module`, `pluginId`, `surface` et `access`.
3. Donnez un identifiant stable avec `defineRoute({ id })`. Gardez cet identifiant lorsque le chemin change.
4. Attachez les chemins publics et les alias à `exposures`. Le dispatch public utilise ces métadonnées.
5. Si une contribution d’administration appelle cet endpoint, indiquez son `route_id` dans `scripts/config/superboard-plugin-api-adapters.json`. Conservez ses contraintes de paramètres, de corps et de requête. N’ajoutez ni méthode, ni chemin, ni liste de sources à cette contribution.
6. Régénérez les clients avec `node scripts/emdash/plugin-client-adapters.mjs`.

Le propriétaire est le composant métier. Il peut différer du service exécutant et de la famille d’URL. Une collecte Core reste une route Core même si un alias contient `analytics`.

La propriété `access` décrit une politique ; elle ne remplace pas son contrôle. Conservez les middlewares et vérifications de session, de permissions, de signature, de CSRF, de CORS, d’activation et de limitation des requêtes. Enregistrez les middlewares avec `use`, les secours avec `transport: "fallback"` et les connexions WebSocket avec `transport: "websocket"`.

Les routes `HEAD` implicites des routeurs compatibles sont dérivées des handlers `GET`. Les prévols CORS sont enregistrés séparément. `continuation: true` décrit un handler qui transmet la requête au suivant ; `mount: "extend"` complète un routeur sans remplacer ses chemins existants.

## Monter un autre routeur

`route` conserve les déclarations du routeur enfant. Le contrôle compare sa table avec le montage effectué et refuse une modification de l’enfant qui rend ce montage périmé.

`mountRegisteredRouter` relie un routeur natif à un routeur Hono. La même table sert à exécuter les handlers et à décrire le montage. Les routes des Durable Objects utilisent `executionScope` pour identifier leur composant, sans leur attribuer une URL publique.

L’intégration Astro lit le graphe résolu et les exports des endpoints. Content utilise les handlers EmDash de ce graphe, chargés à la demande. Les groupes de modules déclarent leur propriétaire indépendamment des URL. L’intégration Identity observe le routeur embarqué sans modifier ses sources amont.

## Déclarer une destination interne

Une route proxy déclare `destination`, avec le service, le chemin interne et, si nécessaire, `sourcePath` pour son chemin canonique. Le proxy utilise `resolveRouteDestination` pour construire sa requête. L’inventaire dérive les endpoints accessibles depuis le manifeste du service cible.

Pour Paywalls et Onboardings, `destinations` décrit les branches avant et après migration vers Flows. La politique du projet choisit la branche au moment de la requête. La référence de l’opération ne dépend pas du Worker choisi. Une destination attendue indisponible rend l’observation partielle ; les références périmées ne sont pas utilisées pour autoriser un dispatch.

## Exposer le manifeste du runtime

`withRouteManifest` expose `GET /internal/route-manifest/v1` sur un hôte interne après authentification. Passez les routeurs effectivement utilisés au wrapper. Une fonction de sources peut fournir les routes publiées à chaud : Gateway utilise ainsi son manifeste actif pour le dispatch et l’inventaire. Les brouillons ne sont pas des routes actives.

`SUPERBOARD_WORKER_VERSION` fournit la version exécutée du Worker. `SUPERBOARD_RELEASE` permet de repérer des versions différentes pendant un déploiement progressif. Une version manquante reste indiquée comme non vérifiée.

Une extension gérée doit publier le même contrat avec son identifiant `managed-…`. Le binding `API_SERVICE` permet au wrapper de faire vérifier la signature de découverte par le Core, sans transmettre le secret au Worker. Son routeur doit lui aussi utiliser le registre. Une extension sans contrat vérifiable reste indisponible dans l’inventaire et bloque le contrôle de couverture.

## Consulter l’inventaire

Le Core collecte les manifestes via les bindings de la topologie configurée. Les réponses sont associées à l’instance, à l’environnement et à la version observés. Une panne produit un inventaire partiel. Une observation antérieure porte sa date et l’état périmé.

La nomenclature unifiée regroupe l’ensemble des routes sous les 8 entités canoniques du système : `superboard-core` et les 7 plugins métier (`superboard-authentification`, `superboard-data`, `superboard-monetization`, `superboard-communication`, `superboard-acquisition`, `superboard-support`, `superboard-analytics`). Tous les modules internes (`supbrd-plugmod-*`) sont rattachés à leur plugin propriétaire respectif et ne sont plus exposés comme des plugins indépendants dans l'inventaire.

Le descripteur de route distingue l’origine via la propriété `origin` (`cms` pour les routes natives du framework EmDash, `superboard` pour les routes de la plateforme).

Configuration applique un filtrage strict sur l’inventaire visible :
- Les routes natives du CMS EmDash (`/_emdash/api/content/*`, `/_emdash/api/taxonomies/*`, etc.) et les adaptateurs internes (`/_emdash/api/superboard/*`) sont exclus de l’inventaire affiché dans les onglets Configuration.
- Seules les routes clientes publiques des SDK (`surface: "sdk"`, sous le domaine `sdk.mabza.dev`), appelées par les applications mobiles et web, sont affichées et rattachées à leur plugin propriétaire.
- L'interface distingue les chemins canoniques, les alias, les chemins internes et les destinations conditionnelles. Les requêtes partagées utilisent les ETags ; l’actualisation se fait à l’ouverture, au retour sur l’onglet et toutes les trente secondes pendant sa visibilité. La pagination et les filtres restent conservés. Une réponse 401 ou 403 retire les données affichées.

La découverte des routes n’ajoute pas de requête de base de données au rendu public anonyme.

## Valider une modification

`pnpm routes:check` combine l’analyse du code, la comparaison des tables construites avec leurs déclarations, les références d’administration, les manifestes des services et la publication Gateway. Le contrôle est raccordé à la CI qualité et aux commandes préalables au déploiement.

Avec le serveur local démarré, `pnpm routes:test:browser` couvre le parcours « déclaration → handler HTTP → Configuration », puis le retrait de la déclaration. `pnpm local:test:settings` couvre les sept vues Configuration en français et en anglais.

La réussite d’un contrôle ciblé ne remplace pas la validation de l’ensemble du périmètre : permissions, plugins désactivés, signatures, alias, WebSockets, pannes et déploiements progressifs restent à couvrir lors de la validation finale.
