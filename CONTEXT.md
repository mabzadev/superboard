# Plateforme SuperBoard

Ce contexte définit le vocabulaire transversal de SuperBoard en tant que site EmDash, sans décrire son implémentation.

## Langage

**Site EmDash** :
Site déployable qui réunit le CMS EmDash, son administration interne et le Front SuperBoard qu’il publie.
_À éviter_ : Dashboard EmDash, SuperBoard monolithique

**Instance SuperBoard** :
Déploiement autonome d’un Site EmDash qui correspond à un unique projet SuperBoard et porte toutes ses API, données et surfaces d’administration.
_À éviter_ : tenant, workspace multiprojet, portefeuille de projets

**Identifiant d’instance** :
Slug stable et immuable attribué à une Instance SuperBoard d’après son site ou son application, par exemple `vocostar`.
_À éviter_ : nom d’affichage mutable, sélecteur de projet, tenant ID

**EmDash amont** :
Dépôt officiel `emdash-cms/emdash`, utilisé comme source de synchronisation mais jamais comme seconde autorité du produit SuperBoard.
_À éviter_ : dépôt canonique EmDash de SuperBoard, fork produit

**Socle EmDash intégré** :
Copie complète et exactement épinglée d’EmDash amont conservée dans le dépôt canonique SuperBoard.
_À éviter_ : dépendance EmDash flottante, sous-module externe

**Opérateur SuperBoard** :
Propriétaire humain unique d’une Instance SuperBoard, seul autorisé à ouvrir EmDash Admin et le Front SuperBoard.
_À éviter_ : utilisateur d’application, client final

**EmDash Admin** :
Surface interne du Site EmDash réservée à l’Opérateur SuperBoard pour construire, configurer et publier SuperBoard.
_À éviter_ : SuperBoard Admin, interface d’utilisateur d’application

**Identité EmDash** :
Identité dont l’autorité appartient au Site EmDash. L’identité de l’Opérateur SuperBoard appartient au core administratif ; les identités des utilisateurs d’application appartiennent à `supbrd-plug-user`.
_À éviter_ : identité Melody canonique, compte Dashboard générique

**Donnée EmDash** :
Donnée autoritative d’une Instance SuperBoard gouvernée par le Site EmDash, qu’elle soit éditoriale, administrative ou opérationnelle.
_À éviter_ : copie de cache, donnée possédée par un Worker

**Autorité d’écriture** :
Plugin ou repository EmDash unique habilité à modifier une catégorie de Donnée EmDash et à émettre ses reçus et événements.
_À éviter_ : écriture partagée, accès direct depuis plusieurs Workers

**Store de plugin** :
Stockage spécialisé gouverné par le Site EmDash dont le schéma, les écritures, les migrations et les sauvegardes appartiennent au repository d’un plugin.
_À éviter_ : base possédée par un Worker, stockage partagé sans autorité

**Événement analytique** :
Fait analytique exact et autoritatif conservé dans un Store de plugin D1 gouverné par EmDash.
_À éviter_ : datapoint échantillonné, archive R2, métrique agrégée

**Projection analytique** :
Vue accélérée ou agrégée reconstruisible depuis les Événements analytiques sans devenir une source de vérité.
_À éviter_ : audit, événement autoritatif, backup

**Ledger d’audit EmDash** :
Journal central immuable qui agrège les reçus atomiques de tous les repositories de plugins de l’Instance SuperBoard.
_À éviter_ : logs de Worker, Analytics Engine, audit best-effort

**Gateway API** :
Plugin module `supbrd-plugmod-gateway` qui possède le catalogue complet des routes et politiques API dans EmDash tandis que son Worker exécute le routage sans posséder les données métier.
_À éviter_ : proxy sans configuration visible, base métier centrale

**Route Gateway** :
Donnée EmDash qui décrit un chemin API, sa méthode, sa destination et toutes ses politiques d’accès et d’exécution.
_À éviter_ : route codée uniquement dans le Worker, chemin non inventorié

