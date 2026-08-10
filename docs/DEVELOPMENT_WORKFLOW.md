# OpenGrow development and release workflow

## Branches and environments

| Git branch     | GitHub Environment                  | Cloudflare environment | Default target                |
| -------------- | ----------------------------------- | ---------------------- | ----------------------------- |
| feature branch | none                                | none                   | local validation only         |
| `dev`          | `development`                       | `development`          | `mbza-development`            |
| `main`         | one or more production Environments | `production`           | configured production targets |

Inspect the exact branch-to-Environment matrix without contacting Cloudflare:

```bash
# Uses dev/main from the current checkout.
npm run github:deployment:plan

# Explicit form used by CI and release audits.
npm run github:deployment:plan -- --branch main
```

An explicit `--branch` wins over `GITHUB_REF_NAME`, which wins over the local
Git branch. Any value other than `dev` or `main` is rejected; feature branches
therefore cannot select a deployment.

Feature branches open a pull request into `dev`. After review and automated
checks, merging to `dev` deploys the development account and the `mbza.dev`
domains. Validation in the FlutterFlow reference application happens against
that environment. A pull request from `dev` to `main` promotes the same Git
commit; merging it deploys production. There is no persistent staging or
preview Cloudflare environment.

Protect `dev` and `main` in `opengrow-platform` with the single required status
check `CI gate`, one CODEOWNERS approval, stale-review dismissal and linear
history. It aggregates the always-required security/change plan and all
conditional Worker, Dashboard and Flutter jobs, rejecting any selected job that
failed or was cancelled. Protect `dev` and `main` in `opengrow-reference` with
`Reference gate` and the same CODEOWNERS requirement. Requiring these stable aggregate checks avoids a branch rule
that silently misses a conditional job or waits forever for a job that was
correctly skipped.

The Cloudflare deployment workflow normally starts only from a successful CI
`workflow_run`. Its manual dispatch path is reserved for redeploying an exact
long-lived-branch revision and queries GitHub Actions before continuing; a SHA
without a successful aggregate `CI gate` is refused. Cross-repository reference
dispatches additionally prove that the requested platform SHA belongs to the
official platform `dev` history before resolving local packages or deploying.

## GitHub Environment configuration

The strict, non-secret source of truth for repository structure is
`config/github-control-plane.json`. It declares both public repositories,
their descriptions, Issues/Projects/Wiki policy, allowed merge strategies,
automatic branch cleanup, default branch, stable required check, Environments,
mandatory CODEOWNERS review, variable names and secret names. Validate it
locally without contacting GitHub:

```bash
npm run github:readiness
```

If a declared repository does not exist, or the current operator cannot see it,
generate the remote bootstrap plan:

```bash
npm run github:bootstrap
```

This command is read-only by default and returns the exact confirmation derived
from the schema version and repository names. A reviewed plan may create only
the declared empty repositories with their exact visibility and settings:

```bash
npm run github:bootstrap -- \
  --apply --confirm "GITHUB:BOOTSTRAP:<schema>:<plan-digest>"
```

The bootstrap never initializes a commit, creates a branch, changes a Git
remote, uploads a secret or pushes a worktree. An HTTP `404` can represent a
missing repository or an inaccessible path; the plan states this ambiguity,
and a confirmed create fails without overwrite if the name already exists.
Only an explicit REST `404` can produce a
creation operation; authentication, authorization, malformed-response and
network failures block the plan. Repository creation therefore remains a
separate authorization from commit, push and reconciliation.

Before the first commit or push, refresh and inspect the exact local/remote
history relationship:

```bash
npm run github:history:plan -- --fetch
```

This inspection is read-only apart from updating local remote-tracking refs. It
verifies each checkout's canonical `origin`, current branch, local `HEAD`,
cleanliness, `origin/main`, `origin/dev` and merge base. When an independently
initialized remote `main` exists, the report derives an immutable audit branch
name from that exact SHA and lists preservation before publication of `dev`.
The displayed commands are evidence only: the script never commits, creates a
remote branch or pushes. Staging, committing, preserving the remote SHA and
publishing `dev` remain independently reviewed operations.
If the origin, local branch, worktree, local history, remote `main`, audit ref
or remote `dev` is unsafe, the repository is marked blocked and emits no push
command at all. In particular, a dirty worktree can never produce a
`publish-dev` command for its older committed `HEAD`.
An audit branch that already points at another SHA or a non-fast-forward remote
`dev` is a blocker; the plan never proposes a force-push.
Once both remote branches exist, a missing `main`/`dev` merge base is also a
blocker. `npm run github:history:bridge:plan` generates the exact local-only
preparation and protected maintenance-window controls for both repositories;
see [`GIT_HISTORY_BRIDGE.md`](./GIT_HISTORY_BRIDGE.md). The planner never
executes the generated merge or any remote operation.

