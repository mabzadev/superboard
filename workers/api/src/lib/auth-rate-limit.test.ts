import { describe, expect, it } from "vitest";
import { createFakeD1 } from "../test/fake-d1";
import type { Env } from "../types";
import {
  consumeDashboardAuthAttempt,
  cleanupDashboardAuthRateLimits,
  dashboardAuthRateLimitResponse,
} from "./auth-rate-limit";

function envWithCount(count: number) {
  let persistedKey = "";
  const db = createFakeD1((call) => {
    if (call.op === "first" && call.sql.includes("dashboard_auth_rate_limits")) {
      persistedKey = String(call.args[0]);
      return { attempt_count: count };
    }
    return undefined;
  });
  return {
    env: { DB: db, KV: {} as KVNamespace } as Env,
    key: () => persistedKey,
  };
}

describe("Dashboard authentication rate limiting", () => {
  it("stores only a digest of scope, Cloudflare IP and subject", async () => {
    const { env, key } = envWithCount(1);
    const result = await consumeDashboardAuthAttempt(
      env,
      new Request("https://api.test/oauth/token", {
        headers: { "cf-connecting-ip": "192.0.2.25" },
      }),
      "oauth.password",
      "Person@Example.com",
    );
    expect(result.allowed).toBe(true);
    expect(key()).toMatch(/^[a-f0-9]{64}$/);
    expect(key()).not.toContain("person@example.com");
    expect(key()).not.toContain("192.0.2.25");
  });

  it("returns a no-store 429 response after the bounded window is exhausted", async () => {
    const { env } = envWithCount(11);
    const result = await consumeDashboardAuthAttempt(
      env,
      new Request("https://api.test/auth/sign_in"),
      "dashboard.sign_in",
      "person@example.com",
    );
    const response = dashboardAuthRateLimitResponse(result);
    expect(result.allowed).toBe(false);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("600");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("deletes expired counters without touching the active window", async () => {
    const db = createFakeD1((call) => {
      if (call.op === "run" && call.sql.includes("DELETE FROM dashboard_auth_rate_limits")) {
        return { success: true, meta: { changes: 4 } };
      }
      return undefined;
    });
    await expect(cleanupDashboardAuthRateLimits(db)).resolves.toBe(4);
  });
});
