import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { verifyInternalProjectContextRequest } from "@superboard/contracts/project-context";
import type { Env } from "../types";
import { createFakeD1 } from "../test/fake-d1";
import admin from "./admin";

const CUTOVER_TOKEN = "cutover-token-for-tests";
const FLOWS_TOKEN = "flows-token-for-tests";

describe("Flows cutover user hash gateway", () => {
  it("requires cutover authorization and a stable idempotency key", async () => {
    const fetch = vi.fn(async () => new Response("unreachable"));
    const application = testApplication();
    const environment = testEnvironment(fetch);

    const unauthorized = await application.request(
      "/api/v1/admin/module-cutover/user-hashes/42-test",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_ids: ["customer-1"] }),
      },
      environment,
    );
    expect(unauthorized.status).toBe(403);

    const missingIdempotency = await application.request(
      "/api/v1/admin/module-cutover/user-hashes/42-test",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${CUTOVER_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ user_ids: ["customer-1"] }),
      },
      environment,
    );
    expect(missingIdempotency.status).toBe(422);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("signs the exact project-scoped Worker request without exposing the hash key", async () => {
    let forwarded: Request | undefined;
    const fetch = vi.fn(async (request: Request) => {
      forwarded = request;
      return Response.json({
        data: {
          items: [{ user_id: "customer-1", user_id_hash: "a".repeat(64) }],
        },
      });
    });
    const response = await testApplication().request(
      "/api/v1/admin/module-cutover/user-hashes/42-test",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${CUTOVER_TOKEN}`,
          "content-type": "application/json",
          "idempotency-key": "flows-cutover-user-hashes-test-0001",
        },
        body: JSON.stringify({ user_ids: ["customer-1"] }),
      },
      testEnvironment(fetch),
    );

    expect(response.status).toBe(200);
    expect(forwarded).toBeDefined();
    expect(new URL(forwarded!.url).pathname).toBe(
      "/internal/v1/projects/42-test/cutover/user-hashes",
    );
    expect(forwarded!.headers.get("idempotency-key")).toBe(
      "flows-cutover-user-hashes-test-0001",
    );
    await expect(
      verifyInternalProjectContextRequest(forwarded!, FLOWS_TOKEN, "flows"),
    ).resolves.toMatchObject({
      ok: true,
      context: {
        projectId: 7,
        projectRef: "42-test",
        instanceId: 42,
        environment: "test",
        actorId: 0,
        role: "cutover",
      },
    });
    expect(forwarded!.headers.get("x-flow-user-hash-key")).toBeNull();
  });
});

function testApplication() {
  const application = new Hono<{ Bindings: Env }>();
  application.route("/api/v1/admin", admin);
  return application;
}

function testEnvironment(fetch: ReturnType<typeof vi.fn>): Env {
  const DB = createFakeD1((call) => {
    if (call.sql.includes("SELECT id, instance_id, is_test")) {
      expect(call.args).toEqual([42, 1]);
      return {
        id: 7,
        instance_id: 42,
        is_test: 1,
        name: "Test project",
        identifier: "test-project",
      };
    }
    throw new Error(`Unexpected D1 query: ${call.sql}`);
  });
  return {
    DB,
    OPENGROW_CUTOVER_TOKEN: CUTOVER_TOKEN,
    FLOWS_INTERNAL_TOKEN: FLOWS_TOKEN,
    FLOWS_MODULE: { fetch } as unknown as Fetcher,
  } as Env;
}
