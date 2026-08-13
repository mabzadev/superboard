import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("POST /api/auth/refresh", () => {
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

  it("rejects a missing refresh token before contacting the API", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("../refresh/route");

    const response = await POST(request({}));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a complete rotated token pair", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValueOnce(
        Response.json({
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
        })
      )
    );
    const { POST } = await import("../refresh/route");

    const response = await POST(request({ refresh_token: "old-token" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      access_token: "new-access-token",
      refresh_token: "new-refresh-token",
    });
  });

  it("fails closed on a partial successful response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValueOnce(
        Response.json({ access_token: "new-access-token" })
      )
    );
    const { POST } = await import("../refresh/route");

    const response = await POST(request({ refresh_token: "old-token" }));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Authentication service returned an invalid response",
    });
  });
});

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest("https://board.example.test/api/auth/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
