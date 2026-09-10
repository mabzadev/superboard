# Plugins regroupés de SuperBoard

Le regroupement demandé le 9 septembre 2026 est implémenté et migré sur la console locale. SuperBoard comprend sept plugins métier et un socle obligatoire. Vocostar ajoute une extension indépendante. Aucun déploiement public ni changement DNS n’a été effectué.

## Unités installables

| Plugin              | Identifiant                 |
| ------------------- | --------------------------- |
| Identité            | `supbrd-plug-identity`      |
| Données et fichiers | `supbrd-plug-data`          |
| Commerce            | `supbrd-plug-commerce`      |
| Communication       | `supbrd-plug-communication` |
| Parcours            | `supbrd-plug-journeys`      |
| Support             | `supbrd-plug-support`       |
| Statistiques        | `supbrd-plug-analytics`     |

Le socle `supbrd-core` réunit les paramètres, l’audit, la passerelle, l’observabilité et MCP. Ses fonctions obligatoires ne peuvent pas être désactivées. MCP reste une fonction optionnelle. L’extension `supbrd-plugmod-vocostar` conserve son manifeste et ses workers dédiés.

Le transport `cloudflare-email` appartient à EmDash et reste indépendant des campagnes et emails applicatifs. La liste EmDash locale affiche donc neuf entrées : sept plugins métier, le socle et ce transport. Ce total ne signifie pas neuf plugins métier SuperBoard.

La répartition exacte des fonctions est définie dans [superboard-plugin-packages.json](../../scripts/config/superboard-plugin-packages.json). Le [catalogue généré](../../scripts/config/superboard-plugin-catalog.json) contient les manifestes des unités installables. Le build produit leurs points d’entrée ; les dix-huit anciens points d’entrée autonomes ont été retirés.

`scripts/config/emdash-plugin-topology.json` conserve les contrats des fonctions internes pour les versions publiées, les stores, les permissions et les opérations existantes. Ses entrées et les dossiers `src/front/plugins` ne servent plus à compter les unités installables. Les anciens identifiants restent les espaces de noms des fonctions et deviennent des alias vers leur propriétaire.

## Cycle de vie et fonctions

Une action d’activation ou de désactivation d’un plugin passe par une opération gérée et une publication de front. Désactiver un groupe retire ses fonctions encore actives ; les fonctions déjà désactivées restent dans leur état. Les opérations acceptées doivent terminer avant la désactivation, et les nouvelles prises de travail tiennent compte du propriétaire regroupé.

Les pages de plugins dans EmDash permettent d’activer ou de désactiver leurs fonctions internes. Réactiver Parcours ne réactive pas Flows si cette fonction était désactivée. Les préférences et états sont séparés par instance et environnement. Une fonction absente du déploiement ne peut pas être activée par la page. Vocostar est masqué et ses pages refusées lorsque la cible ne le déclare pas.

Les échecs de publication restaurent les états, preuves, préférences et données précédents. Les identifiants des opérations, leases, commandes et sources de données restent conservés. Les appels via un nouveau propriétaire utilisent les identifiants complets des contributions fournis par son catalogue ; les permissions et contrôles de la fonction concernée restent appliqués.

Les endpoints applicatifs d’Identité acceptent aussi le nouvel identifiant du plugin. Ils conservent l’authentification SDK par projet et utilisateur, sans exiger une session opérateur EmDash.

## Migration et réglages

[0028_plugin_packages.sql](../../apps/site/migrations/0028_plugin_packages.sql) ajoute les tables des packages, des préférences de fonctions et des reçus de migration. La reprise est idempotente. Elle conserve les désactivations explicites et attend la fin ou la récupération d’une opération en cours. Elle ne supprime ni contenu, ni historique, ni réglage.

Les réglages gardent leurs clés de stockage historiques `plugin:<fonction>:settings:<clé>`. Les nouveaux formulaires regroupent leurs schémas avec des noms de champs distincts. Le résolveur serveur de clés les relie au stockage existant. Les anciens lecteurs et les nouvelles pages accèdent ainsi aux mêmes valeurs, sans copie de secrets. Les versions historiques restent consultables ; les nouvelles versions sont rattachées au propriétaire regroupé.

Les anciens chemins d’administration de plugins redirigent vers leur propriétaire. La page des domaines et workers se trouve désormais à `/_emdash/admin/plugins/supbrd-core/configuration` ; son ancienne adresse reste compatible. Les réglages d’un plugin désactivé restent accessibles et le gestionnaire verrouille la désactivation du socle. Ces options d’interface complètent les contrôles serveur.

Les menus et comptes opérateur restent dans EmDash. Le menu du front `superboard-admin`, ses personnalisations et les langues autorisées du front sont conservés. Les contrôles natifs prennent en compte les préférences française, anglaise et arabe d’EmDash.

## Génération et contrôles

Après modification de la répartition ou des contrats internes, régénérer le catalogue :

```sh
rtk proxy pnpm plugins:catalog
rtk proxy pnpm plugins:test
rtk proxy pnpm lint:quick
```

Le lint bloque un catalogue qui ne correspond plus aux fonctions déclarées, un propriétaire manquant ou dupliqué, et la réapparition d’un point d’entrée autonome retiré. Les tests vérifient la conservation des contributions et des stores, les préférences d’activation, les reprises de migration, les contrôles rendus par Block Kit et le cycle complet de publication et de compensation. Les tests des handlers de réglages vérifient aussi lecture, écriture, suppression et masquage des secrets avec les clés historiques.

La vérification locale a couvert le catalogue dans EmDash, les commandes de Parcours, ses réglages regroupés et l’actualisation de la configuration. Après un rechargement à chaud de la configuration Wrangler, Astro a renvoyé des pages HTML vides ; un redémarrage complet a rétabli leur rendu. Les données locales ont été conservées.

Les contrôles ciblés totalisent 60 tests réussis : catalogue et adaptation EmDash (7), migration D1 (6), contrôles rendus (2), cycle de vie et compensation (19), compatibilité du SDK Identité (1), handlers de réglages (15), contrats de plugins et proxy MCP (9), bundle en sandbox (1). Le lint complet conserve deux diagnostics antérieurs dans `plugin-front-menu-integration.test.tsx` et `vite-config.ts`. Le diagnostic antérieur du test de bundle a été corrigé pendant l’adaptation de ce test.

La mise en service distante reste distincte. Appliquer les migrations avec le manifeste de la cible et vérifier les installations existantes avant la bascule ; les [commandes D1](https://developers.cloudflare.com/d1/wrangler-commands/) distinguent explicitement les bases locales et distantes. Le [choix des six sous-domaines](./SUPERBOARD_DOMAINES_CONFIGURATION_2026-09-08.md) reste inchangé.
