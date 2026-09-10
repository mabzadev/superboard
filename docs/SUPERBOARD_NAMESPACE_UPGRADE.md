# Canonical SuperBoard namespace

This checkout uses `SuperBoard` for public types and product names, `superboard`
for package paths and protocol identifiers, and `SUPERBOARD_` for environment
variables. Deprecated namespace aliases and duplicate Dart entrypoints are removed.

Flutter and FlutterFlow 4.0.0 are pending releases. Rebuild native applications
when upgrading. HTTP clients must use the canonical headers and
`/auth/superboard-token`; signed purchase data uses `superboard-purchases` as
issuer and `superboard-sdk` as audience. Local SDK cache keys use the canonical
namespace. Earlier cached native wrappers and signed payloads are not accepted
by the 4.0.0 sources.

The standalone Android, iOS, JavaScript, React Native and archived Support SDK
sources have also been renamed. Their recorded release commits describe
historical artifacts. Renaming this checkout does not publish replacement
packages, move immutable tags or change a remote registry.

## Existing deployment configuration

Configure the canonical environment keys with the existing values before
deploying. This includes `SUPERBOARD_TARGET`, `SUPERBOARD_ENVIRONMENT`,
`SUPERBOARD_RELEASE`, `SUPERBOARD_BACKUP_ENCRYPTION_KEY` and
`SUPERBOARD_ENTITLEMENT_WEBHOOK_SECRET` where applicable. The environment helper
does not fall back to a previous namespace.

## Existing API databases

Two early API migrations have canonical filenames. Before applying the current
migration chain to an existing database, reconcile their applied names and the
billing comparison column. Work from a verified SQLite backup:

```bash
node scripts/database/canonical-namespace-upgrade.mjs --database /path/to/api-backup.sqlite
```

The default command prints the SQL plan without changing the file. It discovers
the previous names from migration history and preserves the values in billing
comparisons. Apply the reviewed plan to a local copy with:

```bash
node scripts/database/canonical-namespace-upgrade.mjs --database /path/to/api-copy.sqlite --apply
```

The local update is transactional and can be retried. Ambiguous migration
history is rejected. For a remote D1 database, apply the reviewed SQL plan using
the existing backup and migration workflow before running the ordinary migration
chain. The tool does not connect to Cloudflare or deploy a Worker.

The subsequent Site migration `0031_canonical_namespace_manifests.sql` installs
the regenerated plugin manifest artifacts.

## Verification

`pnpm brand:check` rejects the retired namespace in source contents and filenames,
including tests, SDKs and tracked build artifacts. Ignored build outputs, local
backups and Git history are not source inputs. `pnpm sdk:catalog:check` verifies source versions and release state.
