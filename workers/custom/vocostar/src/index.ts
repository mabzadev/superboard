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
  type CustomWorkerManifest,
} from "@superboard/contracts/custom-worker";
import {
  RequestBodyError,
  readJsonLimited,
} from "@superboard/contracts/request-body";
import { configuredSecrets } from "@superboard/contracts/secret";
import { inspectSqlSchemaHealth } from "@superboard/contracts/health";
import {
  cancelJob,
  createJob,
  eraseApplicationUser,
  getJob,
  listJobs,
  reconcile,
  retryJob,
  stats,
} from "./jobs";
import { VocoStarJobError } from "./validation";

const CAPABILITIES: CustomWorkerManifest["capabilities"] = [
  {
    id: "vocostar.voice.clone",
    description:
      "Clone a user voice with the VocoStar Workflow and Container pipeline.",
    mode: "queue",
  },
  {
    id: "vocostar.media.convert",
    description: "Convert text, audio or video with a selected VocoStar voice.",
    mode: "queue",
  },
  {
    id: "vocostar.jobs.read",
    description:
      "Inspect conversion status, progress, failures and aggregate counts.",
    mode: "request",
  },
  {
    id: "vocostar.jobs.cancel",
    description:
      "Cancel an owner-scoped conversion that has not started and refund charged credits exactly once.",
    mode: "request",
  },
  {
    id: "vocostar.jobs.retry",
    description:
      "Retry a failed or undispatched conversion with the same durable job identity.",
    mode: "request",
  },
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/health") {
        try {
          const [summary, schema] = await Promise.all([
            stats(env),
            inspectSqlSchemaHealth(env.VOCOSTAR_DB, env.D1_EXPECTED_MIGRATION),
          ]);
          const current = schema.status === "current";
          return json(
            {
              service: "custom-vocostar",
              appKey: env.APP_KEY,
              environment: env.ENVIRONMENT,
              protocolVersion: CUSTOM_WORKER_PROTOCOL_VERSION,
              ...summary,
              status: current ? summary.status : "degraded",
              schema,
              ...(current ? {} : { reason: "database_schema_not_current" }),
            },
            current && summary.status === "ok" ? 200 : 503,
          );
        } catch {
          return json(
            {
              service: "custom-vocostar",
              appKey: env.APP_KEY,
              environment: env.ENVIRONMENT,
              protocolVersion: CUSTOM_WORKER_PROTOCOL_VERSION,
              status: "degraded",
              reason: "database_health_unavailable",
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
        return json(await stats(env));
      }
      const eraseMatch = url.pathname.match(
        /^\/internal\/v1\/users\/([^/]+)$/u,
      );
      if (request.method === "DELETE" && eraseMatch) {
        if (!scope || scope.subject !== decodeURIComponent(eraseMatch[1])) {
          return json({ error: "scope_required" }, 403);
        }
        return json(await eraseApplicationUser(env, scope));
      }
      if (url.pathname === CUSTOM_WORKER_JOB_PATH) {
        if (request.method === "GET")
          return json(await listJobs(url, env, scope));
        if (request.method === "POST") {
          const body = await readJson(request);
          return json(
            await createJob(parseCustomWorkerJob(body), env, scope),
            202,
          );
        }
      }
      const cancelMatch = url.pathname.match(
        new RegExp(
          `^${CUSTOM_WORKER_JOB_PATH}/([^/]+)${CUSTOM_WORKER_JOB_CANCEL_SUFFIX}$`,
        ),
      );
      if (request.method === "POST" && cancelMatch)
        return json(await cancelJob(cancelMatch[1], env, scope), 202);
      const retryMatch = url.pathname.match(
        /^\/internal\/v1\/jobs\/([^/]+)\/retry$/,
      );
      if (request.method === "POST" && retryMatch)
        return json(await retryJob(retryMatch[1], env), 202);
      const jobMatch = url.pathname.match(/^\/internal\/v1\/jobs\/([^/]+)$/);
      if (request.method === "GET" && jobMatch)
        return json(await getJob(jobMatch[1], env, scope));
      return json({ error: "not_found" }, 404);
    } catch (error) {
      if (error instanceof VocoStarJobError)
        return json({ error: error.code }, error.status);
      if (error instanceof CustomWorkerProtocolError)
        return json({ error: error.code }, 422);
      console.error(
        JSON.stringify({
          event: "vocostar_custom_request_failed",
          error: safeError(error),
        }),
      );
      return json({ error: "internal_error" }, 500);
    }
  },

  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      reconcile(env).catch((error) => {
        console.error(
          JSON.stringify({
            event: "vocostar_custom_reconcile_failed",
            error: safeError(error),
          }),
        );
      }),
    );
  },
} satisfies ExportedHandler<Env>;

function manifest(env: Env): CustomWorkerManifest {
  const enabled = new Set(
    env.CUSTOM_WORKER_CAPABILITIES.split(",").map((value) => value.trim()),
  );
  return {
    protocolVersion: CUSTOM_WORKER_PROTOCOL_VERSION,
    appKey: env.APP_KEY,
    service: "custom-vocostar",
    version: "1.2.0",
    description:
      "VocoStar-specific voice-cloning and media-conversion orchestration.",
    capabilities: CAPABILITIES.filter((capability) =>
      enabled.has(capability.id),
    ),
  };
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await readJsonLimited(request, 70_000);
  } catch (cause) {
    if (cause instanceof RequestBodyError) {
      throw new VocoStarJobError(
        cause.code === "body_too_large" ? "payload_too_large" : "json_invalid",
        cause.status,
      );
    }
    throw cause;
  }
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 500);
}
