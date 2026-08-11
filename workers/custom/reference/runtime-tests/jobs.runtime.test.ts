import { env } from "cloudflare:workers";
import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { runReferenceMaintenance } from "../src/index";

describe("reference custom Worker with D1", () => {
  beforeEach(async () => {
    await runtimeEnv.REFERENCE_DB.prepare(
      "DELETE FROM reference_custom_jobs",
    ).run();
  });

  it("persists an idempotent echo and rejects a conflicting replay", async () => {
    const body = echoJob("reference:idempotent:1", "first");
    const first = await authorized("/internal/v1/jobs", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "x-custom-worker-subject": "user-1" },
    });
    expect(first.status, await first.clone().text()).toBe(202);
    const receipt = await first.json<{ id: string; status: string }>();
    expect(receipt).toMatchObject({ status: "completed" });

    const replay = await authorized("/internal/v1/jobs", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "x-custom-worker-subject": "user-1" },
    });
    await expect(replay.json()).resolves.toMatchObject({ id: receipt.id });

    const conflict = await authorized("/internal/v1/jobs", {
      method: "POST",
      body: JSON.stringify(echoJob("reference:idempotent:1", "changed")),
      headers: { "x-custom-worker-subject": "user-1" },
    });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toEqual({
      error: "idempotency_conflict",
    });
  });

  it("persists a revision-bound acceptance receipt and rejects incomplete evidence", async () => {
    const body = acceptanceJob("reference:acceptance:1");
    const created = await authorized("/internal/v1/jobs", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "x-custom-worker-subject": "user-1" },
    });
    expect(created.status, await created.clone().text()).toBe(202);
    await expect(created.json()).resolves.toMatchObject({
      capability: "reference.acceptance",
      status: "completed",
      result: {
        acceptance: {
          target: "mbza-development",
          projectEnvironment: "test",
          platformRevision: "a".repeat(40),
          referenceRevision: "b".repeat(40),
          decision: "accepted",
          failed: 0,
          journeys: { length: 16 },
        },
        projectRef: "12-test",
      },
    });

    const list = await authorized(
      "/internal/v1/jobs?capability=reference.acceptance&status=completed",
      { headers: { "x-custom-worker-subject": "user-1" } },
    );
    await expect(list.json()).resolves.toMatchObject({
      jobs: [{ capability: "reference.acceptance" }],
    });
    const stats = await authorized("/internal/v1/stats");
    await expect(stats.json()).resolves.toMatchObject({
      capabilities: { "reference.acceptance": { completed: 1 } },
    });

    const incomplete = acceptanceJob("reference:acceptance:incomplete");
    incomplete.payload.journeys = incomplete.payload.journeys.slice(1);
    const rejected = await authorized("/internal/v1/jobs", {
      method: "POST",
      body: JSON.stringify(incomplete),
      headers: { "x-custom-worker-subject": "user-1" },
    });
    expect(rejected.status).toBe(422);
    await expect(rejected.json()).resolves.toEqual({
      error: "acceptance_journeys_invalid",
    });

    const wrongTarget = acceptanceJob("reference:acceptance:wrong-target");
    wrongTarget.payload.target = "another-target";
    const targetRejected = await authorized("/internal/v1/jobs", {
      method: "POST",
      body: JSON.stringify(wrongTarget),
      headers: { "x-custom-worker-subject": "user-1" },
    });
    expect(targetRejected.status).toBe(422);
    await expect(targetRejected.json()).resolves.toEqual({
      error: "acceptance_target_invalid",
    });

    const invalidExemption = acceptanceJob(
      "reference:acceptance:invalid-exemption",
    );
    invalidExemption.payload.journeys[0] = {
      id: "bootstrap",
      status: "not_applicable",
      evidence: "must never be exempt",
    };
    const exemptionRejected = await authorized("/internal/v1/jobs", {
      method: "POST",
      body: JSON.stringify(invalidExemption),
      headers: { "x-custom-worker-subject": "user-1" },
    });
    expect(exemptionRejected.status).toBe(422);
    await expect(exemptionRejected.json()).resolves.toEqual({
      error: "acceptance_journeys_invalid",
    });

    const secretEvidence = acceptanceJob(
      "reference:acceptance:secret-evidence",
    );
    secretEvidence.payload.journeys[0].evidence =
      "Bearer header-content-must-not-be-persisted";
    const secretRejected = await authorized("/internal/v1/jobs", {
      method: "POST",
      body: JSON.stringify(secretEvidence),
      headers: { "x-custom-worker-subject": "user-1" },
    });
    expect(secretRejected.status).toBe(422);
    await expect(secretRejected.json()).resolves.toEqual({
      error: "acceptance_journeys_invalid",
    });
  });

  it("scopes detail and list reads to the authenticated project and subject", async () => {
    const created = await authorized("/internal/v1/jobs", {
      method: "POST",
      body: JSON.stringify(echoJob("reference:owned:1", "owned")),
      headers: { "x-custom-worker-subject": "user-1" },
    });
    const receipt = await created.json<{ id: string }>();

    const owned = await authorized(`/internal/v1/jobs/${receipt.id}`, {
      headers: { "x-custom-worker-subject": "user-1" },
    });
    await expect(owned.json()).resolves.toMatchObject({
      id: receipt.id,
      result: { echo: { value: "owned" } },
    });
    const hidden = await authorized(`/internal/v1/jobs/${receipt.id}`, {
      headers: { "x-custom-worker-subject": "user-2" },
    });
    expect(hidden.status).toBe(404);
    const list = await authorized(
      "/internal/v1/jobs?capability=reference.echo&status=completed&limit=10",
      { headers: { "x-custom-worker-subject": "user-2" } },
    );
    await expect(list.json()).resolves.toEqual({ jobs: [], nextCursor: null });

    const otherProject = await authorized(`/internal/v1/jobs/${receipt.id}`, {
      headers: {
        "x-custom-worker-project": "13-test",
        "x-custom-worker-subject": "user-1",
      },
    });
    expect(otherProject.status).toBe(404);
    const otherProjectList = await authorized("/internal/v1/jobs", {
      headers: {
        "x-custom-worker-project": "13-test",
        "x-custom-worker-subject": "user-1",
      },
    });
    await expect(otherProjectList.json()).resolves.toEqual({
      jobs: [],
      nextCursor: null,
    });

    const hiddenCancellation = await authorized(
      `/internal/v1/jobs/${receipt.id}/cancel`,
      {
        method: "POST",
        headers: { "x-custom-worker-subject": "user-2" },
      },
    );
    expect(hiddenCancellation.status).toBe(404);
    const terminalCancellation = await authorized(
      `/internal/v1/jobs/${receipt.id}/cancel`,
      {
        method: "POST",
        headers: { "x-custom-worker-subject": "user-1" },
      },
    );
    expect(terminalCancellation.status).toBe(409);
    await expect(terminalCancellation.json()).resolves.toEqual({
      error: "job_not_cancellable",
    });
  });

  it("erases only the authenticated subject's reference jobs", async () => {
    for (const [subject, key] of [
      ["erasure-user", "reference:erasure:owned"],
      ["retained-user", "reference:erasure:retained"],
    ]) {
      const response = await authorized("/internal/v1/jobs", {
        method: "POST",
        body: JSON.stringify(echoJob(key, subject)),
        headers: { "x-custom-worker-subject": subject },
      });
      expect(response.status).toBe(202);
    }
    const erased = await authorized("/internal/v1/users/erasure-user", {
      method: "DELETE",
      headers: { "x-custom-worker-subject": "erasure-user" },
    });
    await expect(erased.json()).resolves.toEqual({
      erased: true,
      jobs_deleted: 1,
    });
    const repeated = await authorized("/internal/v1/users/erasure-user", {
      method: "DELETE",
      headers: { "x-custom-worker-subject": "erasure-user" },
    });
    await expect(repeated.json()).resolves.toEqual({
      erased: true,
      jobs_deleted: 0,
    });
    const mismatch = await authorized("/internal/v1/users/erasure-user", {
      method: "DELETE",
      headers: { "x-custom-worker-subject": "another-user" },
    });
    expect(mismatch.status).toBe(403);
    const retained = await authorized("/internal/v1/jobs", {
      headers: { "x-custom-worker-subject": "retained-user" },
    });
    await expect(retained.json()).resolves.toMatchObject({
      jobs: [{ result: { echo: { value: "retained-user" } } }],
    });
  });

  it("rejects incomplete or mismatched public SDK scope", async () => {
    const incomplete = await SELF.fetch(
      "https://custom.test/internal/v1/jobs",
      {
        headers: {
          "x-custom-worker-token": "custom-runtime-secret",
          "x-custom-worker-subject": "user-1",
        },
      },
    );
    expect(incomplete.status).toBe(422);
    await expect(incomplete.json()).resolves.toEqual({
      error: "scope_invalid",
    });

    const missing = await authorized("/internal/v1/jobs", {
      method: "POST",
      body: JSON.stringify(echoJob("reference:scope-missing:1", "blocked")),
    });
    expect(missing.status).toBe(403);
    await expect(missing.json()).resolves.toEqual({
      error: "scope_required",
    });

    const mismatch = await authorized("/internal/v1/jobs", {
      method: "POST",
      body: JSON.stringify(echoJob("reference:project-mismatch:1", "blocked")),
      headers: {
        "x-custom-worker-project": "13-test",
        "x-custom-worker-subject": "user-1",
      },
    });
    expect(mismatch.status).toBe(403);
    await expect(mismatch.json()).resolves.toEqual({
      error: "project_mismatch",
    });
  });

  it("paginates durable jobs and reports aggregate statistics", async () => {
    for (const [key, value] of [
      ["reference:page:1", "one"],
      ["reference:page:2", "two"],
    ]) {
      const response = await authorized("/internal/v1/jobs", {
        method: "POST",
        body: JSON.stringify(echoJob(key, value)),
        headers: { "x-custom-worker-subject": "user-1" },
      });
      expect(response.status).toBe(202);
    }
    const first = await authorized("/internal/v1/jobs?limit=1", {
      headers: { "x-custom-worker-subject": "user-1" },
    });
    const page = await first.json<{
      jobs: unknown[];
      nextCursor: string | null;
    }>();
    expect(page.jobs).toHaveLength(1);
    expect(page.nextCursor).toBeTruthy();
    const second = await authorized(
      `/internal/v1/jobs?limit=1&cursor=${encodeURIComponent(page.nextCursor!)}`,
      { headers: { "x-custom-worker-subject": "user-1" } },
    );
    await expect(second.json()).resolves.toMatchObject({
      jobs: [{ status: "completed" }],
    });

    const stats = await authorized("/internal/v1/stats");
    await expect(stats.json()).resolves.toMatchObject({
      status: "ok",
      jobs: { completed: 2 },
      capabilities: { "reference.echo": { completed: 2 } },
    });
  });

  it("requires the private token and checks the D1 binding in health", async () => {
    expect(
      (await SELF.fetch("https://custom.test/internal/v1/jobs")).status,
    ).toBe(401);
    const health = await SELF.fetch("https://custom.test/health");
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({
      service: "custom-reference",
      status: "ok",
      retentionDays: 30,
      schema: {
        status: "current",
        expectedMigration: "0002_reference_acceptance.sql",
        latestMigration: "0002_reference_acceptance.sql",
        appliedMigrationCount: 2,
      },
    });
    const manifest = await authorized("/internal/v1/manifest");
    await expect(manifest.json()).resolves.toMatchObject({
      version: "1.2.0",
      capabilities: [
        { id: "reference.echo", mode: "request" },
        { id: "reference.acceptance", mode: "request" },
      ],
    });
  });

  it("prunes jobs older than the target-defined retention window", async () => {
    const expired = await authorized("/internal/v1/jobs", {
      method: "POST",
      body: JSON.stringify(echoJob("reference:expired:1", "expired")),
      headers: { "x-custom-worker-subject": "user-1" },
    });
    const receipt = await expired.json<{ id: string }>();
    await runtimeEnv.REFERENCE_DB.prepare(
      "UPDATE reference_custom_jobs SET created_at = ? WHERE id = ?",
    )
      .bind("2020-01-01T00:00:00.000Z", receipt.id)
      .run();

    const fresh = await authorized("/internal/v1/jobs", {
      method: "POST",
      body: JSON.stringify(echoJob("reference:fresh:1", "fresh")),
      headers: { "x-custom-worker-subject": "user-1" },
    });
    expect(fresh.status, await fresh.clone().text()).toBe(202);

    const missing = await authorized(`/internal/v1/jobs/${receipt.id}`, {
      headers: { "x-custom-worker-subject": "user-1" },
    });
    expect(missing.status).toBe(404);
    const stats = await authorized("/internal/v1/stats");
    await expect(stats.json()).resolves.toMatchObject({
      jobs: { completed: 1 },
    });
  });

  it("fails closed when a persisted job payload is corrupt", async () => {
    const created = await authorized("/internal/v1/jobs", {
      method: "POST",
      body: JSON.stringify(echoJob("reference:corrupt:1", "valid")),
      headers: { "x-custom-worker-subject": "user-1" },
    });
    const receipt = await created.json<{ id: string }>();
    await runtimeEnv.REFERENCE_DB.prepare(
      "UPDATE reference_custom_jobs SET payload_json = ? WHERE id = ?",
    )
      .bind("not-json", receipt.id)
      .run();

    const response = await authorized(`/internal/v1/jobs/${receipt.id}`, {
      headers: { "x-custom-worker-subject": "user-1" },
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "job_payload_corrupt",
    });
  });

  it("runs retention from the declarative scheduled maintenance handler", async () => {
    const created = await authorized("/internal/v1/jobs", {
      method: "POST",
      body: JSON.stringify(echoJob("reference:scheduled:1", "expired")),
      headers: { "x-custom-worker-subject": "user-1" },
    });
    const receipt = await created.json<{ id: string }>();
    await runtimeEnv.REFERENCE_DB.prepare(
      "UPDATE reference_custom_jobs SET created_at = ? WHERE id = ?",
    )
      .bind("2020-01-01T00:00:00.000Z", receipt.id)
      .run();

    await expect(
      runReferenceMaintenance({
        REFERENCE_DB: runtimeEnv.REFERENCE_DB,
        REFERENCE_JOB_RETENTION_DAYS: "30",
      } as Env),
    ).resolves.toBe(1);
    const count = await runtimeEnv.REFERENCE_DB.prepare(
      "SELECT COUNT(*) total FROM reference_custom_jobs",
    ).first<{ total: number }>();
    expect(count?.total).toBe(0);
  });
});

