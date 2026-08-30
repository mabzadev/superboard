import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyInternalProjectContextRequest } from "@superboard/contracts/project-context";
import type { Env } from "../types";

const mocks = vi.hoisted(() => ({
  getRequestAuthContext: vi.fn(),
  resolveAuthorizedProjectContext: vi.fn(),
}));

vi.mock("../lib/auth", () => ({ getRequestAuthContext: mocks.getRequestAuthContext }));
vi.mock("../lib/domain-modules", async (load) => ({
  ...(await load<typeof import("../lib/domain-modules")>()),
  resolveAuthorizedProjectContext: mocks.resolveAuthorizedProjectContext,
}));

import identityAdminRoutes from "./identity-admin";

describe("Identity administration gateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestAuthContext.mockResolvedValue({ userId: 7 });
    mocks.resolveAuthorizedProjectContext.mockResolvedValue({
      ok: true,
      context: {
        projectId: 11,
        projectRef: "10-prod",
        instanceId: 10,
        environment: "production",
        role: "admin",
      },
    });
  });

  it("forwards the complete Melody admin API over the private Identity binding", async () => {
    const identityFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        expect(request.url).toBe(
          "https://identity.internal/internal/v1/melody-admin/api/v1/apps/42?include=roles",
        );
        expect(request.method).toBe("PUT");
        expect(request.headers.get("authorization")).toBeNull();
        expect(request.headers.get("cookie")).toBeNull();
        expect(request.headers.get("x-internal-token")).toBe("module-token");
        expect(await request.json()).toEqual({ name: "Mobile app" });
        await expect(
          verifyInternalProjectContextRequest(
            request,
            "module-token",
            "identity",
          ),
        ).resolves.toMatchObject({
          ok: true,
          context: {
            actorId: 7,
            projectId: 11,
            projectRef: "10-prod",
            method: "PUT",
          },
        });
        return Response.json({ app: { id: 42, name: "Mobile app" } });
      },
    );
    const response = await testApp().request(
      "/10-prod/api/v1/apps/42?include=roles",
      {
        method: "PUT",
        headers: {
          authorization: "Bearer dashboard-token",
          cookie: "must-not-leak=1",
          "content-type": "application/json",
          "x-request-id": "identity-admin-request",
        },
        body: JSON.stringify({ name: "Mobile app" }),
      },
      fixture(identityFetch),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.json()).resolves.toEqual({
      app: { id: 42, name: "Mobile app" },
    });
  });

  it("exposes configuration info at the project root", async () => {
    const identityFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        expect(request.url).toBe(
          "https://identity.internal/internal/v1/melody-admin/info",
        );
        return Response.json({ AUTH_SERVER_URL: "https://auth.mbza.dev" });
      },
    );
    const response = await testApp().request(
      "/10-prod",
      { headers: { authorization: "Bearer dashboard-token" } },
      fixture(identityFetch),
    );
    expect(response.status).toBe(200);
    expect(identityFetch).toHaveBeenCalledOnce();
  });

  it("rejects paths outside Melody's info and API surfaces", async () => {
    const response = await testApp().request(
      "/10-prod/.well-known/jwks.json",
      { headers: { authorization: "Bearer dashboard-token" } },
      fixture(vi.fn()),
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "identity_admin_path_invalid" },
    });
  });

  it("requires a dashboard session and an owner or administrator role", async () => {
    mocks.getRequestAuthContext.mockResolvedValueOnce(null);
    const unauthenticated = await testApp().request(
      "/10-prod/api/v1/apps",
      {},
      fixture(vi.fn()),
    );
    expect(unauthenticated.status).toBe(401);

    mocks.resolveAuthorizedProjectContext.mockResolvedValueOnce({
      ok: true,
      context: {
        projectId: 11,
        projectRef: "10-prod",
        instanceId: 10,
        environment: "production",
        role: "member",
      },
    });
    const member = await testApp().request(
      "/10-prod/api/v1/apps",
      { headers: { authorization: "Bearer member-token" } },
      fixture(vi.fn()),
    );
    expect(member.status).toBe(403);
    await expect(member.json()).resolves.toMatchObject({
      error: { code: "administrator_required" },
    });
  });

  it("fails closed when its private binding is unavailable", async () => {
    const response = await testApp().request(
      "/10-prod/api/v1/apps",
      { headers: { authorization: "Bearer dashboard-token" } },
      { DB: {} } as Env,
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "identity_admin_unavailable", retryable: true },
    });
  });
});

function testApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/", identityAdminRoutes);
  return app;
}

function fixture(identityFetch: ReturnType<typeof vi.fn>): Env {
  return {
    DB: {},
    MODULE_INTERNAL_TOKEN: "module-token",
    IDENTITY_SERVICE: { fetch: identityFetch } as unknown as Fetcher,
  } as Env;
}
