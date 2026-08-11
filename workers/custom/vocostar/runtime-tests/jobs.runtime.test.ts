import { env } from "cloudflare:workers";
import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

describe("VocoStar custom Worker with D1", () => {
  beforeEach(async () => {
    await runtimeEnv.VOCOSTAR_DB.batch([
      runtimeEnv.VOCOSTAR_DB.prepare("DELETE FROM opengrow_custom_jobs"),
      runtimeEnv.VOCOSTAR_DB.prepare("DELETE FROM send_users_medias"),
      runtimeEnv.VOCOSTAR_DB.prepare("DELETE FROM send_users_vocals"),
      runtimeEnv.VOCOSTAR_DB.prepare("DELETE FROM users_medias"),
      runtimeEnv.VOCOSTAR_DB.prepare("DELETE FROM users_vocals"),
      runtimeEnv.VOCOSTAR_DB.prepare("DELETE FROM app_vocals"),
      runtimeEnv.VOCOSTAR_DB.prepare("DELETE FROM users"),
      runtimeEnv.VOCOSTAR_DB.prepare(
        "INSERT INTO users (id,premium,credits,is_anonymous) VALUES ('user-1',1,100,1)",
      ),
      runtimeEnv.VOCOSTAR_DB.prepare(
        "INSERT INTO app_vocals (id,refs) VALUES ('voice-1','https://files.example.test/vocals/voice-1.mp3')",
      ),
    ]);
  });

  it("reports the applied custom D1 schema revision", async () => {
    const response = await SELF.fetch("https://custom.test/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      service: "custom-vocostar",
      status: "ok",
      schema: {
        status: "current",
        expectedMigration: "0004_owner_scoped_file_ids.sql",
        latestMigration: "0004_owner_scoped_file_ids.sql",
        appliedMigrationCount: 5,
      },
    });
    const manifest = await authorized("/internal/v1/manifest");
    const manifestBody = await manifest.json<{
      version: string;
      capabilities: Array<{ id: string; mode: string }>;
    }>();
    expect(manifestBody.version).toBe("1.2.0");
    expect(manifestBody.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "vocostar.jobs.cancel",
          mode: "request",
        }),
        expect.objectContaining({
          id: "vocostar.jobs.retry",
          mode: "request",
        }),
      ]),
    );
  });

  it("creates one durable media job and deducts credits exactly once", async () => {
    const body = mediaJob("media:idempotent:1", 10);
    const first = await authorized("/internal/v1/jobs", {
      method: "POST",
      body: JSON.stringify(body),
    });
    expect(first.status, await first.clone().text()).toBe(202);
    const receipt = await first.json<{
      id: string;
      entityId: string;
      status: string;
    }>();
    expect(receipt.status).toBe("running");

    const second = await authorized("/internal/v1/jobs", {
      method: "POST",
      body: JSON.stringify(body),
    });
    expect(second.status).toBe(202);
    await expect(second.json()).resolves.toMatchObject({
      id: receipt.id,
      entityId: receipt.entityId,
    });

    const user = await runtimeEnv.VOCOSTAR_DB.prepare(
      "SELECT credits FROM users WHERE id='user-1'",
    ).first<{ credits: number }>();
    const dispatch = await runtimeEnv.VOCOSTAR_DB.prepare(
      "SELECT id,user_media_id,status FROM send_users_medias",
    ).first<{
      id: string;
      user_media_id: string;
      status: string;
    }>();
    expect(user?.credits).toBe(90);
    expect(dispatch).toMatchObject({
      id: receipt.id,
      user_media_id: receipt.entityId,
      status: "processing",
    });

    const conflict = await authorized("/internal/v1/jobs", {
      method: "POST",
      body: JSON.stringify(mediaJob("media:idempotent:1", 11)),
    });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toEqual({
      error: "idempotency_conflict",
    });
  });

  it("stores only an owner-scoped Files identifier and resolves a ticket at dispatch", async () => {
    const body = mediaJob("media:file:1", 0, {
      mediaType: "audio",
      input: { fileId: "11111111-1111-4111-8111-111111111111" },
    });
    const response = await authorized("/internal/v1/jobs", {
      method: "POST",
      body: JSON.stringify(body),
    });
    expect(response.status, await response.clone().text()).toBe(202);
    const receipt = await response.json<{ id: string }>();
    const [job, media] = await runtimeEnv.VOCOSTAR_DB.batch([
      runtimeEnv.VOCOSTAR_DB.prepare(
        "SELECT user_id,source_file_id FROM opengrow_custom_jobs WHERE id=?",
      ).bind(receipt.id),
      runtimeEnv.VOCOSTAR_DB.prepare(
        "SELECT input FROM users_medias WHERE id=(SELECT entity_id FROM opengrow_custom_jobs WHERE id=?)",
      ).bind(receipt.id),
    ]);
    expect(job.results[0]).toMatchObject({
      user_id: "user-1",
      source_file_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(
      JSON.parse(String((media.results[0] as { input: string }).input)),
    ).toEqual({
      audio_file_id: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("projects completion into job detail, list and aggregate statistics", async () => {
    const created = await authorized("/internal/v1/jobs", {
      method: "POST",
      body: JSON.stringify(mediaJob("media:complete:1", 0)),
    });
    const receipt = await created.json<{ id: string; entityId: string }>();
    await runtimeEnv.VOCOSTAR_DB.batch([
      runtimeEnv.VOCOSTAR_DB.prepare(
        "UPDATE users_medias SET job=1,progress=1,processed_at='2026-08-08T12:05:00.000Z' WHERE id=?",
      ).bind(receipt.entityId),
      runtimeEnv.VOCOSTAR_DB.prepare(
        "DELETE FROM send_users_medias WHERE id=?",
      ).bind(receipt.id),
    ]);

    const detail = await authorized(`/internal/v1/jobs/${receipt.id}`);
    await expect(detail.json()).resolves.toMatchObject({
      id: receipt.id,
      status: "completed",
      progress: 1,
    });
    const list = await authorized("/internal/v1/jobs?limit=10");
    await expect(list.json()).resolves.toMatchObject({
      jobs: [{ id: receipt.id, status: "completed" }],
    });
    const stats = await authorized("/internal/v1/stats");
    await expect(stats.json()).resolves.toMatchObject({
      users: { total: 1, premium: 1, anonymous: 1 },
      jobs: { completed: 1 },
    });
  });

  it("requires the private token for operational surfaces", async () => {
    const response = await SELF.fetch("https://custom.test/internal/v1/jobs");
    expect(response.status).toBe(401);
  });

  it("limits SDK job reads to the authenticated application project and subject", async () => {
    const created = await authorized("/internal/v1/jobs", {
      method: "POST",
      body: JSON.stringify(mediaJob("media:owned:1", 0)),
      headers: { "x-custom-worker-subject": "user-1" },
    });
    const receipt = await created.json<{ id: string }>();

    const owned = await authorized(`/internal/v1/jobs/${receipt.id}`, {
      headers: { "x-custom-worker-subject": "user-1" },
    });
    expect(owned.status).toBe(200);
    const forbidden = await authorized(`/internal/v1/jobs/${receipt.id}`, {
      headers: { "x-custom-worker-subject": "user-2" },
    });
    expect(forbidden.status).toBe(404);
    const list = await authorized("/internal/v1/jobs", {
      headers: { "x-custom-worker-subject": "user-2" },
    });
    await expect(list.json()).resolves.toEqual({ jobs: [], nextCursor: null });

    const otherProject = await authorized(`/internal/v1/jobs/${receipt.id}`, {
      headers: {
        "x-custom-worker-project": "12-test",
        "x-custom-worker-subject": "user-1",
      },
    });
    expect(otherProject.status).toBe(404);
  });

  it("deletes app-specific media and pseudonymizes durable financial receipts", async () => {
    const created = await authorized("/internal/v1/jobs", {
      method: "POST",
      body: JSON.stringify(
        mediaJob("media:account-erasure:1", 10, {
          mediaType: "audio",
          input: { fileId: "22222222-2222-4222-8222-222222222222" },
        }),
      ),
      headers: { "x-custom-worker-subject": "user-1" },
    });
    expect(created.status, await created.clone().text()).toBe(202);
    const receipt = await created.json<{ id: string }>();
    await runtimeEnv.VOCOSTAR_DB.prepare(
      `INSERT INTO opengrow_custom_job_credit_refunds
        (job_id, user_id, amount, created_at)
       VALUES (?, 'user-1', 10, '2026-08-08T12:00:00.000Z')`,
    )
      .bind(receipt.id)
      .run();
    const erased = await authorized("/internal/v1/users/user-1", {
      method: "DELETE",
      headers: { "x-custom-worker-subject": "user-1" },
    });
    expect(erased.status, await erased.clone().text()).toBe(200);
    await expect(erased.json()).resolves.toMatchObject({
      erased: true,
      jobs_redacted: 1,
      medias_deleted: 1,
      dispatches_deleted: 1,
      users_deleted: 1,
    });
    const [user, media, dispatch, job, refund] =
      await runtimeEnv.VOCOSTAR_DB.batch([
        runtimeEnv.VOCOSTAR_DB.prepare(
          "SELECT id FROM users WHERE id = 'user-1'",
        ),
        runtimeEnv.VOCOSTAR_DB.prepare(
          "SELECT id FROM users_medias WHERE user_id = 'user-1'",
        ),
        runtimeEnv.VOCOSTAR_DB.prepare(
          "SELECT id FROM send_users_medias WHERE id = ?",
        ).bind(receipt.id),
        runtimeEnv.VOCOSTAR_DB.prepare(
          "SELECT user_id, source_file_id, status, last_error FROM opengrow_custom_jobs WHERE id = ?",
        ).bind(receipt.id),
        runtimeEnv.VOCOSTAR_DB.prepare(
          "SELECT user_id FROM opengrow_custom_job_credit_refunds WHERE job_id = ?",
        ).bind(receipt.id),
      ]);
    expect(user.results).toEqual([]);
    expect(media.results).toEqual([]);
    expect(dispatch.results).toEqual([]);
    expect(job.results[0]).toMatchObject({
      user_id: expect.stringMatching(/^erased:[a-f0-9]{32}$/u),
      source_file_id: null,
      status: "cancelled",
      last_error: "account_erased",
    });
    expect(refund.results[0]).toMatchObject({
      user_id: expect.stringMatching(/^erased:[a-f0-9]{32}$/u),
    });
    const repeated = await authorized("/internal/v1/users/user-1", {
      method: "DELETE",
      headers: { "x-custom-worker-subject": "user-1" },
    });
    await expect(repeated.json()).resolves.toMatchObject({
      erased: true,
      jobs_redacted: 0,
      users_deleted: 0,
    });
  });

  it("cancels only an owned undispatched job and refunds credits exactly once", async () => {
    const created = await authorized("/internal/v1/jobs", {
      method: "POST",
      body: JSON.stringify(mediaJob("media:cancel:1", 10)),
      headers: { "x-custom-worker-subject": "user-1" },
    });
    const receipt = await created.json<{ id: string }>();
    await runtimeEnv.VOCOSTAR_DB.batch([
      runtimeEnv.VOCOSTAR_DB.prepare(
        "UPDATE opengrow_custom_jobs SET status='queued' WHERE id=?",
      ).bind(receipt.id),
      runtimeEnv.VOCOSTAR_DB.prepare(
        "UPDATE send_users_medias SET status='pending' WHERE id=?",
      ).bind(receipt.id),
    ]);

    const hidden = await authorized(`/internal/v1/jobs/${receipt.id}/cancel`, {
      method: "POST",
      headers: { "x-custom-worker-subject": "user-2" },
    });
    expect(hidden.status).toBe(404);

    const cancelled = await authorized(
      `/internal/v1/jobs/${receipt.id}/cancel`,
      {
        method: "POST",
        headers: { "x-custom-worker-subject": "user-1" },
      },
    );
    expect(cancelled.status, await cancelled.clone().text()).toBe(202);
    await expect(cancelled.json()).resolves.toMatchObject({
      id: receipt.id,
      status: "cancelled",
    });

    const replay = await authorized(`/internal/v1/jobs/${receipt.id}/cancel`, {
      method: "POST",
      headers: { "x-custom-worker-subject": "user-1" },
    });
    expect(replay.status).toBe(202);
    await expect(replay.json()).resolves.toMatchObject({ status: "cancelled" });

    const [user, dispatch, refund] = await runtimeEnv.VOCOSTAR_DB.batch([
      runtimeEnv.VOCOSTAR_DB.prepare(
        "SELECT credits FROM users WHERE id='user-1'",
      ),
      runtimeEnv.VOCOSTAR_DB.prepare(
        "SELECT status FROM send_users_medias WHERE id=?",
      ).bind(receipt.id),
      runtimeEnv.VOCOSTAR_DB.prepare(
        "SELECT amount, applied_at FROM opengrow_custom_job_credit_refunds WHERE job_id=?",
      ).bind(receipt.id),
    ]);
    expect(user.results[0]).toMatchObject({ credits: 100 });
    expect(dispatch.results[0]).toMatchObject({ status: "cancelled" });
    expect(refund.results).toHaveLength(1);
    expect(refund.results[0]).toMatchObject({ amount: 10 });
    expect(
      (refund.results[0] as { applied_at: string }).applied_at,
    ).toBeTruthy();

    const stats = await authorized("/internal/v1/stats");
    await expect(stats.json()).resolves.toMatchObject({
      jobs: { cancelled: 1 },
      cancellations: {
        jobs: 1,
        refundsPending: 0,
        refundsApplied: 1,
        creditsRefunded: 10,
      },
    });

    const retry = await authorized(`/internal/v1/jobs/${receipt.id}/retry`, {
      method: "POST",
    });
    expect(retry.status).toBe(409);
    await expect(retry.json()).resolves.toEqual({
      error: "job_not_retryable",
    });
  });

  it("rejects cancellation and retry after processing has started", async () => {
    const created = await authorized("/internal/v1/jobs", {
      method: "POST",
      body: JSON.stringify(mediaJob("media:running:1", 10)),
      headers: { "x-custom-worker-subject": "user-1" },
    });
    const receipt = await created.json<{ id: string }>();
    const cancelled = await authorized(
      `/internal/v1/jobs/${receipt.id}/cancel`,
      {
        method: "POST",
        headers: { "x-custom-worker-subject": "user-1" },
      },
    );
    expect(cancelled.status).toBe(409);
    await expect(cancelled.json()).resolves.toEqual({
      error: "job_not_cancellable",
    });
    const retried = await authorized(`/internal/v1/jobs/${receipt.id}/retry`, {
      method: "POST",
    });
    expect(retried.status).toBe(409);
    await expect(retried.json()).resolves.toEqual({
      error: "job_not_retryable",
    });
  });
});

const runtimeEnv = env as unknown as { VOCOSTAR_DB: D1Database };

function mediaJob(
  idempotencyKey: string,
  creditCost: number,
  payloadOverrides: Record<string, unknown> = {},
) {
  return {
    idempotencyKey,
    projectRef: "11-test",
    capability: "vocostar.media.convert",
    requestedAt: new Date().toISOString(),
    payload: {
      vocalId: "voice-1",
      vocalType: "app",
      mediaType: "text",
      creditCost,
      input: { text: "Bonjour", language: "fr" },
      ...payloadOverrides,
    },
  };
}

function authorized(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-custom-worker-token", "custom-runtime-secret");
  if (!headers.has("x-custom-worker-subject"))
    headers.set("x-custom-worker-subject", "user-1");
  if (!headers.has("x-custom-worker-project"))
    headers.set("x-custom-worker-project", "11-test");
  if (init.body) headers.set("content-type", "application/json");
  return SELF.fetch(`https://custom.test${path}`, { ...init, headers });
}