**Gateway Manifest** :
Artefact immuable, validé et activé atomiquement qui contient toutes les Routes Gateway exécutables d’une Instance SuperBoard.
_À éviter_ : table de routes lue à chaque requête, miroir incomplet du code

**Front Draft** :
Graphe global mutable et versionné qui rassemble toutes les entrées destinées à une future Release Front.
_À éviter_ : ensemble de drafts indépendants, état live partiel

**Draft Snapshot** :
Capture immuable de toutes les entrées et versions exactes d’un Front Draft utilisée comme unique input d’une compilation.
_À éviter_ : lecture du draft courant, snapshot par page

**Front Release Candidate** :
Artefact global immuable compilé depuis un Draft Snapshot et conservé inactif jusqu’à sa validation, sa preview et son approbation.
_À éviter_ : draft exécutable, release partielle, artefact mutable

**Canonical Release Payload** :
Représentation JSON normalisée et canonicalisée d’une Release Front utilisée comme input unique de son checksum et de sa signature.
_À éviter_ : JSON sérialisé localement, payload non déterministe

**Release Signature** :
Signature ES256 qui lie une Release Front, son Instance SuperBoard, son schéma et son checksum à la clé de release du Site EmDash.
_À éviter_ : checksum seul, clé JWT réutilisée, HMAC partagé

**Validation Receipt** :
Résultat immuable et checksumé d’un validateur exécuté sur un Front Release Candidate exact.
_À éviter_ : log de compilation, validation booléenne sans preuve

**Release Approval** :
Approbation explicite de l’Opérateur SuperBoard liée au checksum, à la signature et au jeu complet de Validation Receipts d’un candidate.
_À éviter_ : compilation réussie, approbation réutilisable

**Release Rollback** :
Retour contrôlé vers une Release Front antérieure par échange de pointeur lorsque compatible, ou par restauration des Stores et artefacts lorsque nécessaire.
_À éviter_ : recompilation approximative, activation d’une release incompatible

**Renderer Descriptor** :
Contrat immuable qui lie un Renderer de plugin à son build, son checksum, son ABI, ses schémas, ses capacités et ses états supportés.
_À éviter_ : plage de version résolue au runtime, renderer latest

**SuperBoard Plugin Manifest** :
Contrat commun fermé qui décrit l’identité, le type, les exécutions, contributions, Stores, Workers, capacités, migrations et pannes d’un plugin SuperBoard.
_À éviter_ : contrat déduit du code, manifest différent par famille

**Native Plugin** :
Plugin inclus dans le trusted computing base du Site EmDash et techniquement autorisé à accéder sans capability gate aux ressources du runtime.
_À éviter_ : plugin sandboxed, signature considérée seule comme preuve de confiance

**Plugin Namespace** :
Préfixe global formé du plugin id et du type de contribution qui rend chaque command, data source, event et renderer unique dans l’Instance SuperBoard.
_À éviter_ : identifiant court global, premier plugin installé gagnant

**Plugin Contribution Descriptor** :
Contrat fermé, versionné et checksumé qui décrit un Store, command, data source, event ou renderer déclaré dans le namespace d’un plugin.
_À éviter_ : contribution libre, contrat déduit des exports TypeScript

**Worker Descriptor** :
Contrat fermé qui lie un Worker dédié à son plugin, son artefact, ses ressources, bindings, secrets, protocoles, health checks et politiques de panne.
_À éviter_ : wrangler comme autorité, découverte runtime

**Execution Lease** :
Autorisation courte et liée à une tentative précise permettant à un Worker de retourner un résultat au repository propriétaire d’une Opération durable.
_À éviter_ : callback permanent, lease globale de Worker

**Plugin Lifecycle** :
Automate EmDash qui fait évoluer un plugin entre available, staged, installed, active, draining, disabled, quarantined et purged sans activation implicite.
_À éviter_ : installation égale activation, statuts libres par plugin

