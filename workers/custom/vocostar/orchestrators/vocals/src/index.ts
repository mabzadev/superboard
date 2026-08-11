// BUILD: 2026-04-19 v4 — D1 natif (remplace Supabase sbPatch/sbDelete)
import { Container, getContainer } from "@cloudflare/containers";
import {
  DurableObject,
  WorkflowEntrypoint,
  WorkflowEvent,
  WorkflowStep,
} from "cloudflare:workers";
import {
  errorMessage,
  isNonEmptyString,
  isRecord,
  JsonRecord,
  parseContainerResponse,
  parseDispatcherResponse,
  parseJobEnvelope,
  positiveIntegerVariable,
} from "./protocol";

// ── Types ──────────────────────────────────────────────────────────────────────
interface VocalData {
  user_vocal_id: string;
  user_id: string;
  audio_src: string;
  language?: string;
  text_audio: string;
  text_unlock: string;
  send_id?: string;
  premium?: boolean;
  [key: string]: unknown;
}
interface VocalPayload {
  queue_id: string;
  data: VocalData;
}
interface ModalResult {
  audio_audio_url: string;
  audio_unlock_url: string;
  refs_url: string;
}

// ── Container ──────────────────────────────────────────────────────────────────
export class Standard extends Container<Env> {
  defaultPort = 8080;
  envVars = containerEnvironment(this.env);
}

function containerEnvironment(env: Env): Record<string, string> {
  return {
    MODAL_API_KEY: env.MODAL_API_KEY,
    MODAL_TTS_URL: env.MODAL_TTS_URL,
    GATEWAY_URL: env.GATEWAY_URL,
    GATEWAY_INTERNAL_TOKEN: env.GATEWAY_INTERNAL_TOKEN,
    FILES_INPUT_ORIGIN: env.FILES_INPUT_ORIGIN,
    FILES_INPUT_MAX_BYTES: env.FILES_INPUT_MAX_BYTES,
    OUTPUT_FILE_ORIGIN: env.OUTPUT_FILE_ORIGIN,
    R2_ENDPOINT_URL: env.R2_ENDPOINT_URL,
    R2_BUCKET_NAME: env.R2_BUCKET_NAME,
    R2_READY_MAX_ATTEMPTS: env.R2_READY_MAX_ATTEMPTS,
    R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
  };
}

