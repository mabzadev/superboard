# Worker operational catalog

The Infrastructure back office exposes one target-driven inventory through
`GET /api/v1/platform/status`. It is intended for operators and remains behind
the existing SuperBoard owner/admin authorization.

## Sources of truth

- `deploy/targets/<target>.json` owns deployment names, feature activation,
  public domains, public monitors, and application-specific service bindings.
- `scripts/cloudflare-services.mjs` owns the complete common service registry.
- `workers/api/src/routes/platform-status.ts` owns reusable operational
  descriptions: purpose, health mode/path, capabilities, routes, data/queue
  dependencies, and supported job families.
- Existing `API_CAPABILITIES` remain the only API route/capability catalog;
  Worker cards derive from it instead of copying gateway routes.

The Wrangler generator serializes the safe subset as
`PLATFORM_WORKERS_JSON`. In addition to the common registry, every
`customWorker.managedWorkers` entry is appended dynamically; there is no fixed
Worker count. Managed entries include only their operational description,
deployment and binding names, Workflow, container/Durable Object classes and
logical stores. The catalog contains no token, credential, Cloudflare account
ID, D1 ID, KV ID, R2 secret, provider URL, or provider configuration.

## Status semantics

- `ok`: the configured health contract responded successfully.
- `degraded` / `unavailable`: the runtime responded with a failing contract or
  could not be reached.
- `disabled`: the target manifest explicitly disables the Worker.
- `misconfigured`: the target enables the Worker but its required binding,
  public monitor, deployment name, or catalog contract is absent or invalid.

Managed Workers are checked through generated API service bindings. The probe
is explicitly a reachability check: any non-5xx response proves that the Worker
is online, including a legacy `405` from a Worker that has no dedicated GET
health route. It does not claim that downstream model providers are healthy.

The API validates the catalog schema version, target, environment, complete and
unique Worker inventory, safe deployment names, and custom dependencies. A
missing or malformed catalog degrades the global platform status; it is never
silently treated as a disabled service.

## Dashboard visibility

Every Worker card shows its exact target deployment name, common/application
kind, purpose, enabled state, live status and latency, health mode/path,
capabilities, served routes, service/data/queue/external-Worker dependencies,
and persisted job counters. Raw health details remain collapsible for diagnosis.

Queue backlog that is not persisted remains in Cloudflare runtime analytics;
the UI explicitly reports unavailable job visibility rather than inventing a
zero count.
