# Collecte SDK du core

Le core conserve les événements SDK partagés avant leur traitement par les
plugins. Analytics lit ce journal pour alimenter ses statistiques. Le service
App du core en extrait les événements clients pour ses vues existantes.
Marketing le lit directement pour déclencher ses parcours, même si Analytics
est désactivé. Il rapproche les identités avec ses alias hachés existants.
Les appels de collecte peuvent réussir quand ces consommateurs sont arrêtés.

## Entrées compatibles

`POST /v1/data/events` accepte le contrat `AnalyticsEventV1`, seul ou
dans un objet `events` de 1 à 100 éléments. Les en-têtes `PROJECT-KEY`, `PLATFORM`
et `IDENTIFIER` doivent identifier une application configurée. Le serveur résout
le projet et l’environnement ; le corps ne peut pas choisir un autre projet.
Le corps est limité à 1 Mio et chaque événement à 64 Kio. Les événements publics ont la source `sdk` et ne
peuvent pas employer les noms réservés aux faits vérifiés par le serveur.

Les points d’entrée existants restent utilisables :

| Entrée                                                         | Traitement                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `/event`, `/events`, `/api/v1/sdk/event`, `/api/v1/sdk/events` | Le contrat natif existant alimente le journal dans sa transaction.             |
| `/api/v1/analytics/events`                                     | Alias de la collecte du core avec le contrat Analytics existant.               |
| `/api/v1/app/events`                                           | Les événements clients deviennent des événements `customer.*` dans le journal. |

Les deux derniers alias conservent l’exigence d’un `Idempotency-Key`. La réponse
`202` confirme la conservation durable, pas la mise à jour des statistiques.
Les identifiants stables dédupliquent les réessais ; un identifiant réutilisé
avec un contenu différent produit une erreur `409`. Le serveur attribue le
format `customer` uniquement à l’entrée validée des événements clients.
Les SDK Flutter et FlutterFlow existants peuvent continuer à utiliser leurs URL.
Le suivi appareil et l’enregistrement du SDK restent dans les API du core.
Les interactions de workflow, les achats et les conversations restent des
commandes métier adressées au service responsable.

## Lecture par un plugin

Le contrat `@superboard/contracts/core-collection` fournit
`fetchCollectionProjects`, `fetchCollectionPage` et `consumeCoreCollection`.
Les appels passent par le service binding `API_SERVICE` et portent une signature
avec le secret interne. En environnement géré, la propriété de liaison
`superboard_plugin_id` doit correspondre au consommateur et son cycle de vie
doit autoriser l’exécution.

Les routes privées sont :

- `GET /internal/collection/v1/{plugin}/projects?after=0` : projets contenant des
  événements, par pages de 100 ;
- `GET /internal/collection/v1/{plugin}/events?project_id=1&after=0&limit=100` :
  événements d’un projet, ordonnés par séquence de réception ;
- le paramètre répétable `event_name` sélectionne jusqu’à 20 noms exacts.

Une page contient `items`, `nextCursor` et `hasMore`. La date métier
`occurred_at` ne définit pas l’ordre du curseur : un événement ancien reçu
tardivement reste lisible. La lecture ne supprime ni n’acquitte les données du
core. Deux plugins peuvent relire les mêmes événements indépendamment.

Chaque consommateur possède sa table `core_collection_cursors`. Le lecteur
commun traite au maximum dix projets et cent événements par projet et par
passage. Il reprend au projet suivant lors du prochain passage. Le curseur
d’événement avance après le succès durable du traitement. Un rejet bloque la
progression de ce projet pour ce consommateur, tandis que les autres projets
continuent. Une interruption entre traitement et sauvegarde du curseur entraîne
une relecture : le traitement doit être idempotent.

Analytics, Marketing et App consomment lors de leur passage planifié. Le
délai visible dépend de la taille du retard, des rejets et de l’activité du
consommateur. Les paramètres de traitement d’Analytics ne désactivent pas la
collecte du core. Une application exclue d’Analytics est ignorée par sa
projection, tandis que ses événements restent dans le journal. Une relecture
explicite est nécessaire pour reprendre ces événements après avoir réinclus
l’application. Les preuves d’achats produites par Billing restent distinctes
des revenus déclarés par un SDK.

## Mise à niveau

Appliquer la migration API `0071_core_collection.sql`, la migration Analytics
`0003_core_collection_cursor.sql` et la migration App
`0005_core_collection_cursor.sql` avant de mettre à jour les services.
Appliquer aussi la migration Marketing `0017_core_collection_cursor.sql`.
La migration Site `0055_core_sdk_collection.sql` enregistre les nouveaux
artefacts de plugins.
Régénérer les configurations des services : App reçoit un binding `API_SERVICE`
et une planification chaque minute. Déployer le core avant les consommateurs.

La migration API conserve les données existantes et reprend les faits de
`analytics_fact_outbox`, y compris ceux déjà livrés ou en échec. Un trigger
capture les écritures des producteurs existants dans la même transaction ;
les anciennes tables restent présentes pour la compatibilité. Les anciennes
livraisons directes à Analytics sont retirées du code mis à jour. Ses reçus
existants dédupliquent la reprise du journal.
L’entrée interne des signaux Marketing reste compatible avec les producteurs
existants ; ses reçus dédupliquent les signaux déjà reçus par Analytics.

L’effacement d’un compte supprime les événements du sujet dans le journal et
leur copie historique dans l’outbox. Une reprise de consommation ne doit pas
réintroduire ces événements. Les politiques de conservation des projections
Analytics concernent leurs propres tables ; elles ne purgent pas le journal
du core.

## Vérification locale

Les tests de collecte utilisent SQLite et les implémentations du core et des
consommateurs. Pour vérifier le parcours dans un navigateur, lancer
`pnpm collection:test:browser`, puis ouvrir `http://127.0.0.1:4399`.
Les bases sont isolées en mémoire. La disponibilité des plugins est simulée et les files de livraison sont
neutralisées ; l’ingestion, les signatures, les curseurs et les reçus
Analytics utilisent le code du dépôt.

Les URL publiques et leurs alias sont décrits dans le [contrat des endpoints](PUBLIC_ENDPOINTS.md).
