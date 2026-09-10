# Scripts d'exploitation et de génération

Ce dossier contient les outils qui préparent, configurent ou exploitent le
projet. Les tests et linters sont regroupés dans [tests/](../tests/README.md).
Lancez les commandes `pnpm` depuis la racine du dépôt.

## Où chercher

| Dossier       | Rôle                                                                                   |
| ------------- | -------------------------------------------------------------------------------------- |
| `config/`     | Configuration commune, schémas JSON et catalogues versionnés.                          |
| `local/`      | Démarrage et arrêt de l'environnement local.                                           |
| `cloudflare/` | Registre des services, configurations Wrangler, déploiement, domaines et secrets.      |
| `github/`     | Configuration du dépôt, protections, environnements et reprise de l'historique Git.    |
| `emdash/`     | Intégration du CMS, génération des plugins, seed, modèles et mesure des requêtes SQL.  |
| `clients/`    | Catalogue et publication des SDK, génération FlutterFlow et source de sa bibliothèque. |
| `database/`   | Sauvegarde, restauration, orchestration des migrations D1 et outils de bascule.        |

Un outil spécifique à un plugin reste dans
`packages/plugins/<plugin>/scripts/`. Ses tests se trouvent dans
`tests/checks/plugins/<plugin>/`. Les outils d'import du SDK Flows restent dans
`sdks/flows/scripts/`, avec leurs tests dans `tests/checks/sdks/flows/`.

## Commandes courantes

| Besoin                               | Commande                              | Point d'entrée                                               |
| ------------------------------------ | ------------------------------------- | ------------------------------------------------------------ |
| Démarrer ou arrêter le projet        | `pnpm local:start`, `pnpm local:stop` | `local/start.mjs`                                            |
| Vérifier le code                     | `pnpm lint:quick`, `pnpm typecheck`   | `../tests/lints/lint.mjs` et les configurations des packages |
| Vérifier les déploiements            | `pnpm cloudflare:test:targets`        | `../tests/checks/cloudflare/`                                |
| Régénérer la configuration racine    | `pnpm emdash:overlay`                 | `emdash/overlay.mjs`                                         |
| Régénérer les catalogues des plugins | `pnpm emdash:parity:generate`         | `emdash/parity-generate.mjs`                                 |
| Vérifier le catalogue des SDK        | `pnpm sdk:catalog:check`              | `clients/sdk-catalog.mjs`                                    |
| Mesurer les requêtes du CMS          | `pnpm query-counts`                   | `emdash/query-counts.mjs`                                    |

`pnpm run` affiche la liste complète des commandes.

## Sources et fichiers générés

`config/emdash-root.overlay.json` définit les commandes et les ajouts de
SuperBoard. `config/emdash-integration.json` fixe la version d'EmDash et les
règles d'intégration. Après modification, `pnpm emdash:overlay` régénère
`package.json`, `pnpm-workspace.yaml`, `.gitignore` et le `README.md` racine.
`pnpm emdash:overlay:check` vérifie leur concordance.

Les configurations et leurs schémas restent ensemble dans `config/`. Les
catalogues signés des plugins y restent également ; régénérez-les avec leurs
outils pour conserver la cohérence des sommes de contrôle.

Les cibles de déploiement résident dans `../infra/targets/`. Les sorties de
compilation du déploiement et les dumps SQL sont dans `../infra/generated/`.
Les snapshots du nombre de requêtes restent versionnés auprès de
`emdash/query-counts.mjs` ; voir [l'analyse des dumps SQL](emdash/query-dumps.md).

## Développement et déploiement

Les noms des commandes de déploiement et des services restent stables. Le
déplacement des tests ne change pas les cibles, les bindings ou les migrations.
Les contrôles de déploiement sont exécutés depuis `tests/checks/cloudflare/` ;
les opérations restent dans `scripts/cloudflare/`.

Suivez le [workflow de développement](../docs/DEVELOPMENT_WORKFLOW.md) et le
[guide Cloudflare](../docs/CLOUDFLARE.md) pour la validation, les sauvegardes et le
déploiement. Une vérification locale ne publie pas un SDK et ne déploie pas de
service distant.

## Ajouter un outil

Choisissez l'un des sept dossiers existants et utilisez un nom décrivant son
action. Ajoutez ses tests dans la famille correspondante de `tests/checks/`.
Conservez les noms des commandes `pnpm` et modifiez leurs chemins dans l'overlay.

Les migrations restent chez leur service ou leur CMS propriétaire. Les
sauvegardes, états locaux et secrets restent dans leurs répertoires de données.