**Plugin Lock** :
Résolution immuable des versions et checksums exacts de tous les plugins et dependencies intégrée à une Release Front.
_À éviter_ : plage SemVer résolue au runtime, dependency informative

**Capability Approval** :
Consentement de l’Opérateur lié à l’artefact, au checksum et au jeu exact de capacités et ressources d’un plugin non natif.
_À éviter_ : autorisation héritée par plugin id, capability documentaire

**Worker Health** :
État vérifié par EmDash à partir du Worker Descriptor, du handshake, des dépendances, des callbacks, de la capacité et des résultats récents.
_À éviter_ : HTTP 200 auto-déclaré, première requête métier comme probe

**Circuit Breaker** :
Automate closed, open et half_open qui suspend l’attribution de nouvelles leases lorsqu’une command ou dependency dépasse sa politique d’échec.
_À éviter_ : retry illimité, panne silencieuse

**Execution Budget** :
Limites déclarées, approuvées et observées de CPU, temps, mémoire, réseau, concurrence, payload et backlog d’un plugin sandboxed ou Worker dédié.
_À éviter_ : limite Cloudflare implicite, budget informatif non appliqué

**Plugin Installation Plan** :
Saga durable et compensable qui prépare artefact, resources, Stores, migrations, Worker et validations sans activer les contributions du plugin.
_À éviter_ : installation progressive active, réparation manuelle implicite

**Execution Attempt** :
Tentative numérotée d’une Opération durable, liée à une Execution Lease propre et incapable d’écrire après expiration ou remplacement.
_À éviter_ : retry sans nouvelle lease, premier callback gagnant

**Failure Policy** :
Contrat explicite qui détermine fail_closed, degraded, stale, fallback ou unavailable pour une contribution ou dependency en panne.
_À éviter_ : comportement uniforme implicite, cache stale non autorisé

**Plugin Drain** :
Phase contrôlée qui arrête les nouvelles opérations, termine ou checkpoint les attempts actives et prépare une Release Front sans les contributions du plugin.
_À éviter_ : désactivation immédiate, attente indéfinie

**Plugin Quarantine** :
Isolement automatique ou manuel d’un plugin après violation d’intégrité ou de sécurité, sans purge de ses données ni de ses preuves.
_À éviter_ : circuit breaker opérationnel, suppression automatique

**Historical Component** :
Application, Worker ou store antérieur conservé uniquement pendant la coexistence et le rollback, sans appartenir à l’architecture plugin cible.
_À éviter_ : plugin cible, dépendance permanente cachée

**External Client** :
Application reference, SDK ou intégration qui consomme les contrats SuperBoard sans être installée comme plugin dans le Site EmDash.
_À éviter_ : Renderer de plugin, application administrative

**Capability Dependency** :
Dépendance plugin requise uniquement pour un sous-ensemble déclaré de commands, data sources, events ou renderers, avec un comportement d’absence explicite.
_À éviter_ : dépendance globale implicite, appel inter-plugin non déclaré

**Source Status** :
Classification delivered, unvalidated ou historical qui distingue la présence d’une feature dans la cible de son niveau réel de validation et de déploiement.
_À éviter_ : checkout local considéré comme livré, feature non validée considérée hors périmètre

**Dependency Policy** :
Contrat de Release Front qui classe une dépendance comme required, optional ou fallback et définit son gate d’activation et son comportement runtime.
_À éviter_ : dépendance implicite, absence sans état EmDash

**Last Verified Release** :
Dernière Release Front dont le runtime a vérifié l’Instance, le schéma, le checksum, la signature, les renderers et le Gateway Manifest.
_À éviter_ : dernier draft lisible, cache non vérifié

**Point de restauration d’instance** :
Checkpoint global signé qui relie les états restaurables de tous les Stores de plugins, objets R2, manifests et outboxes d’une Instance SuperBoard.
_À éviter_ : dernier backup disponible, snapshot supposé transactionnel

