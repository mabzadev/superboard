# Fonctionnalités présentes dans SuperBoard

> Document historique : les constats et les chemins ci-dessous décrivent un état antérieur du dépôt. Certains composants ont été déplacés ou retirés. Pour l’organisation actuelle, consulter le [guide du monorepo](../MONOREPO.md).

Le [compte rendu de réorganisation](./SUPERBOARD_REORGANISATION_IMPLEMENTATION_2026-09-07.md) décrit les ajouts intervenus après cet inventaire initial.

Inventaire du checkout examiné le 7 septembre 2026, associé à la [proposition de réorganisation](./SUPERBOARD_REORGANISATION_PROPOSITION_2026-09-07.md).

« Présent » signifie qu’un code, une route, un écran ou un contrat existe dans le dépôt. Ce document ne certifie pas que toutes les opérations fonctionnent de bout en bout ni que tous les services sont déployés. Les suites de tests métier et les comptes Cloudflare n’ont pas été audités en exécution pendant cette étude. Un champ `ready` dans une topologie est une déclaration du catalogue, pas un health check effectué ici.

Le périmètre comprend les fonctionnalités SuperBoard, le custom Vocostar, les capacités EmDash conservées dans le socle et les SDK. Les plugins d’exemple et outils de migration sont identifiés séparément. L’annexe des vues est exhaustive par rapport aux 121 entrées du catalogue front, y compris les pages de détail, d’authentification et les routes de transition. Une vue n’équivaut pas à une fonctionnalité indépendante.

## Socle et administration

Les fonctionnalités suivantes sont présentes dans les sources du socle et du site.

| Domaine                     | Fonctionnalités relevées                                                                                                                                                                                                  | Sources                                                                                                                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Console opérateur           | Connexion, invitations, récupération d’accès, compte et profil opérateur, déconnexion, sélection du projet Production/Test, thème clair/sombre, barre réduite et navigation mobile                                        | [Plugin utilisateur](../../packages/plugins/supbrd-plug-identity/src/front-user.ts), [contrôles](../../apps/site/src/components/NativeFrontControls.tsx), [shell](../../apps/site/src/components/NativeFrontApp.tsx)                                      |
| Composition du front        | Routes et pages déclarées, layouts, renderers, sources de données et commandes, permissions, paramètres d’URL, textes traduits, thèmes et états d’erreur/indisponibilité                                                  | [Contrats du socle](../../packages/supbrd-core/src/contracts.ts), [rendu](../../packages/supbrd-core/src/native-front.ts)                                                                                                                                 |
| Publication du front        | Compilation, contrôles de cohérence, checksum, signatures, prévisualisation, approbation, activation de release et rollback                                                                                               | [Compilateur](../../packages/supbrd-core/src/release-compiler.ts), [workflow](../../packages/supbrd-core/src/front-workflow.ts), [activation](../../packages/supbrd-core/src/front-activation.ts), [pages console](../../apps/site/src/pages/_superboard) |
| Cycle de vie des plugins    | Catalogue, installation par instance/cible, vérification d’artefact et de dépendances, migrations et ressources, activation, drainage, désactivation, quarantaine, purge et conservation de réglages                      | [Catalogue et transitions](../../apps/site/src/lib/superboard-plugin-catalog.ts), [opérations](../../apps/site/src/lib/managed-plugin-operation.ts)                                                                                                       |
| Paramètres de l’application | Paramètres effectifs et versions, projets, identifiants clients, clés d’accès, configuration et tests SDK Web/iOS/Android, bibliothèque d’intégration                                                                     | [Plugin paramètres](../../packages/plugins/supbrd-core/src/front-settings.ts), [App](../../packages/plugins/supbrd-core/app/src/index.ts), [projets](../../packages/plugins/supbrd-core/api/src/routes/projects.ts)                                       |
| Déploiements                | Manifestes par cible, environnements local/développement/production, noms de services, domaines, bindings, activation de modules, ressources D1/KV/R2/Queues, génération de configuration                                 | [Cibles](../../infra/targets), [registre](../../scripts/cloudflare/services.mjs)                                                                                                                                                                          |
| API BaaS                    | Routes applicatives et opérateur, contexte projet, façade SDK, versions v1/v2, routage vers les modules, politiques d’accès et limites de requêtes                                                                        | [Entrée API](../../packages/plugins/supbrd-core/api/src/index.ts), [Gateway](../../packages/plugins/supbrd-core/api/src/routes/gateway-admin.ts)                                                                                                          |
| Audit et exploitation       | Journal vérifiable et archivage, état plateforme et services, latences, métriques d’exécution, incidents, accusé de prise en charge/résolution, traitements custom et e-mails en échec, suivi des suppressions de comptes | [Audit](../../packages/plugins/supbrd-core/src/audit.ts), [plateforme](../../packages/plugins/supbrd-core/api/src/routes/platform-status.ts), [supervision](../../packages/plugins/supbrd-core/observability/src/index.ts)                                |
| Assistants IA / MCP         | Outils opérateur, OAuth et consentement, jetons et révocation, sessions et traces d’appels, transport Streamable HTTP stateless                                                                                           | [MCP](../../packages/plugins/supbrd-core/mcp/src/index.ts), [OAuth](../../packages/plugins/supbrd-core/api/src/routes/mcp-oauth.ts), [plugin](../../packages/plugins/supbrd-core/src/front/mcp)                                                           |

## Utilisateurs et authentification

L’identité opérateur EmDash, les comptes applicatifs et le moteur Identity/Melody ont des surfaces distinctes. Les regrouper dans le menu ne doit pas mélanger leurs jetons ni leurs autorisations.

| Domaine               | Fonctionnalités relevées                                                                                                                     | Sources                                                                                                                                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Comptes applicatifs   | Annuaire, profils, membres, suspension, rattachement de fournisseurs et révocation de sessions ; utilisateurs/profils clients et parrainages | [Contrats utilisateur](../../packages/plugins/supbrd-plug-identity/src/user.ts), [administration](../../packages/plugins/supbrd-core/api/src/routes/application-users-admin.ts), [App](../../packages/plugins/supbrd-core/app/src/index.ts) |
| Connexion applicative | Inscription, e-mail/mot de passe, Google, Apple, sessions, validation/échange de jetons, paramètres d’inscription et audiences               | [Identity](../../packages/plugins/supbrd-plug-identity/worker/src/index.ts), [runtime](../../packages/plugins/supbrd-plug-identity/worker/src/melody-runtime.ts)                                                                            |
| Gestion des accès     | Rôles, permissions API/scopes, applications OAuth, organisations et groupes, attributs utilisateur, SAML SSO, politiques de comptes          | [Routeur Identity](../../packages/plugins/supbrd-plug-identity/worker/src/melody/router.tsx), [vues](../../packages/plugins/supbrd-plug-identity/src/front-user.ts)                                                                         |
| Sécurité de connexion | MFA e-mail, OTP et SMS dans le moteur embarqué, règles d’enrôlement et de secours, journaux de connexion/e-mail/SMS                          | [MFA](../../packages/plugins/supbrd-plug-identity/worker/src/melody/services/mfa.ts), [Identity](../../packages/plugins/supbrd-plug-identity/worker/src/melody)                                                                             |
| Suppression de compte | Orchestration durable des suppressions dans les modules, reprise après échec, isolation de l’utilisateur, suivi administratif                | [Route SDK](../../packages/plugins/supbrd-core/api/src/routes/account-sdk.ts), [orchestration](../../packages/plugins/supbrd-core/api/src/lib/account-erasure.ts)                                                                           |

Les fournisseurs de connexion, e-mail et SMS nécessitent une configuration effective. Leur code et leurs réglages ne prouvent pas qu’ils sont activés sur une cible donnée.

## Ventes et abonnements

