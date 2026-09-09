# Simplification de SuperBoard : plugins et sous-domaines

Statut : proposition historique du 8 septembre 2026. L’utilisateur a demandé son regroupement de plugins le 9 septembre ; son [implémentation locale et ses contrats](./SUPERBOARD_PLUGINS_REGROUPES_2026-09-09.md) sont décrits séparément. Les comptes « actuels » ci-dessous décrivent l’état antérieur à ce regroupement ; les comptes Cloudflare n’ont pas été inspectés.

La répartition des domaines de cette proposition est remplacée par le [choix utilisateur à six sous-domaines et MCP sous la console](./SUPERBOARD_DOMAINES_CONFIGURATION_2026-09-08.md). La proposition de regroupement des plugins reste distincte.

## Cible proposée

SuperBoard expose sept plugins métier et un socle technique obligatoire. Vocostar ajoute un huitième plugin. Les domaines publics sont organisés autour de cinq rôles : console, API, authentification, fichiers et liens. Quatre rôles peuvent suffire après une migration validée de l’authentification vers l’API.

| Ensemble complet      | Plugins séparés actuels | Plugins métier cibles |                    Workers regroupés |
| --------------------- | ----------------------: | --------------------: | -----------------------------------: |
| SuperBoard seul       |                      18 |             7 + socle | 10, conservés dans cette proposition |
| SuperBoard + Vocostar |                      19 |             8 + socle | 13, conservés dans cette proposition |

Les 18 entrées actuelles incluent cinq fonctions transférées dans le socle. Elles restent disponibles mais ne sont plus cinq extensions à installer séparément. Le compte exclut le modèle de plugin custom et l’extension de référence MBZA. La cible Vocostar actuelle désactive Analytics et Flows et prévoit donc 11 workers ; ce profil reste possible après regroupement.

## Sept plugins métier

| Plugin cible        | Entrées actuelles réunies                                                          | Responsabilité                                                                               |
| ------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Identité            | `supbrd-plug-user`                                                                 | Utilisateurs d’applications, profils, organisations, rôles, connexions et sessions.          |
| Données et fichiers | `supbrd-plug-content`, `supbrd-plugmod-files`                                      | Contenus applicatifs, documents, révisions, fichiers, métadonnées et accès au stockage.      |
| Commerce            | `supbrd-plug-products`, `supbrd-plugmod-billing`, `supbrd-plugmod-paywalls`        | Catalogue, offres, prix, achats, abonnements, remboursements, droits et écrans d’abonnement. |
| Communication       | `supbrd-plugmod-marketing`, `supbrd-plugmod-email`, `supbrd-plugmod-dynamic-links` | Campagnes, contacts marketing, segments, e-mails, push, liens courts et attribution.         |
| Parcours            | `supbrd-plugmod-onboardings`, `supbrd-plugmod-flows`                               | Accueil des utilisateurs, ciblage et scénarios automatisés.                                  |
| Support             | `supbrd-plugmod-support`                                                           | Conversations, canaux, agents, intégrations et centre d’aide.                                |
| Statistiques        | `supbrd-plugmod-analytics`                                                         | Événements, tableaux de bord, cohortes, rétention, rapports et alertes.                      |

Vocostar demeure une extension indépendante : `supbrd-plugmod-vocostar`. Ses voix, conversions, résultats, jobs et réglages restent propres à l’application. Ses trois workers — métier, voix et média — restent dédiés.

Ces regroupements correspondent à des tâches continues : préparer une offre puis suivre ses achats ; créer une campagne puis mesurer les clics de ses liens ; définir un onboarding puis déclencher un scénario. Le support conserve son propre cycle de vie et Statistiques peut toujours être désactivé indépendamment, comme dans le profil Vocostar.

### Fonctions du socle

Les cinq entrées suivantes rejoignent les réglages et outils techniques de SuperBoard :

- `supbrd-plug-settings` : paramètres de l’instance et configuration des SDK ;
- `supbrd-plug-audit` : journal d’audit, archivage et vérification ;
- `supbrd-plugmod-gateway` : routage et politiques d’accès ;
- `supbrd-plugmod-observability` : santé, métriques et incidents ;
- `supbrd-plugmod-mcp` : exposition des outils, consentements et autorisations MCP.

Les options avancées restent configurables. Par exemple, l’accès MCP et les routes personnalisées peuvent être désactivés sans désactiver le routage nécessaire au fonctionnement de la plateforme. Le journal technique minimal et la connexion des opérateurs restent disponibles. Les e-mails nécessaires à la sécurité du compte opérateur ne doivent pas dépendre de l’activation des campagnes marketing.

Les menus, les vues système et les identités opérateur appartiennent toujours à EmDash. Désactiver Données ou Identité ne supprime pas les menus, les vues de configuration ou les comptes opérateur.

### Regroupement réel et fonctions optionnelles

