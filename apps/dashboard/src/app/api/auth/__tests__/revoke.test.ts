import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("POST /api/auth/revoke", () => {
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

  it("preserves an empty successful revocation response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(null, { status: 204 })
      )
    );
    const { POST } = await import("../revoke/route");

    const response = await POST(
      new NextRequest("https://board.example.test/api/auth/revoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "refresh-token" }),
      })
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });
});