Le catalogue et la facturation conservent des contrats distincts ; les écrans doivent relier le produit, son achat et le droit accordé.

| Domaine             | Fonctionnalités relevées                                                                                                                       | Sources                                                                                                                                                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalogue           | Produits, packages/groupes, offres, prix, droits, création, modification et archivage, synchronisation du catalogue des stores et statistiques | [Topologie Products](../../scripts/config/emdash-plugin-topology.json), [runtime Products](../../packages/plugins/supbrd-plug-commerce/products/src/index.ts)                                                                                 |
| Achats              | Validation Apple/Google, achats vérifiés, clients payants, droits accordés, restauration, registre financier et signatures de réponses d’achat | [API achats v2](../../packages/plugins/supbrd-core/api/src/routes/purchases-v2-sdk.ts), [Billing](../../packages/plugins/supbrd-plug-commerce/billing/src/index.ts)                                                                           |
| Abonnements         | État et événements des abonnements, rapprochement avec les stores, notifications fournisseurs et rejeu d’événements                            | [Webhooks](../../packages/plugins/supbrd-core/api/src/routes/purchases-provider-webhooks.ts), [API administrative](../../packages/plugins/supbrd-core/api/src/routes/purchases-v2-admin.ts)                                                   |
| Remboursements      | Création et suivi, statuts Apple, remboursements Google, reprises de jobs financiers et opérations en échec                                    | [Remboursements](../../packages/plugins/supbrd-core/api/src/lib/refunds.ts), [Google](../../packages/plugins/supbrd-core/api/src/lib/google-voided-purchases.ts), [Billing](../../packages/plugins/supbrd-plug-commerce/billing/src/index.ts) |
| Écrans d’abonnement | Définitions, éditeur, versions, publication, emplacements, expériences/variantes, événements d’exposition et statistiques                      | [Paywalls](../../packages/plugins/supbrd-plug-commerce/paywalls/src/index.ts), [plugin](../../packages/plugins/supbrd-plug-commerce/src/front/paywalls)                                                                                       |

## Communication et service client

Le code couvre les communications transactionnelles, les campagnes et les conversations de support. L’ancien Messaging subsiste comme code historique et est désactivé dans les deux manifestes examinés.

| Domaine                 | Fonctionnalités relevées                                                                                                                             | Sources                                                                                                                                                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E-mails transactionnels | Paramètres SMTP, tests et vérification de domaine, envoi, capture de développement, tentatives, reprises, file d’échec et événements de fournisseurs | [Email](../../packages/plugins/supbrd-plug-communication/email/src/index.ts), [écran E-mail](../../packages/plugins/supbrd-plug-communication/src/front/email/EmailPage.tsx)                                                                              |
| Notifications push      | Cibles et jetons d’appareils, envoi et traitement, configuration des identifiants FCM/APNs, état de boîte de réception                               | [Push](../../packages/plugins/supbrd-core/api/src/routes/push.ts), [SDK](../../packages/plugins/supbrd-core/api/src/routes/sdk.ts), [identifiants](../../packages/plugins/supbrd-core/api/src/lib/push-credentials.ts)                                    |
| E-mail marketing        | Abonnés, listes, segments, modèles, campagnes/newsletters, planification et transitions d’état, statistiques, médias                                 | [Marketing](../../packages/plugins/supbrd-plug-communication/marketing/src/index.ts), [sources et commandes](../../scripts/config/emdash-plugin-topology.json)                                                                                            |
| Consentement            | Préférences newsletter, consentements, identité marketing, désabonnements et suivi                                                                   | [Préférences SDK](../../packages/plugins/supbrd-core/api/src/routes/marketing-sdk.ts), [tracking](../../packages/plugins/supbrd-plug-communication/marketing/src/tracking.ts)                                                                             |
| Parcours marketing      | Définition et mise à jour de parcours, activation, inscriptions, progression et statistiques, connecteurs de canaux                                  | [Parcours](../../packages/plugins/supbrd-plug-communication/marketing/src/journeys.ts), [vues](../../packages/plugins/supbrd-plug-communication/src/front-marketing.ts)                                                                                   |
| Messages intégrés       | Édition et prévisualisation des messages dans l’application, rattachement aux campagnes et aux canaux                                                | [Vues marketing](../../packages/plugins/supbrd-plug-communication/src/front-marketing.ts)                                                                                                                                                                 |
| Liens et attribution    | Liens courts, campagnes de liens, domaines et vérification, règles de redirection, aperçus sociaux, paramètres de suivi et statistiques de clics     | [Dynamic Links](../../packages/plugins/supbrd-plug-communication/dynamic-links/src/index.ts), [plugin](../../packages/plugins/supbrd-plug-communication/src/front-dynamic-links.ts)                                                                       |
| Conversations           | Boîte de réception unifiée, contacts, conversations, messages, pièces jointes, canaux et temps réel                                                  | [Support](../../packages/plugins/supbrd-plug-support/worker/src/index.ts), [ConversationRoom](../../packages/plugins/supbrd-plug-support/worker/src/conversation-room.ts), [realtime](../../packages/plugins/supbrd-plug-support/worker/src/realtime.ts)  |
| Équipe support          | Agents/équipes, affectation et règles automatiques, notifications, service levels, qualité/CSAT, rapports et configuration                           | [Automatisations](../../packages/plugins/supbrd-plug-support/worker/src/workflows.ts), [service levels](../../packages/plugins/supbrd-plug-support/worker/src/service-levels.ts), [vues](../../packages/plugins/supbrd-plug-support/src/front-support.ts) |
| Aide et IA              | Portails, catégories, dossiers, articles et publication, index de connaissances, assistant IA « Captain », support proactif                          | [Connaissances](../../packages/plugins/supbrd-plug-support/worker/src/knowledge.ts), [assistant](../../packages/plugins/supbrd-plug-support/worker/src/captain.ts), [plugin](../../packages/plugins/supbrd-plug-support/src/front-support.ts)             |
| Intégrations support    | Fournisseurs, canaux, connecteurs OAuth, webhooks et rotation/révocation de secrets de webhook                                                       | [Intégrations](../../packages/plugins/supbrd-plug-support/worker/src/integrations.ts), [OAuth](../../packages/plugins/supbrd-plug-support/worker/src/integration-oauth.ts), [webhooks](../../packages/plugins/supbrd-plug-support/worker/src/webhooks.ts) |

## Parcours, statistiques et données

Les familles Analytics et Flows sont activées dans la cible MBZA et désactivées dans la cible Vocostar examinée.