La cible comporte sept unités métier d’installation, de mise à jour et de cycle de vie, plus Vocostar quand il est installé. Un regroupement de dix-huit cartes dans l’interface ne suffit pas à atteindre cette cible.

Les fonctions internes restent activables séparément dans les réglages de chaque plugin. Ainsi, Parcours peut conserver Onboarding avec Flows désactivé. Communication peut conserver les liens courts avec les campagnes désactivées. La migration reprend les états précédents : elle n’active pas une fonction qui était désactivée.

Les anciens identifiants deviennent des alias de compatibilité vers les nouveaux propriétaires. Les stores, tables, identifiants d’opérations, routes SDK et historiques restent conservés. Chaque store garde une seule autorité d’écriture. Les contrats de manifestes et de permissions doivent exprimer les fonctions actives et les workers nécessaires à leur exécution.

## Cinq sous-domaines canoniques

| Rôle             | Exemple SuperBoard MBZA | Exemple SuperBoard + Vocostar | Contenu                                                                                  |
| ---------------- | ----------------------- | ----------------------------- | ---------------------------------------------------------------------------------------- |
| Console          | `board.mbza.dev`        | `grow.vocostar.com`           | Front SuperBoard, administration EmDash sous `/_emdash/admin`, réglages et exploitation. |
| API              | `api.mbza.dev`          | `api.vocostar.com`            | API métier, endpoints des SDK et endpoint MCP.                                           |
| Authentification | `auth.mbza.dev`         | `auth.vocostar.com`           | Identité applicative, OAuth/OIDC, SSO et passkeys existantes.                            |
| Fichiers         | `files.mbza.dev`        | `files.vocostar.com`          | Uploads, téléchargements et contenus utilisateurs sur une origine distincte.             |
| Liens            | `in.mbza.dev`           | `go.vocostar.com`             | Liens publiés, redirections et associations mobiles.                                     |

Les noms ci-dessus réutilisent les domaines déjà déclarés. Le choix définitif de l’origine de console doit prendre en compte le domaine sur lequel les passkeys EmDash ont été enregistrées. Si ces passkeys utilisent `site.*`, cette origine reste servie pendant leur migration ; changer uniquement une redirection DNS ne les transfère pas.

Les cinq rôles sont les origines canoniques proposées pour les nouvelles intégrations. Le nombre réel de domaines servis peut rester supérieur pendant la conservation des alias. Les domaines commerciaux des applications et les domaines personnalisés des clients pour leurs liens sont hors de ce compte.

### Domaines regroupés

