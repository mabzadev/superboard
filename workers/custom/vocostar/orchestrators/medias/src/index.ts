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
interface MediaData {
  media_id: string;
  user_id: string;
  media_type: "video" | "audio" | "text";
  premium?: boolean;
  vocal_ref?: string;
  video_src?: string;
  audio_src?: string;
  text_src?: string;
  text?: string;
  language?: string;
  [key: string]: unknown;
}
interface MediaPayload {
  queue_id: string;
  data: MediaData;
}
interface PrepareResult {
  audio_src_url: string;
  video_src_url: string;
  crv_r2_path: string;
  file_prefix: string;
  is_video: boolean;
}
interface ModalResult {
  audio_crv_url: string;
}
interface FfmpegResult {
  video_sd: string;
  video_hd: string;
  video_ads: string;
  thumbnail: string;
}

// ── Containers ────────────────────────────────────────────────────────────────
export class Standard extends Container<Env> {
  defaultPort = 8080;
  envVars = containerEnvironment(this.env);
}
export class Premium extends Container<Env> {
  defaultPort = 8080;
  envVars = containerEnvironment(this.env);
}

function containerEnvironment(env: Env): Record<string, string> {
  return {
    MODAL_API_KEY: env.MODAL_API_KEY,
    MODAL_ATS_URL: env.MODAL_ATS_URL,
    MODAL_TTS_URL: env.MODAL_TTS_URL,
    GATEWAY_URL: env.GATEWAY_URL,
    GATEWAY_INTERNAL_TOKEN: env.GATEWAY_INTERNAL_TOKEN,
    FILES_INPUT_ORIGIN: env.FILES_INPUT_ORIGIN,
    FILES_INPUT_MAX_BYTES: env.FILES_INPUT_MAX_BYTES,
    OUTPUT_FILE_ORIGIN: env.OUTPUT_FILE_ORIGIN,
    WATERMARK_URL: env.WATERMARK_URL,
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

function isMediaData(value: unknown): value is MediaData {
  return (
    isRecord(value) &&
    isNonEmptyString(value.media_id) &&
    isNonEmptyString(value.user_id) &&
    (value.media_type === "video" ||
      value.media_type === "audio" ||
      value.media_type === "text")
  );
}

function isPrepareResult(value: unknown): value is PrepareResult {
  return (
    isRecord(value) &&
    isNonEmptyString(value.audio_src_url) &&
    typeof value.video_src_url === "string" &&
    isNonEmptyString(value.crv_r2_path) &&
    isNonEmptyString(value.file_prefix) &&
    typeof value.is_video === "boolean"
  );
}

function isModalResult(value: unknown): value is ModalResult {
  return isRecord(value) && isNonEmptyString(value.audio_crv_url);
}

function isFfmpegResult(value: unknown): value is FfmpegResult {
  return (
    isRecord(value) &&
    isNonEmptyString(value.video_sd) &&
    isNonEmptyString(value.video_hd) &&
    isNonEmptyString(value.video_ads) &&
    isNonEmptyString(value.thumbnail)
  );
}

function log(event: string, details: JsonRecord = {}): void {
  console.log(JSON.stringify({ event, ...details }));
}

// ── Workflow ───────────────────────────────────────────────────────────────────
//
//  Step 1  acquire-slot   Smart backoff : 1→2→4→8→16→30s (durable sleep)
//  Step 2  prepare        /prepare  → download + extract audio (sync, < 60s)
//  Step 3  run-modal      /run-modal → Modal SeedVC ou Chatterbox (streaming, 8 min)
//  Step 4  run-ffmpeg     /run-ffmpeg → Mux FFmpeg (streaming, 4 min, vidéo seulement)
//  Step 5  update-db      D1 UPDATE users_medias + DELETE send_users_medias
//  catch   handle-failure D1 UPDATE send_users_medias status=failed
//  finally release-slot   Libère toujours le slot
//
export class MediaProcessingWorkflow extends WorkflowEntrypoint<
  Env,
  MediaPayload
> {
  async run(
    event: WorkflowEvent<MediaPayload>,
    step: WorkflowStep,
  ): Promise<unknown> {
    const { queue_id, data } = event.payload;
    const startMs = Date.now();
    const timings: Record<string, number> = {};

    const isPremium = data?.premium === true && data?.media_type !== "text";
    const maxSlots = positiveIntegerVariable(
      isPremium
        ? this.env.PREMIUM_MAX_INSTANCES
        : this.env.STANDARD_MAX_INSTANCES,
      isPremium ? "PREMIUM_MAX_INSTANCES" : "STANDARD_MAX_INSTANCES",
      100,
    );
    const poolLabel = isPremium ? "premium" : "standard";
    const dispName = isPremium ? "premium" : "standard";

    let instanceId: number | null = null;

    const callContainer = (path: string, body: JsonRecord) => {
      const ns = isPremium ? this.env.PREMIUM : this.env.STANDARD;
      const ctr = getContainer(ns, `vx-${instanceId}`);
      return ctr.fetch(`http://localhost:8080${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    };

    try {
      // ── Step 1 : Acquire slot ──────────────────────────────────────────────
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
              this.env.DISPATCHER.idFromName(dispName),
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
            `[Workflow] ${poolLabel} pool full (attempt ${attempt}), waiting ${delay}s…`,
          );
          await step.sleep(`wait-${attempt}`, `${delay} seconds`);
          attempt++;
        }
      }
      console.log(
        `[Workflow] ${poolLabel} slot vx-${instanceId} ← queue=${queue_id}`,
      );

      // ── Step 2 : Prepare ───────────────────────────────────────────────────
      const t2 = Date.now();
      const prepare = await step.do(
        "prepare",
        {
          retries: { limit: 2, delay: "5 seconds", backoff: "constant" },
          timeout: "30 seconds",
        },
        async (): Promise<PrepareResult> => {
          const resp = await callContainer("/prepare", {
            queue_id,
            payload: data,
          });
          return parseContainerResponse(resp, isPrepareResult);
        },
      );
      timings.prepare_ms = Date.now() - t2;
      console.log(
        `[Workflow] prepare ✅ audio_src=${prepare.audio_src_url.slice(-40)}`,
      );

      // ── Step 3 : Modal AI ──────────────────────────────────────────────────
      const t3 = Date.now();
      const modal = await step.do(
        "run-modal",
        {
          retries: { limit: 2, delay: "5 seconds", backoff: "constant" },
          timeout: "3 minutes",
        },
        async (): Promise<ModalResult> => {
          const resp = await callContainer("/run-modal", {
            queue_id,
            payload: data,
            audio_src_url: prepare.audio_src_url,
            crv_r2_path: prepare.crv_r2_path,
          });
          return parseContainerResponse(resp, isModalResult);
        },
      );
      timings.modal_ms = Date.now() - t3;
      console.log(
        `[Workflow] run-modal ✅ audio_crv=${modal.audio_crv_url.slice(-40)}`,
      );

      // ── Step 4 : FFmpeg mux (vidéo seulement) ─────────────────────────────
      let ffmpeg: FfmpegResult | null = null;
      if (prepare.is_video) {
        const t4 = Date.now();
        ffmpeg = await step.do(
          "run-ffmpeg",
          {
            retries: { limit: 2, delay: "5 seconds", backoff: "constant" },
            timeout: "2 minutes",
          },
          async (): Promise<FfmpegResult> => {
            const resp = await callContainer("/run-ffmpeg", {
              video_src_url: prepare.video_src_url,
              audio_crv_url: modal.audio_crv_url,
              user_id: data.user_id,
              file_prefix: prepare.file_prefix,
            });
            return parseContainerResponse(resp, isFfmpegResult);
          },
        );
        timings.ffmpeg_ms = Date.now() - t4;
        console.log(
          `[Workflow] run-ffmpeg ✅ sd=${ffmpeg.video_sd.slice(-40)}`,
        );
      }

      // ── Step 5 : Update D1 ─────────────────────────────────────────────────
      const outputData =
        data.media_type === "video" && ffmpeg
          ? {
              video_src: prepare.video_src_url,
              video_sd: ffmpeg.video_sd,
              video_hd: ffmpeg.video_hd,
              video_ads: ffmpeg.video_ads,
              thumbnail: ffmpeg.thumbnail,
              audio_src: prepare.audio_src_url,
              audio_crv: modal.audio_crv_url,
            }
          : data.media_type === "audio"
            ? {
                audio_src: prepare.audio_src_url,
                audio_crv: modal.audio_crv_url,
              }
            : {
                text_src: data.text_src || data.text,
                audio_crv: modal.audio_crv_url,
              };

      const t5 = Date.now();
      await step.do(
        `update-db-${data.media_type}`,
        {
          retries: { limit: 5, delay: "3 seconds", backoff: "constant" },
          timeout: "30 seconds",
        },
        async (): Promise<void> => {
          const now = new Date().toISOString();

          // Mise à jour users_medias avec calcul de timing
          await this.env.DB.prepare(
            `UPDATE users_medias
                    SET output = ?, job = 1, progress = 1.0, processed_at = ?,
                        timing = CAST(
                          (JULIANDAY(?) - JULIANDAY(created_at)) * 86400.0
                        AS TEXT)
                    WHERE id = ?`,
          )
            .bind(JSON.stringify(outputData), now, now, data.media_id)
            .run();

          // Suppression de la queue
          await this.env.DB.prepare(
            "DELETE FROM send_users_medias WHERE id = ?",
          )
            .bind(queue_id)
            .run();

          console.log(`[Workflow] update-db ✅ D1 media=${data.media_id}`);
        },
      );
      timings.db_ms = Date.now() - t5;

      // ── Step 6 : Push WebSocket via gateway ────────────────────────────────
      await step.do(
        `notify-ws-${data.media_type}`,
        {
          retries: { limit: 3, delay: "2 seconds", backoff: "constant" },
          timeout: "10 seconds",
        },
        async (): Promise<void> => {
          try {
            const r = await fetch(
              `${this.env.GATEWAY_URL}/ws/medias/progress`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-VocoStar-Internal-Token": this.env.GATEWAY_INTERNAL_TOKEN,
                },
                body: JSON.stringify({
                  media_id: data.media_id,
                  user_id: data.user_id,
                  progress: 1.0,
                }),
              },
            );
            if (!r.ok) throw new Error(`Gateway callback HTTP ${r.status}`);
            console.log(
              `[Workflow] notify-ws ✅ HTTP ${r.status} media=${data.media_id}`,
            );
          } catch (e) {
            console.warn("[Workflow] notify-ws failed (non-fatal):", e);
          }
        },
      );

      // ── Step 7 : Push notification FCM ────────────────────────────────────
      await step.do(
        `notify-push-${data.media_type}`,
        {
          retries: { limit: 2, delay: "3 seconds", backoff: "constant" },
          timeout: "15 seconds",
        },
        async (): Promise<void> => {
          const notifType =
            data.media_type === "video"
              ? "video_ready"
              : data.media_type === "audio"
                ? "audio_ready"
                : "text_ready";
          try {
            const r = await fetch(`${this.env.GATEWAY_URL}/internal/notify`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-VocoStar-Internal-Token": this.env.GATEWAY_INTERNAL_TOKEN,
              },
              body: JSON.stringify({
                user_id: data.user_id,
                notification_type: notifType,
              }),
            });
            if (!r.ok) throw new Error(`Gateway callback HTTP ${r.status}`);
            console.log(
              `[Workflow] notify-push ✅ HTTP ${r.status} type=${notifType}`,
            );
          } catch (e) {
            console.warn("[Workflow] notify-push failed (non-fatal):", e);
          }
        },
      );

      return {
        status: "completed",
        queue_id,
        media_id: data.media_id,
        media_type: data.media_type,
        pool: poolLabel,
        slot: `vx-${instanceId}`,
        duration_ms: Date.now() - startMs,
        timings,
        output: outputData,
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
            "UPDATE send_users_medias SET status = 'failed', last_error = ? WHERE id = ?",
          )
            .bind(message.slice(0, 1000), queue_id)
            .run();
        },
      );

      return {
        status: "failed",
        queue_id,
        media_id: data.media_id,
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
              const ns = isPremium ? this.env.PREMIUM : this.env.STANDARD;
              const ctr = getContainer(ns, `vx-${instanceId}`);
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
              this.env.DISPATCHER.idFromName(dispName),
            );
            await stub.fetch("http://dispatch/release", {
              method: "POST",
              body: JSON.stringify({ id: instanceId }),
              headers: { "Content-Type": "application/json" },
            });
            console.log(
              `[Workflow] Released ${poolLabel} slot ${instanceId} for ${queue_id}`,
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
    let job: { queueId: string; data: MediaData };
    try {
      job = parseJobEnvelope(await request.json(), isMediaData);
    } catch (error: unknown) {
      return Response.json({ error: errorMessage(error) }, { status: 400 });
    }
    const { queueId, data } = job;
    log("producer.accepted", {
      queue_id: queueId,
      media_id: data.media_id,
      media_type: data.media_type,
      premium: data.premium === true,
    });
    try {
      const instance = await createIdempotentWorkflow(
        env.MEDIA_WORKFLOW,
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
  workflow: Workflow<MediaPayload>,
  id: string,
  params: MediaPayload,
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
