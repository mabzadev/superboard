import {
  OBSERVABILITY_HEALTH_PATH,
  OBSERVABILITY_SUMMARY_PATH,
  OBSERVABILITY_WINDOWS_MINUTES,
  type ObservabilitySummary,
  type ObservabilityWindowMinutes,
  type RuntimeMetricRow,
} from "@opengrow/contracts/observability";
import { configuredSecrets, matchesAnySecret } from "@opengrow/contracts/secret";

interface ObservabilitySecrets {
  OBSERVABILITY_INTERNAL_TOKEN: string;
  OBSERVABILITY_INTERNAL_TOKEN_PREVIOUS?: string;
  CLOUDFLARE_ANALYTICS_ACCOUNT_ID?: string;
  CLOUDFLARE_ANALYTICS_TOKEN?: string;
}

type ObservabilityEnv = Env & ObservabilitySecrets;

export default {
  async tail(events: TraceItem[], env: ObservabilityEnv): Promise<void> {
    for (const trace of events) {
      const event = classifyEvent(trace.event);
      env.ANALYTICS.writeDataPoint({
        indexes: [bounded(trace.scriptName || "unknown", 96)],
        blobs: [
          "v1",
          bounded(trace.scriptName || "unknown", 96),
          bounded(trace.entrypoint || "default", 96),
          event.type,
          event.method,
          event.path,
          event.status,
          bounded(trace.outcome || "unknown", 64),
          bounded(env.ENVIRONMENT, 32),
        ],
        doubles: [
          1,
          finite(trace.cpuTime),
          finite(trace.wallTime),
          trace.exceptions.length,
          trace.logs.length,
          trace.truncated ? 1 : 0,
        ],
      });
    }
  },

  async fetch(request: Request, env: ObservabilityEnv): Promise<Response> {
    if (!(await authorized(request, env))) return json({ error: "unauthorized" }, 401);
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);

    const url = new URL(request.url);
    if (url.pathname === OBSERVABILITY_HEALTH_PATH) {
      return json({
        service: "observability",
        status: configured(env) ? "ok" : "misconfigured",
        environment: env.ENVIRONMENT,
        dataset: env.ANALYTICS_DATASET,
        analyticsQueryConfigured: configured(env),
        timestamp: new Date().toISOString(),
      }, configured(env) ? 200 : 503);
    }
    if (url.pathname === OBSERVABILITY_SUMMARY_PATH) {
      return runtimeSummary(env, parseWindow(url.searchParams.get("window")));
    }
    return json({ error: "not_found" }, 404);
  },
} satisfies ExportedHandler<ObservabilityEnv>;

async function runtimeSummary(
  env: ObservabilityEnv,
  windowMinutes: ObservabilityWindowMinutes,
): Promise<Response> {
  if (!configured(env)) {
    const summary: ObservabilitySummary = {
      status: "misconfigured",
      environment: env.ENVIRONMENT,
      dataset: env.ANALYTICS_DATASET,
      windowMinutes,
      generatedAt: new Date().toISOString(),
      rows: [],
      error: "Cloudflare analytics read credentials are not configured",
    };
    return json(summary, 503);
  }

  try {
    const query = summaryQuery(env.ANALYTICS_DATASET, windowMinutes);
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ANALYTICS_ACCOUNT_ID}/analytics_engine/sql`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.CLOUDFLARE_ANALYTICS_TOKEN}`,
          "content-type": "text/plain; charset=utf-8",
        },
        body: query,
        signal: AbortSignal.timeout(5_000),
      },
    );
    const payload = JSON.parse(await readBoundedText(response, 1_000_000)) as unknown;
    if (!response.ok) throw new Error(cloudflareError(payload, response.status));
    const summary: ObservabilitySummary = {
      status: "ok",
      environment: env.ENVIRONMENT,
      dataset: env.ANALYTICS_DATASET,
      windowMinutes,
      generatedAt: new Date().toISOString(),
      rows: normalizeRows(payload),
    };
    return json(summary);
  } catch (error) {
    console.error(JSON.stringify({
      message: "observability_summary_failed",
      error: error instanceof Error ? error.message : String(error),
      environment: env.ENVIRONMENT,
    }));
    const summary: ObservabilitySummary = {
      status: "unavailable",
      environment: env.ENVIRONMENT,
      dataset: env.ANALYTICS_DATASET,
      windowMinutes,
      generatedAt: new Date().toISOString(),
      rows: [],
      error: error instanceof Error ? error.message : "Analytics query failed",
    };
    return json(summary, 503);
  }
}

