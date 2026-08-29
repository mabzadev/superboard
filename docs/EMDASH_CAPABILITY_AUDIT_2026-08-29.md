# Audit des capacités et limites d’EmDash pour la migration SuperBoard

- Ticket de recherche : [Auditer les capacités et les limites actuelles d’EmDash](https://github.com/mabzadev/superboard/issues/44)
- Carte Wayfinder : [Migration complète de SuperBoard vers EmDash CMS](https://github.com/mabzadev/superboard/issues/33)
- Date de l’audit : 29 août 2026
- Dépôt audité : [`emdash-cms/emdash`](https://github.com/emdash-cms/emdash)
- Commit audité, immuable : [`1717d31b351164a5f78e95fe004ee582c7c50f40`](https://github.com/emdash-cms/emdash/commit/1717d31b351164a5f78e95fe004ee582c7c50f40)
- Version déclarée des paquets principaux à ce commit : `0.35.0` pour `emdash`, `@emdash-cms/admin` et `@emdash-cms/cloudflare`.[^pkg-core][^pkg-admin][^pkg-cloudflare]

## Résultat

EmDash fournit déjà un socle CMS substantiel et directement exploitable : une administration React montée dans un site Astro, un modèle de contenu dynamique en base, des collections et champs typés, Portable Text, médias, menus, taxonomies, sections, zones de widgets, authentification, RBAC, révisions et publication par entrée, API REST, CLI, plugins natifs ou sandboxés, stockage et KV par plugin, hooks, routes, pages d’administration, widgets et blocs.[^readme-features][^admin-screens][^schema-types][^plugin-overview]

EmDash ne fournit pas la cible « Release Front SuperBoard ». Au commit audité, il n’existe ni modèle canonique de pages/layouts/éléments/actions/data sources du front produit, ni registre générique de renderers publics, ni validateur inter-plugins, ni artefact de release front immuable, ni pointeur d’activation atomique, ni rollback de release, ni descripteur de Worker métier avec santé et migrations. Cette conclusion ne repose pas seulement sur une recherche lexicale : les surfaces exhaustives de `PluginDescriptor`, `PluginManifest`, `PluginContext` et des noms de hooks s’arrêtent aux primitives CMS et plugins détaillées ci-dessous.[^plugin-descriptor][^plugin-manifest][^plugin-context][^hook-names]

La différence déterminante est la suivante :

- EmDash sait publier atomiquement **une entrée de contenu** et conserver ses révisions.[^content-publish]
- L’action « bulk publish » de l’administration lance **une requête par entrée**, avec cinq requêtes au maximum en parallèle ; ce n’est pas une transaction de site.[^bulk-publish]
- Les menus, zones de widgets, widgets, sections, options et états de plugins sont stockés comme des lignes actives sans pointeurs draft/live comparables à ceux des collections de contenu.[^live-resource-tables]
- EmDash n’a donc pas de promotion atomique d’un ensemble cohérent de routes, pages, layouts, permissions, textes, médias et contributions de plugins.

EmDash est en **beta preview** et ses paquets principaux audités (`emdash`, admin et adapter Cloudflare) sont encore pré-1.0. Le registre de plugins et son contrat partagé sont explicitement expérimentaux ; plusieurs noms de capacités sont dans une fenêtre de migration ; la documentation et le code présentent quelques divergences de configuration. Une migration complète doit donc épingler exactement la version évaluée et traiter les surfaces expérimentales comme changeantes, mais cet audit ne choisit pas encore de stratégie d’intégration.[^readme-status][^pkg-core][^pkg-admin][^pkg-cloudflare][^plugin-types-experimental][^registry-experimental][^capability-transition]

## Méthode et sens des classifications

Le dépôt officiel a été cloné intégralement, sans clone superficiel, avec tous les packages, applications, démos, templates, documentation et historique disponibles. L’audit a lu le code et la documentation officiels au SHA indiqué ; les permaliens de ce document pointent toujours vers ce SHA.

Les termes ont ici un sens strict :

- **Existe** : la capacité est implémentée et exposée dans le commit audité.
- **Adaptable** : une primitive existe et peut contribuer à la cible, mais elle ne satisfait pas à elle seule le contrat SuperBoard. Ce qualificatif ne constitue pas une recommandation d’architecture.
- **Manque** : aucune surface correspondante n’apparaît dans les contrats publics exhaustifs ou dans les implémentations auditées ; un développement ou une extension de contrat est requis.
- **Instable** : la capacité est explicitement bêta/expérimentale, en transition, ou la documentation officielle ne correspond pas entièrement au code du même SHA.

Les absences ont été contrôlées dans les descripteurs, manifests, contextes, hooks, routes, migrations et tables, avec des recherches explicites sur les concepts « front release », « release manifest », « activation pointer », « renderer/action/data-source registry » et « Worker health/migration ». Les seuls « releases » natifs trouvés concernent les versions de paquets plugins, pas une version complète du front d’un site.

## Vue synthétique

| Domaine | Existe | Adaptable à la cible SuperBoard | Manque ou reste instable |
| --- | --- | --- | --- |
| Administration | SPA React à `/_emdash/admin`, écrans de contenu, médias, schémas, menus, widgets, taxonomies, réglages et plugins.[^admin-screens] | Pages/widgets/panneaux/colonnes React pour plugins natifs ; Block Kit pour plugins sandboxés.[^react-admin][^block-kit] | Aucune surface native pour composer le front produit public ; pages plugins confinées à leur namespace et incapables de remplacer les écrans core.[^admin-plugin-namespace] |
| Schémas et collections | 16 types de champs, validations, références, repeater, index, supports drafts/révisions/preview/scheduling/search/SEO ; tables SQL `ec_*`.[^schema-types][^content-table] | Collections `json`/`portableText`/`reference`/`repeater` pour décrire une partie du modèle front. | Aucun schéma officiel page/layout/élément/action/data source/release, aucune validation inter-collections ou inter-plugins de la cible. |
| Contenu et médias | Draft/live, révisions, programmation, traductions, médias locaux/R2/S3 et providers externes.[^content-publish][^media-library] | Contenu, textes, médias et certaines instances de composition peuvent alimenter un compilateur externe ou ajouté. | La révision est par entrée ; les menus/widgets/sections/options ne partagent pas ce workflow ; pas de cohérence globale de release. |
| Authentification et RBAC | Passkeys, magic links, OAuth, providers, Cloudflare Access ; cinq rôles et une carte de permissions core.[^auth-guide][^rbac] | Providers et sessions peuvent servir de bridge d’identité ; les routes plugins peuvent exiger une permission core.[^plugin-route-auth] | Pas de page `/login` SuperBoard composée dans le CMS, pas de rôles/permissions front déclaratifs et extensibles, pas de guards ou politiques par route/élément/release. |
| Plugins | Formats standard/sandboxé et natif, lifecycle, hooks, routes, KV, stockage, admin, blocs et MCP.[^plugin-descriptor][^plugin-manifest] | Les deux formats couvrent une grande partie des familles `supbrd-plug-*` et peuvent envelopper des appels externes. | Aucun registre public d’éléments/renderers/actions/data sources ; aucun descripteur de Worker métier, ressources, migration ou santé pour `supbrd-plugmod-*`. |
| Sandbox | Runner Cloudflare Worker Loader et runner Node/workerd ; capabilities, isolation réseau, quotas.[^sandbox-security][^workerd-package] | Convient à du code backend déclaratif limité et à des UI Block Kit. | Dynamic Workers nécessite un compte Cloudflare payant ; capacités grossières ; pas de bindings hôte ; mémoire non plafonnée par plugin dans le runner Cloudflare ; sandbox Hyperdrive non supporté.[^paid-dynamic-workers][^cloudflare-runner-limits][^hyperdrive-sandbox-limit] |
| Rendu du site | Site Astro SSR, Live Collections, Portable Text, menus et widgets récupérables à l’exécution.[^site-architecture][^menus][^widgets] | Un plugin natif peut fournir des composants Astro pour des blocs Portable Text ; un thème peut fournir des routes et layouts en code.[^portable-text-components][^themes] | Pas de thème/runtime abstrait, pas de routeur CMS générique, pas de renderer React public piloté par manifeste, pas de pages concrètes détenues par une release. |
| Publication et versions | Publication atomique d’une entrée, révisions, preview signée, snapshots, sauvegardes, versions de plugin immuables.[^content-publish][^snapshot][^plugin-version-immutable] | Les mécanismes de snapshot, checksum de plugin et manifest de migrations donnent des motifs techniques réutilisables. | Pas de compilation globale, checksum de release site, activation atomique, rollback de release, promotion par environnement ou validation de parité. |
| Migrations | Migrations core avec manifest de build exact et modes `auto`/`check`/`manual` ; évolution live du schéma via admin/API/CLI.[^core-migrations][^schema-evolution] | Manifest de migration, empreinte de cible, seed exporté et répétition CLI sont des primitives de contrôle. | Les changements de modèle de contenu prennent effet immédiatement, la suppression détruit la colonne et les données, et le stockage plugin n’a pas de migrations de données déclaratives.[^schema-evolution][^plugin-storage-migrations] |

## 1. Administration

### Existe

L’administration est une SPA React servie sous `/_emdash/admin/*`. Elle expose nativement le dashboard, les listes et éditeurs de contenu, la médiathèque, le constructeur de schéma, les menus, zones de widgets, taxonomies, réglages et pages de plugins. Sa navigation est calculée depuis les collections et plugins installés.[^admin-screens]

Le formulaire d’une collection est généré depuis ses champs. Les champs texte, nombres, booléens, dates, sélections, Portable Text, images et références ont des éditeurs intégrés. La médiathèque gère recherche, filtres, glisser-déposer, métadonnées et suppression en masse.[^admin-editor-media]

### Adaptable

Un plugin natif peut contribuer :

- des pages React sous `/_emdash/admin/plugins/<plugin-id>/<path>` ;
- des widgets de dashboard ;
- des panneaux dans l’éditeur de contenu ;
- des colonnes en lecture seule dans les listes de contenu ;
- un formulaire de réglages auto-généré depuis `admin.settingsSchema`.[^react-admin]

Un plugin sandboxé peut fournir une UI d’administration déclarative en JSON via Block Kit. Le host rend les blocs et renvoie les interactions au plugin, sans exécuter le JavaScript du plugin dans le navigateur.[^block-kit]

Ces surfaces peuvent héberger les outils internes de définition, validation, preview et suivi d’une future Release Front.

### Manque ou limite

Ces extensions concernent **EmDash Admin**, pas le front public SuperBoard. Les pages plugins restent dans le namespace du plugin et un plugin ne peut pas remplacer un écran core de l’administration.[^admin-plugin-namespace] Aucun contrat audité ne permet à un plugin d’enregistrer une page publique SuperBoard, un layout public ou une route publique finale comme objet de premier rang.

Les filtres `minRole` des panneaux et colonnes React ne sont que des filtres de visibilité ; la documentation exige de refaire l’autorisation dans les routes API. Ils ne forment pas une politique déclarative de front.[^react-visibility-not-auth]

La désactivation d’un plugin natif masque ses liens, widgets, colonnes et pages d’administration, mais la documentation indique que ses hooks backend continuent à s’exécuter. Cette sémantique ne correspond pas automatiquement à « aucune contribution runtime d’un plugin désactivé » et devra être traitée explicitement dans le futur modèle front.[^plugin-disable-semantics]

## 2. Schémas, collections et modèle de contenu

### Existe

Le registre de schéma stocké en base est la source de vérité. EmDash expose 16 types de champs : `string`, `text`, `url`, `number`, `integer`, `boolean`, `datetime`, `select`, `multiSelect`, `portableText`, `image`, `file`, `reference`, `json`, `slug` et `repeater`. Les collections déclarent notamment les supports `drafts`, `revisions`, `preview`, `scheduling`, `search` et `seo`.[^schema-types]

Chaque collection obtient une vraie table SQL `ec_<slug>` avec colonnes de cycle de vie, version optimiste, pointeurs de révision live/draft, locale et groupe de traduction, puis ses champs applicatifs comme colonnes typées.[^content-table]

Une collection peut déclarer un `urlPattern`, être routable ou non, masquer son entrée de sidebar, choisir des colonnes d’administration et définir des champs de titre/date. Cela fournit des métadonnées utiles à une description de pages, mais pas une route exécutable à elle seule.[^collection-config]

### Adaptable

Les champs `json`, `portableText`, `reference` et `repeater` permettent de représenter des arbres de composition, des props, des références et du contenu éditorial. Les collections dédiées peuvent fournir des formulaires générés et un workflow draft/révision par enregistrement.

Le modèle est exportable dans un seed avec réglages, collections, taxonomies, menus et zones de widgets, et l’option `--with-content` ajoute les entrées. Cette exportabilité est utile pour reproduire un environnement ou constituer une entrée de compilation.[^schema-evolution]

### Manque ou limite

Aucun type natif ne représente les concepts SuperBoard suivants : release front, page, layout, instance d’élément, renderer, action, data source, permission de front, route authentifiée, état loading/error/disabled/unavailable ou dépendance de Worker. Ces concepts ne figurent ni dans `PluginDescriptor` ni dans `PluginManifest`.[^plugin-descriptor][^plugin-manifest]

EmDash valide chaque champ et chaque entrée, mais n’expose pas de validateur global pour :

- l’unicité des routes après normalisation ;
- l’unicité des identifiants d’éléments dans une page ;
- la résolution de références entre pages, layouts, médias et plugins ;
- les collisions de types d’éléments, actions ou data sources ;
- les cycles de dépendances ;
- la compatibilité entre version d’instance et version de renderer ;
- la complétude des traductions d’une release.

L’évolution du schéma live prend effet immédiatement. La documentation décrit une « migration » de modèle comme un script de commandes CLI exécutées environnement par environnement ; supprimer un champ supprime sa colonne et ses données.[^schema-evolution] Ce mécanisme ne fournit pas une version de schéma front préparée puis activée avec une release.

## 3. Contenu, publication, révisions et traductions

### Existe

Les tables de contenu portent `status`, `version`, `live_revision_id` et `draft_revision_id`. La publication promeut la révision draft d’une entrée vers live, recopie les données de la révision dans la ligne et effectue une mise à jour atomique protégée par la version et les pointeurs attendus.[^content-publish-repository]

Le handler officiel résume explicitement la portée : « one atomic content-row statement ». La transaction inclut éventuellement la création d’une redirection lorsque le slug change, mais toujours pour une seule entrée.[^content-publish]

Le produit sait aussi dépublier, programmer une entrée, restaurer des révisions et publier les traductions indépendamment. Une restauration crée une nouvelle révision et conserve l’historique.[^working-content]

### Adaptable

Une future description de release pourrait utiliser des entrées draftées et révisées comme matière éditoriale. Le hook `content:afterSave` peut déclencher une invalidation ou une demande de compilation, et `content:afterPublish` signale une promotion d’entrée.[^content-hooks]

### Manque ou limite

Il n’existe pas de draft global regroupant plusieurs pages, menus, réglages et plugins. L’administration « bulk » n’ajoute pas cette garantie : elle appelle les endpoints existants par entrée, en parallèle limité, et accepte des succès partiels.[^bulk-publish]

Les traductions ont chacune leur propre statut et historique et sont publiées indépendamment. EmDash ne garantit donc pas qu’un ensemble multilingue soit activé d’un seul geste.[^working-content]

Le `PluginContext` accorde aux plugins `content:write` uniquement les opérations `create`, `update` et `delete` ; il n’expose pas `publish`, `schedule` ou une transaction multi-entrées.[^plugin-content-access] Le pilotage de ce workflow n’est donc pas réalisable avec ce contexte seul.

## 4. Médias, menus, sections et widgets

### Existe

La médiathèque gère images, documents, vidéo et audio, dossiers, suivi d’usage, uploads et métadonnées. Les backends officiels couvrent le filesystem local, R2 et S3-compatible ; le flux d’upload utilise une cible signée quand l’adapter le permet et une route stream sinon.[^media-library]

Les champs médias conservent un objet portable avec provider, id, URL éventuelle, dimensions, point focal, alt et métadonnées. EmDash fournit aussi des providers Cloudflare Images et Stream.[^media-values]

Les menus sont des arbres ordonnés de liens, avec références vers contenus/taxonomies ou URL custom. Les zones de widgets acceptent du Portable Text, un menu ou un `componentId` et ses props. Les sections sont des fragments Portable Text réutilisables dans l’éditeur.[^menus][^widgets][^sections]

### Adaptable

Ces objets couvrent une part du besoin de navigation, textes et médias SuperBoard. Les `componentId` et `componentProps` des widgets ressemblent à une instance de renderer déclarative.

### Manque ou limite

Le mapping d’un `componentId` vers un composant reste écrit dans le template Astro. L’exemple officiel construit explicitement un `componentMap` dans `WidgetRenderer.astro` ; EmDash ne fournit pas un registre public dynamique de composants.[^widgets]

Menus, widgets et sections sont des lignes actives, sans `live_revision_id`/`draft_revision_id` ni version de release. Les options globales n’ont qu’un nom et une valeur JSON.[^live-resource-tables] Une modification de ces ressources n’est donc pas automatiquement staged avec les entrées de pages.

Le snapshot et la sauvegarde incluent les métadonnées média mais pas les binaires ; une release front autonome aurait donc besoin d’un contrat supplémentaire pour la référence et la disponibilité des médias.[^backup-contents]

## 5. Authentification, sessions et RBAC

### Existe

EmDash fournit une authentification passkey/WebAuthn, des magic links, GitHub, Google et Atmosphere, ainsi qu’une interface de provider extensible. Cloudflare Access peut remplacer exclusivement les autres mécanismes.[^auth-guide]

Les sessions utilisent des cookies HttpOnly, Secure, SameSite=Lax, avec expiration glissante de 30 jours par défaut.[^auth-sessions]

Le RBAC comprend cinq niveaux fixes : Subscriber, Contributor, Author, Editor et Admin. La carte de permissions core couvre contenu, médias, taxonomies, commentaires, menus, bylines, widgets, sections, redirections, utilisateurs, réglages, schéma, plugins, import, backups, recherche et auth.[^rbac]

Les routes privées de plugins sont authentifiées et exigent par défaut `plugins:manage`. Elles peuvent sélectionner une permission RBAC EmDash existante ; les routes publiques contournent auth, scopes et CSRF.[^plugin-route-auth]

### Adaptable

Un `AuthProviderDescriptor` peut fournir des composants React pour le login/setup de l’administration, des routes d’auth, des préfixes publics et son stockage. Cette interface, les sessions et l’identité de l’appelant transmise aux routes privées sont des primitives utilisables par un bridge d’identité.[^auth-provider][^plugin-route-user]

### Manque ou limite

Le login natif documenté est celui de `/_emdash/admin`. Aucun objet CMS ne décrit une page publique `/login`, son layout, ses textes, ses états ou l’URL de retour vers un shell SuperBoard.[^auth-guide]

Les rôles et noms de permissions sont définis statiquement dans `@emdash-cms/auth`. Il n’existe pas de registre de permissions applicatives par plugin ou par release, ni de politique déclarative par page, élément, projet, cible ou environnement.[^rbac]

Les routes plugins peuvent réutiliser les permissions core, mais leur contrat ne permet pas de déclarer de nouvelles permissions SuperBoard. Les contrôles de visibilité React `minRole` ne remplacent pas l’autorisation serveur.[^plugin-route-auth][^react-visibility-not-auth]

## 6. Plugins : formats, lifecycle et distribution

### Existe

EmDash distingue :

- le format standard, utilisable en processus ou en sandbox ;
- le format natif, chargé au build, en processus, nécessaire pour React arbitraire dans l’admin, composants Astro publics de Portable Text et fragments HTML/scripts.[^plugin-descriptor][^plugin-formats]

Le `PluginManifest` sérialise l’identité/version, le contrat d’accès, les capacités, hosts réseau, stockage, hooks, routes, MCP et contributions d’administration. Les hooks lifecycle couvrent installation, activation, désactivation et désinstallation.[^plugin-manifest][^lifecycle-hooks]

Le marketplace/registre permet installation, consentement aux capacités, mise à jour et désinstallation de plugins sandboxés. Les versions publiées sont immuables et l’installation vérifie checksum, id, version et contrat de capacités.[^plugin-install][^registry-trust][^plugin-version-immutable]

Ces capacités recouvrent une part importante de `supbrd-plug-*` : état et stockage propres, hooks, routes, UI de back-office et version du plugin.

### Adaptable

Une extension SuperBoard peut utiliser :

- une page d’administration native ou Block Kit pour sa configuration ;
- KV pour les petits réglages/états ;
- stockage plugin pour des documents indexés ;
- routes plugins pour ses endpoints JSON ;
- hooks et cron pour le travail déclenché ou planifié ;
- `ctx.http` pour appeler une API externe autorisée ;
- le lifecycle pour initialiser ou préserver ses données.

Une famille `supbrd-plugmod-*` peut donc être représentée partiellement par un plugin EmDash qui parle à un Worker existant. Cela ne signifie pas que le Worker est géré par EmDash : le contrat natif ne connaît pas son déploiement, ses bindings, ses migrations ou sa santé.

### Manque ou limite

`PluginDescriptor` est exhaustif : id, version, entrypoint, options, format, entrées admin/Astro, pages/widgets/settings/blocs/widgets de champs, capacités, hosts, stockage, MCP, routes et hooks. Il n’a aucun champ pour un Worker métier, une queue, un Durable Object, un Workflow, un Container, une liste de migrations, une sonde de santé ou une condition de readiness.[^plugin-descriptor]

`PluginManifest` ne contient pas davantage ces concepts.[^plugin-manifest] EmDash ne peut donc pas nativement refuser une publication front parce que « le Worker, ses migrations ou sa santé ne sont pas prêts ».

Les seules dépendances déclarées observées sont celles d’une configuration de hook, pour ordonner l’exécution de ce hook. Elles ne constituent pas un graphe de dépendances global entre plugin, renderer, layout, Worker et release.[^hook-config]

## 7. Sandbox, capabilities et limites d’exécution

### Existe

Avec un runner actif, la sandbox applique :

- gating de `ctx.content`, `ctx.taxonomies`, `ctx.media`, `ctx.http`, `ctx.users` et `ctx.email` ;
- scoping du KV et du stockage par plugin ;
- blocage du `fetch` direct, avec passage par la bridge et allowlist ;
- absence de filesystem, variables d’environnement et bindings host ;
- limites dépendant du runner.[^sandbox-security]

Le runner Cloudflare utilise Dynamic Worker Loader et une bridge de service. Il bloque le réseau direct, configure 50 ms CPU, 10 subrequests et 30 secondes wall-clock par défaut. La valeur 128 MB est déclarée mais n’est pas configurable ni effectivement plafonnée par plugin par Worker Loader.[^sandbox-security][^cloudflare-runner-limits]

Un paquet `@emdash-cms/sandbox-workerd` `0.5.1` existe pour Node et expose un runner workerd ; Miniflare est une dépendance optionnelle de développement.[^workerd-package]

### Adaptable

Les plugins sandboxés conviennent à des opérations backend limitées, au stockage scoped, aux hooks, aux routes JSON et aux UI Block Kit. Ils peuvent contribuer des métadonnées publiques structurées via `page:metadata`.[^page-hooks]

### Manque ou limite

Les capacités sont grossières : `content:write` autorise la modification de tout contenu, pas seulement celui créé par le plugin. Il n’existe pas de portée normative par collection, entrée, projet ou environnement.[^sandbox-coarse]

Le type `DeclaredAccess` accepte des contraintes ouvertes, mais le code précise que les contraintes inconnues sont seulement consultatives ; la seule contrainte normativement appliquée aujourd’hui est `network.request.allowedHosts`.[^declared-access]

Un plugin sandboxé ne voit aucun binding hôte. Il ne peut donc pas recevoir directement, par le contrat actuel, un service binding vers un Worker module, une Queue, un DO ou un Workflow.[^sandbox-security]

Le README officiel avertit que Dynamic Workers n’est disponible que sur les comptes payants Cloudflare.[^paid-dynamic-workers] Le bridge des plugins sandboxés Cloudflare est en outre D1-only et n’est pas disponible avec Hyperdrive/PostgreSQL.[^hyperdrive-sandbox-limit] Un bundle publié au registre est plafonné à 256 Kio décompressés au total, 128 Kio par fichier et 20 fichiers ; il ne constitue donc pas un conteneur arbitrairement extensible.[^plugin-bundle-limits]

Sans runner disponible, les plugins `sandboxed: []` sont ignorés au démarrage. Les déplacer dans `plugins: []` les exécute en processus sans frontière d’isolation et leur permet de contourner les capacités par les API du host.[^plugin-formats][^sandbox-coarse]

## 8. Hooks

### Existe

Les hooks couvrent :

- lifecycle plugin ;
- sauvegarde, suppression, publication, dépublication, restauration et programmation d’une entrée ;
- upload média ;
- cron ;
- email ;
- commentaires ;
- `page:metadata` et `page:fragments`.[^hook-names]

Chaque hook peut définir priorité, timeout, dépendances d’ordre, politique `abort` ou `continue` et exclusivité pour quelques providers.[^hook-config]

`page:metadata` renvoie des contributions structurées et validées pour meta, property, link allowlisté ou JSON-LD. `page:fragments`, réservé aux plugins natifs, peut injecter scripts ou HTML dans les emplacements auxquels le template public a explicitement souscrit.[^page-hooks]

### Adaptable

`content:afterSave`, `content:afterPublish` et `cron` sont des points possibles pour demander une revalidation ou une compilation. `plugin:activate` peut initialiser idempotemment de nouveaux réglages.[^content-hooks][^plugin-settings]

### Manque ou limite

La liste exhaustive n’inclut aucun hook pour :

- modification de collection ou de champ ;
- modification de menu, widget, zone, section ou réglage global ;
- modification du contrat de permissions ;
- changement de santé/migration d’un Worker ;
- demande, succès, échec ou activation d’une Release Front.[^hook-names]

Un compilateur qui doit observer **toutes** les surfaces du front ne peut donc pas se fier uniquement aux hooks actuels.

## 9. Réglages, KV et stockage plugin

### Existe

Chaque plugin possède un KV privé `ctx.kv` avec `get`, `set`, `delete` et `list`. Les clés sont préfixées automatiquement par l’id du plugin dans la table d’options.[^plugin-settings]

Les plugins sandboxés construisent leur écran de réglages en Block Kit et enregistrent les valeurs dans le KV. Les plugins natifs peuvent déclarer `admin.settingsSchema` pour obtenir un formulaire automatique.[^plugin-settings][^react-settings]

Le stockage plugin fournit CRUD, batch, requêtes indexées, compteurs et pagination. Toutes les collections partagent `_plugin_storage`, avec scoping `plugin_id`/`collection` et données JSON ; les index déclarés sont créés comme index d’expression.[^plugin-storage]

### Adaptable

Le KV peut contenir de petits curseurs et réglages de compilation. Le stockage plugin peut contenir des documents de travail, diagnostics ou métadonnées de releases. Ces usages restent bornés par le contrat document-store et ne créent pas une release front nativement.

### Manque ou limite

Le stockage plugin n’a pas de workflow draft/live, de révisions, d’activation atomique ou de contrat d’immutabilité. Il n’a pas de migrations de données déclaratives : EmDash ajoute ou retire automatiquement les index, tandis qu’une migration de valeur doit être codée manuellement et idempotemment, par exemple dans `plugin:activate`.[^plugin-storage-migrations][^plugin-settings]

Le `PluginContext` ne fournit aucune API de schéma, menus, widgets, sections ou réglages globaux. Sa liste exhaustive s’arrête au stockage/KV, contenu, taxonomies en lecture, médias, HTTP, log, site/URL, utilisateurs, cron et email.[^plugin-context] Un plugin sandboxé compilateur ne peut donc pas lire directement tout l’état nécessaire à une Release Front.

## 10. Routes plugins, actions et data sources

### Existe

Les routes plugins sont montées sous `/_emdash/api/plugins/<slug>/<route-name>`, exécutées avec le même `PluginContext` que les hooks, et peuvent avoir un schéma Zod d’entrée. Les réponses JSON sont enveloppées dans le format EmDash.[^plugin-routes]

Les routes privées disposent de l’utilisateur authentifié, peuvent choisir une permission core et sont protégées par CSRF pour les sessions cookie. Les routes publiques peuvent déclarer un `Cache-Control` pour les GET réussis.[^plugin-route-auth][^plugin-route-user]

Une route privée peut être exposée explicitement comme outil MCP, avec schémas d’entrée/sortie, permission et marqueur destructif, après consentement administrateur.[^plugin-mcp]

### Adaptable

Les routes fournissent une primitive backend crédible pour implémenter des actions et data sources SuperBoard, y compris un proxy vers un Worker via `ctx.http`.

### Manque ou limite

Il n’existe pas de registre front typé d’actions/data sources, pas de liaison déclarative entre une instance d’élément et une route, pas de version de contrat intégrée à une release, et pas de validation globale de disponibilité. Les routes restent sous le namespace EmDash du plugin ; elles ne créent pas une route de page SuperBoard.

Les routes publiques contournent entièrement l’auth et la CSRF, tandis que les routes privées utilisent le RBAC core. Le contrat ne fournit pas la notion intermédiaire « route publique du site mais nécessitant la session et une permission SuperBoard déclarée dans la release ».[^plugin-route-auth]

## 11. Pages, layouts, renderers et rendu public

### Existe

EmDash est une intégration Astro. Le site écrit ses pages et composants, puis lit le contenu live via `getEmDashCollection()` et `getEmDashEntry()` ; l’administration et le contenu partagent la base.[^site-architecture]

La documentation des thèmes est explicite : un thème EmDash est un projet Astro complet et « there is no theme API or abstraction layer ». Les routes, pages, layouts, composants et styles sont des fichiers du projet ; le seed initialise le modèle de contenu.[^themes]

Les layouts sélectionnables par l’éditeur sont un champ `select` dont la valeur est mappée manuellement vers des imports Astro dans le fichier de route.[^page-layouts]

Les plugins natifs peuvent fournir un `componentsEntry` qui exporte `blockComponents`. EmDash les fusionne dans le renderer `PortableText` ; cette surface concerne les types de blocs Portable Text et des composants Astro chargés au build.[^portable-text-components]

Les plugins sandboxés peuvent déclarer les champs d’édition d’un bloc, mais ne peuvent pas livrer son renderer public. Le renderer doit venir d’un package natif ou du site.[^portable-text-components]

### Adaptable

Les blocs Portable Text, widgets à `componentId`, composants Astro natifs et champs JSON peuvent servir de précédents pour un futur registre SuperBoard. Block Kit peut être interprété par un renderer SuperBoard prévu dans du code de confiance.

### Manque ou limite

Ces surfaces ne constituent pas le renderer demandé :

- aucun registre générique de primitives du front public ;
- aucun renderer React public fourni par un plugin EmDash ;
- aucun registre d’actions ou data sources ;
- aucun routeur piloté par un manifeste CMS ;
- aucune représentation native du login, du shell, des pages d’erreur/interdit/maintenance ou des états loading/disabled/unavailable ;
- aucune séparation native « EmDash Admin interne / SuperBoard Admin public » au niveau d’un modèle de pages.

L’`adminEntry` React s’exécute dans EmDash Admin, pas dans le site public.[^react-admin] Le `componentsEntry` public ne couvre que les blocs Portable Text Astro.[^portable-text-components] `page:fragments` injecte du HTML ou des scripts dans un template qui a ajouté les composants d’insertion ; il ne compose pas des pages.[^page-fragments]

## 12. Preview, snapshots et sauvegardes

### Existe

La preview d’une entrée utilise un token HMAC signé et limité dans le temps. Le middleware sert implicitement le draft concerné au même template Astro.[^preview]

Le endpoint `/_emdash/api/snapshot` produit un snapshot pour une base de preview isolée. Il inclut les tables de contenu dynamiques et les tables système nécessaires au rendu : schémas, taxonomies, menus, sections, zones/widgets, SEO, médias, options sûres et révisions.[^snapshot-route][^snapshot]

Les sauvegardes enveloppent ce snapshot avec tous les contenus, y compris draft, scheduled et trash, et enregistrent la version EmDash. Elles excluent utilisateurs/auth, secrets, configuration plugin et binaires médias.[^backup-implementation][^backup-contents]

### Adaptable

Le snapshot constitue une source de données portable et déjà filtrée pour le rendu. Il peut aider à évaluer une preview ou constituer un input de compilation.

### Manque ou limite

Le snapshot n’est pas une Release Front :

- il ne contient pas le stockage `_plugin_*` ni les réglages `plugin:*` ;
- il exclut auth et secrets ;
- il ne contient pas les binaires médias ;
- son code parcourt successivement les tables et ajoute seulement `generatedAt`, sans id de release, checksum global, pointeur d’activation ou garantie explicite de lecture atomique sous écritures concurrentes.[^snapshot]

La restauration du backup JSON n’est pas encore exposée ; un assistant CLI est seulement « planned ». Les options actuelles sont D1 Time Travel ou la réimportation d’un dump complet.[^backup-restore]

La preview signée standard vise une entrée. Elle ne sélectionne pas un ensemble cohérent de drafts de pages, menus, réglages et plugins.

## 13. Publication globale, immutabilité et rollback

### Existe

Trois primitives voisines existent, mais pour des objets différents :

1. une entrée de contenu peut être promue atomiquement de draft vers live ;[^content-publish]
2. une version publiée de plugin est immuable et vérifiée par checksum à l’installation ;[^registry-trust][^plugin-version-immutable]
3. un build produit un manifest exact des migrations core, lié à l’artefact, et le CLI vérifie les migrations inconnues ou en attente.[^core-migrations]

### Adaptable

Ces mécanismes démontrent que le code possède déjà des briques pour versionner, vérifier une empreinte, contrôler une cible et refuser un état incompatible. Elles sont des précédents possibles pour le futur back du front.

### Manque

Aucune implémentation auditée ne fournit :

- un `FrontRelease` immuable avec id, version, checksum, date, auteur et provenance ;
- un bundle complet des routes, pages, layouts, éléments, textes, permissions, navigation et versions de plugins/renderers ;
- un pipeline draft → normalisation → validations structurelles/inter-plugins → preview → publication ;
- une activation par échange atomique d’un pointeur unique ;
- une lecture du renderer limitée à la release active ;
- un historique d’activations et un rollback vers une release précédente ;
- une promotion du même artefact entre environnements ;
- un état `failed` qui laisse l’ancienne release active ;
- une politique de compatibilité entre release, `supbrd-core` et plugins.

Ces capacités sont à développer ; elles ne doivent pas être confondues avec les révisions d’une entrée ou les versions des paquets plugins.

## 14. Migrations

### Existe : migrations core

EmDash distingue les migrations core de l’évolution du modèle de contenu. Le build écrit `.emdash/migrations.json` avec version EmDash, liste ordonnée de migrations, locales et exécuteur de l’adapter. Le CLI offre `--status`, apply et `--check`, refuse les manifests/artefacts incompatibles et impose une empreinte de cible pour les applications non interactives.[^core-migrations]

Le runtime propose `auto`, `check` et `manual`. La documentation décrit aussi la compatibilité expand/deploy/contract et la tolérance directionnelle des migrations inconnues pendant un rolling deploy.[^core-migrations]

### Existe : modèle de contenu

Le modèle live est modifié via admin ou CLI REST. Le seed ne s’applique qu’à une base vide ; changer le seed d’un déploiement existant ne modifie rien. Une migration répétable est documentée comme un script de commandes `emdash schema`.[^schema-evolution]

### Limites pour la cible

Le manifest de migrations core ne couvre ni les migrations des collections métier pilotées par un plugin, ni les migrations des Workers externes, ni la compatibilité d’une Release Front avec des renderers.

Le stockage plugin n’a pas de migrations de données déclaratives. Les index sont convergés automatiquement ; l’auteur gère lui-même les changements de forme des documents.[^plugin-storage-migrations]

Le futur contrôle « Worker + migrations + santé prêts avant activation » n’a aucun point de données standard dans `PluginDescriptor` ou `PluginManifest`.[^plugin-descriptor][^plugin-manifest]

## 15. Instabilité et divergences observées

### Statut général

Le projet s’annonce lui-même en `beta preview`. Les paquets core sont `0.35.0` et le paquet de types partagé précise que le contrat de manifest peut évoluer avant la fin du RFC du registre.[^readme-status][^plugin-types-experimental]

### Registre et contrat d’accès

Le registre fédéré, ses lexicons et formes de records sont explicitement expérimentaux. La documentation conseille d’épingler la version exacte.[^registry-experimental]

Le code accepte à la fois les capacités canoniques (`content:read`, `network:request`, etc.) et d’anciens alias (`read:content`, `network:fetch`, etc.) pendant une fenêtre de dépréciation. `declaredAccess` est encore optionnel dans le wire manifest pendant sa migration.[^capability-transition][^plugin-manifest]

### Documentation et code de sandbox

Au même SHA :

- `@emdash-cms/sandbox-workerd` `0.5.1` est bien un package présent dans le monorepo et la page d’installation le documente ;[^workerd-package][^plugin-install]
- la page de choix du format dit encore que le runner Node/workerd est « in development » ;[^plugin-formats]
- plusieurs exemples de configuration utilisent `@emdash-cms/sandbox-cloudflare`, alors que le package présent est `@emdash-cms/cloudflare` et que sa fonction `sandbox()` renvoie `@emdash-cms/cloudflare/sandbox`.[^plugin-install][^cloudflare-sandbox-export]

Ces divergences n’annulent pas les capacités du code, mais elles prouvent que cette surface évolue rapidement et que les exemples doivent être vérifiés contre le package épinglé.

### Limitations documentées dans le code Cloudflare

Le support de sandbox avec Hyperdrive/PostgreSQL est explicitement absent parce que la bridge parle directement à D1.[^hyperdrive-sandbox-limit] La limite mémoire par plugin du runner Cloudflare est déclarative mais non appliquée par Worker Loader.[^cloudflare-runner-limits]

## 16. Points d’extension disponibles pour une future Release Front

Cette section inventorie des coutures techniques ; elle ne choisit pas l’architecture.

1. **Modèle éditorial** — collections dynamiques avec JSON, Portable Text, références, repeater, drafts et révisions par entrée.[^schema-types][^content-table]
2. **Back-office spécialisé** — pages React natives, panneaux d’éditeur, colonnes de listes, settings auto-générés ou pages Block Kit.[^react-admin][^block-kit]
3. **Backend de compilation** — route plugin privée, hooks de contenu et cron ; contraintes : namespace plugin, RBAC core et contexte incomplet pour les ressources globales.[^plugin-routes][^plugin-context][^hook-names]
4. **État de travail** — KV et stockage document indexé par plugin ; contraintes : pas de draft/live, version immuable ni migration déclarative.[^plugin-settings][^plugin-storage]
5. **Matière de snapshot** — endpoint snapshot comprenant contenu et chrome du site ; contraintes : exclusions plugin/auth/médias et absence de contrat de release atomique.[^snapshot]
6. **Renderers build-time** — `componentsEntry` et composants Astro de blocs Portable Text ; contraintes : pas de registre générique public React ni de chargement sandboxé de renderer.[^portable-text-components]
7. **Appels métier** — routes plugins et `ctx.http` avec allowlist ; contraintes : pas de service binding sandboxé ni descripteur de Worker/readiness.[^plugin-routes][^sandbox-security][^plugin-descriptor]
8. **Vérification d’artefacts** — checksum et immutabilité de versions plugins, ainsi que manifest exact de migrations core ; contraintes : ces contrats ne s’appliquent pas encore au front du site.[^registry-trust][^plugin-version-immutable][^core-migrations]
9. **Identité** — providers, sessions et utilisateur authentifié des routes privées ; contraintes : page publique et permissions SuperBoard absentes.[^auth-provider][^plugin-route-user][^rbac]

## 17. Écart précis avec les exigences SuperBoard

| Exigence SuperBoard | État EmDash audité | Qualification |
| --- | --- | --- |
| EmDash Admin interne à `/_emdash/admin` | Fourni nativement. | **Existe** |
| Front SuperBoard distinct après `/login` | Astro permet d’écrire ces routes, mais EmDash ne les modélise ni ne les compose. | **À développer** |
| Toutes les pages/layouts/routes/textes/états détenus par EmDash | Contenus, menus, widgets et médias existent ; routes/layouts/renderers restent du code Astro. | **Partiel, à adapter puis développer** |
| `supbrd-core` sans page concrète, renderer générique | Aucun contrat équivalent. | **À développer** |
| Registre typé éléments/renderers | PT blocks et component widgets sont des précédents limités. | **À développer** |
| Registre actions/data sources | Routes plugins et MCP sont des précédents backend. | **À développer** |
| `supbrd-plug-*` sans Worker | Plugins EmDash couvrent backend, storage, settings et admin. La contribution au front public manque. | **Fortement adaptable** |
| `supbrd-plugmod-*` avec Worker | Appel HTTP possible ; aucun descripteur, binding, migration, santé ou readiness standard. | **Partiel, contrat à développer** |
| Plugins sandboxés contribuant du Block Kit au front | Block Kit existe uniquement comme renderer d’admin/plugin et champs d’édition de blocs ; pas de renderer public SuperBoard officiel. | **À adapter** |
| Validation structurelle et inter-plugins | Validations locales de champ, manifest, capacité et route existent. Pas de compilateur global. | **À développer** |
| Détection route/id/type/action/data source en double | Aucune surface globale correspondante. | **À développer** |
| Détection références, permissions, traductions, cycles | Quelques validations locales existent ; aucune validation de graphe de release. | **À développer** |
| Vérification Worker/migrations/santé | Absente des manifests/descripteurs. | **À développer** |
| Preview complète d’un draft de front | Preview par entrée et snapshot de preview existent, sans sélection cohérente de release. | **À adapter** |
| Release complète immuable + checksum | Immutabilité/checksum existent pour les paquets plugins seulement. | **À développer** |
| Activation atomique | Publication atomique par entrée seulement. | **À développer** |
| Renderer ne lisant jamais les drafts | Les queries publiques servent le live ; aucune API de « release active » globale n’existe. | **À développer** |
| Rollback de release | Révisions d’entrée et D1 Time Travel existent ; restore JSON prévu, pas de rollback front. | **À développer** |
| Permissions déclarées dans la release | RBAC core statique uniquement. | **À développer** |
| Compatibilité stricte et aucune perte de données | Migrations core prudentes ; évolution de schéma peut supprimer irréversiblement des colonnes. | **Contrôle supplémentaire requis** |

## Conclusion factuelle

EmDash peut accueillir le **plan de contrôle éditorial** de SuperBoard et une grande partie de l’enveloppe backend de plugins. Il possède déjà les primitives de schéma, contenu, médias, auth, admin, lifecycle, storage, hooks et API qui évitent de reconstruire un CMS.

En revanche, la propriété « tout le front SuperBoard est géré et publié depuis EmDash » n’est pas une fonctionnalité existante d’EmDash `0.35.0`. Le site public reste un projet Astro dont routes, layouts et composants sont livrés en code. Les mécanismes de publication sont locaux à une entrée ou à un paquet plugin, pas à un graphe complet de front.

Le travail à développer se concentre donc, factuellement, sur un nouveau domaine de Release Front : contrats de déclaration, registre de primitives, compilation et validations globales, artefact immuable, activation/rollback atomiques, permissions applicatives, intégration des Workers et renderer public. Cet audit ne décide ni où stocker ce domaine, ni quel format de plugin employer, ni comment l’exécuter.

## Sources primaires épinglées

[^pkg-core]: [`packages/core/package.json`, lignes 1–5](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/core/package.json#L1-L5)
[^pkg-admin]: [`packages/admin/package.json`, lignes 1–5](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/admin/package.json#L1-L5)
[^pkg-cloudflare]: [`packages/cloudflare/package.json`, lignes 1–5](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/cloudflare/package.json#L1-L5)
[^readme-features]: [`README.md`, lignes 104–156](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/README.md#L104-L156)
[^readme-status]: [`README.md`, lignes 135–166](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/README.md#L135-L166)
[^paid-dynamic-workers]: [`README.md`, lignes 1–18](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/README.md#L1-L18)
[^site-architecture]: [`docs/src/content/docs/concepts/architecture.mdx`, lignes 8–98](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/concepts/architecture.mdx#L8-L98)
[^admin-screens]: [`docs/src/content/docs/concepts/admin-panel.mdx`, lignes 8–36](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/concepts/admin-panel.mdx#L8-L36)
[^admin-editor-media]: [`docs/src/content/docs/concepts/admin-panel.mdx`, lignes 39–75](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/concepts/admin-panel.mdx#L39-L75)
[^admin-plugin-namespace]: [`docs/src/content/docs/concepts/admin-panel.mdx`, lignes 72–75](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/concepts/admin-panel.mdx#L72-L75)
[^schema-types]: [`packages/core/src/schema/types.ts`, lignes 1–105 et 117–173](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/core/src/schema/types.ts#L1-L173)
[^collection-config]: [`packages/core/src/schema/types.ts`, lignes 175–229](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/core/src/schema/types.ts#L175-L229)
[^content-table]: [`packages/core/src/schema/registry.ts`, lignes 1409–1456](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/core/src/schema/registry.ts#L1409-L1456)
[^schema-evolution]: [`docs/src/content/docs/deployment/schema-evolution.mdx`, lignes 8–86 et 124–128](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/deployment/schema-evolution.mdx#L8-L128)
[^working-content]: [`docs/src/content/docs/guides/working-with-content.mdx`, lignes 157–234 et 306–334](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/guides/working-with-content.mdx#L157-L334)
[^content-publish]: [`packages/core/src/api/handlers/content.ts`, lignes 1573–1625](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/core/src/api/handlers/content.ts#L1573-L1625)
[^content-publish-repository]: [`packages/core/src/database/repositories/content.ts`, lignes 1752–1969](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/core/src/database/repositories/content.ts#L1752-L1969)
[^bulk-publish]: [`packages/admin/src/lib/bulk.ts`, lignes 1–40](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/admin/src/lib/bulk.ts#L1-L40)
[^media-library]: [`docs/src/content/docs/guides/media-library.mdx`, lignes 9–177 et 296–314](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/guides/media-library.mdx#L9-L314)
[^media-values]: [`docs/src/content/docs/guides/media-library.mdx`, lignes 448–523](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/guides/media-library.mdx#L448-L523)
[^menus]: [`docs/src/content/docs/guides/menus.mdx`, lignes 8–65 et 118–202](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/guides/menus.mdx#L8-L202)
[^widgets]: [`docs/src/content/docs/guides/widgets.mdx`, lignes 8–178](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/guides/widgets.mdx#L8-L178)
[^sections]: [`docs/src/content/docs/guides/sections.mdx`, lignes 8–92 et 158–209](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/guides/sections.mdx#L8-L209)
[^live-resource-tables]: [`packages/core/src/database/types.ts`, lignes 396–415 et 478–628](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/core/src/database/types.ts#L396-L628)
[^auth-guide]: [`docs/src/content/docs/guides/authentication.mdx`, lignes 8–16, 92–118 et 208–224](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/guides/authentication.mdx#L8-L224)
[^auth-provider]: [`docs/src/content/docs/guides/authentication.mdx`, lignes 182–206](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/guides/authentication.mdx#L182-L206)
[^auth-sessions]: [`docs/src/content/docs/guides/authentication.mdx`, lignes 267–276](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/guides/authentication.mdx#L267-L276)
[^rbac]: [`packages/auth/src/rbac.ts`, lignes 8–112 et 177–232](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/auth/src/rbac.ts#L8-L232)
[^plugin-overview]: [`docs/src/content/docs/plugins/overview.mdx`, lignes 8–40](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/plugins/overview.mdx#L8-L40)
[^plugin-formats]: [`docs/src/content/docs/plugins/creating-plugins/choosing-a-format.mdx`, lignes 8–74](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/plugins/creating-plugins/choosing-a-format.mdx#L8-L74)
[^plugin-descriptor]: [`packages/core/src/astro/integration/runtime.ts`, lignes 50–154](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/core/src/astro/integration/runtime.ts#L50-L154)
[^plugin-manifest]: [`packages/plugin-types/src/index.ts`, lignes 291–434](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/plugin-types/src/index.ts#L291-L434)
[^plugin-types-experimental]: [`packages/plugin-types/src/index.ts`, lignes 1–31](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/plugin-types/src/index.ts#L1-L31)
[^capability-transition]: [`packages/plugin-types/src/index.ts`, lignes 33–160 et 404–420](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/plugin-types/src/index.ts#L33-L160)
[^declared-access]: [`packages/plugin-types/src/index.ts`, lignes 163–192](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/plugin-types/src/index.ts#L163-L192)
[^sandbox-security]: [`docs/src/content/docs/plugins/creating-plugins/capabilities.mdx`, lignes 82–106](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/plugins/creating-plugins/capabilities.mdx#L82-L106)
[^sandbox-coarse]: [`docs/src/content/docs/plugins/creating-plugins/capabilities.mdx`, lignes 100–120](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/plugins/creating-plugins/capabilities.mdx#L100-L120)
[^cloudflare-runner-limits]: [`packages/cloudflare/src/sandbox/runner.ts`, lignes 34–48](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/cloudflare/src/sandbox/runner.ts#L34-L48)
[^hyperdrive-sandbox-limit]: [`packages/cloudflare/src/index.ts`, lignes 356–365](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/cloudflare/src/index.ts#L356-L365)
[^workerd-package]: [`packages/workerd/package.json`, lignes 1–37](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/workerd/package.json#L1-L37)
[^cloudflare-sandbox-export]: [`packages/cloudflare/src/index.ts`, lignes 529–542](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/cloudflare/src/index.ts#L529-L542)
[^hook-names]: [`packages/plugin-types/src/manifest-schema.ts`, lignes 87–124](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/plugin-types/src/manifest-schema.ts#L87-L124)
[^hook-config]: [`docs/src/content/docs/plugins/creating-plugins/hooks.mdx`, lignes 25–69 et 326–384](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/plugins/creating-plugins/hooks.mdx#L25-L69)
[^lifecycle-hooks]: [`docs/src/content/docs/plugins/creating-plugins/hooks.mdx`, lignes 71–131](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/plugins/creating-plugins/hooks.mdx#L71-L131)
[^content-hooks]: [`docs/src/content/docs/plugins/creating-plugins/hooks.mdx`, lignes 133–235](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/plugins/creating-plugins/hooks.mdx#L133-L235)
[^page-hooks]: [`docs/src/content/docs/plugins/creating-plugins/hooks.mdx`, lignes 262–325](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/plugins/creating-plugins/hooks.mdx#L262-L325)
[^plugin-context]: [`docs/src/content/docs/plugins/creating-plugins/api-routes.mdx`, lignes 529–569](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/plugins/creating-plugins/api-routes.mdx#L529-L569)
[^plugin-content-access]: [`packages/core/src/plugins/types.ts`, lignes 311–356](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/core/src/plugins/types.ts#L311-L356)
[^plugin-routes]: [`docs/src/content/docs/plugins/creating-plugins/api-routes.mdx`, lignes 8–55 et 84–97](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/plugins/creating-plugins/api-routes.mdx#L8-L97)
[^plugin-route-auth]: [`docs/src/content/docs/plugins/creating-plugins/api-routes.mdx`, lignes 99–134 et 159–173](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/plugins/creating-plugins/api-routes.mdx#L99-L173)
[^plugin-route-user]: [`docs/src/content/docs/plugins/creating-plugins/api-routes.mdx`, lignes 136–157](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/plugins/creating-plugins/api-routes.mdx#L136-L157)
[^plugin-mcp]: [`docs/src/content/docs/plugins/creating-plugins/api-routes.mdx`, lignes 175–211](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/plugins/creating-plugins/api-routes.mdx#L175-L211)
[^plugin-settings]: [`docs/src/content/docs/plugins/creating-plugins/settings.mdx`, lignes 8–25, 66–162 et 190–230](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/plugins/creating-plugins/settings.mdx#L8-L230)
[^react-settings]: [`docs/src/content/docs/plugins/creating-native-plugins/react-admin.mdx`, lignes 398–411](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/plugins/creating-native-plugins/react-admin.mdx#L398-L411)
[^plugin-storage]: [`docs/src/content/docs/plugins/creating-plugins/storage.mdx`, lignes 8–92 et 279–315](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/plugins/creating-plugins/storage.mdx#L8-L315)
[^plugin-storage-migrations]: [`docs/src/content/docs/plugins/creating-plugins/storage.mdx`, lignes 296–320](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/plugins/creating-plugins/storage.mdx#L296-L320)
[^block-kit]: [`docs/src/content/docs/plugins/creating-plugins/block-kit.mdx`, lignes 8–25 et 77–105](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/plugins/creating-plugins/block-kit.mdx#L8-L105)
[^react-admin]: [`docs/src/content/docs/plugins/creating-native-plugins/react-admin.mdx`, lignes 8–64, 168–225 et 227–333](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/plugins/creating-native-plugins/react-admin.mdx#L8-L333)
[^react-visibility-not-auth]: [`docs/src/content/docs/plugins/creating-native-plugins/react-admin.mdx`, lignes 256–261 et 325–333](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/plugins/creating-native-plugins/react-admin.mdx#L256-L333)
[^plugin-disable-semantics]: [`docs/src/content/docs/plugins/creating-native-plugins/react-admin.mdx`, lignes 459–473](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/plugins/creating-native-plugins/react-admin.mdx#L459-L473)
[^portable-text-components]: [`docs/src/content/docs/plugins/creating-native-plugins/portable-text-components.mdx`, lignes 8–70 et 92–100](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/plugins/creating-native-plugins/portable-text-components.mdx#L8-L100)
[^page-fragments]: [`docs/src/content/docs/plugins/creating-native-plugins/page-fragments.mdx`, lignes 8–35 et 37–68](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/plugins/creating-native-plugins/page-fragments.mdx#L8-L68)
[^themes]: [`docs/src/content/docs/themes/creating-themes.mdx`, lignes 8–48 et 158–166](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/themes/creating-themes.mdx#L8-L166)
[^page-layouts]: [`docs/src/content/docs/guides/page-layouts.mdx`, lignes 8–16 et 96–144](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/guides/page-layouts.mdx#L8-L144)
[^preview]: [`docs/src/content/docs/guides/preview.mdx`, lignes 8–37 et 39–71](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/guides/preview.mdx#L8-L71)
[^snapshot-route]: [`packages/core/src/astro/routes/api/snapshot.ts`, lignes 1–8 et 93–103](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/core/src/astro/routes/api/snapshot.ts#L1-L103)
[^snapshot]: [`packages/core/src/api/handlers/snapshot.ts`, lignes 141–208 et 220–367](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/core/src/api/handlers/snapshot.ts#L141-L367)
[^backup-implementation]: [`packages/core/src/api/handlers/backup.ts`, lignes 1–18 et 106–130](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/packages/core/src/api/handlers/backup.ts#L1-L130)
[^backup-contents]: [`docs/src/content/docs/guides/backups.mdx`, lignes 8–27](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/guides/backups.mdx#L8-L27)
[^backup-restore]: [`docs/src/content/docs/guides/backups.mdx`, lignes 65–103](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/guides/backups.mdx#L65-L103)
[^core-migrations]: [`docs/src/content/docs/deployment/core-migrations.mdx`, lignes 8–48 et 167–193](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/deployment/core-migrations.mdx#L8-L193)
[^plugin-install]: [`docs/src/content/docs/plugins/installing.mdx`, lignes 8–72 et 100–166](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/plugins/installing.mdx#L8-L166)
[^registry-experimental]: [`docs/src/content/docs/plugins/registry.mdx`, lignes 8–18](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/plugins/registry.mdx#L8-L18)
[^registry-trust]: [`docs/src/content/docs/plugins/registry.mdx`, lignes 81–104](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/plugins/registry.mdx#L81-L104)
[^plugin-version-immutable]: [`docs/src/content/docs/plugins/creating-plugins/publishing.mdx`, lignes 121–136](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/plugins/creating-plugins/publishing.mdx#L121-L136)
[^plugin-bundle-limits]: [`docs/src/content/docs/plugins/creating-plugins/publishing.mdx`, lignes 80–98](https://github.com/emdash-cms/emdash/blob/1717d31b351164a5f78e95fe004ee582c7c50f40/docs/src/content/docs/plugins/creating-plugins/publishing.mdx#L80-L98)
