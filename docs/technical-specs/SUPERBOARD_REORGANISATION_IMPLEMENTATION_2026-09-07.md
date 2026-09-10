# Réorganisation de SuperBoard : implémentation et mise en service

> Document historique : les constats et les chemins ci-dessous décrivent un état antérieur du dépôt. Certains composants ont été déplacés ou retirés. Pour l’organisation actuelle, consulter le [guide du monorepo](../MONOREPO.md).

SuperBoard conserve le socle BaaS de Vplusflare. La console organise les fonctionnalités par usage, les environnements possèdent une configuration de déploiement distincte et Vocostar dispose d’un plugin concret. Le dépôt contient le générateur des services regroupés et les étapes de préparation de leur bascule.

Cette implémentation est vérifiée localement. Aucun domaine, secret, worker ou jeu de données de production n’a été modifié pendant ce travail. Les comptes de déploiement et les ressources Vocostar doivent être vérifiés avant la mise en service.

## Navigation et vues

La barre latérale affiche Vue d’ensemble, Utilisateurs et accès, Données et contenus, Ventes et abonnements, Communication, Parcours et automatisations, Statistiques et les plugins applicatifs actifs. Paramètres, Exploitation et Plugins sont séparés des rubriques métier.

Un seul groupe peut être développé. Le mode réduit conserve les pictogrammes ; choisir un groupe redéploie ses liens. Les pages détaillées du support, des liens, de la connexion et des autres sections sont accessibles par navigation locale. Les URL et identifiants des fonctionnalités existantes sont conservés.

L’accueil utilise `/superboard-system/home` et reste accessible sans le plugin Statistiques. `/dashboard` conserve son rôle de vue statistique existante. Le menu `superboard-admin`, visible dans EmDash sous **Navigation du front** pour le français et **Front navigation** pour l’anglais, fournit les libellés, l’ordre, les groupes et les sous-menus. La projection filtre les permissions et les routes des plugins actifs ; elle ne rajoute pas les entrées supprimées dans EmDash. Les menus déjà personnalisés sont conservés lors de la mise à niveau. La mise à niveau du bootstrap des vues ajoute les nouvelles vues sans remplacer les personnalisations existantes.