After repository creation, inspect the real structure without changing it:

```bash
npm run github:readiness:remote
```

Aggregate the local target, source-control, SDK and reference-application gates
without changing GitHub or Cloudflare:

```bash
npm run platform:readiness
npm run platform:readiness:remote
node scripts/platform-readiness.mjs --remote --strict
```

The report distinguishes local contract validity from actual deployment
prerequisites. It reports resource names, unresolved non-secret binding IDs,
branch/commit cleanliness, pending immutable SDK releases, Google/Apple audience
configuration, the Support reference allowlist and only the presence of
credential names. It never returns credential values. Strict mode remains red
until the declared GitHub repositories, branches, protections, Environments,
target resources and acceptance configuration are all real.

The remote inspection deliberately returns no secret value and fails until the
repositories, `dev`/`main` branches and declared Environments exist.

Once both repositories and both branches have been pushed, preview the exact
structural convergence plan:

```bash
npm run github:reconcile
```

The reconciliation command is read-only by default. It detects drift in the
repository description, Issues/Projects/Wiki/download settings and allowed
merge strategies. It can converge those settings, create/update GitHub
Environments, non-secret Environment variables, the `dev` default branch and
hardened branch protection, but it deliberately cannot create repositories or
branches and cannot upload secret values. Apply the reviewed plan only with its
exact confirmation:

```bash
npm run github:reconcile -- \
  --apply --confirm "GITHUB:RECONCILE:<schema>:<plan-digest>"
```

The control-plane schema is version 7. Version 6 introduced the versioned
GitHub Environment protection intent; version 7 adds vulnerability alerts,
Dependabot security updates, future immutable releases and the Platform SDK tag
ruleset without weakening those Environment protections. An incompatible
manifest change must increment that version, automatically
invalidating confirmations issued for an older repository contract. The digest
also covers every endpoint and non-secret
JSON mutation body, so description, merge-policy, protection or Environment
drift invalidates a previously generated confirmation even within one schema
version.

Security and release integrity are code-first controls. Remote readiness is red
unless both repositories have vulnerability alerts and unpaused Dependabot
security updates enabled. It also requires repository release immutability for
future publications. The Platform additionally requires the exact active
`OpenGrow immutable SDK tags` tag ruleset, with no bypass actor, covering every
declared SDK and semantic-version tag and denying tag update and deletion. Tag
creation remains allowed, so the reviewed release workflow can continue to
publish a new version.

An `enabled` but `paused` Dependabot state is a reconciliation blocker, not an
enabled state. Resolve the outstanding security-update queue and require a
fresh remote inspection to report `paused=false`; the reconciler never hides
that condition behind an otherwise empty mutation plan.

`npm run github:reconcile` may only enable these controls or create the missing
exact tag ruleset after its code contract has been merged and its confirmation
digest has been independently reviewed. It never moves or deletes a tag, edits
or deletes a release, replaces a drifted same-name ruleset, or disables a
security control. A drifted ruleset is a manual blocker. GitHub applies release
immutability only to future releases, so readiness inventories older mutable
releases. An older release is compensated only when it has no attached assets
and its tag is covered by the exact no-bypass update/deletion ruleset; any
mutable legacy asset remains a hard blocker rather than being deleted or
republished automatically. See GitHub's documentation for
[immutable releases](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/establish-provenance-and-integrity/prevent-release-changes)
and [tag rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository).

The required `CI gate` also depends on `Non-Node dependency security`. That job
uses Python `3.13.7` with `pip-audit 2.10.1` against the VocoStar vocals
container requirements, and Ruby `3.4.9` with Bundler `2.7.2` and
`bundler-audit 0.9.3` against the committed React Native example
`Gemfile.lock`. CI pins both runtime versions, the audit orchestrator rejects a
tool-version mismatch before either scan, and the aggregate gate accepts this
job only when it returns `success`. Developers with those exact tools installed
can reproduce both scans with `npm run security:audit:non-node`.

