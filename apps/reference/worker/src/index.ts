import { createFetchRouter } from "@superboard/contracts/route-registry";
import { withRouteManifest } from "@superboard/contracts/route-manifest";
import {
  CUSTOM_WORKER_JOB_CANCEL_SUFFIX,
  CUSTOM_WORKER_JOB_PATH,
  CUSTOM_WORKER_MANIFEST_PATH,
  CUSTOM_WORKER_PROTOCOL_VERSION,
  CUSTOM_WORKER_STATS_PATH,
  CustomWorkerProtocolError,
  customWorkerAuthorized,
  parseCustomWorkerJob,
  parseCustomWorkerScope,
  type CustomWorkerJob,
  type CustomWorkerManifest,
} from "@superboard/contracts/custom-worker";
import {
  RequestBodyError,
  readJsonLimited,
} from "@superboard/contracts/request-body";
import { configuredSecrets } from "@superboard/contracts/secret";
import { inspectSqlSchemaHealth } from "@superboard/contracts/health";
import {
  cancelReferenceJob,
  createReferenceJob,
  eraseReferenceUser,
  getReferenceJob,
  listReferenceJobs,
  pruneExpiredReferenceJobs,
  ReferenceJobError,
  referenceStats,
} from "./jobs";

const capabilities: CustomWorkerManifest["capabilities"] = [
  {
    id: "reference.echo",
    description:
      "Development-only durable job contract verification; replace it with app-specific jobs.",
    mode: "request",
  },
  {
    id: "reference.acceptance",
    description:
      "Durable MABZA acceptance receipt bound to exact platform and reference revisions.",
    mode: "request",
  },
];

const routes = createFetchRouter<Env>({ service: "custom", module: "reference", pluginId: "supbrd-core", ownerBinding: "CUSTOM_WORKER_PLUGIN_ID", surface: "internal", access: "internal" });
routes.defineRoute({ access: "public" }).get("/health", async ({ env }) => {
        try {
          const retentionDays = referenceRetentionDays(
            env.REFERENCE_JOB_RETENTION_DAYS,
          );
          const [stats, schema] = await Promise.all([
            referenceStats(env.REFERENCE_DB),
            inspectSqlSchemaHealth(env.REFERENCE_DB, env.D1_EXPECTED_MIGRATION),
          ]);
          const current = schema.status === "current";
          return json(
            {
              service: "custom-reference",
              appKey: env.APP_KEY,
              environment: env.ENVIRONMENT,
              retentionDays,
              protocolVersion: CUSTOM_WORKER_PROTOCOL_VERSION,
              ...stats,
              status: current ? stats.status : "degraded",
              schema,
              ...(current ? {} : { reason: "database_schema_not_current" }),
            },
            current ? 200 : 503,
          );
        } catch {
          return json(
            {
              service: "custom-reference",
              appKey: env.APP_KEY,
              environment: env.ENVIRONMENT,
              status: "degraded",
              protocolVersion: CUSTOM_WORKER_PROTOCOL_VERSION,
            },
            503,
          );
        }
      });
routes.use("*", async ({ request, env }, next) => { if (
        !(await customWorkerAuthorized(
          request,
          configuredSecrets(
            env.CUSTOM_WORKER_TOKEN,
            env.CUSTOM_WORKER_TOKEN_PREVIOUS,
          ),
        ))
      ) {
        return json({ error: "unauthorized" }, 401);
      } return next(); });
routes.get(CUSTOM_WORKER_MANIFEST_PATH, async ({ request, env }) => { parseCustomWorkerScope(request);
        return json(manifest(env));
      });
routes.get(CUSTOM_WORKER_STATS_PATH, async ({ request, env }) => { parseCustomWorkerScope(request);
        return json(await referenceStats(env.REFERENCE_DB));
      });
routes.delete("/internal/v1/users/:subject", async ({ request, env, params }) => { const scope = parseCustomWorkerScope(request) ?? undefined;
        if (!scope || scope.subject !== decodeURIComponent(params.subject)) {
          return json({ error: "scope_required" }, 403);
        }
        return json({
          erased: true,
          jobs_deleted: await eraseReferenceUser(env.REFERENCE_DB, scope),
        });
      });
routes.get(CUSTOM_WORKER_JOB_PATH, async ({ request, env, url }) => { const scope = parseCustomWorkerScope(request) ?? undefined;
          return json(await listReferenceJobs(url, env.REFERENCE_DB, scope));
        });
routes.post(CUSTOM_WORKER_JOB_PATH, async ({ request, env }) => { const scope = parseCustomWorkerScope(request) ?? undefined;
          if (env.ENVIRONMENT !== "development") {
            return json({ error: "reference_capability_disabled" }, 403);
          }
          return json(
            await createReferenceJob(
              parseCustomWorkerJob(await readJsonLimited(request, 70_000)),
              env.REFERENCE_DB,
              referenceRetentionDays(env.REFERENCE_JOB_RETENTION_DAYS),
              scope,
              env.APP_KEY,
            ),
            202,
          );
        });
routes.post(`${CUSTOM_WORKER_JOB_PATH}/:id${CUSTOM_WORKER_JOB_CANCEL_SUFFIX}`, async ({ request, env, params }) => { const scope = parseCustomWorkerScope(request) ?? undefined;
        return json(
          await cancelReferenceJob(params.id, env.REFERENCE_DB, scope),
          202,
        );
      });
routes.get(`${CUSTOM_WORKER_JOB_PATH}/:id`, async ({ request, env, params }) => { const scope = parseCustomWorkerScope(request) ?? undefined;
        return json(
          await getReferenceJob(params.id, env.REFERENCE_DB, scope),
        );
      });

export default withRouteManifest(({
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return await routes.fetch(request, env); } catch (error) {
      if (error instanceof RequestBodyError) {
        return json({ error: error.code }, error.status);
      }
      if (error instanceof CustomWorkerProtocolError) {
        return json({ error: error.code }, 422);
      }
      if (error instanceof ReferenceJobError) {
        return json({ error: error.code }, error.status);
      }
      console.error(
        JSON.stringify({ event: "reference_custom_request_failed" }),
      );
      return json({ error: "internal_error" }, 500);
    }
  },
  scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): void {
    ctx.waitUntil(runReferenceMaintenance(env).then(() => undefined));
  },
} satisfies ExportedHandler<Env>), [routes], { service: "custom", pluginId: "supbrd-core" });

export function runReferenceMaintenance(env: Env): Promise<number> {
  return pruneExpiredReferenceJobs(
    env.REFERENCE_DB,
    referenceRetentionDays(env.REFERENCE_JOB_RETENTION_DAYS),
  );
}

export function referenceRetentionDays(value: string): number {
  if (!/^\d{1,4}$/.test(value)) {
    throw new ReferenceJobError("reference_retention_invalid", 503);
  }
  const days = Number(value);
  if (!Number.isSafeInteger(days) || days < 1 || days > 3_650) {
    throw new ReferenceJobError("reference_retention_invalid", 503);
  }
  return days;
}

export function parseJob(value: unknown): CustomWorkerJob {
  return parseCustomWorkerJob(value);
}

function manifest(env: Env): CustomWorkerManifest {
  const enabled = new Set(
    env.CUSTOM_WORKER_CAPABILITIES.split(",").map((value) => value.trim()),
  );
  return {
    protocolVersion: CUSTOM_WORKER_PROTOCOL_VERSION,
    appKey: env.APP_KEY,
    service: "custom-reference",
    version: "1.2.0",
    description: "Reference app-specific extension for SuperBoard",
    capabilities: capabilities.filter((capability) =>
      enabled.has(capability.id),
    ),
  };
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
