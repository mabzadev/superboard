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
} from "@opengrow/contracts/custom-worker";
import {
  RequestBodyError,
  readJsonLimited,
} from "@opengrow/contracts/request-body";
import { configuredSecrets } from "@opengrow/contracts/secret";
import { inspectSqlSchemaHealth } from "@opengrow/contracts/health";
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
      "Durable MBZA acceptance receipt bound to exact platform and reference revisions.",
    mode: "request",
  },
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/health") {
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
      }
      if (
        !(await customWorkerAuthorized(
          request,
          configuredSecrets(
            env.CUSTOM_WORKER_TOKEN,
            env.CUSTOM_WORKER_TOKEN_PREVIOUS,
          ),
        ))
      ) {
        return json({ error: "unauthorized" }, 401);
      }

      const scope = parseCustomWorkerScope(request) ?? undefined;
      if (
        request.method === "GET" &&
        url.pathname === CUSTOM_WORKER_MANIFEST_PATH
      ) {
        return json(manifest(env));
      }
      if (
        request.method === "GET" &&
        url.pathname === CUSTOM_WORKER_STATS_PATH
      ) {
        return json(await referenceStats(env.REFERENCE_DB));
      }
      const eraseMatch = url.pathname.match(
        /^\/internal\/v1\/users\/([^/]+)$/u,
      );
      if (request.method === "DELETE" && eraseMatch) {
        if (!scope || scope.subject !== decodeURIComponent(eraseMatch[1])) {
          return json({ error: "scope_required" }, 403);
        }
        return json({
          erased: true,
          jobs_deleted: await eraseReferenceUser(env.REFERENCE_DB, scope),
        });
      }
      if (url.pathname === CUSTOM_WORKER_JOB_PATH) {
        if (request.method === "GET") {
          return json(await listReferenceJobs(url, env.REFERENCE_DB, scope));
        }
        if (request.method === "POST") {
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
        }
      }
      const cancelMatch = url.pathname.match(
        new RegExp(
          `^${CUSTOM_WORKER_JOB_PATH}/([^/]+)${CUSTOM_WORKER_JOB_CANCEL_SUFFIX}$`,
        ),
      );
      if (request.method === "POST" && cancelMatch) {
        return json(
          await cancelReferenceJob(cancelMatch[1], env.REFERENCE_DB, scope),
          202,
        );
      }
      const jobMatch = url.pathname.match(/^\/internal\/v1\/jobs\/([^/]+)$/);
      if (request.method === "GET" && jobMatch) {
        return json(
          await getReferenceJob(jobMatch[1], env.REFERENCE_DB, scope),
        );
      }
      return json({ error: "not_found" }, 404);
    } catch (error) {
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
} satisfies ExportedHandler<Env>;

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
    description: "Reference app-specific extension for OpenGrow",
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