const runtimeEnv = env as unknown as { REFERENCE_DB: D1Database };

function echoJob(idempotencyKey: string, value: string) {
  return {
    idempotencyKey,
    projectRef: "12-test",
    capability: "reference.echo",
    payload: { value },
    requestedAt: new Date().toISOString(),
  };
}

function acceptanceJob(idempotencyKey: string) {
  const now = new Date().toISOString();
  return {
    idempotencyKey,
    projectRef: "12-test",
    capability: "reference.acceptance",
    payload: {
      schemaVersion: 1,
      target: "mbza-development",
      projectEnvironment: "test",
      platformRevision: "a".repeat(40),
      referenceRevision: "b".repeat(40),
      completedAt: now,
      journeys: [
        "bootstrap",
        "sign-in",
        "create-account",
        "password-recovery",
        "home",
        "profile",
        "notifications",
        "files",
        "products",
        "paywall",
        "dynamic-links",
        "support",
        "marketing-consent",
        "onboarding",
        "custom-extension",
        "diagnostics",
      ].map((id) => ({ id, status: "passed", evidence: `${id} accepted` })),
    },
    requestedAt: now,
  };
}

function authorized(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-custom-worker-token", "custom-runtime-secret");
  if (
    headers.has("x-custom-worker-subject") &&
    !headers.has("x-custom-worker-project")
  ) {
    headers.set("x-custom-worker-project", "12-test");
  }
  if (init.body) headers.set("content-type", "application/json");
  return SELF.fetch(`https://custom.test${path}`, { ...init, headers });
}
