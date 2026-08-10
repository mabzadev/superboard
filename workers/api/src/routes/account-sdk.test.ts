import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeD1 } from "../test/fake-d1";
import type { AppVariables, Env } from "../types";

const mocks = vi.hoisted(() => ({ eraseApplicationAccount: vi.fn() }));

vi.mock("../lib/account-erasure", async (load) => ({
  ...(await load<typeof import("../lib/account-erasure")>()),
  eraseApplicationAccount: mocks.eraseApplicationAccount,
}));

import accountSdk from "./account-sdk";

describe("application account SDK", () => {
  beforeEach(() => {
    mocks.eraseApplicationAccount.mockReset();
    mocks.eraseApplicationAccount.mockResolvedValue({
      operationId: "account-erasure-operation-1",
      status: "completed",
      completedSteps: [
        "app",
        "marketing",
        "support",
        "custom",
        "billing",
        "identity",
      ],
    });
  });

  it("derives the erasure subject from Identity and never trusts request data", async () => {
    const environment = fixture();
    const response = await app().request(
      "/",
      {
        method: "DELETE",
        headers: {
          authorization: "Bearer verified-identity-token",
          "x-request-id": "account-erasure-request-1",
        },
      },
      environment,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      data: {
        deleted: true,
        status: "completed",
        operation_id: "account-erasure-operation-1",
        completed_steps: [
          "app",
          "marketing",
          "support",
          "custom",
          "billing",
          "identity",
        ],
      },
    });
    expect(mocks.eraseApplicationAccount).toHaveBeenCalledWith(
      environment,
      {
        projectId: 20,
        instanceId: 10,
        projectRef: "10-test",
        environment: "test",
      },
      "application-user-1",
      "account-erasure-request-1",
    );
  });

  it("returns a retryable 202 while another request holds the durable lease", async () => {
    mocks.eraseApplicationAccount.mockResolvedValueOnce({
      operationId: "account-erasure-operation-2",
      status: "processing",
      completedSteps: ["app"],
    });
    const response = await app().request(
      "/",
      {
        method: "DELETE",
        headers: { authorization: "Bearer verified-identity-token" },
      },
      fixture(),
    );
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        deleted: false,
        status: "processing",
        completed_steps: ["app"],
      },
    });
  });

  it("rejects an invalid Identity session before creating an erasure operation", async () => {
    const response = await app().request(
      "/",
      {
        method: "DELETE",
        headers: { authorization: "Bearer rejected-token" },
      },
      fixture(401),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "identity_invalid", retryable: false },
    });
    expect(mocks.eraseApplicationAccount).not.toHaveBeenCalled();
  });
});

function app() {
  const value = new Hono<{ Bindings: Env; Variables: AppVariables }>();
  value.use("*", async (c, next) => {
    c.set("projectId", 20);
    c.set("instanceId", 10);
    await next();
  });
  value.route("/", accountSdk);
  return value;
}

function fixture(identityStatus = 200): Env {
  const db = createFakeD1((call) => {
    if (call.op === "first" && call.sql.includes("FROM projects")) {
      return { id: 20, instance_id: 10, is_test: 1 };
    }
    return undefined;
  });
  return {
    DB: db,
    IDENTITY_SERVICE: {
      fetch: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request("https://identity.internal/auth/me", init);
        expect(request.headers.get("authorization")).toBe(
          identityStatus === 200
            ? "Bearer verified-identity-token"
            : "Bearer rejected-token",
        );
        return identityStatus === 200
          ? Response.json({ user: { id: "application-user-1" } })
          : Response.json({ error: "invalid" }, { status: identityStatus });
      }),
    } as unknown as Fetcher,
  } as Env;
}
