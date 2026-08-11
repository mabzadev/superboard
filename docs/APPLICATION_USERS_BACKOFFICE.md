# Application users back office

SuperBoard exposes a target-owned administrator view at **App → Users**. It is
the common operational surface for application authentication and the optional
Billing capability; it is not an SuperBoard SaaS user database.

## Authority and scope

- Identity D1 is authoritative for application accounts, email verification,
  password presence, anonymous identity, Google/Apple links and sessions.
- Billing is authoritative for financial customers, verified subscriptions,
  entitlements, balances, transactions and paywall events.
- Each deployment target owns a distinct Identity Worker and Identity D1
  binding. The API resolves that binding from the typed target manifest. No
  Worker name, account id, database id, hostname or application id is embedded
  in the route or dashboard.
- The selected project is the dashboard authorization boundary. Only a project
  `owner` or `admin` may query the target's application identities. Billing
  remains project-scoped and optional, so a free user is visible even when no
  financial customer exists.

## API contract

Authenticated dashboard routes:

- `GET /api/v1/application-users/projects/:projectRef/users`
  accepts `q`, `limit` (1–100) and `offset`.
- `GET /api/v1/application-users/projects/:projectRef/users/:userId`
  returns the sanitized authentication detail.

The API validates the dashboard session and project role before calling the
target's `IDENTITY_SERVICE` binding. It replaces the dashboard bearer token
with a short-lived, HMAC-signed internal context containing the numeric
`project_id`, `projectRef`, instance, environment, role, request method and
exact Identity path. Identity verifies both the rotating internal token and
that signature before reading data, then binds `project_id` to every user,
provider and session query. Only allowlisted query parameters are forwarded.
Identity's internal routes cannot be reached from the public `/auth` proxy.

The response contains public account metadata, provider names, provider email,
verification booleans and aggregate session status. It never returns password
hashes, refresh-token hashes, email/reset tokens, signing keys, provider subject
hashes or internal credentials. All responses are `private, no-store`.

## Dashboard behavior

The App → Users list includes users without purchases and can search by user
id, email, name or authentication provider. Selecting a user shows:

- email verification and anonymous/account state;
- password presence without credential material;
- linked anonymous, Google and Apple identities;
- active, revoked and expired session counts;
- the matching Billing customer, active subscriptions and entitlements;
- recent paywall activity.

If Billing is disabled for an application target or temporarily unavailable,
Identity remains usable and the UI reports purchase state as unavailable. A
missing Billing customer is represented as a valid free account, not an error.

## Schema decision

Identity migration `0002_project_scope.sql` adds `project_id` to users,
provider identities, sessions and email/reset tokens. Composite uniqueness,
foreign keys and project-leading indexes prevent an email, provider subject or
session relation from crossing application boundaries. Access and SuperBoard
exchange tokens include a signed positive `pid`; refresh tokens rotate the
session already stored with its original project and cannot select a project
from caller-controlled headers.

The migration deliberately copies legacy rows with `project_id = NULL`: there
is no safe generic way to infer their application. Until every legacy row is
mapped, Identity returns `503 identity_project_backfill_required` from signed
project routes and reports the same reason from `/health`. It never falls back
to an unscoped query. New inserts and project-id updates are protected by D1
triggers.

For a D1 database known to contain exactly one legacy application, the operator
may backfill it in one transaction after resolving the numeric project id from
the target API D1 (shown here as `:project_id`):

```sql
BEGIN IMMEDIATE;
UPDATE application_users
SET project_id = :project_id
WHERE project_id IS NULL;
UPDATE application_identities
SET project_id = (
  SELECT application_users.project_id
  FROM application_users
  WHERE application_users.id = application_identities.user_id
)
WHERE project_id IS NULL;
UPDATE application_sessions
SET project_id = (
  SELECT application_users.project_id
  FROM application_users
  WHERE application_users.id = application_sessions.user_id
)
WHERE project_id IS NULL;
UPDATE application_identity_tokens
SET project_id = (
  SELECT application_users.project_id
  FROM application_users
  WHERE application_users.id = application_identity_tokens.user_id
)
WHERE project_id IS NULL;
COMMIT;
```

For a shared legacy D1, first create and review an explicit `user_id →
project_id` inventory from application ownership evidence; never run the
single-project update. Deployment remains blocked until this verification
returns zero:

```sql
SELECT
  (SELECT COUNT(*) FROM application_users WHERE project_id IS NULL) +
  (SELECT COUNT(*) FROM application_identities WHERE project_id IS NULL) +
  (SELECT COUNT(*) FROM application_sessions WHERE project_id IS NULL) +
  (SELECT COUNT(*) FROM application_identity_tokens WHERE project_id IS NULL)
  AS unscoped_rows;
```

The deployment orchestrator performs that remote verification after D1
migration convergence and before activating the Identity Worker. It writes a
mode-`0600` receipt outside Git bound to the target, environment, Cloudflare
account id, Identity database name and id, final migration, exact 40-character
Git revision and the four zero counters. The Identity deploy reads the supplied
audit receipt, verifies its SHA-256 and rejects any mismatch or stale revision.
It then always repeats the remote D1 query immediately before `wrangler deploy`
and validates a fresh receipt; a caller-provided receipt can never replace that
final remote proof. Receipt directories and files are resolved with `realpath`,
and symlinks or paths whose real destination enters the Git repository are
rejected.

The verification command is deliberately read-only and rejects `--apply`,
`--confirm` and `--mapping`:

```bash
npm run identity:cutover:verify -- \
  --target <target> \
  --environment <development|production> \
  --revision <exact-40-character-git-sha> \
  --receipt-directory <absolute-path-outside-git>
```

If it reports legacy rows, stop deployment. Backfill only during an approved
maintenance window, from the protected pre-migration backup, with a reviewed
mapping inventory and an explicit operator confirmation recorded in the change
ticket. Do not add a generic deployment-time auto-map: a wrong project is a
cross-application disclosure and cannot be repaired safely after traffic is
enabled. Run the read-only verification again against the exact deployment
revision; only its new zero-row receipt may unlock Identity.

Initial register, password, anonymous, Google/Apple and password-reset requests
must include FlutterFlow SDK `PROJECT-KEY`, `PLATFORM`, `IDENTIFIER` and optional
`ENVIRONMENT` headers. The public API resolves those credentials against D1 and
signs the private Identity context; neither the SDK nor FlutterFlow receives an
internal token or supplies a numeric project id.