| Domaine actuel          | Destination proposée                       | Traitement de transition                                                                                                                                                                                |
| ----------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site.*`                | Origine Console                            | Conserver les chemins. Retirer l’alias seulement après validation des sessions et passkeys opérateur.                                                                                                   |
| `sdk.*`                 | Origine API                                | Utiliser les routes SDK déjà exposées sur l’API, notamment `/api/v1/sdk`. Conserver les anciennes URL pour les versions d’app encore utilisées.                                                         |
| `mcp.*`                 | Endpoint MCP sur l’origine API             | Ajouter un routage par chemin, avec découverte OAuth, audience et URI de ressource cohérentes. Les routes administratives `/api/v1/mcp` ne constituent pas à elles seules cette migration de protocole. |
| `mail.*`                | Vue de capture des e-mails dans la console | Accès opérateur requis. La capture reste une fonction de développement ; aucun besoin d’une origine publique dédiée.                                                                                    |
| `messages.vocostar.com` | Aucune nouvelle origine canonique          | Messaging est désactivé dans le manifeste. Vérifier les consommateurs historiques avant tout retrait.                                                                                                   |

Le partage d’une origine ne nécessite pas la fusion des workers. L’API transmet déjà les requêtes d’authentification à Identity et les requêtes de fichiers au service Files. L’origine MCP requiert en revanche un raccordement explicite du chemin au bon point d’entrée dans le runtime regroupé.

### Pourquoi conserver Auth, Fichiers et Liens

Le code Identity dérive le RP ID passkey du hostname de `AUTH_SERVER_URL` et utilise cette URL pour l’émetteur OIDC. Déplacer l’authentification vers `api.*` change donc des contrats existants. Le domaine `auth.*` reste canonique dans la première étape. Une cible à quatre origines exige un parcours testé de migration des passkeys, des clients OAuth/SSO, des cookies, des endpoints de découverte et des validateurs de jetons.

Le code EmDash traite les passkeys opérateur séparément : leur RP ID dépend du site. Cette vérification s’applique aussi au regroupement `site.*` et `board.*`/`grow.*`.

Fichiers conserve une origine distincte pour séparer les contenus utilisateurs des origines portant les sessions et les API. Les politiques actuelles acceptent notamment des fichiers binaires et, pour Vocostar, des familles de types audio et vidéo. Ce choix évite de faire dépendre toute l’isolation du système d’une future liste de formats autorisés.

Liens conserve son hostname pour les liens déjà distribués et les fichiers d’association Apple/Android. Le déplacer pour uniformiser les noms obligerait à maintenir les anciens domaines dans les applications et dans les liens existants.

Les sources primaires et les contraintes détaillées sont réunies dans [la note sur les domaines](./SUPERBOARD_DOMAINES_CONTRAINTES_2026-09-08.md).

## Configuration et interface EmDash

Les manifestes `deploy/targets/<cible>.json` restent la source des adresses et de l’état souhaité du déploiement. La cible comprend cinq rôles d’origine et une liste explicite d’alias de migration. Le compilateur produit les variables anciennes nécessaires aux SDK et aux workers ; ces valeurs dérivées ne deviennent pas une seconde configuration indépendante.

Une page de réglages EmDash affiche chaque rôle, son domaine canonique, ses alias, son worker de destination et son état vérifié. Une adresse attendue dans un manifeste et une adresse réellement rattachée dans Cloudflare doivent rester distinguées.

Les sept plugins contribuent leurs rubriques au menu natif EmDash. Les libellés, l’ordre, les sous-menus et les masquages restent éditables dans EmDash. Aucun catalogue de navigation parallèle ne doit être ajouté au front. Les routes métier existantes peuvent être conservées pendant le regroupement ; la suppression de plugins techniques n’impose pas une réécriture de toutes les URL de pages.

## Mise en œuvre proposée

1. Inventorier les installations, états des fonctions, stores, permissions, domaines Cloudflare, clients OAuth, RP ID et versions de SDK réellement utilisés. Valider la matrice de correspondance des 18 entrées avec le socle et les 7 plugins.
2. Livrer les contrats de regroupement et les alias. Migrer les paramètres et le cycle de vie par famille, en conservant les données et l’état d’activation de chaque fonction.
3. Afficher les sept plugins métier et la zone technique du socle dans EmDash. Vérifier les opérations réelles et les menus édités depuis EmDash.
4. Ajouter les nouvelles adresses canoniques des SDK et de MCP, puis migrer leurs clients. Conserver les anciennes routes en proxy de compatibilité lorsque les consommateurs ne peuvent pas suivre une redirection.
5. Regrouper la console et la capture d’e-mails, après vérification des sessions et passkeys opérateur. Retirer chaque alias uniquement lorsque les utilisateurs ou clients concernés ont migré.
6. Évaluer la migration d’authentification vers l’API. Le passage de cinq à quatre origines est une étape distincte ; garder cinq constitue un résultat acceptable si les clients existants imposent cette séparation.

Les APIs, les webhooks, les signatures, les téléchargements signés et les connexions persistantes ne sont pas migrés par une redirection générique. Aucun retrait d’ancien domaine, aucun déplacement de table et aucune bascule de worker ne sont autorisés par ce document seul.

## Critères de validation

- Toutes les commandes, sources de données, vues et opérations de la configuration actuelle ont un propriétaire dans la nouvelle matrice ; aucun doublon d’écriture.
- Les combinaisons d’activation antérieures sont conservées, notamment Onboarding actif avec Flows inactif et Statistiques désactivé sur Vocostar.
- Une migration interrompue reprend sans écraser les réglages modifiés, les historiques de paiement ou les personnalisations de vues et de menus.
- Les tests de contrat vérifient réellement les anciens identifiants, les permissions, l’activation des fonctions et les opérations métier après regroupement.
- Les tests EmDash → cache → front continuent à vérifier les renommages, déplacements et suppressions du menu.
- Les tests réseau vérifient les anciens et nouveaux endpoints, les corps POST, les signatures, OAuth/MCP, les passkeys et les associations mobiles. Les callbacks continuent à terminer les jobs déjà acceptés.
- Chaque alias retiré a une preuve de migration de ses consommateurs et une procédure de retour au routage précédent. Les passkeys et anciens liens sont des critères distincts du seul volume de trafic.
- Les règles de lint et les tests de génération imposent une source unique pour les domaines et les contributions de menus, des destinations sans collision et un rejet des paramètres de domaine codés en dur.

## Sources du dépôt

- [Catalogue des plugins](../../config/emdash-plugin-topology.json).
- [Groupes de workers](../../scripts/worker-deployment-groups.mjs).
- [Cible MBZA](../../deploy/targets/mbza-development.json) et [cible Vocostar](../../deploy/targets/vocostar.json).
- [Routage des sous-domaines](../../workers/api/src/index.ts) et [générateur Cloudflare](../../scripts/cloudflare-config.mjs).
- [RP ID Identity](../../workers/identity/src/melody/utils/crypto.ts), [découverte Identity](../../workers/identity/src/melody/handlers/other.ts) et [passkeys EmDash](../../packages/core/src/auth/passkey-config.ts).