| Domaine              | Fonctionnalités relevées                                                                                                        | Sources                                                                                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Parcours d’accueil   | Définition et modification, suppression, versions, publication, emplacements, ciblage, expériences, progression et statistiques | [Onboardings](../../packages/plugins/supbrd-plug-journeys/onboardings/src/index.ts), [contrats](../../scripts/config/emdash-plugin-topology.json)                                                                                                            |
| Scénarios Flows      | Éditeur de workflows, versions, publication et activation, graphe d’exécution, composants, déclenchements Launchpad et ciblage  | [Workflows](../../packages/plugins/supbrd-plug-journeys/flows/src/workflows/service.ts), [Launchpad](../../packages/plugins/supbrd-plug-journeys/flows/src/launchpad/service.ts), [runtime](../../packages/plugins/supbrd-plug-journeys/flows/src/runtime)   |
| Exécution Flows      | Événements en queue, état par utilisateur, délais via Workflows, hub temps réel, suivi des participants et expérimentations     | [Worker](../../packages/plugins/supbrd-plug-journeys/flows/src/index.ts), [expériences](../../packages/plugins/supbrd-plug-journeys/flows/src/services/experiments.ts)                                                                                       |
| Configuration Flows  | Environnements de parcours, rotation de clés, localisation, SDK, composants réutilisables                                       | [Plugin Flows](../../packages/plugins/supbrd-plug-journeys/src/front-flows.ts)                                                                                                                                                                               |
| Collecte statistique | Événements produit pseudonymisés, installations, profils, sessions, vues/écrans, appareils et pays, achats vérifiés             | [Collecte](../../packages/plugins/supbrd-plug-analytics/worker/src/ingestion.ts), [requêtes](../../packages/plugins/supbrd-plug-analytics/worker/src/queries.ts)                                                                                             |
| Analyses             | Tableaux de bord, analyse d’événements, tunnels de conversion, rétention, cohortes, crashs et retours utilisateur               | [Ressources](../../packages/plugins/supbrd-plug-analytics/worker/src/resources.ts), [vues Analytics](../../packages/plugins/supbrd-plug-analytics/src/front-analytics.ts)                                                                                    |
| Pilotage statistique | Rapports/exports, opérations de données, alertes, configuration distante, réglages et signaux marketing                         | [Rapports](../../packages/plugins/supbrd-plug-analytics/worker/src/reports.ts), [opérations](../../packages/plugins/supbrd-plug-analytics/worker/src/operations.ts), [signaux](../../packages/plugins/supbrd-plug-analytics/worker/src/marketing-signals.ts) |
| Contenus SuperBoard  | Documents, révisions, taxonomies, création, modification et publication                                                         | [Plugin Content](../../packages/plugins/supbrd-plug-data/src/front/content), [API contenu](../../apps/site/src/lib/content-plugin-api.ts)                                                                                                                    |
| Fichiers applicatifs | Tickets d’upload, confirmation, métadonnées, téléchargements contrôlés, suppression, nettoyage et usage du stockage             | [Files](../../packages/plugins/supbrd-plug-data/worker/src/index.ts), [plugin Files](../../packages/plugins/supbrd-plug-data/src/front/files)                                                                                                                |

## Vocostar

Le code métier est présent. L’intégration dans le catalogue de plugins concrets, les pages dédiées proposées et la bascule de production ne sont pas achevées par cette étude.

| Fonctionnalité           | Éléments présents                                                                                                                     | Source                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Clonage de voix          | Capacité `vocostar.voice.clone`, validation, création et orchestration durable                                                        | [Entrée custom](../../workers/custom/vocostar/src/index.ts), [jobs](../../workers/custom/vocostar/src/jobs.ts)                         |
| Conversion de médias     | Capacité `vocostar.media.convert`, entrées texte/audio/vidéo et voix sélectionnée, enrichissement et exécution                        | [Jobs](../../workers/custom/vocostar/src/jobs.ts), [validation](../../workers/custom/vocostar/src/validation.ts)                       |
| Traitements              | Création, déduplication, liste paginée, détail, progression, échecs, compteurs et réconciliation périodique                           | [Jobs](../../workers/custom/vocostar/src/jobs.ts)                                                                                      |
| Annulation et reprises   | Annulation avant traitement, contrôle du propriétaire, compensation de crédits idempotente, relance administrative                    | [Worker](../../workers/custom/vocostar/src/index.ts), [jobs](../../workers/custom/vocostar/src/jobs.ts)                                |
| Isolation et fichiers    | Scope projet/utilisateur, références de fichiers propriétaires, résolution des entrées/sorties et suppression des données utilisateur | [Jobs](../../workers/custom/vocostar/src/jobs.ts), [migrations](../../workers/custom/vocostar/migrations)                              |
| Moteur voix              | Workflow de traitement vocal, conteneurs Standard, dispatcher, appels aux fournisseurs de génération et stockage                      | [Orchestrateur voix](../../workers/custom/vocostar/orchestrators/vocals/src/index.ts)                                                  |
| Moteur média             | Workflow média, conteneurs Standard/Premium, dispatcher, traitement média et configuration de filigrane                               | [Orchestrateur média](../../workers/custom/vocostar/orchestrators/medias/src/index.ts), [manifeste](../../infra/targets/vocostar.json) |
| Configuration déployable | Capacités, ressources, crons, moteurs gérés, noms de secrets et pont runtime dans le manifeste de cible                               | [Cible Vocostar](../../infra/targets/vocostar.json)                                                                                    |

Le `runtimeBridge` Vocostar est explicitement `blocked` dans le manifeste : les callbacks restent détenus par l’ancienne passerelle externe. Le catalogue ne contient pas encore le plugin concret `supbrd-plugmod-vocostar` proposé. Aucun écran Vocostar dédié n’apparaît dans les 121 vues front enregistrées ; les jobs custom sont actuellement couverts par l’exploitation générique.

## Capacités EmDash conservées dans le dépôt

Ces capacités existent dans les packages EmDash. Leur présence ne signifie pas qu’elles sont toutes exposées dans le menu SuperBoard actuel.

| Famille                  | Capacités présentes                                                                                                                                                     | Source                                                                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modèles de contenu       | Collections, types de champs, validation, relations, génération de types, schémas stockés en base                                                                       | [Schémas](../../packages/core/src/schema), [routes schema](../../packages/core/src/astro/routes/api/schema)                                             |
| Édition et publication   | Contenu structuré/Portable Text, brouillons, révisions, restauration, prévisualisation, duplication, publication/dépublication, programmation, corbeille et traductions | [Routes contenu](../../packages/core/src/astro/routes/api/content), [révisions](../../packages/core/src/astro/routes/api/revisions)                     |
| Organisation éditoriale  | Taxonomies, termes, auteurs/bylines, menus et traductions, sections, zones de widgets et réorganisation                                                                 | [Routes du CMS](../../packages/core/src/astro/routes/api), [administration](../../packages/admin/src/routes)                                            |
| Médias CMS               | Bibliothèque, dossiers, fournisseurs, upload, confirmation, usage des médias et stockage                                                                                | [Routes media](../../packages/core/src/astro/routes/api/media)                                                                                          |
| Recherche et SEO         | Recherche, suggestions, reconstruction d’index, redirections et suivi des erreurs 404                                                                                   | [Recherche](../../packages/core/src/astro/routes/api/search), [redirections](../../packages/core/src/astro/routes/api/redirects)                        |
| Collaboration            | Commentaires et réactions sur les contenus                                                                                                                              | [Commentaires](../../packages/core/src/astro/routes/api/comments)                                                                                       |
| Accès CMS                | Sessions opérateur, passkeys, magic links, invitations, OAuth, jetons API et permissions                                                                                | [Auth](../../packages/core/src/astro/routes/api/auth), [OAuth](../../packages/core/src/astro/routes/api/oauth), [auth package](../../packages/auth/src) |
| Administration technique | Paramètres, sauvegardes/export, snapshots, import WordPress, thèmes/prévisualisation, API OpenAPI et MCP                                                                | [Routes CMS](../../packages/core/src/astro/routes/api)                                                                                                  |
| Extensions               | Plugins natifs et sandboxés, hooks, stockage, API et contributions à l’administration, outillage CLI et registre de distribution                                        | [Plugins core](../../packages/core/src/plugins), [plugin-cli](../../packages/plugin-cli), [marketplace](../../packages/marketplace)                     |

Les plugins EmDash additionnels présents sont : formulaires et soumissions (`forms`), champs structurés (`field-kit`), sélecteur de couleur (`color`), intégrations médias (`embeds`), syndication AT Protocol (`atproto`), modération IA de commentaires (`ai-moderation`), journal des changements (`audit-log`) et notifications webhook (`webhook-notifier`). Les dossiers `api-test`, `marketplace-test`, `mcp-smoke` et `sandboxed-test` sont des fixtures de test et ne sont pas des fonctionnalités métier à afficher. [Packages de plugins](../../packages/plugins).

## SDK et outils de migration