**Graphe de migrations** :
Manifeste EmDash qui ordonne les migrations possédées par les plugins selon leurs dépendances et versions de Stores.
_À éviter_ : migrations au démarrage des Workers, suite globale sans propriétaire

**Migration destructive** :
Migration qui supprime ou rend immédiatement incompatible une donnée ou une structure et dont le rollback exige un Point de restauration d’instance.
_À éviter_ : migration réversible, changement expand/contract

**Preuve de restauration** :
Résultat vérifié d’une restauration isolée démontrant qu’un Point de restauration d’instance et ses artefacts permettent réellement de revenir avant une Migration destructive.
_À éviter_ : backup présent, procédure non testée

**Opération durable** :
Commande synchrone ou asynchrone considérée comme acceptée uniquement après le commit de son état, de son idempotence, de son audit et de son outbox dans le Store propriétaire.
_À éviter_ : message Queue non persisté, succès anticipé

**Retrait de plugin** :
Cycle contrôlé de désactivation, quarantaine et purge explicite d’un plugin et de ses Stores sans confondre arrêt d’exécution et suppression de données.
_À éviter_ : désinstallation destructive immédiate, conservation implicite

**Front SuperBoard** :
Ensemble des surfaces d’administration produit publiées par le Site EmDash et réservées à l’Opérateur SuperBoard.
_À éviter_ : EmDash Admin, interface d’utilisateur d’application

**Présentation EmDash** :
Ensemble complet des pages, layouts, routes, menus, composants visibles, textes et états d’interface défini, composé et monté par le Site EmDash.
_À éviter_ : interface possédée par un plugin, page codée dans un Worker

**Renderer de plugin** :
Implémentation visuelle fournie par un plugin mais enregistrée, configurée, instanciée et montée exclusivement par la Présentation EmDash.
_À éviter_ : page de plugin, interface autonome, montage direct

**Utilisateur d’application** :
Utilisateur final d’une application cliente de l’Instance SuperBoard qui s’authentifie et consomme SuperBoard uniquement par les API et les SDK.
_À éviter_ : Opérateur SuperBoard, utilisateur du tableau de bord

**Jeton d’accès d’application** :
JWT de courte durée signé par le Site EmDash pour autoriser un Utilisateur d’application à appeler les API de l’Instance SuperBoard.
_À éviter_ : session de l’Opérateur SuperBoard, token EmDash opaque

**Jeton d’identité d’application** :
JWT OIDC signé qui atteste la connexion d’un Utilisateur d’application auprès de son client mobile sans autoriser directement les API.
_À éviter_ : Jeton d’accès d’application, session de tableau de bord

**Jeton de rafraîchissement d’application** :
Secret opaque, rotatif et révocable qui permet à un client mobile de renouveler les jetons d’une session d’Utilisateur d’application.
_À éviter_ : JWT longue durée, Jeton d’accès d’application

**Release Front** :
Représentation globale unique, complète, immuable et validée de toute la Présentation EmDash d’une Instance SuperBoard, activée atomiquement.
_À éviter_ : draft, page partielle, release par plugin

**Plugin full EmDash** :
Plugin `supbrd-plug-*` dont l’exécution et les données appartiennent entièrement au Site EmDash et qui peut fournir des Renderers de plugin sans posséder d’interface.
_À éviter_ : plugin module, Worker métier, plugin d’interface

**Plugin module** :
Plugin `supbrd-plugmod-*` configuré dans EmDash, associé à un Worker pour son runtime métier ou asynchrone, et qui peut fournir des Renderers de plugin sans posséder d’interface.
_À éviter_ : plugin full EmDash, Worker autonome, plugin d’interface

**Core SuperBoard** :
Plugin fondateur `supbrd-core` qui fournit le runtime générique utilisé par la Présentation EmDash sans posséder de page, composition ou interface concrète.
_À éviter_ : application SuperBoard, collection de pages, propriétaire de l’affichage