function summaryQuery(dataset: string, windowMinutes: ObservabilityWindowMinutes): string {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(dataset)) {
    throw new Error("ANALYTICS_DATASET must be a valid Analytics Engine identifier");
  }
  return `SELECT
    blob2 AS service,
    blob8 AS outcome,
    blob4 AS eventType,
    SUM(_sample_interval) AS invocations,
    SUM(_sample_interval * double4) AS exceptions,
    SUM(_sample_interval * double6) AS truncated,
    SUM(_sample_interval * double2) / SUM(_sample_interval) AS averageCpuMs,
    SUM(_sample_interval * double3) / SUM(_sample_interval) AS averageWallMs,
    MAX(double2) AS maximumCpuMs,
    MAX(double3) AS maximumWallMs
  FROM ${dataset}
  WHERE timestamp > NOW() - INTERVAL '${windowMinutes}' MINUTE
  GROUP BY service, outcome, eventType
  ORDER BY service, outcome, eventType
  FORMAT JSON`;
}

function normalizeRows(payload: unknown): RuntimeMetricRow[] {
  const candidate = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.data)
      ? payload.data
      : [];
  return candidate.slice(0, 1_000).flatMap((value) => {
    if (!isRecord(value)) return [];
    const service = text(value.service);
    const outcome = text(value.outcome);
    const eventType = text(value.eventType);
    if (!service || !outcome || !eventType) return [];
    return [{
      service,
      outcome,
      eventType,
      invocations: number(value.invocations) ?? 0,
      exceptions: number(value.exceptions) ?? 0,
      truncated: number(value.truncated) ?? 0,
      averageCpuMs: number(value.averageCpuMs),
      averageWallMs: number(value.averageWallMs),
      maximumCpuMs: number(value.maximumCpuMs),
      maximumWallMs: number(value.maximumWallMs),
    }];
  });
}

function classifyEvent(event: TraceItem["event"]): {
  type: string;
  method: string;
  path: string;
  status: string;
} {
  if (!event) return { type: "unknown", method: "", path: "", status: "" };
  if ("request" in event) {
    let path = "unknown";
    try { path = new URL(event.request.url).pathname; } catch { /* sanitized fallback */ }
    return {
      type: "fetch",
      method: bounded(event.request.method || "", 16),
      path: bounded(path, 256),
      status: event.response ? String(event.response.status) : "",
    };
  }
  if ("queue" in event) return { type: "queue", method: "", path: bounded(event.queue, 128), status: "" };
  if ("cron" in event) return { type: "scheduled", method: "", path: bounded(event.cron, 128), status: "" };
  if ("mailFrom" in event) return { type: "email", method: "", path: "", status: "" };
  if ("rpcMethod" in event) return { type: "rpc", method: bounded(event.rpcMethod, 96), path: "", status: "" };
  if ("consumedEvents" in event) return { type: "tail", method: "", path: "", status: "" };
  if ("scheduledTime" in event) return { type: "alarm", method: "", path: "", status: "" };
  return { type: "custom", method: "", path: "", status: "" };
}

function parseWindow(value: string | null): ObservabilityWindowMinutes {
  const candidate = Number(value || 60);
  return OBSERVABILITY_WINDOWS_MINUTES.includes(candidate as ObservabilityWindowMinutes)
    ? candidate as ObservabilityWindowMinutes
    : 60;
}

function configured(env: ObservabilityEnv): boolean {
  return /^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ANALYTICS_ACCOUNT_ID || "") &&
    Boolean(env.CLOUDFLARE_ANALYTICS_TOKEN);
}

async function authorized(request: Request, env: ObservabilityEnv): Promise<boolean> {
  const provided = request.headers.get("x-observability-token") || "";
  return matchesAnySecret(provided, configuredSecrets(
    env.OBSERVABILITY_INTERNAL_TOKEN,
    env.OBSERVABILITY_INTERNAL_TOKEN_PREVIOUS,
  ));
}

async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maximumBytes) throw new Error("Cloudflare analytics response is too large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let result = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) throw new Error("Cloudflare analytics response is too large");
      result += decoder.decode(value, { stream: true });
    }
    result += decoder.decode();
    return result;
  } finally {
    reader.releaseLock();
  }
}

function cloudflareError(payload: unknown, status: number): string {
  if (isRecord(payload) && Array.isArray(payload.errors)) {
    const message = payload.errors.flatMap((error) => isRecord(error) && text(error.message) ? [text(error.message)] : []).join("; ");
    if (message) return `Cloudflare analytics ${status}: ${message}`;
  }
  return `Cloudflare analytics request failed with HTTP ${status}`;
}

function bounded(value: string, maximum: number): string { return value.slice(0, maximum); }
function finite(value: number): number { return Number.isFinite(value) ? value : 0; }
function text(value: unknown): string { return typeof value === "string" ? value.slice(0, 256) : ""; }
function number(value: unknown): number | null {
  const candidate = typeof value === "number" ? value : Number(value);
  return Number.isFinite(candidate) ? candidate : null;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}