The reconciler requires the stable aggregate check, one approval, stale-review
dismissal, administrator enforcement, linear history, resolved conversations,
and disabled force-push/deletion on both protected branches. It fails closed on
an inaccessible repository, missing branch or incomplete remote response.
Missing secret names remain explicit manual actions and keep readiness red until
an operator supplies their values through GitHub's encrypted secret interface.
The authenticated operator/token needs repository Administration write access,
and the GitHub organization plan must support protected private branches. The
payload follows GitHub's versioned REST contracts for
[branch protection](https://docs.github.com/en/rest/branches/branch-protection),
[deployment environments](https://docs.github.com/en/rest/deployments/environments)
and [Actions variables](https://docs.github.com/en/rest/actions/variables).

Create the GitHub Environments referenced by
`config/cloudflare-deployments.json`, or let the confirmed reconciler create
their non-secret structure. The current entries are `development` and
`production`; `cloudflare-*` is only the workflow concurrency group and is not
an Environment name. Protection intent is versioned beside variables and secret
names. While it is marked `pending-external`, reconciliation reports activation
as a manual prerequisite and cannot apply reviewer, timer or branch/tag rules.
After the current publication sequence, add the required second trusted human,
change the reviewed intent to `enforced`, apply the exact confirmed plan with no
pending jobs, then disable administrator bypass in the GitHub Environment UI.
In each environment:

- variable `OPENGROW_TARGET`: target manifest name; it must equal the `target`
  field of that Environment's versioned deployment-matrix entry or the job
  fails before any Cloudflare operation;
- secret `CLOUDFLARE_ACCOUNT_ID`: account selected for that environment;
- secret `CLOUDFLARE_API_TOKEN`: least-privilege deployment token for only that
  account; it must also be able to read the target zones, DNS records and Worker
  custom domains for the non-mutating ownership gate.
- development variable `OPENGROW_REFERENCE_REPOSITORY`: canonical owner/name of
  the reference repository;
- development secret `OPENGROW_REFERENCE_DISPATCH_TOKEN`: fine-grained token
  permitted only to create repository dispatch events in that repository;
- production secret `OPENGROW_BACKUP_ENCRYPTION_KEY`: base64 encoding of 32
  random bytes, retained independently for D1 recovery.

The separate `opengrow-reference` repository also uses a `development`
Environment. It contains the scoped Cloudflare account/token plus
`OPENGROW_PROJECT_KEY` and `OPENGROW_PROJECT_ID`. The latter two select the
registered MBZA test application at build time and never appear in the Git
tree. Reference CI first validates demo mode, records the exact tested platform
and reference SHAs, then rebuilds the live Web artifact from those immutable
revisions inside this protected Environment. Installation steps never receive
the project values.

Recommended values are `mbza-development` for development and `vocostar` only
while VocoStar remains the selected production migration target. Other
applications add one matrix entry, target manifest and GitHub Environment. They
do not copy the workflow or edit Worker source constants.

`.github/workflows/deploy-cloudflare.yml` is the single automatic deployment
authority. It starts only after a successful completed `CI` run on `dev` or
`main`, checks out that exact SHA, resolves every declared Environment for the
branch, proves that its mutable Environment target equals the reviewed matrix
target and rejects a superseded automatic revision. Each matrix job is isolated
by its Environment-scoped account and secrets.
It validates the target and common extension services, runs platform
typechecks/tests, then deploys every enabled Worker in dependency order:
observability/email/files/identity, domain modules, billing/custom, API and
MCP, then dashboard. The dashboard is always last because it depends on the API. A
production deployment encrypts all pre-migration D1 backups before artifact
retention; a missing encryption key blocks that release evidence.

`opengrow-reference/.github/workflows/ci.yml` is the separate publication authority
for the acceptance application. Pull requests and both long-lived branches run
the manifest, Dart and Flutter tests. A push to `dev` additionally builds Flutter
Web, stores the build as a short-lived artifact and deploys the exact artifact
to `https://reference.mbza.dev` with a generated Static Assets configuration.
It reuses the `development` Environment Cloudflare secrets but never reads
`OPENGROW_TARGET`; its own non-secret deployment contract is
`reference.project.json`. The reference `main` branch does not deploy to MBZA.
The workflow derives the Platform repository and its development branch from
that schema-validated project file through `reference-ci-metadata.mjs`; neither
value is duplicated as an application-specific workflow constant.

After a successful platform `dev` deployment, a separate job sends
`platform-dev-updated` with the exact platform commit SHA. The reference
workflow first proves that GitHub's default branch still equals the declared
development branch, then checks out that branch and the immutable Platform SHA
before testing and publishing. The dispatch token is distinct from Cloudflare
credentials. Because both canonical repositories are public, the reference
checkout uses no repository read token.

## Local procedure

Every operational command requires `--target` or `OPENGROW_TARGET`. OpenGrow
never selects VocoStar, mbza.dev or any Cloudflare account implicitly.

### Enregistrer une nouvelle application

`target:register` génère d'abord un manifeste complet et lance seulement le
bootstrap en lecture/planification. Sans `--apply`, aucune ressource Cloudflare
n'est créée. Les origines web, domaines, noms de ressources et audiences sont
des paramètres de cible; aucun hostname applicatif n'est ajouté au code commun.

```bash
npm run target:register -- \
  --target sample-development \
  --environment development \
  --account-alias sample-development \
  --workers-dev-subdomain sample \
  --api-domain api.sample.dev \
  --shortlinks-domain in.sample.dev \
  --sdk-domain sdk.sample.dev \
  --dashboard-domain grow.sample.dev \
  --files-domain files.sample.dev \
  --mcp-domain mcp.sample.dev \
  --mail-preview-domain mail.sample.dev \
  --mail-from-address noreply@sample.dev \
  --max-file-bytes 20971520 \
  --allowed-file-content-types application/pdf,image/png,text/plain \
  --operator-docs-url https://github.com/example/opengrow-platform/tree/dev/docs \
  --operator-support-email support@sample.dev \
  --application-web-origins https://reference.sample.dev \
  --auth-gateway-issuer https://api.sample.dev \
  --auth-gateway-audience opengrow \
  --auth-gateway-jwks-url https://api.sample.dev/.well-known/jwks.json
```

Le template crée des noms différents pour le bucket applicatif et le cache
Dashboard. La limite par fichier et l'allowlist MIME sont obligatoirement
déclarées par application; le Worker Files les applique aussi aux flux sans
`Content-Length`. Google/Apple, la liste Support et les features se déclarent
avec `--google-audiences`, `--apple-audiences`, `--support-project-ids` et
`--disable-features`. Une application mobile sans origine web conserve une
liste `webOrigins` vide mais explicite.

Pour compléter ou faire évoluer ces identifiants publics après le bootstrap,
utiliser le configurateur générique. Le premier appel ne modifie rien et émet
le diff exact ainsi qu'une confirmation liée au contenu désiré :

```bash
npm run target:configure-application -- \
  --target sample-development \
  --environment development \
  --google-audiences web-client.apps.googleusercontent.com \
  --apple-audiences dev.example.application \
  --web-origins https://reference.sample.dev \
  --support-project-ids 73

npm run target:configure-application -- \
  --target sample-development \
  --environment development \
  --google-audiences web-client.apps.googleusercontent.com \
  --apple-audiences dev.example.application \
  --web-origins https://reference.sample.dev \
  --support-project-ids 73 \
  --apply --confirm \
  "TARGET:CONFIGURE-APPLICATION:sample-development:development:<digest>"
```

Les listes peuvent être vidées explicitement avec `--clear-google-audiences`,
`--clear-apple-audiences`, `--clear-web-origins` et
`--clear-support-project-ids`. La commande accepte uniquement des audiences
publiques, des origines HTTPS sans credentials/chemin et des identifiants
Support numériques. Les secrets OAuth, Apple et Support restent dans les
contrats Cloudflare; ils ne sont jamais acceptés par ce configurateur.

`target:register` ne déploie jamais les Workers. Utiliser d'abord `--remote`
pour obtenir le plan lié au compte, puis `--apply --confirm <valeur exacte>`
pour créer/adopter uniquement les ressources. Les identifiants non secrets sont
ensuite revus et commités; les secrets sont configurés et vérifiés avant que le
workflow protégé ne puisse déployer.

Pour une extension applicative, le même appel accepte un contrat custom
entièrement déclaratif :

```bash
  --custom-source workers/custom/sample/src/index.ts \
  --custom-capabilities sample.convert,sample.jobs.retry \
  --custom-secrets MODEL_PROVIDER_TOKEN \
  --custom-vars-json '{"JOB_RETENTION_DAYS":"30"}' \
  --custom-crons-json '["*/5 * * * *"]' \
  --custom-d1-binding CUSTOM_DB \
  --custom-d1-name opengrow-sample-development-dev-custom-db \
  --custom-migrations-dir workers/custom/sample/migrations \
  --custom-service-bindings-json '[{"binding":"MODEL_SERVICE","workers":{"development":"model-worker-dev"}}]'
```

`--custom-d1-binding` et `--custom-migrations-dir` sont indissociables. Les
valeurs secrètes ne passent jamais dans ces options : `--custom-secrets`
déclare seulement leurs noms, puis `cloudflare:secrets:upload` reçoit un bundle
JSON exact depuis le gestionnaire de secrets et crée les versions inactives de
tous les membres du contrat. Le validateur refuse aussi qu'une variable custom écrase `APP_KEY`,
`ENVIRONMENT`, `CUSTOM_WORKER_CAPABILITIES` ou un binding secret.

```bash
npm ci
npm run migration:inventory:test
npm run cloudflare:test:targets
npm run cloudflare:test:services
npm run typecheck
npm test

# Inspect the exact deployment without remote mutation
npm run cloudflare:deploy:all -- \
  --target mbza-development --environment development --plan

# Inspect resources that would be provisioned
npm run cloudflare:bootstrap -- \
  --target mbza-development --environment development
```

Inspect local D1 histories without contacting Cloudflare:

```bash
npm run cloudflare:d1:plan -- \
  --target mbza-development --environment development --service all
```

Add `--remote-read` for a value-free Cloudflare comparison. The resulting JSON
contains `remote_read`, global `converged` and `pending_migration_count` fields,
plus `remote_converged`, `pending_migrations` and
`pending_migration_count` for each D1 owner. The parser fails closed on empty,
ambiguous or unknown Wrangler output and rejects any pending filename outside
the reviewed local migration chain. `ready` continues to mean that every D1
resource is provisioned; `converged` is the separate proof that no migration is
pending.

Every generated D1 owner config also pins Wrangler's migration ledger to
`d1_migrations` and derives `D1_EXPECTED_MIGRATION` from the final reviewed SQL
file in that owner's repository directory. Worker `/health` responses compare
the live ledger to that exact filename and report `current`, `behind` or
`drifted`. Missing or malformed ledger data is an unavailable database, not an
implicit healthy result. The platform aggregator also rejects a service that
claims `ok` without a valid current schema contract.

```bash
npm run cloudflare:d1:plan -- \
  --target mbza-development --environment development --service all \
  --remote-read
```

`migration:inventory:test` applique la chaîne complète des migrations de l'API
centrale à une base SQLite neuve, puis vérifie ses 118 tables, ses clés
étrangères, son intégrité et les colonnes de sécurité actuelles.
`cloudflare:test:targets` découvre en plus chaque couple cible/environnement
versionné et reconstruit une base neuve pour chaque propriétaire de schéma D1
activé, y compris les deux Custom Workers. Une nouvelle cible ou un nouveau
répertoire de migrations custom est donc couvert automatiquement sans modifier
la commande CI.

The first authorized bootstrap requires both the scoped account ID and token:

```bash
CLOUDFLARE_ACCOUNT_ID_MBZA_DEVELOPMENT=... \
CLOUDFLARE_API_TOKEN=... \
npm run cloudflare:bootstrap -- \
  --target mbza-development --environment development --apply
```

Bootstrap writes the newly resolved non-secret resource IDs into the manifest.
Review that diff before requesting permission to stage and commit it. Runtime
secret bundles are then piped from the approved secret manager to
`cloudflare:secrets:upload`; values never appear on a command line or in Git.

## Required secrets by service

Print the exact name-only contract for any target with:

```bash
npm run cloudflare:secrets:plan -- --target <target>
```

The schema-2 output also contains a complete value-free coordination graph. It
identifies every cross-Worker value, its provenance, its target/application
scope and its rotation procedure. See
[Gestion des secrets OpenGrow](./SECRET_MANAGEMENT.md). Production values are
never generated by this planning command.

On a brand-new Cloudflare account, create the private Worker service shells
before uploading secrets. The command first prints an account-fingerprinted,
read-only plan and requires its exact confirmation for apply. Each shell has no
route, `workers.dev` hostname, cron, Queue consumer, storage binding or secret;
it exists only because Cloudflare cannot upload an inactive version for a
Worker service that has never been created:

```bash
npm run cloudflare:workers:bootstrap -- \
  --target <target> --environment <environment>

npm run cloudflare:workers:bootstrap -- \
  --target <target> --environment <environment> \
  --apply --confirm CLOUDFLARE:WORKER-SHELLS:<target>:<environment>:<digest>
```

After the required secrets have been uploaded and the name-only preflight is
green, the normal deployment replaces every shell in dependency order. The
shell command is idempotent and never replaces an existing Worker.

For a capture-only development target, OpenGrow can generate the complete
cross-service secret graph in memory, fetch and fingerprint-check Apple's
official Root CA G3, upload one inactive secret version per private Worker, and
stage the dashboard OAuth database/hash pair together for the next deployment.
Subsequent Dashboard rotations use the separately confirmed bounded-overlap
command after migration 0056 is active; the clear client secret is never
written to the checkout.
Using versioned secrets prevents a secret update from accidentally activating
an uploaded application version. The command refuses production and never
prints or writes secret values into Git:

```bash
npm run cloudflare:dev-secrets:bootstrap -- \
  --target <development-target> --environment development

npm run cloudflare:dev-secrets:bootstrap -- \
  --target <development-target> --environment development \
  --apply --confirm CLOUDFLARE:DEV-SECRETS:<target>:development:<digest>
```

`CLOUDFLARE_ANALYTICS_TOKEN` must be supplied by the operator or secret manager
because OpenGrow cannot manufacture a scoped Cloudflare Analytics read token.
The development bootstrap does not accept SMTP credentials and cannot be used
for a production target.

The output never reads or returns secret values and distinguishes the complete
allowlist from the target-specific required set. After uploading the values,
verify the names present on every remote Worker:

```bash
npm run cloudflare:secrets:check -- \
  --target <target> --environment <environment>
```

The deployment workflow runs this name-only check and stops before upload when
a required name or key alternative is absent. The legacy `cloudflare:set-secret`
command is now a non-mutating compatibility guard: it rejects names outside the
registry and maps allowed names to their owning coordination contract without
reading stdin or invoking Wrangler.

Custom Worker validation is also manifest-driven. `npm run custom:check`
validates only the extension declared by `OPENGROW_TARGET`; CI uses
`npm run custom:check:all` to discover and validate every extension declared by
the checked-in target manifests. Adding an application therefore does not
require editing the common deployment workflow.
Before typechecking, these commands regenerate each extension's
`worker-configuration.d.ts` from its owning target through `wrangler types`.
The repository-wide `cloudflare:types:check` gate rejects stale D1, Service
Binding, variable or secret declarations, so custom Workers do not maintain a
second handwritten infrastructure contract.

Le protocole de jobs custom sépare explicitement les responsabilités. Le
client authentifié peut créer, lister, lire et annuler uniquement ses propres
jobs encore en attente. Le Worker applicatif décide si l'annulation est
possible et doit rendre toute compensation financière idempotente. La relance
d'un job en échec n'est jamais exposée au SDK mobile : elle passe par Grow,
requiert un administrateur de plateforme et conserve l'identité durable du
job. La référence renvoie `job_not_cancellable` pour ses reçus synchrones déjà
terminés, ce qui valide le comportement terminal sans simuler un traitement.

| Service                | Required secret examples                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| API                    | `JWT_SECRET`, `MODULE_INTERNAL_TOKEN`, `EMAIL_INTERNAL_TOKEN`, optional provider credentials                      |
| Dashboard              | `CLIENT_SECRET`                                                                                                   |
| Email                  | `EMAIL_INTERNAL_TOKEN`, `MAIL_PREVIEW_TOKEN`; SMTP host/user/password values for production                       |
| Identity               | `IDENTITY_KEYSET`, `EMAIL_INTERNAL_TOKEN`, `FILES_INTERNAL_TOKEN`                                                 |
| Files                  | `FILES_INTERNAL_TOKEN`, `FILES_DOWNLOAD_SIGNING_KEY` (JWKS is obtained through the configured gateway URL)        |
| Observability          | `OBSERVABILITY_INTERNAL_TOKEN`, analytics account/token when remote summaries are enabled                         |
| Domain feature Workers | `INTERNAL_API_TOKEN` plus module-specific encryption/signing keys; Marketing also receives `EMAIL_INTERNAL_TOKEN` |
| Custom Worker          | `CUSTOM_WORKER_TOKEN` plus app-specific provider credentials                                                      |

Marketing SMTP credentials are encrypted with its target-scoped
`SMTP_ENCRYPTION_KEY`. The DKIM selector is public project configuration; SPF,
DKIM and DMARC verification results contain no secret. Saving a profile resets
its verification evidence. Production campaign delivery remains closed until
the sender is rechecked successfully from `/marketing/settings`.

The same random value is used for both ends of a private contract (for example,
API, Identity, Marketing and Email Worker `EMAIL_INTERNAL_TOKEN`) but uploaded
independently to each Worker.

Generate a new application identity signing key outside the repository. The
generator creates a new file exclusively with mode `0600`, never prints the
private JWK, and refuses any destination inside the Git checkout:

```bash
npm run identity:keyset -- --output /absolute/secure/path/mbza-development-identity-keyset.json
npm run cloudflare:secrets:upload -- --target mbza-development \
  --environment development --contracts identity-identity-keyset
```

Import that file into the approved secret manager, then have the manager emit
the exact apply payload on stdin; securely remove the local file afterwards.
Never reuse the development keyset in production. During rotation, keep
the previous public key in `keys`, make the new private key `active_kid`, wait
longer than the maximum token TTL, then remove the retired key.

## Release gates

Before merging `dev` to `main`:

1. all unit/runtime/type tests pass;
2. `grow.mbza.dev/infrastructure` shows enabled Workers healthy and all public
   surface monitors, including `reference.mbza.dev`, reachable;
3. transactional mail appears in `mail.mbza.dev` and never reaches external
   recipients in capture mode;
4. upload, notification, Google/Apple authentication, paywall and support flows
   pass in `opengrow-reference`;
5. D1 migrations have a backup/rollback plan;
6. production target resources and secrets are complete;
7. VocoStar-specific conversion jobs pass through the authenticated
   `/api/v1/sdk/custom/v1/jobs` facade, including owner-scoped cancellation,
   while retry remains back-office only;
8. Chatwoot is removed only after OpenGrow Support parity and data migration are
   signed off.

## Bibliothèques et code FlutterFlow

`config/sdk-libraries.json` est l'unique catalogue de versions. Le fichier
`config/flutterflow-custom-code.json` est l'unique inventaire de widgets,
actions communes et adaptateurs réservés à l'application de référence.

Les exports FlutterFlow externes restent hors du dépôt Platform. Chaque analyse
applicative peut cependant posséder un snapshot versionné sous
`config/flutterflow-sources/`, vérifié sans lire ses fichiers `.env`. Pour
VocoStar :

```bash
npm run flutterflow:source:verify:vocostar -- \
  --source /chemin/vers/le/dernier/export-vocostar

OPENGROW_CLIENT_SOURCE_VOCOSTAR=/chemin/vers/le/dernier/export-vocostar \
  npm run flutterflow:source:verify:vocostar
```

`--source` est prioritaire lorsqu'il est fourni. Sinon, le vérificateur lit le
nom de l'application dans le manifeste et dérive automatiquement
`OPENGROW_CLIENT_SOURCE_<APPLICATION>`; il ne contient aucun chemin de poste.

Une application cliente versionnée peut aussi déclarer un plan de migration
dans `config/flutterflow-migrations/<application>.json`. Le validateur exige que
chaque gate du snapshot soit couverte une fois, que chaque remplacement existe
dans la surface FlutterFlow publique et que les dépendances de phase restent
acycliques et ordonnées :

```bash
npm run flutterflow:migration:plan:vocostar

OPENGROW_CLIENT_SOURCE_VOCOSTAR=/chemin/vers/le/dernier/export-vocostar \
  npm run flutterflow:migration:plan:vocostar
```

Sans source, la commande valide le contrat seulement. Avec une source, elle
rejoint le snapshot authentifié aux phases/lots de migration et sort avec le
code 2 tant qu'un lot reste rouge. Le rapport `platform:readiness` réutilise ce
même plan au lieu de maintenir une seconde liste de remplacements.

Le readiness global accepte les exports de plusieurs applications sans chemin
codé en dur. En local, fournir `--client-sources` avec des paires uniques
`application=/chemin/absolu` séparées par des points-virgules; en CI, utiliser
la variable dérivée du nom de l'application :

```bash
OPENGROW_CLIENT_SOURCE_VOCOSTAR=/chemin/vers/vocostar \
  npm run platform:readiness

npm run platform:readiness -- \
  --client-sources 'vocostar=/chemin/vers/vocostar;autre-app=/chemin/vers/autre'
```

Une application inconnue, un chemin relatif, une source absente, un snapshot
obsolète ou un gate de convergence rouge échouent tous en mode fermé.

Le contrôle recalcule les empreintes de toutes les sources générées référencées
par FlutterFlow et refuse une analyse devenue obsolète. Quand le manifeste
déclare un contrat `convergence`, il inspecte également le runtime Flutter
ignoré par Git, échoue si un chemin attendu manque, n'affiche jamais le contenu
trouvé et ne devient vert qu'après retrait des couplages legacy, câblage des
autorités communes et résorption du budget de diagnostics déclaré.

Après une modification de bibliothèque :

1. incrémenter la version dans la source du package;
2. mettre `sourceVersion` à cette version mais conserver
   `latestReleaseVersion` et le tag déjà publiés; le statut devient
   `pending-release`;
3. valider la bibliothèque, `npm run sdk:catalog:check` et la référence MBZA;
4. lancer `Prepare immutable SDK release` sur le commit `dev` relu.
   L'Environment
   GitHub `sdk-release` protège la création du tag; le workflow de publication
   revalide le catalogue depuis ce tag puis attend le job
   `authorize-publication` dans le même Environment avant tout envoi de package
   ou GitHub Release. Il ouvre ensuite une PR qui
   met à jour `latestReleaseVersion`, `releaseRef` et `releaseStatus`;
5. fusionner les PR de catalogue après CI. Dès que FlutterFlow et Support sont
   tous deux publiés, GitHub vérifie leurs tags/releases et ouvre une PR unique
   qui épingle les deux dépendances immuables dans `opengrow-reference`.

Le Dashboard `/app/libraries` est une vue de cet état Git. Il n'accepte ni
édition directe du code ni jeton de dépôt. Les écrans de configuration SDK ne
stockent que des références opaques `secret://`, `provider://` ou
`operator://`. Quand une clé APNs/FCM doit être consommée par le runtime Push,
sa valeur est chiffrée avant persistance D1 avec le keyring versionné
`STORE_CREDENTIALS_ENCRYPTION_KEYS`; seul ce keyring reste un secret Worker.
Les valeurs claires ne vont ni dans Git, ni dans les manifests de cible, ni
dans l'état FlutterFlow.

Le projet FlutterFlow réutilisable `OpenGrow` suit désormais le même modèle.
Sa source canonique est `tools/flutterflow-library/dsl/edit.dart`, son contrat
est `config/flutterflow-library.json` et son projet FlutterFlow distant n'est
qu'une cible compilée. Le contrat inventorie exactement 11 Library Values et 63
Custom Actions, refuse les dépendances SSH ou les branches mutables et vérifie
que les anciens tokens sont supprimés de l'App State. La commande locale est :

```bash
npm run flutterflow-library:check
```

Après publication des deux tags immuables requis, un merge relu sur `main`
déclenche `sync-flutterflow-library.yml`. Le workflow lit l'identifiant du
projet dans la variable GitHub `FF_LIBRARY_PROJECT_ID` et la clé dans le secret
`FF_API_KEY` de l'Environment `flutterflow-library`; il exécute
`flutterflow ai test` avant `flutterflow ai run`. Une version source encore
marquée `pending-release` bloque donc volontairement la mise à jour distante.
Le Dashboard affiche ce statut et les tags manquants sans posséder de droit
d'écriture sur le dépôt.

La session applicative suit la même règle. Depuis le SDK FlutterFlow `2.2.4`,
`opengrowApplicationInitialize` restaure automatiquement access token et refresh
token depuis le stockage chiffré natif, puis effectue la rotation avant
expiration. Le refresh token ne ressort jamais des actions publiques ;
`opengrowApplicationCurrentSessionJson` ne fournit à l'hôte que l'access token
éphémère, l'identité et l'échéance utiles à son auth en mémoire. Une application
ou une bibliothèque FlutterFlow qui redéclare ces tokens dans un App State
persisté, dans `SharedPreferences` ou dans son propre `FlutterSecureStorage`
duplique l'autorité et doit échouer à la revue de convergence.

Les bearer tokens Dashboard OAuth/MCP, les secrets client OAuth et les tokens
d'invitation/réinitialisation suivent une règle plus stricte : D1 ne conserve
qu'un digest SHA-256. Les seeds TOTP restent relisibles uniquement sous forme
chiffrée. La maintenance converge les anciennes lignes par lots; le statut
Infrastructure reste dégradé tant qu'une valeur réutilisable en clair subsiste.
Les chemins d'authentification Dashboard utilisent aussi la table commune
`dashboard_auth_rate_limits`; une réponse `429` avec `Retry-After` est attendue
après dépassement et les compteurs expirés sont purgés par la maintenance.