// ── Dispatcher Durable Object ──────────────────────────────────────────────────
export class Dispatcher extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const max = Number.parseInt(url.searchParams.get("max") || "20", 10);
    if (!Number.isInteger(max) || max < 1 || max > 100) {
      return Response.json({ error: "Invalid pool size" }, { status: 400 });
    }

    if (url.pathname === "/acquire") {
      const leaseMs = positiveIntegerVariable(
        this.env.DISPATCH_LEASE_MS,
        "DISPATCH_LEASE_MS",
        86_400_000,
      );
      const now = Date.now();
      const instanceId = await this.ctx.storage.transaction(async (storage) => {
        for (let id = 1; id <= max; id += 1) {
          const key = `busy:${id}`;
          const expiresAt: unknown = await storage.get(key);
          if (typeof expiresAt !== "number" || expiresAt <= now) {
            await storage.put(key, now + leaseMs);
            return id;
          }
        }
        return null;
      });
      log("dispatcher.acquire", { instanceId, max, lease_ms: leaseMs });
      return Response.json({ instanceId });
    }

    if (url.pathname === "/release") {
      const body: unknown = await request.json();
      if (
        !isRecord(body) ||
        !Number.isInteger(body.id) ||
        Number(body.id) < 1
      ) {
        return Response.json({ error: "Invalid slot id" }, { status: 400 });
      }
      const id = Number(body.id);
      await this.ctx.storage.delete(`busy:${id}`);
      log("dispatcher.release", { instanceId: id });
      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isVocalData(value: unknown): value is VocalData {
  return (
    isRecord(value) &&
    isNonEmptyString(value.user_vocal_id) &&
    isNonEmptyString(value.user_id) &&
    isNonEmptyString(value.audio_src) &&
    isNonEmptyString(value.text_audio) &&
    isNonEmptyString(value.text_unlock)
  );
}

function isModalResult(value: unknown): value is ModalResult {
  return (
    isRecord(value) &&
    isNonEmptyString(value.audio_audio_url) &&
    isNonEmptyString(value.audio_unlock_url) &&
    isNonEmptyString(value.refs_url)
  );
}

function log(event: string, details: JsonRecord = {}): void {
  console.log(JSON.stringify({ event, ...details }));
}

// ── Workflow ───────────────────────────────────────────────────────────────────
//
//  Step 1  acquire-slot   Smart backoff : 1→2→4→8→16→30s
//  Step 2  run-modal      /run-modal → 2 TTS Modal en parallèle (streaming, 8 min)
//  Step 3  update-db      D1 PATCH users_vocals + DELETE send_users_vocals
//  catch   handle-failure D1 UPDATE send_users_vocals status=failed
//  finally release-slot   Libère toujours le slot
//
export class VocalProcessingWorkflow extends WorkflowEntrypoint<
  Env,
  VocalPayload
> {
  async run(
    event: WorkflowEvent<VocalPayload>,
    step: WorkflowStep,
  ): Promise<unknown> {
    const { queue_id, data } = event.payload;
    const startMs = Date.now();
    const timings: Record<string, number> = {};
    const maxSlots = positiveIntegerVariable(
      this.env.STANDARD_MAX_INSTANCES,
      "STANDARD_MAX_INSTANCES",
      100,
    );

    let instanceId: number | null = null;

    const callContainer = (path: string, body: JsonRecord) => {
      const ctr = getContainer(this.env.STANDARD, `vx-${instanceId}`);
      return ctr.fetch(`http://localhost:8080${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    };

    try {
      // ── Step 1 : Acquire slot (smart backoff) ──────────────────────────────
      const DELAYS = [1, 2, 4, 8, 16, 30];
      let attempt = 0;

      while (instanceId === null) {
        if (attempt > 100)
          throw new Error(
            "Pool exhausted: no slot available after 100 attempts (~30 min)",
          );

        instanceId = await step.do(
          `acquire-${attempt}`,
          { timeout: "10 seconds" },
          async (): Promise<number | null> => {
            const stub = this.env.DISPATCHER.get(
              this.env.DISPATCHER.idFromName("standard"),
            );
            const resp = await stub.fetch(
              `http://dispatch/acquire?max=${maxSlots}`,
            );
            return parseDispatcherResponse(resp);
          },
        );

        if (instanceId === null) {
          const delay = DELAYS[Math.min(attempt, DELAYS.length - 1)];
          console.log(
            `[Workflow] Pool full (attempt ${attempt}), waiting ${delay}s…`,
          );
          await step.sleep(`wait-${attempt}`, `${delay} seconds`);
          attempt++;
        }
      }
      console.log(
        `[Workflow] standard slot vx-${instanceId} ← queue=${queue_id}`,
      );

      // ── Step 2 : Modal TTS ─────────────────────────────────────────────────
      const t2 = Date.now();
      const modal = await step.do(
        "run-modal",
        {
          retries: { limit: 2, delay: "20 seconds", backoff: "constant" },
          timeout: "9 minutes",
        },
        async (): Promise<ModalResult> => {
          const resp = await callContainer("/run-modal", {
            queue_id,
            payload: data,
          });
          return parseContainerResponse(resp, isModalResult);
        },
      );
      timings.modal_ms = Date.now() - t2;
      console.log(
        `[Workflow] run-modal ✅ audio=${modal.audio_audio_url.slice(-40)}`,
      );

      // ── Step 3 : Update D1 ─────────────────────────────────────────────────
      const t3 = Date.now();
      await step.do(
        "update-db",
        {
          retries: { limit: 5, delay: "3 seconds", backoff: "constant" },
          timeout: "30 seconds",
        },
        async (): Promise<void> => {
          const now = new Date().toISOString();

          // Mise à jour users_vocals
          await this.env.DB.prepare(
            `UPDATE users_vocals
                    SET refs = ?, audio_audio = ?, audio_unlock = ?,
                        progress = 1.0, processed_at = ?, job = 1
                    WHERE id = ?`,
          )
            .bind(
              modal.refs_url,
              modal.audio_audio_url,
              modal.audio_unlock_url,
              now,
              data.user_vocal_id,
            )
            .run();

          // Suppression de la queue
          const sendId = data.send_id || queue_id;
          await this.env.DB.prepare(
            "DELETE FROM send_users_vocals WHERE id = ?",
          )
            .bind(sendId)
            .run();

          console.log(`[Workflow] update-db ✅ D1 vocal=${data.user_vocal_id}`);
        },
      );
      timings.db_ms = Date.now() - t3;

      // ── Step 3.5 : Notify WS (progress=1.0 + URLs → Flutter page update) ──
      await step.do(
        "notify-ws",
        {
          retries: { limit: 3, delay: "2 seconds", backoff: "constant" },
          timeout: "10 seconds",
        },
        async (): Promise<void> => {
          try {
            const r = await fetch(`${this.env.GATEWAY_URL}/ws/vocals/notify`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-VocoStar-Internal-Token": this.env.GATEWAY_INTERNAL_TOKEN,
              },
              body: JSON.stringify({ user_id: data.user_id }),
            });
            if (!r.ok) throw new Error(`Gateway callback HTTP ${r.status}`);
            console.log(
              `[Workflow] notify-ws ✅ HTTP ${r.status} vocal=${data.user_vocal_id}`,
            );
          } catch (e) {
            console.warn("[Workflow] notify-ws failed (non-fatal):", e);
          }
        },
      );

      // ── Step 4 : Push notification FCM ─────────────────────────────────────
      await step.do(
        "notify-user",
        {
          retries: { limit: 2, delay: "3 seconds", backoff: "constant" },
          timeout: "15 seconds",
        },
        async (): Promise<void> => {
          try {
            const r = await fetch(`${this.env.GATEWAY_URL}/internal/notify`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-VocoStar-Internal-Token": this.env.GATEWAY_INTERNAL_TOKEN,
              },
              body: JSON.stringify({
                user_id: data.user_id,
                notification_type: "clone_ready",
              }),
            });
            if (!r.ok) throw new Error(`Gateway callback HTTP ${r.status}`);
            console.log(
              `[Workflow] notify-user ✅ HTTP ${r.status} vocal=${data.user_vocal_id}`,
            );
          } catch (e) {
            console.warn("[Workflow] notify-user failed (non-fatal):", e);
          }
        },
      );

      return {
        status: "completed",
        queue_id,
        user_vocal_id: data.user_vocal_id,
        slot: `vx-${instanceId}`,
        duration_ms: Date.now() - startMs,
        timings,
        output: {
          refs: modal.refs_url,
          audio_audio: modal.audio_audio_url,
          audio_unlock: modal.audio_unlock_url,
        },
      };
    } catch (error: unknown) {
      const message = errorMessage(error);
      console.error(
        JSON.stringify({ event: "workflow.failed", queue_id, error: message }),
      );

      await step.do(
        "handle-failure",
        {
          retries: { limit: 5, delay: "3 seconds", backoff: "constant" },
          timeout: "30 seconds",
        },
        async (): Promise<void> => {
          await this.env.DB.prepare(
            "UPDATE send_users_vocals SET status = 'failed', last_error = ? WHERE id = ?",
          )
            .bind(message.slice(0, 1000), queue_id)
            .run();
        },
      );

      return {
        status: "failed",
        queue_id,
        user_vocal_id: data.user_vocal_id,
        error: message.slice(0, 500),
        slot: instanceId ? `vx-${instanceId}` : null,
        duration_ms: Date.now() - startMs,
      };
    } finally {
      if (instanceId !== null) {
        await step
          .do(
            "shutdown-container",
            {
              retries: { limit: 3, delay: "2 seconds", backoff: "constant" },
              timeout: "15 seconds",
            },
            async (): Promise<void> => {
              const ctr = getContainer(this.env.STANDARD, `vx-${instanceId}`);
              await ctr.fetch("http://localhost:8080/shutdown", {
                method: "POST",
              });
              console.log(
                `[Workflow] Container vx-${instanceId} shutdown signaled`,
              );
            },
          )
          .catch(() => {
            /* non-bloquant */
          });

        await step.do(
          "release-slot",
          {
            retries: { limit: 5, delay: "2 seconds", backoff: "constant" },
            timeout: "20 seconds",
          },
          async (): Promise<void> => {
            const stub = this.env.DISPATCHER.get(
              this.env.DISPATCHER.idFromName("standard"),
            );
            await stub.fetch("http://dispatch/release", {
              method: "POST",
              body: JSON.stringify({ id: instanceId }),
              headers: { "Content-Type": "application/json" },
            });
            console.log(
              `[Workflow] Released standard slot ${instanceId} for ${queue_id}`,
            );
          },
        );
      }
    }
  }
}

