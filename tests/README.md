# Tests et contrôles du dépôt

Tous les tests du code maintenu sont regroupés ici. Les applications, plugins et
SDK conservent leurs sources et leurs dépendances dans leurs dossiers d'origine.
Les commandes `pnpm` continuent à lancer les suites correspondantes.

## Les quatre dossiers

| Dossier     | Rôle                                                                              | Exemple                                                            |
| ----------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `e2e/`      | Parcours complets dans un navigateur ou une application mobile.                   | Se connecter, créer un contenu, changer de langue.                 |
| `fixtures/` | Données partagées et petites applications utilisées par les tests.                | Site EmDash isolé, site de performance, contrats JSON.             |
| `lints/`    | Analyse du code et règles communes du dépôt.                                      | Imports, marque, menus et séparation des configurations.           |
| `checks/`   | Tests unitaires, d'intégration et de runtime, ainsi que les contrôles des outils. | Vérifier une API, une migration ou un générateur de configuration. |

## Retrouver une suite

Dans `checks/`, le chemin indique son propriétaire :

| Chemin                | Ce qui est vérifié                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `apps/<application>/` | Site, serveur MCP, application de référence et applications EmDash.                                                      |
| `packages/<package>/` | Moteur EmDash et bibliothèques communes.                                                                                 |
| `plugins/<plugin>/`   | Interface et intégration d'un plugin. Les services regroupés gardent leur nom : `billing/`, `products/`, `worker/`, etc. |
| `sdks/<sdk>/`         | SDK JavaScript, React Native, Flutter, FlutterFlow, Android, iOS et Identity.                                            |
| `cloudflare/`         | Cibles, services, déploiement et gestion des secrets.                                                                    |
| `database/`           | Migrations, sauvegardes, restaurations et bascules.                                                                      |
| `emdash/`             | Intégration du CMS, catalogues, bundles et preuves d'installation.                                                       |
| `github/`             | Workflows, protections et configuration GitHub.                                                                          |
| `clients/`            | Catalogue des SDK et outils FlutterFlow.                                                                                 |
| `local/`              | Démarrage et supervision de l'environnement local.                                                                       |
| `repository/`         | Règles générales du dépôt et tests des linters.                                                                          |
| `infra/`              | Outils propres aux projets d'infrastructure.                                                                             |

Un sous-dossier `unit/` contient les tests d'une fonction ou d'un module.
`runtime/` exécute le service avec son environnement de test, notamment workerd.
`front/` vérifie les composants d'interface. Les sous-dossiers métier existants
restent en place lorsqu'ils permettent de retrouver une fonctionnalité.

Dans `e2e/`, `emdash/` couvre le CMS, `site/` couvre SuperBoard et `flutter/`
couvre l'intégration mobile. `site/remote/` contient les parcours qui nécessitent
une cible distante.

Les images de référence et snapshots propres à un test restent avec sa suite.
Les sources amont épinglées dans `sdks/flows/upstream/` restent intactes, avec
leurs tests d'origine. Les générateurs de fixtures exportés par
`packages/registry-moderation` sont utilisés par le runtime et restent dans ce
package.

## Exécuter les contrôles

Depuis la racine du dépôt :

```bash
pnpm install --frozen-lockfile
pnpm lint:quick
pnpm typecheck
pnpm cloudflare:test:targets
pnpm plugins:test
```

Les commandes de chaque package restent disponibles :

```bash
pnpm --dir packages/core test
pnpm --dir apps/site run test:front
pnpm flutter-purchases:check
pnpm flutterflow-purchases:check
```

Les configurations Vitest, Playwright, Gradle et Swift restent liées au projet
qu'elles exécutent. Elles pointent vers les sources de test centralisées. iOS
utilise le `Package.swift` à la racine ; ses tests se trouvent dans
`checks/sdks/ios/`. Les tests Android utilisent les source sets des projets SDK.

L'installation relie automatiquement les dépendances de chaque suite à son
package d'origine. Ces liens `node_modules` sont générés et ignorés par Git.
Après une installation avec `--ignore-scripts`, lancez `pnpm tests:prepare`.
`checks/project-config.mjs` porte ce raccordement commun et la configuration
Vitest ; il ne contient aucun test métier.

Pour les parcours locaux :

```bash
pnpm test:e2e
pnpm local:start --state-directory /tmp/superboard-validation
pnpm local:test
pnpm local:stop --state-directory /tmp/superboard-validation
```

Les suites distantes, notamment `test:plugins:development` et les scénarios de
`e2e/site/remote/`, nécessitent une cible configurée. Une commande agrégée peut
inclure cette phase : consultez sa définition avant de l'utiliser pour une
validation uniquement locale.

Les tests hérités de Melody dans
`checks/plugins/supbrd-plug-identity/worker/unit/melody/` sont conservés. Leur
ancien environnement Node, Redis et PostgreSQL n'est pas raccordé aux commandes
actuelles du Worker Cloudflare. Une réussite de ces commandes ne valide donc
pas cette suite héritée. Les tests iOS et les tests Android sur appareil exigent
également les plateformes et simulateurs correspondants.

## Ajouter un test ou un contrôle

Choisissez le propriétaire, puis un nom décrivant le comportement vérifié :
`plugin-activation.test.ts`, `backup-receipt.test.mjs` ou `navigation.spec.ts`.
Les fichiers `*.test.mjs` vont dans `checks/`. Les linters vont dans `lints/` et
leurs tests dans `checks/repository/`. Les données réutilisées vont dans
`fixtures/`.

Les commandes d'exploitation restent dans [scripts/](../scripts/README.md).
Un déplacement doit mettre à jour les imports, les configurations des lanceurs,
les commandes de l'overlay et les preuves générées qui référencent ces sources.
Les migrations existantes restent immuables.