La page push filtre les notifications côté serveur. La recherche accepte les longues chaînes littérales et conserve les motifs courts existants, dans la [limite D1 de 50 octets pour les motifs LIKE](https://developers.cloudflare.com/d1/platform/limits/).

Le catalogue passe de 121 à **127 vues enregistrées** : cinq vues Vocostar et une page de notifications push. Les menus possèdent des textes français et anglais. La couverture des vues est distincte : certaines vues historiques contiennent encore des textes anglais sans traduction française. L’arabe est retiré des choix de langue du front à la demande de l’utilisateur. Les préférences arabes du front sont ignorées au profit d’une langue prise en charge. Les langues d’EmDash Admin sont conservées.

Le front propose désormais un sélecteur de langue dans la barre supérieure. Le choix est conservé dans le navigateur lors des changements de page, des rechargements et du passage par la connexion. Les liens et paramètres Identity suivent ce choix, même lorsqu'une ancienne URL contient `/en/`. EmDash Admin conserve son réglage séparé, dans **Paramètres → Langue**. Les résumés de plugins se rechargent lorsque cette langue change. Les 16 vues Analytics disposent désormais de textes français et anglais, y compris les filtres, notifications et formats de dates et de nombres.

Vérifications du 8 septembre : 116 tests unitaires du site, 39 tests de composants du front, 34 tests Analytics/Support, deux tests du rechargement des pages Block Kit, un test du plugin compilé dans un contexte sans variables Node, et trois scénarios HTTP de session/langue passent. Les vérifications de types du site, de l’admin et des deux packages de plugins/front passent ; le lint rapide ne rapporte aucun diagnostic. Le lint complet initial conserve un avertissement préexistant dans `packages/core/src/astro/integration/vite-config.ts`. Le navigateur confirme le sélecteur FR/EN, la navigation arabe RTL avec repli anglais, le tableau de bord Analytics français et le maintien du français dans Identity malgré une URL `/en/`.

La page native `/_emdash/admin/plugins/supbrd-plugmod-analytics` reste un résumé technique du plugin. Elle ne monte pas les vues métier accessibles sous `/analytics`. Ces corrections de langue ne constituent donc pas une intégration complète de ces vues dans le menu et les pages natives d’EmDash Admin.

Sources : [shell](../../apps/site/src/components/NativeFrontApp.tsx), [accordéon](../../apps/site/src/components/NativeFrontNavigation.tsx), [organisation et traductions](../../apps/site/src/lib/product-navigation.ts), [bootstrap](../../apps/site/src/lib/superboard-views.ts).

## Accès à EmDash Admin et à la console

Le site Astro sert l’administration native EmDash et les vues React de SuperBoard. La console opérateur utilise la session EmDash et exige un compte actif possédant `settings:manage`, comme ses API. Un utilisateur connecté sans cette permission reçoit `403` ; un visiteur sans session est redirigé vers la connexion EmDash. Le garde s’applique aussi à l’accueil avant la première release et aux prévisualisations. Les routes de connexion publiques conservent leur accès anonyme.

Le diagnostic local a reproduit une administration vide alors que le front était accessible. Une reproduction à froid a ensuite identifié une collision de cache : `astro check` utilisait le même répertoire Vite que le serveur actif et supprimait des dépendances encore référencées par celui-ci. Le site sépare les caches `dev`, `sync`, `build` et `preview`. Le contrôle de démarrage vérifie le HTML natif contenant `admin-root` ; un simple HTTP `200` vide ne suffit plus.

La validation couvre 104 tests unitaires du site, 9 tests de démarrage et un test HTTP de connexion/déconnexion commun au back-office et au front. La reproduction « serveur frais → typecheck → premier accès à l’administration » échoue avant la séparation des caches et passe après. Le typecheck du site passe sans erreur. Le lint complet conserve l’avertissement antérieur dans `packages/core/src/astro/integration/vite-config.ts` ; le lint rapide est propre.

Sources : [garde opérateur](../../apps/site/src/lib/operator-access.ts), [résolution des pages](../../apps/site/src/lib/front-page.ts), [isolation du cache](../../apps/site/runtime-cache.mjs), [contrôle local](../../tests/e2e/site/console.mjs), [test de session partagée](../../tests/e2e/site/auth/admin-session.spec.ts).

## Environnements

Le contexte affiché identifie l’application, le déploiement et l’adresse API. Le choix historique Production/Test est nommé « Données du projet ». Changer d’environnement ouvre sa console déclarée ; la nouvelle session et les autorisations sont établies sur cette destination. Les vues sont également remontées au changement de projet afin de ne pas réutiliser l’état de formulaire du projet précédent.

Un environnement peut redéfinir `domains`, `applicationIdentity`, `oauth`, `authGateway`, `mail`, `filePolicy` et `operator` dans le manifeste de cible. `plugins` contient les désactivations propres à cet environnement. Les paramètres non redéfinis proviennent du manifeste de l’application.

La validation refuse le partage d’un domaine API, d’un domaine d’authentification, d’une console, d’un worker ou d’un stockage d’identité entre deux environnements déployés d’une même cible. Le mode local reste compatible avec les outils de développement existants. Les liens de console supplémentaires se déclarent dans `consoleEnvironments` ; les destinations doivent être des origines HTTPS valides.

Sources : [matérialisation par environnement](../../scripts/cloudflare/target-environments.mjs), [schéma](../../infra/targets/schema.json), [validation du contexte de console](../../apps/site/src/lib/deployment-context.ts).

## Plugin Vocostar

Le plugin `supbrd-plugmod-vocostar` déclare sa compatibilité, son stockage, ses commandes, ses lectures et ses réglages dans [son manifeste](../../plugins/vocostar/plugin.json). Il possède les vues Voix, Conversions, Fichiers générés, Traitements en cours et Configuration.

Les listes et relances administratives vérifient le projet. Une relance ne peut pas cibler le job d’un autre projet. Les points d’entrée SDK historiques restent disponibles et passent par l’admission du plugin configuré. Un worker custom de référence ne peut pas satisfaire le contrôle de disponibilité de Vocostar.

Les réglages sont conservés par EmDash dans l’environnement. L’API lit un instantané authentifié lors d’une création de job ; les champs secrets sont exclus. Le worker applique les capacités activées, les langues, la longueur maximale du texte et, lorsqu’il est configuré, le coût de conversion. Le rejeu d’une requête existante conserve son identité et son résultat après un changement de réglages.

La valeur de coût laissée vide conserve le contrat de tarification historique. Les fournisseurs, ressources, modèles de conteneurs et paramètres de déploiement restent déclarés dans la cible. Les données métier et pipelines Vocostar existants sont conservés ; ce changement ne remplace pas la migration de leurs données historiques.

Sources : [vues](../../packages/supbrd-runtime-plugins/src/front/client/plugins/supbrd-plugmod-vocostar), [façade administrative](../../packages/plugins/supbrd-core/api/src/routes/application-module-admin.ts), [réglages exécutés](../../workers/custom/vocostar/src/settings.ts), [worker métier](../../workers/custom/vocostar/src/index.ts).

## Callbacks et WebSockets Vocostar

Le bridge reçoit les callbacks historiques `/internal/notify`, `/ws/vocals/notify`, `/ws/vocals/progress` et `/ws/medias/progress`, ainsi que `/ws/medias/notify`. L’API transmet les requêtes au worker Vocostar en supprimant les en-têtes de portée internes fournis par le client. Le worker vérifie `X-VocoStar-Internal-Token` contre `VOCOSTAR_INTERNAL_CALLBACK_TOKEN`. Le secret doit correspondre à `GATEWAY_INTERNAL_TOKEN` des orchestrateurs et au secret `INTERNAL_CALLBACK_TOKEN` de la passerelle historique. Les callbacks restent accessibles aux producteurs authentifiés après désactivation du plugin pour terminer les jobs acceptés.

Les connexions historiques `GET /ws/vocals` et `GET /ws/medias` conservent les JWT HS256 transmis par `Authorization: Bearer` ou `?token=`. Le bridge vérifie la signature, le format et l’expiration avec `VOCOSTAR_LEGACY_JWT_SECRET`, qui doit correspondre au `JWT_SECRET` historique. Les deux secrets du bridge acceptent un équivalent optionnel suffixé `_PREVIOUS` pendant une rotation. Les SDK disposent également de `/api/v1/sdk/custom/v1/ws/vocals` et `/api/v1/sdk/custom/v1/ws/medias`, avec leurs identifiants SDK et un jeton d’identité applicative vérifié. L’admission du plugin s’applique aux nouvelles connexions.

La migration [0005](../../workers/custom/vocostar/migrations/0005_runtime_identity_bridge.sql) lie chaque utilisateur historique à un projet et un sujet applicatif. Elle reprend les utilisateurs dont les jobs existants appartiennent à un seul projet ; les autres associations doivent être établies explicitement. Un administrateur de niveau 50 peut appeler `PUT /api/v1/plugins/vocostar/projects/{projectRef}/runtime-identities` par le bridge opérateur EmDash, avec `{"legacyUserId":"identifiant-historique","subject":"sujet-applicatif"}`. Le projet provient de la route autorisée. Répéter la même association est sans effet ; changer une association existante ou utiliser un utilisateur ayant des jobs dans plusieurs projets est refusé. Les progressions vérifient également le propriétaire de la voix ou du média et, si présent, l’identifiant du job.

Les liaisons `VOCOSTAR_USER_VOCALS_ROOM` et `VOCOSTAR_USER_MEDIAS_ROOM` pointent vers les classes et espaces existants de `api-auth-gateway`. Les connexions déjà ouvertes et celles établies par le bridge utilisent ainsi le même objet par utilisateur. Le compilateur refuse une configuration qui change ce propriétaire. La passerelle historique reste nécessaire comme hôte des objets et pour ses autres routes applicatives. Les notifications utilisent toujours `intern-pipeline-dispatcher` ; une erreur de ce service est renvoyée au producteur pour permettre une reprise.

Les orchestrateurs et conteneurs transmettent `project_ref`, `job_id` et `subject` lorsqu’ils sont fournis. Un ancien identifiant de queue n’est pas transformé en identifiant de job SuperBoard. Les erreurs HTTP des callbacks déclenchent les reprises configurées dans les Workflows ; si toutes les tentatives échouent, le résultat du traitement terminé est conservé et l’échec de notification est journalisé.

Sources : [bridge](../../workers/custom/vocostar/src/runtime-bridge.ts), [associations d’identité](../../workers/custom/vocostar/src/runtime-identity.ts), [façade API](../../packages/plugins/supbrd-core/api/src/routes/vocostar-runtime.ts), [tests des connexions et callbacks](../../workers/custom/vocostar/runtime-tests/runtime-bridge.runtime.test.ts), [tests API avec D1](../../scripts/vocostar-api-runtime.test.mjs).

## Services regroupés

Le profil `consolidated` produit les déploiements ci-dessous. Les identifiants des modules restent stables.

| Service          | Modules                                                       |
| ---------------- | ------------------------------------------------------------- |
| Console          | Site                                                          |
| API              | API, App, Products, Paywalls, Onboardings, Dynamic Links, MCP |
| Authentification | Identity                                                      |
| Fichiers         | Files                                                         |
| Paiements        | Billing                                                       |
| Communication    | Email, Marketing et transport push                            |
| Automatisations  | Flows                                                         |
| Service client   | Support                                                       |
| Statistiques     | Analytics                                                     |
| Supervision      | Observability                                                 |

Le profil complet comporte **10 services communs**, auxquels s’ajoutent les extensions. MBZA en déclare 11 avec son extension de référence. La cible Vocostar en déclare également 11 avec Analytics et Flows désactivés, son adaptateur custom et ses deux orchestrateurs. Ces chiffres décrivent les plans générés ; ils ne sont pas un comptage des workers actuellement déployés dans les comptes Cloudflare. La passerelle historique Vocostar reste une dépendance externe tant que sa bascule n’est pas validée.

Chaque module reçoit ses propres bindings et variables. Les secrets des modules regroupés utilisent un préfixe, par exemple `EMAIL__EMAIL_INTERNAL_TOKEN` et `MARKETING__INTERNAL_API_TOKEN`. Le manifeste de déploiement indique le worker et le nom de secret d’origine. Le regroupement conserve les liaisons de stockage de chaque module. Le transport push conserve son stockage et son contrat de chiffrement existants.

Le générateur conserve les politiques de queues et produit les transferts de consommateurs. Il refuse les collisions de consommateurs, les runtimes incompatibles et le déplacement implicite des Durable Objects. Les interfaces privées utilisent des points d’entrée nommés. Les shells d’initialisation déclarent ces points d’entrée avant le déploiement des dépendants.

Sources : [compilateur](../../scripts/cloudflare/deployment-groups.mjs), [génération et déploiement](../../scripts/cloudflare/consolidate.mjs), [déploiement complet](../../scripts/cloudflare/deploy-all.mjs), [initialisation](../../scripts/cloudflare/worker-shells.mjs).

## Préparation du déploiement

Générer et examiner le plan d’une cible constitue la première étape.

```bash
rtk proxy node scripts/cloudflare/deploy-all.mjs --target mbza-development --environment development --plan
rtk proxy node scripts/cloudflare/consolidate.mjs --target mbza-development --environment development --preflight --allow-unprovisioned
```

La génération écrit les configurations, les interfaces d’exécution et un manifeste sous `infra/generated/`. Le manifeste liste les services, les secrets à reprendre, les transferts de queues et les anciens workers candidats au retrait. `--allow-unprovisioned` sert à la validation des configurations ; le déploiement normal exige les ressources réelles.

Le déploiement complet respecte les contrôles existants sur les migrations, les sauvegardes, l’identité et le routage. Avant les migrations, il vérifie la présence des secrets des services regroupés. Les secrets déjà configurés dans Cloudflare n’ont pas à être fournis de nouveau. Lors du premier passage, les valeurs manquantes doivent être provisionnées à partir des sources de secrets de l’environnement.

Lors d’une mise à niveau, les configurations de préparation exposent les nouvelles interfaces tout en conservant les anciennes liaisons. Les consommateurs de queues sont ensuite transférés après vérification de leur propriétaire. Les configurations finales basculent les liaisons. Le marqueur de déploiement permet aux mises à jour suivantes de reconnaître un regroupement déjà effectué. Une répartition de trafic entre plusieurs versions doit être terminée avant cette opération.

La préparation conserve les routes, queues et crons du worker physique existant. Le déploiement lit le marqueur de la version active et reprend chaque groupe selon son état, y compris lorsqu’un transfert de queue a été interrompu. Les crons des anciens workers sont retirés juste avant l’activation finale du groupe ; un échec de retrait arrête la publication. Les secrets fournis sont associés à la version publiée ou chargée avec `--secrets-file`, puis le fichier temporaire est supprimé, même après un échec. Le mode `upload-only` ne publie pas une rotation de secrets sur la version active.

`--initial-install` réserve le parcours d’installation initiale aux environnements préparés à cet effet. `--legacy-layout` conserve le parcours historique pour une récupération ciblée. Les outils historiques de gestion par worker continuent d’utiliser les identifiants logiques ; utiliser le manifeste consolidé pour connaître les noms et les secrets des déploiements regroupés.

Le retrait des anciens workers est séparé de la publication : vérifier le drainage, les consommateurs, les crons, les liaisons et les domaines avant suppression. Le générateur ne supprime aucun worker ni aucune donnée.

## Compatibilité des releases

Les migrations [0026](../../apps/site/migrations/0026_previous_plugin_manifests.sql) et [0027](../../apps/site/migrations/0027_reorganisation_plugin_manifests.sql) conservent les manifestes précédents et enregistrent les manifestes de cette réorganisation. Les anciennes migrations ne sont pas modifiées.

Le registre de compatibilité conserve les checksums des renderers précédents. Une release existante peut continuer à utiliser un renderer reconnu ; un checksum inconnu reste refusé. La génération des artefacts est assurée par `scripts/emdash/parity-generate.mjs` et refuse la modification d’une migration publiée.

## Vérifications et limites de mise en service

Les vérifications locales couvrent l’accordéon et la navigation mobile, le rendu RTL, la conservation des vues et personnalisations, l’isolation de l’environnement, les stores et le cycle de vie des plugins, les relances Vocostar par projet, la séparation des bindings dans un worker et les plans de déploiement. Les builds du socle, des plugins et du site ont été exécutés. Les bundles API et Communication ont été validés avec Wrangler en mode dry-run.

Le lint rapide est utilisé sur les changements. Le lint complet conserve un avertissement antérieur dans `packages/core/src/astro/integration/vite-config.ts`. La commande globale de typecheck rencontre également les erreurs antérieures du package `create-emdash` ; les contrôles ciblés portent sur les composants et workers modifiés.

Le manifeste de production Vocostar conserve son `runtimeBridge` bloqué et son routage en préparation. Le code des callbacks et connexions est présent et testé localement. Avant une bascule publique, vérifier les associations d’identité réelles, les secrets partagés, les liaisons vers les Durable Objects et le dispatcher historiques, les ressources non renseignées, les tickets Files et le drainage. Remplacer tout le domaine `api.vocostar.com` nécessite également de préserver ses autres routes historiques d’authentification et de données ; le bridge décrit ici n’autorise pas leur retrait. Aucun déploiement de production n’a été effectué.

La reprise du 8 septembre valide 27 tests runtime et 11 tests unitaires du worker Vocostar, 6 tests de façade API, 31 tests ciblés de configuration/consolidation, 16 tests des orchestrateurs et 2 tests Python de callbacks avec un serveur HTTP local. Les contrôles de types de l’API, du worker Vocostar et de ses deux orchestrateurs passent. Les suites sont exécutées séquentiellement après un incident de mémoire provoqué par plusieurs lints complets simultanés. Pour reproduire les tests Node sans parallélisme entre fichiers, utiliser `NODE_OPTIONS=--max-old-space-size=768 node --test --test-concurrency=1` suivi des fichiers concernés ; pour Vitest, utiliser `--maxWorkers=1 --no-file-parallelism`. Ces plafonds concernent Node, pas la mémoire totale de la machine. `cloudflare:test:targets` exécute également ses fichiers de test un à un et inclut les tests de consolidation et du bridge.

Deux tests supplémentaires de migration vérifient la conservation de 20 001 jobs et des crédits, le refus des associations ambiguës et la reprise après chaque instruction DDL terminée. Le lint ciblé des fichiers de cette reprise passe. Les configurations générées de l’API regroupée, de Communication et du worker Vocostar passent les builds Wrangler `--dry-run`, avec les espaces de Durable Objects historiques conservés.

L’[inventaire initial](./SUPERBOARD_FONCTIONNALITES_2026-09-07.md) reste la photographie fonctionnelle antérieure ; le catalogue contient 19 plugins concrets, 127 vues, 134 commandes et 122 sources de données déclarées, modèle custom inclus pour les deux derniers nombres.

Le contrôle `pnpm lint:front-menu`, intégré aux lints normal, rapide et JSON, bloque les destinations et groupes codés en dur dans la navigation cliente, l’absence de lecture du menu natif, l’oubli de la langue du front et le réajout de destinations depuis la release. La vérification locale du 8 septembre a modifié temporairement un libellé dans l’éditeur EmDash, constaté sa propagation sur le front après rechargement, puis restauré le libellé initial.