// ── Producer : reçoit la requête de intern-pipeline-dispatcher (Service Binding) ─
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }
    let job: { queueId: string; data: VocalData };
    try {
      job = parseJobEnvelope(await request.json(), isVocalData);
    } catch (error: unknown) {
      return Response.json({ error: errorMessage(error) }, { status: 400 });
    }
    const { queueId, data } = job;
    log("producer.accepted", {
      queue_id: queueId,
      user_vocal_id: data.user_vocal_id,
      language: data.language ?? null,
    });
    try {
      const instance = await createIdempotentWorkflow(
        env.VOCAL_WORKFLOW,
        queueId,
        { queue_id: queueId, data },
      );
      log("producer.workflow_started", {
        queue_id: queueId,
        workflow_id: instance.id,
      });
      return Response.json(
        { status: "started", workflow_id: instance.id, queue_id: queueId },
        { status: 202 },
      );
    } catch (error: unknown) {
      const message = errorMessage(error);
      console.error(
        JSON.stringify({
          event: "producer.failed",
          queue_id: queueId,
          error: message,
        }),
      );
      return Response.json(
        { error: "Unable to start workflow" },
        { status: 500 },
      );
    }
  },
} satisfies ExportedHandler<Env>;

async function createIdempotentWorkflow(
  workflow: Workflow<VocalPayload>,
  id: string,
  params: VocalPayload,
) {
  try {
    return await workflow.create({ id, params });
  } catch (error) {
    const existing = await workflow.get(id);
    const state = await existing.status();
    if (state.status !== "unknown") return existing;
    throw error;
  }
}