Les SDK présents couvrent Flutter, FlutterFlow, Swift/iOS, Android, JavaScript, React Native, les parcours Flows et Identity pour Web/React/Vue/Angular/Next.js. Le catalogue distingue les bibliothèques actives, internes, archivées et celles en attente de release ; le code source ne doit pas être présenté comme déjà publié. [Catalogue SDK](../../scripts/config/sdk-libraries.json), [sources](../../sdks).

L’application de référence Flutter/FlutterFlow, les Custom Actions et Library Values, les catalogues de versions immuables et les outils d’installation/intégration sont présents. Les outils de migration des comptes, achats, support/Chatwoot, Flows et historiques Vocostar sont des opérations techniques, à conserver sous Exploitation. [Configuration FlutterFlow](../../scripts/config/flutterflow-custom-code.json), [référence](../../apps/reference), [scripts](../../scripts).

## Activation déclarée par cible

Les tableaux suivants sont des extractions des manifestes et catalogues. Ils complètent l’inventaire fonctionnel avec les identifiants techniques nécessaires à une migration sans perte.

| Rôle actuel     | MBZA                     | Vocostar                 | Destination proposée                     |
| --------------- | ------------------------ | ------------------------ | ---------------------------------------- |
| `api`           | Activé dans le manifeste | Activé dans le manifeste | API                                      |
| `site`          | Activé dans le manifeste | Activé dans le manifeste | Console                                  |
| `billing`       | Activé dans le manifeste | Activé dans le manifeste | Paiements                                |
| `messaging`     | Désactivé                | Désactivé                | Historique à retirer après migration     |
| `email`         | Activé dans le manifeste | Activé dans le manifeste | Communication                            |
| `identity`      | Activé dans le manifeste | Activé dans le manifeste | Authentification                         |
| `files`         | Activé dans le manifeste | Activé dans le manifeste | Fichiers                                 |
| `observability` | Activé dans le manifeste | Activé dans le manifeste | Supervision                              |
| `mcp`           | Activé dans le manifeste | Activé dans le manifeste | API                                      |
| `custom`        | Activé dans le manifeste | Déclaré ; pont bloqué    | Extension de référence / plugin Vocostar |
| `app`           | Activé dans le manifeste | Activé dans le manifeste | API                                      |
| `products`      | Activé dans le manifeste | Activé dans le manifeste | API                                      |
| `paywalls`      | Activé dans le manifeste | Activé dans le manifeste | API                                      |
| `dynamic-links` | Activé dans le manifeste | Activé dans le manifeste | API                                      |
| `support`       | Activé dans le manifeste | Activé dans le manifeste | Service client                           |
| `analytics`     | Activé dans le manifeste | Désactivé                | Statistiques                             |
| `marketing`     | Activé dans le manifeste | Activé dans le manifeste | Communication                            |
| `onboardings`   | Activé dans le manifeste | Activé dans le manifeste | API                                      |
| `flows`         | Activé dans le manifeste | Désactivé                | Automatisations                          |

Les deux moteurs gérés Vocostar, `vocals-orchestrator` et `medias-orchestrator`, sont déclarés en plus du rôle `custom`. Leur activation reste liée à la résolution du blocage des callbacks.

## Correspondance des 121 vues

Les chemins actuels sont conservés dans la première étape. Les intitulés ci-dessous sont proposés. « Page locale » signifie onglet, liste ou page de détail accessible depuis son parent, pas entrée supplémentaire permanente dans la barre. Les 121 modules référencés existent sur disque ; leur statut de catalogue est `registered`.

