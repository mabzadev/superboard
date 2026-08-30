# Parity Matrix et autorité des Stores EmDash

Cette livraison prépare la migration vers les Stores propriétaires des plugins sans effectuer de bascule publique. Le Dashboard historique, le gateway et les Workers existants restent en place pour la coexistence et le rollback.

## Artefacts d’autorité

- `config/emdash-parity-matrix.json` contient 143 lignes exécutables générées depuis les surfaces Dashboard, API, Worker, JavaScript, React Native, Flutter et FlutterFlow. Chaque ligne `required` lie une baseline, une cible, un test existant et le SHA-256 exact de ce test. Le test Dashboard compile puis sert réellement chaque route en HTTP ; les groupes API pointent vers leurs tests comportementaux de route ou de contrat.
- `config/emdash-plugin-topology.json` contient cinq manifests full et quatorze manifests de famille module. Ils utilisent tous le contrat commun fermé `SuperBoardPluginManifest` et passent son validateur runtime. Leurs 85 Stores correspondent aux domaines déclarés et aux vraies tables cibles du registre de cutover ; chaque Store possède son repository et ses checksums canoniques. Les modules possèdent en plus un Worker Descriptor transitoire lié à un test runtime réel. Les contrats de lease/outbox ne sont exigés que pour les exécutions asynchrones ; les callbacks absents sont marqués `not_applicable`, et le custom VocoStar historique reste explicitement `not_ready` tant que son gateway legacy ne vérifie pas le nouveau protocole.
- `docs/evidence/issue-54/parity-matrix.receipt.json` lie par checksum les deux artefacts précédents, leur nombre total de lignes et leur nombre de lignes requises.
- `docs/evidence/issue-54/isolated-store-restore.receipt.json` prouve hors production la restauration logique d’un D1 contenant FTS5, d’objets R2 et de valeurs KV.

Support étendu et Flows complet conservent systématiquement `source_status: unvalidated`, `required: false` et leur blocker explicite. Le générateur refuse leur promotion implicite.

## Autorité d’écriture

La migration D1 Site `0005_plugin_store_authority.sql` introduit le repository commun des Stores de plugins :

- clé d’autorité `(plugin, store, instance, type, id)` ;
- compare-and-swap par révision ;
- idempotence par `operation_id` ;
- outbox créée par trigger dans la même écriture que le record ;
- payload JSON canonique et checksum SHA-256 ;
- chiffrement AES-256-GCM obligatoire avant toute écriture D1 ; aucun e-mail, credential ou payload sensible n’est stocké en clair ;
- index de lecture par instance/plugin/type ;
- métriques de shadow read limitées au plugin, type, résultat et comptages, sans payload ni PII ;
- leases Worker à usage unique, liées à une tentative, une opération, une expiration et un token callback stocké uniquement sous forme de hash ; une nouvelle tentative invalide atomiquement la précédente.

La migration générée `0006_plugin_manifest_registry.sql` installe les artefacts de manifest immuables et active leur checksum dans une table de confiance du Site. Une commande d’écriture ne fournit jamais sa propre autorité : le repository résout le manifest actif par `plugin_id`, vérifie son checksum avec le validateur commun, puis refuse tout Store absent ou hors namespace.

Les aliases publics `projectId` et `pid` sont résolus vers l’`instance_id` canonique. Une divergence entre aliases ferme l’écriture. Les contrats publics ne changent pas : la fixture commune `packages/contracts/fixtures/emdash-store-parity/v1.json` traverse les vrais encodeurs, bridges ou modèles de JavaScript, React Native, Flutter et FlutterFlow.

## Migration et rollback

Le moteur existant `scripts/module-cutover/` reste read-only par défaut et conserve ses gardes de production. Chaque entité réelle du registre porte désormais son `pluginId`, son `storeId` et son `repositoryId`. En mode apply, le moteur exige la clé AES-256 dédiée, écrit d’abord les données chiffrées dans le repository du Site D1, puis seulement la projection de compatibilité dans le D1 de module. Une reprise réutilise l’opération déterministe sans dupliquer l’autorité. Le moteur refuse toute écriture non liée à un repository. Les tests prouvent :

- comptages et checksums déterministes ;
- double import sans duplication ;
- reprise depuis checkpoint après interruption ;
- arrêt immédiat sur mismatch ;
- shadow read fail-closed avec métrique sans PII ;
- reverse delta replayable vers le legacy ;
- rollback bloqué tant qu’un backup, une version Worker ou un reverse delta manque ;
- aucune instruction de suppression dans les deltas produits par le repository EmDash.

La sauvegarde D1 avec FTS5 suit un chemin séparé de `wrangler d1 export` : les tables autoritatives sont exportées logiquement et checksumées, les tables FTS5 sont recréées puis reconstruites depuis les tables restaurées. La preuve déterministe effectue une vraie requête `MATCH`. Un test Worker supplémentaire sauvegarde et restaure les mêmes artefacts au travers de vrais bindings Miniflare R2 et KV, puis relit leurs octets. Aucune ressource distante ou production n’est lue ou modifiée.

## Commandes de preuve

```sh
node scripts/emdash-parity-matrix.mjs
node --test scripts/emdash-parity-matrix.test.mjs
node --test scripts/emdash-store-restore.test.mjs
node --test scripts/module-cutover/*.test.mjs
pnpm --filter @superboard/site test:runtime
pnpm --dir sdks/javascript test
pnpm --dir sdks/react-native test --runInBand --selectProjects plugin
flutter test sdks/flutter/test/emdash_store_parity_test.dart
flutter test sdks/flutterflow/test/emdash_store_parity_test.dart
```

Les opérations de provisionnement distant, de domaine, de trafic et de mutation production restent hors périmètre de cette livraison.
