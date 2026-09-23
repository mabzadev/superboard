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
Les sources amont épinglées dans `sdks/web/flows/upstream/` restent intactes, avec
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
`checks/sdks/flutter/native/ios/`. Les tests Android utilisent les source sets des projets SDK.

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
pnpm local:test:front-layout
pnpm local:test:navigation
pnpm local:test:settings
pnpm local:stop --state-directory /tmp/superboard-validation
```

Les suites distantes, notamment `test:plugins:development` et les scénarios de
`e2e/site/remote/`, nécessitent une cible configurée. Une commande agrégée peut
inclure cette phase : consultez sa définition avant de l'utiliser pour une
validation uniquement locale.

`local:test:front-layout` utilise uniquement une adresse de boucle locale.
Il vérifie la connexion de développement, le chargement des utilisateurs,
l'unicité du lien d'administration, l'ordre titre/onglets en anglais et en
français et l'espacement de la bibliothèque des écrans d'abonnement.

`local:test:navigation` parcourt les liens du menu latéral et des sections dans
Chromium, attend le chargement de React, puis vérifie les réponses HTTP, les
requêtes API et les erreurs JavaScript. Il ouvre les six étapes Android et iOS
et exige les liens de configuration depuis Paramètres et Bibliothèques. Le
serveur local doit être démarré et le composant Paramètres activé. Ce parcours
fait également partie de `pnpm local:test`.

Pour limiter le parcours : `pnpm local:test:navigation /app/libraries`.
Sans argument, le parcours exécute aussi trois actions métier représentatives
depuis les vues publiées : recherche d'un utilisateur connu, actualisation des
statistiques marketing par la requête réelle, puis sauvegarde et relecture d'un
réglage de profil après rechargement. `SUPERBOARD_NAVIGATION_ACTIONS_ONLY=1`
exécute ces actions seules. `SUPERBOARD_NAVIGATION_REPORT=/tmp/navigation.json`
(ou `SUPERBOARD_POST_PUBLICATION_REPORT`) enregistre les imports contrôlés, les
pages rendues, les actions effectuées avec effet attendu et observé, et les
erreurs, avec langue et identité de Release Front ; une action ou une page en
échec fait échouer la commande. Les tests portent sur la navigation interne,
les chargements et ces actions ; les paiements, envois réels de messages et
validations auprès des boutiques exigent leurs propres tests d'intégration. La
réussite couvre les parcours exécutés et ne certifie ni l'ensemble des SDK ni
les fournisseurs externes.

`local:test:settings` ouvre les sept pages Settings en français et en anglais
sur l'instance locale démarrée, avec les plugins activés et leurs vues publiées.
Le parcours attend l'hydratation, ouvre Configuration au clavier, vérifie
l'identité du plugin dans le diagnostic et relance le contrôle de ses Workers.
`SUPERBOARD_SETTINGS_REPORT=/tmp/settings.json` conserve les résultats par URL,
langue et Release Front. Une erreur de page ou d'API fait échouer la commande.
Le statut de santé reste explicite dans le rapport : un diagnostic consultable
ne prouve pas qu'un service indiqué comme indisponible fonctionne. Ce parcours
ne vérifie pas la sauvegarde de tous les formulaires métier.

`pnpm test:navigation` vérifie l'accès au catalogue avec Paramètres actif et
Supervision inactive, le refus lorsque Paramètres est inactif ou l'opérateur
non autorisé, et la présence des liens de section. Le workflow GitHub `quality`
exécute ces tests. `pnpm lint:navigation`
contrôle les destinations des menus déclarés et l'existence des fichiers de
vue. Ces règles sont aussi exécutées par `pnpm lint` et `pnpm lint:quick`.

Les tests hérités de Melody dans
`checks/plugins/supbrd-plug-identity/worker/unit/melody/` sont conservés. Leur
ancien environnement Node, Redis et PostgreSQL n'est pas raccordé aux commandes
actuelles du Worker Cloudflare. Une réussite de ces commandes ne valide donc
pas cette suite héritée. Les tests iOS et les tests Android sur appareil exigent
également les plateformes et simulateurs correspondants.

## Lints et qualité

`pnpm lint` exécute les tests des analyseurs, les règles existantes et les
contrôles étendus. `pnpm lint:quick` sélectionne les fichiers modifiés ; un
changement de configuration ou de dépendances élargit la sélection. Les
contrats du dépôt restent vérifiés même lorsqu'aucun fichier source n'a changé.
L'analyse typée et Knip font partie du contrôle complet.

| Commande                   | Contenu                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `pnpm lint:quality`        | JavaScript, TypeScript, Astro, React, accessibilité, traductions, frontières des packages, chemins et dépendances. |
| `pnpm lint:quality:report` | Tous les diagnostics, y compris la dette initiale.                                                                 |
| `pnpm lint:test`           | Exemples valides et invalides des analyseurs, défaillances d'outils et protection des migrations.                  |
| `pnpm lint:contracts`      | Overlay, dépendances du workspace, configuration Cloudflare, exports publics et inventaire des services.           |
| `pnpm lint:automation`     | Workflows GitHub avec Actionlint et scripts shell avec ShellCheck.                                                 |
| `pnpm lint:dart`           | Flutter et FlutterFlow, avec leurs dépendances résolues par `flutter pub get`.                                     |
| `pnpm lint:android`        | Android Lint et Detekt ; nécessite Java 17, Android 35 et les Build Tools 34.                                      |
| `pnpm lint:swift`          | Sources Swift et tests maintenus, avec SwiftLint.                                                                  |
| `pnpm quality:check`       | Lint complet, contrats et vérification des types du projet.                                                        |
| `pnpm quality:release`     | Qualité, menus, traductions de production, artefacts des plugins et preuves locales de migration/restauration.     |

Les configurations se trouvent dans `lints/` : `quality.config.mjs` pour
ESLint/Astro, `quality.oxlintrc.json` pour l'analyse typée et les tests,
`quality-rules.mjs` pour les conventions SuperBoard, et `dart.yaml`,
`swiftlint.yml`, `android.gradle` pour les SDK. `repository.mjs` vérifie les
chemins et les configurations sans exécuter les commandes qu'il inspecte.

L'analyse typée vise les fichiers TypeScript. Les scripts JavaScript reçoivent
les contrôles syntaxiques et de dépendances. Les assertions non nulles et les
objets partiels des tests conservent leurs exceptions ; les promesses et les
assertions asynchrones restent contrôlées. Les fixtures autonomes reçoivent
l'analyse syntaxique ; leurs types sont validés par leurs suites de construction.
Les sources amont épinglées et les bundles Yarn ne sont pas réécrits pour
satisfaire les règles étendues. Le lanceur historique conserve sa couverture
du runtime SDK Flows importé.

`lints/baseline.json` enregistre les diagnostics existants au moment de
l'activation, par fichier, règle et empreinte de la ligne concernée. Un
diagnostic supplémentaire, déplacé dans un autre fichier ou portant sur une
ligne modifiée échoue. Le nombre de diagnostics connus apparaît dans la sortie :
un contrôle réussi ne signifie pas que cette dette est corrigée. La CI refuse
l'augmentation de ces exceptions par rapport à sa révision de comparaison.
Les erreurs de configuration, les analyseurs défaillants, les tests focalisés
et les modifications de migrations ne peuvent pas être masqués par cet état
initial. Les commentaires de désactivation hérités restent gérés par les
linters historiques ; les contrôles étendus s'exécutent indépendamment.

Les empreintes des diagnostics React excluent le chemin absolu et les numéros
de lignes de l'extrait affiché par le compilateur. Le message sémantique et la
ligne de code restent vérifiés : ajouter un import ne crée pas artificiellement
une nouvelle alerte, mais changer l'expression fautive reste bloquant.

La commande complète ne met jamais à jour cet état initial. L'option
`--capture-baseline` du lanceur est réservée à l'introduction examinée d'un
analyseur ; elle ne constitue pas une correction. Ajoutez un exemple qui
échoue et un exemple correct dans `checks/repository/quality.test.mjs` pour
chaque règle propre au dépôt.

Le workflow `Repository quality` exécute les contrôles de sources et les
analyseurs natifs. `SUPERBOARD_LINT_BASE` fixe la révision de comparaison pour
les migrations et la dette ; localement, sa valeur par défaut est `HEAD`.
Un outil natif manquant produit un échec explicite. Les règles statiques sur
les requêtes, les autorisations et le navigateur ne remplacent pas les parcours
réels, les tests de permissions et la vérification de la version déployée.

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