| Chemin actuel                         | Intitulé proposé                   | Emplacement proposé                           | Implémentation actuelle                                                                                                                    |
| ------------------------------------- | ---------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `/system/audit`                       | Journal d’audit                    | Exploitation / page locale                    | [Source](../../packages/plugins/supbrd-core/src/front/audit/views/superboard.system_audit.tsx)                                             |
| `/system/content`                     | Contenus                           | Données et contenus                           | [Source](../../packages/plugins/supbrd-plug-data/src/front/content/views/superboard.system_content.tsx)                                    |
| `/products/offerings`                 | Produits et offres                 | Ventes et abonnements                         | [Source](../../packages/plugins/supbrd-plug-commerce/src/front/products/views/superboard.products_offerings.tsx)                           |
| `/app/android-setup`                  | Configurer Android                 | Paramètres / applications clientes            | [Source](../../packages/plugins/supbrd-core/src/front/settings/views/superboard.app_android_setup.tsx)                                     |
| `/app/ios-setup`                      | Configurer iOS                     | Paramètres / applications clientes            | [Source](../../packages/plugins/supbrd-core/src/front/settings/views/superboard.app_ios_setup.tsx)                                         |
| `/app/libraries`                      | Bibliothèques SDK                  | Paramètres / applications clientes            | [Source](../../packages/plugins/supbrd-core/src/front/settings/views/superboard.app_libraries.tsx)                                         |
| `/app/web-setup`                      | Configurer le Web                  | Paramètres / applications clientes            | [Source](../../packages/plugins/supbrd-core/src/front/settings/views/superboard.app_web_setup.tsx)                                         |
| `/project-settings`                   | Paramètres de l’environnement      | Administration                                | [Source](../../packages/plugins/supbrd-core/src/front/settings/views/superboard.project_settings.tsx)                                      |
| `/accept-invite`                      | Accepter l’invitation              | Accès opérateur                               | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.accept_invite.tsx)                                         |
| `/account`                            | Mon compte                         | Menu du compte                                | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.account.tsx)                                               |
| `/app/access-key`                     | Clés API                           | Paramètres / applications clientes            | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.app_access_key.tsx)                                        |
| `/app/customers`                      | Profils et installations           | Utilisateurs et accès                         | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.app_customers.tsx)                                         |
| `/app/members`                        | Membres de l’application           | Utilisateurs et accès / page locale           | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.app_members.tsx)                                           |
| `/app/profile`                        | Mon profil                         | Menu du compte                                | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.profile.tsx)                                               |
| `/app/referrals`                      | Parrainages                        | Communication / page locale                   | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.app_referrals.tsx)                                         |
| `/app/users`                          | Utilisateurs de l’application      | Utilisateurs et accès                         | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.users.tsx)                                                 |
| `/identity`                           | Connexion et sécurité              | Utilisateurs et accès / Connexion et sécurité | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.identity.tsx)                                              |
| `/identity/:lang`                     | Connexion et sécurité              | Utilisateurs et accès / Connexion et sécurité | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.identity_by_lang.tsx)                                      |
| `/identity/:lang/account`             | Règles des comptes                 | Utilisateurs et accès / Connexion et sécurité | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.identity_by_lang_account.tsx)                              |
| `/identity/:lang/apps`                | Applications OAuth                 | Utilisateurs et accès / Connexion et sécurité | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.identity_by_lang_apps.tsx)                                 |
| `/identity/:lang/apps/:id`            | Configurer l’application OAuth     | Utilisateurs et accès / Connexion et sécurité | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.identity_by_lang_apps_by_id.tsx)                           |
| `/identity/:lang/apps/banners/:id`    | Modifier la bannière de connexion  | Utilisateurs et accès / Connexion et sécurité | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.identity_by_lang_apps_banners_by_id.tsx)                   |
| `/identity/:lang/apps/banners/new`    | Créer une bannière de connexion    | Utilisateurs et accès / Connexion et sécurité | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.identity_by_lang_apps_banners_new.tsx)                     |
| `/identity/:lang/apps/new`            | Ajouter une application OAuth      | Utilisateurs et accès / Connexion et sécurité | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.identity_by_lang_apps_new.tsx)                             |
| `/identity/:lang/dashboard`           | Vue d’ensemble des connexions      | Utilisateurs et accès / Connexion et sécurité | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.identity_by_lang_dashboard.tsx)                            |
| `/identity/:lang/logs`                | Journal des connexions             | Utilisateurs et accès / Connexion et sécurité | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.identity_by_lang_logs.tsx)                                 |
| `/identity/:lang/logs/email/:id`      | Détail du journal d’e-mail         | Utilisateurs et accès / Connexion et sécurité | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.identity_by_lang_logs_email_by_id.tsx)                     |
| `/identity/:lang/logs/sign-in/:id`    | Détail de connexion                | Utilisateurs et accès / Connexion et sécurité | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.identity_by_lang_logs_sign_in_by_id.tsx)                   |
| `/identity/:lang/logs/sms/:id`        | Détail du journal SMS              | Utilisateurs et accès / Connexion et sécurité | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.identity_by_lang_logs_sms_by_id.tsx)                       |
| `/identity/:lang/orgs`                | Organisations                      | Utilisateurs et accès / Connexion et sécurité | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.identity_by_lang_orgs.tsx)                                 |
| `/identity/:lang/orgs/:id`            | Détail de l’organisation           | Utilisateurs et accès / Connexion et sécurité | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.identity_by_lang_orgs_by_id.tsx)                           |
| `/identity/:lang/orgs/new`            | Créer une organisation             | Utilisateurs et accès / Connexion et sécurité | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.identity_by_lang_orgs_new.tsx)                             |
| `/identity/:lang/roles`               | Rôles et autorisations             | Utilisateurs et accès / Connexion et sécurité | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.identity_by_lang_roles.tsx)                                |
| `/identity/:lang/roles/:id`           | Modifier le rôle                   | Utilisateurs et accès / Connexion et sécurité | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.identity_by_lang_roles_by_id.tsx)                          |
| `/identity/:lang/roles/new`           | Créer un rôle                      | Utilisateurs et accès / Connexion et sécurité | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.identity_by_lang_roles_new.tsx)                            |
| `/identity/:lang/saml`                | SSO d’entreprise                   | Utilisateurs et accès / Connexion et sécurité | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.identity_by_lang_saml.tsx)                                 |
| `/identity/:lang/saml/:id`            | Modifier le SSO d’entreprise       | Utilisateurs et accès / Connexion et sécurité | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.identity_by_lang_saml_by_id.tsx)                           |
| `/identity/:lang/saml/new`            | Configurer un SSO d’entreprise     | Utilisateurs et accès / Connexion et sécurité | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.identity_by_lang_saml_new.tsx)                             |
| `/identity/:lang/scopes`              | Permissions API                    | Utilisateurs et accès / Connexion et sécurité | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.identity_by_lang_scopes.tsx)                               |
| `/identity/:lang/scopes/:id`          | Modifier la permission API         | Utilisateurs et accès / Connexion et sécurité | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.identity_by_lang_scopes_by_id.tsx)                         |
| `/identity/:lang/scopes/new`          | Créer une permission API           | Utilisateurs et accès / Connexion et sécurité | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.identity_by_lang_scopes_new.tsx)                           |
| `/identity/:lang/user-attributes`     | Attributs utilisateur              | Utilisateurs et accès / Connexion et sécurité | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.identity_by_lang_user_attributes.tsx)                      |
| `/identity/:lang/user-attributes/:id` | Modifier l’attribut utilisateur    | Utilisateurs et accès / Connexion et sécurité | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.identity_by_lang_user_attributes_by_id.tsx)                |
| `/identity/:lang/user-attributes/new` | Créer un attribut utilisateur      | Utilisateurs et accès / Connexion et sécurité | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.identity_by_lang_user_attributes_new.tsx)                  |
| `/identity/:lang/users`               | Comptes de connexion               | Utilisateurs et accès / Connexion et sécurité | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.identity_by_lang_users.tsx)                                |
| `/identity/:lang/users/:authId`       | Détail du compte de connexion      | Utilisateurs et accès / Connexion et sécurité | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.identity_by_lang_users_by_authid.tsx)                      |
| `/login`                              | Connexion à la console             | Accès opérateur                               | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.login.tsx)                                                 |
| `/new_password`                       | Récupérer l’accès                  | Accès opérateur                               | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.new_password.tsx)                                          |
| `/register`                           | Créer un compte opérateur          | Accès opérateur                               | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.register.tsx)                                              |
| `/register/with_email`                | Créer un compte par e-mail         | Accès opérateur                               | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.register_with_email.tsx)                                   |
| `/reset_password`                     | Réinitialiser le mot de passe      | Accès opérateur                               | [Source](../../packages/plugins/supbrd-plug-identity/src/front/views/superboard.reset_password.tsx)                                        |
| `/`                                   | Entrée de la console               | Accès / transition                            | [Source](../../packages/plugins/supbrd-plug-analytics/src/front/views/superboard.home.tsx)                                                 |
| `/analytics`                          | Vue d’ensemble des statistiques    | Statistiques                                  | [Source](../../packages/plugins/supbrd-plug-analytics/src/front/views/superboard.analytics.tsx)                                            |
| `/analytics/alerts`                   | Alertes                            | Statistiques                                  | [Source](../../packages/plugins/supbrd-plug-analytics/src/front/views/superboard.analytics_alerts.tsx)                                     |
| `/analytics/cohorts`                  | Groupes d’utilisateurs             | Statistiques                                  | [Source](../../packages/plugins/supbrd-plug-analytics/src/front/views/superboard.analytics_cohorts.tsx)                                    |
| `/analytics/crashes`                  | Erreurs de l’application           | Statistiques                                  | [Source](../../packages/plugins/supbrd-plug-analytics/src/front/views/superboard.analytics_crashes.tsx)                                    |
| `/analytics/dashboards`               | Tableaux de bord                   | Statistiques                                  | [Source](../../packages/plugins/supbrd-plug-analytics/src/front/views/superboard.analytics_dashboards.tsx)                                 |
| `/analytics/dimensions`               | Appareils et pays                  | Statistiques                                  | [Source](../../packages/plugins/supbrd-plug-analytics/src/front/views/superboard.analytics_dimensions.tsx)                                 |
| `/analytics/events`                   | Événements                         | Statistiques                                  | [Source](../../packages/plugins/supbrd-plug-analytics/src/front/views/superboard.analytics_events.tsx)                                     |
| `/analytics/feedback`                 | Retours utilisateur                | Statistiques                                  | [Source](../../packages/plugins/supbrd-plug-analytics/src/front/views/superboard.analytics_feedback.tsx)                                   |
| `/analytics/insights`                 | Conversions et fidélisation        | Statistiques                                  | [Source](../../packages/plugins/supbrd-plug-analytics/src/front/views/superboard.analytics_insights.tsx)                                   |
| `/analytics/installations`            | Installations                      | Statistiques                                  | [Source](../../packages/plugins/supbrd-plug-analytics/src/front/views/superboard.analytics_installations.tsx)                              |
| `/analytics/purchases`                | Revenus vérifiés                   | Statistiques                                  | [Source](../../packages/plugins/supbrd-plug-analytics/src/front/views/superboard.analytics_purchases.tsx)                                  |
| `/analytics/remote-config`            | Configuration distante             | Paramètres / configuration distante           | [Source](../../packages/plugins/supbrd-plug-analytics/src/front/views/superboard.analytics_remote_config.tsx)                              |
| `/analytics/reports`                  | Rapports et exports                | Statistiques                                  | [Source](../../packages/plugins/supbrd-plug-analytics/src/front/views/superboard.analytics_reports.tsx)                                    |
| `/analytics/settings`                 | Paramètres des statistiques        | Statistiques                                  | [Source](../../packages/plugins/supbrd-plug-analytics/src/front/views/superboard.analytics_settings.tsx)                                   |
| `/analytics/users`                    | Audience et utilisation            | Statistiques                                  | [Source](../../packages/plugins/supbrd-plug-analytics/src/front/views/superboard.analytics_users.tsx)                                      |
| `/analytics/views`                    | Écrans consultés                   | Statistiques                                  | [Source](../../packages/plugins/supbrd-plug-analytics/src/front/views/superboard.analytics_views.tsx)                                      |
| `/app`                                | Entrée de l’application            | Accès / transition                            | [Source](../../packages/plugins/supbrd-plug-analytics/src/front/views/superboard.app_shell.tsx)                                            |
| `/dashboard`                          | Vue d’ensemble                     | Accueil                                       | [Source](../../packages/plugins/supbrd-plug-analytics/src/front/views/superboard.dashboard.tsx)                                            |
| `/products/customers`                 | Clients payants                    | Ventes et abonnements                         | [Source](../../packages/plugins/supbrd-plug-commerce/src/front/billing/views/superboard.products_customers.tsx)                            |
| `/products/entitlements`              | Droits d’accès achetés             | Ventes et abonnements                         | [Source](../../packages/plugins/supbrd-plug-commerce/src/front/billing/views/superboard.products_entitlements.tsx)                         |
| `/products/purchases`                 | Achats et abonnements              | Ventes et abonnements                         | [Source](../../packages/plugins/supbrd-plug-commerce/src/front/billing/views/superboard.products_purchases.tsx)                            |
| `/dynamic-links/campaigns`            | Campagnes de liens                 | Communication / Liens et attribution          | [Source](../../packages/plugins/supbrd-plug-communication/src/front/dynamic-links/views/superboard.dynamic_links_campaigns.tsx)            |
| `/dynamic-links/campaigns/:id`        | Détail de la campagne de liens     | Communication / Liens et attribution          | [Source](../../packages/plugins/supbrd-plug-communication/src/front/dynamic-links/views/superboard.dynamic_links_campaigns_by_id.tsx)      |
| `/dynamic-links/domain`               | Domaines des liens                 | Communication / Liens et attribution          | [Source](../../packages/plugins/supbrd-plug-communication/src/front/dynamic-links/views/superboard.dynamic_links_domain.tsx)               |
| `/dynamic-links/links`                | Liens                              | Communication / Liens et attribution          | [Source](../../packages/plugins/supbrd-plug-communication/src/front/dynamic-links/views/superboard.dynamic_links_links.tsx)                |
| `/dynamic-links/redirect-rules`       | Règles de redirection              | Communication / Liens et attribution          | [Source](../../packages/plugins/supbrd-plug-communication/src/front/dynamic-links/views/superboard.dynamic_links_redirect_rules.tsx)       |
| `/dynamic-links/social-media-preview` | Aperçus sur les réseaux sociaux    | Communication / Liens et attribution          | [Source](../../packages/plugins/supbrd-plug-communication/src/front/dynamic-links/views/superboard.dynamic_links_social_media_preview.tsx) |
| `/dynamic-links/tracking`             | Suivi des clics et attribution     | Communication / Liens et attribution          | [Source](../../packages/plugins/supbrd-plug-communication/src/front/dynamic-links/views/superboard.dynamic_links_tracking.tsx)             |
| `/system/email`                       | Envois transactionnels             | Communication                                 | [Source](../../packages/plugins/supbrd-plug-communication/src/front/email/views/superboard.system_email.tsx)                               |
| `/system/files`                       | Fichiers et médias                 | Données et contenus                           | [Source](../../packages/plugins/supbrd-plug-data/src/front/files/views/superboard.system_files.tsx)                                        |
| `/flows`                              | Vue d’ensemble des automatisations | Parcours et automatisations                   | [Source](../../packages/plugins/supbrd-plug-journeys/src/front/flows/views/superboard.flows.tsx)                                           |
| `/flows/components`                   | Composants de parcours             | Parcours et automatisations                   | [Source](../../packages/plugins/supbrd-plug-journeys/src/front/flows/views/superboard.flows_components.tsx)                                |
| `/flows/launchpad`                    | Déclenchements et publications     | Parcours et automatisations                   | [Source](../../packages/plugins/supbrd-plug-journeys/src/front/flows/views/superboard.flows_launchpad.tsx)                                 |
| `/flows/settings/environments`        | Environnements des parcours        | Parcours et automatisations                   | [Source](../../packages/plugins/supbrd-plug-journeys/src/front/flows/views/superboard.flows_settings_environments.tsx)                     |
| `/flows/settings/localization`        | Traductions des parcours           | Parcours et automatisations                   | [Source](../../packages/plugins/supbrd-plug-journeys/src/front/flows/views/superboard.flows_settings_localization.tsx)                     |
| `/flows/settings/sdk`                 | Intégration des parcours           | Parcours et automatisations                   | [Source](../../packages/plugins/supbrd-plug-journeys/src/front/flows/views/superboard.flows_settings_sdk.tsx)                              |
| `/flows/users`                        | Suivi des participants             | Parcours et automatisations                   | [Source](../../packages/plugins/supbrd-plug-journeys/src/front/flows/views/superboard.flows_users.tsx)                                     |
| `/flows/users/:id`                    | Détail du participant              | Parcours et automatisations                   | [Source](../../packages/plugins/supbrd-plug-journeys/src/front/flows/views/superboard.flows_users_by_id.tsx)                               |
| `/flows/workflows`                    | Scénarios automatisés              | Parcours et automatisations                   | [Source](../../packages/plugins/supbrd-plug-journeys/src/front/flows/views/superboard.flows_workflows.tsx)                                 |
| `/flows/workflows/:id`                | Éditeur du scénario                | Parcours et automatisations                   | [Source](../../packages/plugins/supbrd-plug-journeys/src/front/flows/views/superboard.flows_workflows_by_id.tsx)                           |
| `/system/gateway`                     | Routage de l’API                   | Exploitation / page locale                    | [Source](../../packages/plugins/supbrd-core/src/front/gateway/views/superboard.system_gateway.tsx)                                         |
| `/marketing/campaigns`                | Campagnes et newsletters           | Communication                                 | [Source](../../packages/plugins/supbrd-plug-communication/src/front/marketing/views/superboard.marketing_campaigns.tsx)                    |
| `/marketing/channels`                 | Canaux de diffusion                | Communication                                 | [Source](../../packages/plugins/supbrd-plug-communication/src/front/marketing/views/superboard.marketing_channels.tsx)                     |
| `/marketing/email`                    | E-mails et contacts marketing      | Communication                                 | [Source](../../packages/plugins/supbrd-plug-communication/src/front/marketing/views/superboard.marketing_email.tsx)                        |
| `/marketing/in-app-messages`          | Messages dans l’application        | Communication                                 | [Source](../../packages/plugins/supbrd-plug-communication/src/front/marketing/views/superboard.marketing_in_app_messages.tsx)              |
| `/marketing/journeys`                 | Parcours marketing                 | Parcours et automatisations                   | [Source](../../packages/plugins/supbrd-plug-communication/src/front/marketing/views/superboard.marketing_journeys.tsx)                     |
| `/marketing/settings`                 | Paramètres marketing               | Communication                                 | [Source](../../packages/plugins/supbrd-plug-communication/src/front/marketing/views/superboard.marketing_settings.tsx)                     |
| `/marketing/statistics`               | Résultats des campagnes            | Communication                                 | [Source](../../packages/plugins/supbrd-plug-communication/src/front/marketing/views/superboard.marketing_statistics.tsx)                   |
| `/message-preview-craft`              | Aperçu du message                  | Communication / éditeur local                 | [Source](../../packages/plugins/supbrd-plug-communication/src/front/marketing/views/superboard.message_preview_craft.tsx)                  |
| `/mcp/authorize`                      | Autoriser un assistant IA          | Consentement opérateur                        | [Source](../../packages/plugins/supbrd-core/src/front/mcp/views/superboard.mcp_authorize.tsx)                                              |
| `/infrastructure`                     | Exploitation                       | Administration                                | [Source](../../packages/plugins/supbrd-core/src/front/observability/views/superboard.infrastructure.tsx)                                   |
| `/onboardings`                        | Parcours d’accueil                 | Parcours et automatisations                   | [Source](../../packages/plugins/supbrd-plug-journeys/src/front/onboardings/views/superboard.onboardings.tsx)                               |
| `/onboardings/statistics`             | Résultats des parcours d’accueil   | Parcours et automatisations / page locale     | [Source](../../packages/plugins/supbrd-plug-journeys/src/front/onboardings/views/superboard.onboardings_statistics.tsx)                    |
| `/paywalls`                           | Écrans d’abonnement                | Ventes et abonnements                         | [Source](../../packages/plugins/supbrd-plug-commerce/src/front/paywalls/views/superboard.paywalls.tsx)                                     |
| `/paywalls/statistics`                | Résultats des écrans d’abonnement  | Ventes et abonnements / page locale           | [Source](../../packages/plugins/supbrd-plug-commerce/src/front/paywalls/views/superboard.paywalls_statistics.tsx)                          |
| `/support/automations`                | Règles automatiques                | Communication / Service client                | [Source](../../packages/plugins/supbrd-plug-support/src/front/views/superboard.support_automations.tsx)                                    |
| `/support/captain`                    | Assistant IA du support            | Communication / Service client                | [Source](../../packages/plugins/supbrd-plug-support/src/front/views/superboard.support_captain.tsx)                                        |
| `/support/channels`                   | Canaux de contact                  | Communication / Service client                | [Source](../../packages/plugins/supbrd-plug-support/src/front/views/superboard.support_channels.tsx)                                       |
| `/support/configuration`              | Configuration du service client    | Communication / Service client                | [Source](../../packages/plugins/supbrd-plug-support/src/front/views/superboard.support_configuration.tsx)                                  |
| `/support/contacts`                   | Contacts                           | Communication / Service client                | [Source](../../packages/plugins/supbrd-plug-support/src/front/views/superboard.support_contacts.tsx)                                       |
| `/support/help-center`                | Centre d’aide                      | Communication / Service client                | [Source](../../packages/plugins/supbrd-plug-support/src/front/views/superboard.support_help_center.tsx)                                    |
| `/support/inbox`                      | Conversations                      | Communication / Service client                | [Source](../../packages/plugins/supbrd-plug-support/src/front/views/superboard.support_inbox.tsx)                                          |
| `/support/integrations`               | Intégrations du support            | Communication / Service client                | [Source](../../packages/plugins/supbrd-plug-support/src/front/views/superboard.support_integrations.tsx)                                   |
| `/support/proactive-support`          | Aide proactive                     | Communication / Service client                | [Source](../../packages/plugins/supbrd-plug-support/src/front/views/superboard.support_proactive_support.tsx)                              |
| `/support/quality`                    | Satisfaction et qualité            | Communication / Service client                | [Source](../../packages/plugins/supbrd-plug-support/src/front/views/superboard.support_quality.tsx)                                        |
| `/support/reports`                    | Rapports du support                | Communication / Service client                | [Source](../../packages/plugins/supbrd-plug-support/src/front/views/superboard.support_reports.tsx)                                        |
| `/support/settings`                   | Paramètres du support              | Communication / Service client                | [Source](../../packages/plugins/supbrd-plug-support/src/front/views/superboard.support_settings.tsx)                                       |
| `/support/workforce`                  | Agents et équipes                  | Communication / Service client                | [Source](../../packages/plugins/supbrd-plug-support/src/front/views/superboard.support_workforce.tsx)                                      |
| `/mcp`                                | Accès des assistants IA            | Exploitation / page locale                    | [Source](../../packages/plugins/supbrd-core/src/front/mcp/views/superboard.mcp.tsx)                                                        |

