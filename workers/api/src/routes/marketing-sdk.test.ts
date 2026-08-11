import { verifyInternalProjectContextRequest } from "@superboard/contracts/project-context";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createFakeD1 } from "../test/fake-d1";
import type { AppVariables, Env } from "../types";
import marketingSdk from "./marketing-sdk";

describe("application Marketing preferences", () => {
  it("forwards a verified Identity profile through a signed project context", async () => {
    const observed: Request[] = [];
    const env = fixture(observed);
    const response = await app().request(
      "/preferences",
      {
        headers: {
          authorization: "Bearer application-token",
          "x-request-id": "marketing-read-1",
        },
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(observed).toHaveLength(1);
    const forwarded = observed[0];
    expect(forwarded.headers.get("authorization")).toBeNull();
    expect(forwarded.headers.get("x-superboard-application-user-id")).toBe(
      "application-user-1",
    );
    expect(forwarded.headers.get("x-superboard-application-email")).toBe(
      "user@example.test",
    );
    expect(forwarded.headers.get("x-opengrow-application-user-id")).toBe(
      "application-user-1",
    );
    expect(forwarded.headers.get("x-opengrow-application-email")).toBe(
      "user@example.test",
    );
    expect(forwarded.headers.get("x-role")).toBe("application");
    const verified = await verifyInternalProjectContextRequest(
      forwarded,
      "module-secret",
      "marketing",
    );
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.context).toMatchObject({
        projectId: 20,
        projectRef: "10-test",
        instanceId: 10,
        environment: "test",
        actorId: 0,
        role: "application",
        requestId: "marketing-read-1",
      });
    }
  });

  it("reconstructs writes without trusting client identity fields", async () => {
    const observed: Request[] = [];
    const env = fixture(observed);
    const response = await app().request(
      "/preferences",
      {
        method: "PUT",
        headers: {
          authorization: "Bearer application-token",
          "content-type": "application/json",
          "idempotency-key": "consent-1",
          "x-opengrow-application-email": "attacker@example.test",
        },
        body: JSON.stringify({
          consented: true,
          email: "attacker@example.test",
          application_user_id: "attacker",
          attributes: { locale: "fr-CH" },
          list_ids: ["product-news"],
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    const forwarded = observed[0];
    expect(forwarded.headers.get("x-opengrow-application-email")).toBe(
      "user@example.test",
    );
    expect(forwarded.headers.get("idempotency-key")).toBe("consent-1");
    await expect(forwarded.json()).resolves.toEqual({
      consented: true,
      attributes: { locale: "fr-CH" },
      list_ids: ["product-news"],
    });
  });

  it("rejects an unverified email before invoking Marketing", async () => {
    const observed: Request[] = [];
    const env = fixture(observed, false);
    const response = await app().request(
      "/preferences",
      { headers: { authorization: "Bearer application-token" } },
      env,
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "verified_email_required" },
    });
    expect(observed).toHaveLength(0);
  });

  it("rejects malformed preference fields before invoking Marketing", async () => {
    const observed: Request[] = [];
    const env = fixture(observed);
    const response = await app().request(
      "/preferences",
      {
        method: "PUT",
        headers: {
          authorization: "Bearer application-token",
          "content-type": "application/json",
          "idempotency-key": "invalid-preferences-1",
        },
        body: JSON.stringify({
          consented: true,
          attributes: [],
          list_ids: ["private/id"],
        }),
      },
      env,
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "attributes_invalid" },
    });
    expect(observed).toHaveLength(0);
  });
});

function app() {
  const value = new Hono<{ Bindings: Env; Variables: AppVariables }>();
  value.use("*", async (c, next) => {
    c.set("projectId", 20);
    c.set("instanceId", 10);
    await next();
  });
  value.route("/", marketingSdk);
  return value;
}

function fixture(observed: Request[], emailVerified = true): Env {
  const db = createFakeD1((call) => {
    if (call.op === "first" && call.sql.includes("FROM projects")) {
      return { id: 20, instance_id: 10, is_test: 1 };
    }
    return undefined;
  });
  return {
    DB: db,
    MODULE_INTERNAL_TOKEN: "module-secret",
    IDENTITY_SERVICE: {
      fetch: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request("https://identity.internal/auth/me", init);
        expect(request.headers.get("authorization")).toBe(
          "Bearer application-token",
        );
        return Response.json({
          user: {
            id: "application-user-1",
            email: "User@Example.Test",
            name: "Reference User",
            email_verified: emailVerified,
          },
        });
      }),
    } as unknown as Fetcher,
    MARKETING_MODULE: {
      fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        observed.push(request);
        return Response.json({ data: { consented: request.method === "PUT" } });
      }),
    } as unknown as Fetcher,
  } as Env;
}
