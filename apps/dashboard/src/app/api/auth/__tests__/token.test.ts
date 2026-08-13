import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tokenPayload = {
  access_token: "access-token",
  refresh_token: "refresh-token",
};

describe("POST /api/auth/token", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.test");
    vi.stubEnv("NEXT_PUBLIC_CLIENT_ID", "dashboard-client");
    vi.stubEnv("CLIENT_SECRET", "dashboard-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns the token only after the authenticated user was loaded", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(tokenPayload))
      .mockResolvedValueOnce(
        Response.json({
          user: {
            id: "user-1",
            email: "user@example.test",
            name: "Test User",
          },
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("../token/route");

    const response = await POST(loginRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ...tokenPayload,
      user: { id: "user-1", email: "user@example.test" },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.example.test/api/v1/users/me",
      { headers: { Authorization: "Bearer access-token" } }
    );
  });

  it("fails closed when the user endpoint rejects the issued token", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json(tokenPayload))
        .mockResolvedValueOnce(
          Response.json({ error: "unauthorized" }, { status: 401 })
        )
    );
    const { POST } = await import("../token/route");

    const response = await POST(loginRequest("failed-me"));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Unable to load authenticated user",
    });
  });

  it("fails closed when the user endpoint returns no user", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json(tokenPayload))
        .mockResolvedValueOnce(Response.json({ user: null }))
    );
    const { POST } = await import("../token/route");

    const response = await POST(loginRequest("missing-user"));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Unable to load authenticated user",
    });
  });

  it("rejects a successful token response that contains no usable token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValueOnce(
        Response.json({ access_token: null })
      )
    );
    const { POST } = await import("../token/route");

    const response = await POST(loginRequest("invalid-token"));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Authentication service returned an invalid response",
    });
  });
});

function loginRequest(ip = "success"): NextRequest {
  return new NextRequest("https://board.example.test/api/auth/token", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `192.0.2.${ip.length}`,
    },
    body: JSON.stringify({
      email: "user@example.test",
      password: "correct horse battery staple",
    }),
  });
}