## Contrats des plugins

La topologie déclare les commandes et lectures ci-dessous. Les noms sont conservés pour identifier précisément la couverture de migration ; ils ne sont pas des libellés à afficher aux utilisateurs. Cette extraction ne vaut pas validation de chaque branche d’exécution.

### `supbrd-plug-user`

Type : `full`. Aucun Worker propre dans ce descripteur.

Commandes : `application_sign_in`, `update_profile`, `suspend_member`, `link_provider`, `revoke_application_session`.

Lectures : `current_profile`, `members`, `linked_providers`, `active_sessions`.

### `supbrd-plug-settings`

Type : `full`. Aucun Worker propre dans ce descripteur.

Commandes : `update_effective_settings`, `save_sdk_configuration`, `test_sdk_configuration`.

Lectures : `effective_settings`, `settings_versions`, `sdk_configurations`.

### `supbrd-plug-content`

Type : `full`. Aucun Worker propre dans ce descripteur.

Commandes : `create_document`, `update_document`, `publish_document`.

Lectures : `documents`, `taxonomies`, `revisions`.

### `supbrd-plug-products`

Type : `full`. Aucun Worker propre dans ce descripteur.

Commandes : `create_product`, `update_product`, `archive_product`, `create_package`, `update_package`, `archive_package`, `create_offering`, `update_offering`, `archive_offering`, `create_entitlement`, `update_entitlement`, `archive_entitlement`, `sync_store_catalog`.

