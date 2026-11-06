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
`sdks/web/flows/scripts/`, avec leurs tests dans `tests/checks/sdks/web/flows/`.

## Commandes courantes

| Besoin                               | Commande                              | Point d'entrée                                               |
| ------------------------------------ | ------------------------------------- | ------------------------------------------------------------ |
| Démarrer ou arrêter le projet        | `pnpm local:start`, `pnpm local:stop` | `local/start.mjs`                                            |
| Vérifier le code                     | `pnpm lint:quick`, `pnpm typecheck`   | `../tests/lints/lint.mjs` et les configurations des packages |
| Vérifier les déploiements            | `pnpm cloudflare:test:targets`        | `../tests/checks/cloudflare/`                                |
| Régénérer la configuration racine    | `pnpm emdash:overlay`                 | `emdash/overlay.mjs`                                         |
| Mettre à jour EmDash                 | `pnpm emdash:upstream-sync`           | `emdash/upstream-sync.mjs`                                   |
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

## Mettre à jour EmDash

`pnpm emdash:upstream-sync` reporte les changements d'une version d'EmDash
dans le dépôt. Pour chaque fichier modifié par EmDash depuis le commit épinglé
dans `config/emdash-integration.json`, la commande fusionne la version
SuperBoard, la version épinglée et la version cible avec `git merge-file`.
Les modifications de SuperBoard sont conservées.

La section `upstreamSync` de cette configuration décide de la destination de
chaque fichier :

- `ignored` liste les expressions des chemins EmDash qui ne sont pas repris,
  par exemple les workflows GitHub d'EmDash ou les fichiers racine générés par
  l'overlay ;
- `relocated` associe une expression à son chemin dans SuperBoard ; la
  première règle correspondante s'applique. Les tests d'EmDash rejoignent
  `tests/checks/`, ses parcours navigateur `tests/e2e/` et ses fixtures
  `tests/fixtures/`.

Lorsqu'un fichier change de dossier, la commande réécrit ses chemins relatifs :
imports, `vi.mock`, `require`, `new URL(..., import.meta.url)` et appels à
`resolve` ou `join` fondés sur l'emplacement du module, directement ou par une
variable qui contient son dossier. Les imports privés de son paquet d'origine,
comme `#node-sqlite`, deviennent des chemins relatifs lorsqu'il quitte ce
paquet. Les fichiers restés en place qui désignent un fichier déplacé sont
réécrits de la même manière.

Pour passer à une nouvelle version, depuis une branche dédiée :

1. Récupérez la version cible d'EmDash :

   ```bash
   git fetch --no-tags https://github.com/emdash-cms/emdash.git "refs/tags/emdash@1.5.0"
   ```

2. Lancez la synchronisation sur le commit récupéré :

   ```bash
   pnpm emdash:upstream-sync --to FETCH_HEAD --report emdash-sync-report.json
   ```

   La commande écrit les fichiers fusionnés et met à jour `upstream.commit` et
   `upstream.version`. Avec `--dry-run`, elle n'écrit que le rapport. Elle
   récupère le commit épinglé s'il manque localement.

3. Résolvez les conflits listés dans le rapport, puis supprimez le rapport. Une
   fusion en conflit laisse les marqueurs de `git merge-file` dans le fichier.
   Les autres types de conflit (`deleted-upstream`, `deleted-locally`,
   `added-on-both-sides`, `binary`, `symbolic-link`) laissent le fichier
   SuperBoard inchangé.
4. Régénérez la configuration racine et les dépendances avec
   `pnpm emdash:overlay` puis `pnpm install`.
5. Exécutez `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm lint:contracts`,
   `pnpm emdash:test` et `pnpm superboard:test`.

La commande se termine avec le code 1 tant qu'il reste des conflits. Elle ne
lance aucune migration et ne déploie aucun service.

## Développement et déploiement

Les noms des commandes de déploiement et des services restent stables. Le
déplacement des tests ne change pas les cibles, les bindings ou les migrations.
Les contrôles de déploiement sont exécutés depuis `tests/checks/cloudflare/` ;
les opérations restent dans `scripts/cloudflare/`.

Le lanceur local conserve les journaux de chaque service dans son dossier
`logs/`. Il retire le transfert vers les consommateurs Tail du registre local,
qui peut réémettre ses propres erreurs pendant le démarrage. Les configurations
de déploiement Cloudflare conservent leurs consommateurs Tail. Le Site local
accepte le nom interne `site.internal` pour les appels signés des Workers ;
les autres noms non autorisés restent refusés.

`cloudflare:deploy` et `cloudflare:deploy:all` exécutent le lint complet et
`lint:contracts` avant les régressions des plugins et le déploiement.
`quality:release` rassemble la validation locale préalable ; son exécution ne
déploie aucun service. Le détail des contrôles et de la dette initiale figure
dans [le guide des tests](../tests/README.md#lints-et-qualité).

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
