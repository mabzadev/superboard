import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../types";
import { verifyInternalProjectContextRequest } from "@opengrow/contracts/project-context";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  resolveAuthorizedProjectContext: vi.fn(),
}));

vi.mock("../lib/auth", () => ({ getAuthContext: mocks.getAuthContext }));
vi.mock("../lib/domain-modules", async (load) => ({
  ...(await load<typeof import("../lib/domain-modules")>()),
  resolveAuthorizedProjectContext: mocks.resolveAuthorizedProjectContext,
}));

import applicationUsersAdminRoutes from "./application-users-admin";

describe("application user administration gateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthContext.mockResolvedValue({ userId: 7 });
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

  it("forwards only sanitized list parameters through the target Identity binding", async () => {
    const identityFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        expect(request.url).toBe(
          "https://identity.internal/internal/v1/admin/users?q=google&limit=25&offset=50",
        );
        expect(request.headers.get("authorization")).toBeNull();
        expect(request.headers.get("x-internal-token")).toBe("module-token");
        expect(request.headers.get("x-request-id")).toBe("request-1");
        await expect(
          verifyInternalProjectContextRequest(
            request,
            "module-token",
            "identity",
          ),
        ).resolves.toMatchObject({
          ok: true,
          context: { projectId: 11, projectRef: "10-prod" },
        });
        return Response.json({ data: [{ id: "application-user-1" }] });
      },
    );
    const response = await app().request(
      "/10-prod/users?q=google&limit=25&offset=50&secret=must-not-forward",
      {
        headers: {
          authorization: "Bearer dashboard-token",
          "x-request-id": "request-1",
        },
      },
      fixture(identityFetch),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      data: [{ id: "application-user-1" }],
    });
    expect(identityFetch).toHaveBeenCalledTimes(1);
    expect(mocks.resolveAuthorizedProjectContext).toHaveBeenCalledWith(
      expect.anything(),
      7,
      "10-prod",
    );
  });

  it("encodes the application user id and forwards no dashboard credential", async () => {
    const identityFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        expect(request.url).toBe(
          "https://identity.internal/internal/v1/admin/users/user%3A123",
        );
        expect(request.headers.get("authorization")).toBeNull();
        return Response.json({ data: { id: "user:123" } });
      },
    );
    const response = await app().request(
      "/10-test/users/user%3A123",
      { headers: { authorization: "Bearer dashboard-token" } },
      fixture(identityFetch),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: "user:123" },
    });
  });

  it("requires a valid dashboard session and an owner or administrator role", async () => {
    mocks.getAuthContext.mockResolvedValueOnce(null);
    const unauthenticated = await app().request(
      "/10-prod/users",
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
    const member = await app().request(
      "/10-prod/users",
      { headers: { authorization: "Bearer member-token" } },
      fixture(vi.fn()),
    );
    expect(member.status).toBe(403);
    await expect(member.json()).resolves.toMatchObject({
      error: { code: "administrator_required" },
    });
  });

  it("fails closed when the target Identity binding or internal token is absent", async () => {
    const response = await app().request(
      "/10-prod/users",
      { headers: { authorization: "Bearer dashboard-token" } },
      { DB: {} } as Env,
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "identity_admin_unavailable", retryable: true },
    });
  });
});

function app() {
  const instance = new Hono<{ Bindings: Env }>();
  instance.route("/", applicationUsersAdminRoutes);
  return instance;
}

function fixture(identityFetch: ReturnType<typeof vi.fn>): Env {
  return {
    DB: {},
    MODULE_INTERNAL_TOKEN: "module-token",
    IDENTITY_SERVICE: { fetch: identityFetch } as unknown as Fetcher,
  } as Env;
}