Lectures : `products`, `packages`, `offerings`, `entitlements`, `product_statistics`, `store_sync_runs`.

### `supbrd-plug-audit`

Type : `full`. Aucun Worker propre dans ce descripteur.

Commandes : `archive_ledger`, `verify_ledger`.

Lectures : `ledger`, `ledger_search`, `archives`.

### `supbrd-plugmod-gateway`

Type : `module`. Worker déclaré : `packages/plugins/supbrd-core/api`, état de catalogue `ready`.

Commandes : `publish_gateway_manifest`, `update_gateway_route`, `rotate_access_policy`.

Lectures : `active_gateway_manifest`, `gateway_routes`, `rate_limits`.

### `supbrd-plugmod-billing`

Type : `module`. Worker déclaré : `packages/plugins/supbrd-plug-commerce/billing`, état de catalogue `ready`.

Commandes : `create_purchase`, `create_refund`, `update_refund`, `update_subscription`, `reconcile_store`, `migrate_products`.

Lectures : `purchases`, `purchase`, `refunds`, `subscriptions`, `financial_customer_entitlements`, `billing_ledger`, `migration_status`.

### `supbrd-plugmod-support`

Type : `module`. Worker déclaré : `packages/plugins/supbrd-plug-support/worker`, état de catalogue `ready`.

Commandes : `update_support_settings`, `create_support_configuration`, `update_support_configuration`, `delete_support_configuration`, `rotate_support_webhook_secret`, `revoke_support_webhook_secret`, `send_inbox_message`, `update_inbox_conversation`, `create_support_provider`, `update_support_provider`, `delete_support_provider`, `create_support_integration`, `update_support_integration`, `delete_support_integration`, `publish_support_article`.

Lectures : `support_settings`, `unified_inbox_items`, `inbox_conversations`, `inbox_messages`, `support_channels`, `support_providers`, `support_integrations`, `support_portals`, `support_categories`, `support_folders`, `support_articles`, `support_assistant_tasks`.

### `supbrd-plugmod-flows`

Type : `module`. Worker déclaré : `packages/plugins/supbrd-plug-journeys/flows`, état de catalogue `ready`.

Commandes : `create_workflow`, `update_workflow`, `publish_workflow`, `activate_version`, `create_environment`, `rotate_environment_key`, `save_localization`.

Lectures : `overview`, `components`, `workflows`, `workflow`, `environments`, `localization`, `users`, `user_details`.

