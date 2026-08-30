# Parity Matrix et autorité des Stores EmDash

Cette livraison prépare la migration vers les Stores propriétaires des plugins sans effectuer de bascule publique. Le Dashboard historique, le gateway et les Workers existants restent en place pour la coexistence et le rollback.

## Artefacts d’autorité

- `config/emdash-parity-matrix.json` contient 143 lignes exécutables générées depuis les surfaces Dashboard, API, Worker, JavaScript, React Native, Flutter et FlutterFlow. Chaque ligne `required` lie une baseline, une cible, un test existant et le SHA-256 exact de ce test.
- `config/emdash-plugin-topology.json` contient cinq manifests full et quatorze manifests de famille module. Chaque manifest possède un Store, un repository et des checksums canoniques. Les modules possèdent en plus un Worker Descriptor transitoire : aucune autorité d’écriture, lease liée à la tentative, idempotence et outbox obligatoires, callback signé et lié à la lease.
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
- index de lecture par instance/plugin/type ;
- métriques de shadow read limitées au plugin, type, résultat et comptages, sans payload ni PII ;
- leases Worker à usage unique, liées à une tentative, une opération, une expiration et un token callback stocké uniquement sous forme de hash.

Les aliases publics `projectId` et `pid` sont résolus vers l’`instance_id` canonique. Une divergence entre aliases ferme l’écriture. Les contrats publics ne changent pas : la fixture commune `packages/contracts/fixtures/emdash-store-parity/v1.json` est exécutée par JavaScript, React Native, Flutter et FlutterFlow avant/après le changement d’autorité.

## Migration et rollback

Le moteur existant `scripts/module-cutover/` reste read-only par défaut et conserve ses gardes de production. Les tests prouvent :

- comptages et checksums déterministes ;
- double import sans duplication ;
- reprise depuis checkpoint après interruption ;
- arrêt immédiat sur mismatch ;
- shadow read fail-closed avec métrique sans PII ;
- reverse delta replayable vers le legacy ;
- rollback bloqué tant qu’un backup, une version Worker ou un reverse delta manque ;
- aucune instruction de suppression dans les deltas produits par le repository EmDash.

La sauvegarde D1 avec FTS5 suit un chemin séparé de `wrangler d1 export` : les tables autoritatives sont exportées logiquement et checksumées, les tables FTS5 sont recréées puis reconstruites depuis les tables restaurées. Le test restaure également R2 et KV dans des Stores mémoire isolés, effectue une vraie requête `MATCH`, compare les comptages et produit un reçu immuable. Aucune ressource distante ou production n’est lue ou modifiée.

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