### `supbrd-plugmod-analytics`

Type : `module`. Worker déclaré : `packages/plugins/supbrd-plug-analytics/worker`, état de catalogue `ready`.

Commandes : `create_analytics_report`, `update_analytics_report`, `delete_analytics_report`, `create_analytics_operation`, `create_analytics_dashboard`, `update_analytics_dashboard`, `delete_analytics_dashboard`, `create_analytics_cohort`, `evaluate_analytics_cohort`, `upsert_analytics_remote_config`, `create_analytics_alert`, `update_analytics_settings`.

Lectures : `analytics_overview`, `analytics_events`, `analytics_event_analysis`, `analytics_installations`, `analytics_purchases`, `analytics_retention`, `analytics_reports`, `analytics_dashboards`, `analytics_sessions`, `analytics_profiles`, `analytics_views`, `analytics_dimensions`, `analytics_crashes`, `analytics_feedback`, `analytics_cohorts`, `analytics_remote_config`, `analytics_alerts`, `analytics_settings`.

### `supbrd-plugmod-marketing`

Type : `module`. Worker déclaré : `packages/plugins/supbrd-plug-communication/marketing`, état de catalogue `ready`.

Commandes : `create_email_campaign`, `update_email_campaign`, `transition_email_campaign`, `schedule_email_campaign`, `create_marketing_journey`, `update_marketing_journey`, `transition_marketing_journey`, `create_marketing_channel_connector`, `update_marketing_channel_connector`, `delete_marketing_channel_connector`.

Lectures : `email_subscribers`, `subscriber_lists`, `subscriber_segments`, `email_templates`, `email_campaigns`, `marketing_statistics`, `marketing_journeys`, `journey_enrollments`, `journey_statistics`, `marketing_channel_connectors`.

### `supbrd-plugmod-email`

Type : `module`. Worker déclaré : `packages/plugins/supbrd-plug-communication/email`, état de catalogue `ready`.

Commandes : `send_transactional_email`, `save_smtp_settings`, `delete_smtp_settings`, `test_smtp_settings`, `verify_smtp_domain`, `retry_delivery_outbox`, `replay_dead_letter`, `discard_dead_letter`.

Lectures : `smtp_settings`, `delivery_outbox`, `dead_letters`, `provider_webhooks`, `provider_events`.

### `supbrd-plugmod-dynamic-links`

Type : `module`. Worker déclaré : `packages/plugins/supbrd-plug-communication/dynamic-links`, état de catalogue `ready`.

Commandes : `create_link`, `update_link`, `delete_link`, `create_link_campaign`, `delete_link_campaign`, `create_redirect_rule`, `update_redirect_rule`, `delete_redirect_rule`, `create_domain`, `verify_domain`, `delete_domain`, `save_social_preview`, `save_tracking`.

Lectures : `links`, `resolved_link`, `link_campaigns`, `link_campaign_analytics`, `redirect_rules`, `domains`, `social_preview`, `tracking`, `link_statistics`.

### `supbrd-plugmod-files`

Type : `module`. Worker déclaré : `packages/plugins/supbrd-plug-data/worker`, état de catalogue `ready`.

Commandes : `create_upload_ticket`, `complete_upload`, `delete_object`, `collect_garbage`.

Lectures : `objects`, `object_metadata`, `download_ticket`, `storage_usage`.

### `supbrd-plugmod-paywalls`

Type : `module`. Worker déclaré : `packages/plugins/supbrd-plug-commerce/paywalls`, état de catalogue `ready`.

Commandes : `create_paywall`, `update_paywall`, `archive_paywall`, `create_paywall_version`, `publish_paywall_version`, `save_paywall_placement`, `create_paywall_experience`, `update_paywall_experience`, `archive_paywall_experience`.

Lectures : `paywalls`, `paywall_versions`, `paywall_placements`, `paywall_experiences`, `paywall_statistics`.

### `supbrd-plugmod-onboardings`

Type : `module`. Worker déclaré : `packages/plugins/supbrd-plug-journeys/onboardings`, état de catalogue `ready`.

Commandes : `create_onboarding`, `update_onboarding`, `delete_onboarding`, `create_onboarding_version`, `publish_onboarding`, `save_onboarding_placement`, `create_onboarding_targeting_rule`, `create_onboarding_experience`, `set_onboarding_experience_status`.

Lectures : `onboardings`, `onboarding_versions`, `onboarding_placements`, `onboarding_targeting_rules`, `onboarding_experiences`, `onboarding_statistics`.

### `supbrd-plugmod-observability`

Type : `module`. Worker déclaré : `packages/plugins/supbrd-core/observability`, état de catalogue `ready`.

Commandes : `acknowledge_incident`, `resolve_incident`, `retry_custom_job`, `replay_email_dead_letter`, `discard_email_dead_letter`.

Lectures : `platform_status`, `runtime_metrics`, `service_health`, `incidents`, `platform_custom_jobs`, `platform_email_operations`.

### `supbrd-plugmod-mcp`

Type : `module`. Worker déclaré : `packages/plugins/supbrd-core/mcp`, état de catalogue `ready`.

Commandes : `approve_consent`, `revoke_token`, `invoke_tool`.

Lectures : `tokens`, `sessions`, `tool_receipts`.

### `supbrd-plugmod-custom-*`

Type : `module`. Worker déclaré : `infra/targets`, état de catalogue `not_ready`.

Commandes : `execute_operation`.

Lectures : `operations`.

## État déclaré des SDK

Les états ci-dessous viennent du catalogue local ; les tags distants et registres de publication n’ont pas été interrogés.

| Bibliothèque                           | Cycle de vie | État de release déclaré | Sources                                                                                              |
| -------------------------------------- | ------------ | ----------------------- | ---------------------------------------------------------------------------------------------------- |
| SuperBoard Flutter                     | `active`     | `pending-release`       | [sdks/flutter](../../sdks/flutter)                                                                   |
| SuperBoard FlutterFlow                 | `active`     | `pending-release`       | [sdks/flutterflow](../../sdks/flutterflow)                                                           |
| SuperBoard FlutterFlow Support         | `archived`   | `released`              | [sdks/flutterflow_messaging](../../sdks/flutterflow_messaging)                                       |
| SuperBoard iOS                         | `internal`   | `released`              | [sdks/ios](../../sdks/ios)                                                                           |
| SuperBoard Android                     | `internal`   | `released`              | [sdks/android/SuperBoard](../../sdks/android/SuperBoard)                                             |
| SuperBoard JavaScript                  | `archived`   | `released`              | [sdks/javascript](../../sdks/javascript)                                                             |
| SuperBoard React Native                | `archived`   | `released`              | [sdks/react-native](../../sdks/react-native)                                                         |
| SuperBoard Flows JavaScript            | `active`     | `unreleased`            | [sdks/flows/upstream/packages/js](../../sdks/flows/upstream/packages/js)                             |
| SuperBoard Flows React                 | `active`     | `unreleased`            | [sdks/flows/upstream/packages/react](../../sdks/flows/upstream/packages/react)                       |
| SuperBoard Flows JavaScript Components | `active`     | `unreleased`            | [sdks/flows/upstream/packages/js-components](../../sdks/flows/upstream/packages/js-components)       |
| SuperBoard Flows React Components      | `active`     | `unreleased`            | [sdks/flows/upstream/packages/react-components](../../sdks/flows/upstream/packages/react-components) |
| SuperBoard Flows Shared                | `internal`   | `unreleased`            | [sdks/flows/upstream/packages/shared](../../sdks/flows/upstream/packages/shared)                     |
| SuperBoard Flows Styles                | `internal`   | `unreleased`            | [sdks/flows/upstream/packages/styles](../../sdks/flows/upstream/packages/styles)                     |
