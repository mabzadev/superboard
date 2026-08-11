import { describe, expect, it } from "vitest";
import { createFakeD1, type FakeD1Call } from "../test/fake-d1";
import type { Env } from "../types";
import {
  isTokenDigest,
  migrateLegacyBearerTokenStorage,
  tokenDigest,
} from "./token-storage";

function migrationEnv() {
  const updates: FakeD1Call[] = [];
  const db = createFakeD1((call) => {
    if (call.op === "all" && call.sql.includes("FROM oauth_access_tokens")) {
      return [{
        id: 1,
        token: "clear-oauth-access-fixture",
        refresh_token: "clear-oauth-refresh-fixture",
        previous_refresh_token: "clear-oauth-previous-fixture",
      }];
    }
    if (call.op === "all" && call.sql.includes("FROM mcp_tokens")) {
      return [{
        id: "mcp-1",
        access_token: "clear-mcp-access-fixture",
        refresh_token: "clear-mcp-refresh-fixture",
      }];
    }
    if (call.op === "all" && call.sql.includes("FROM oauth_applications")) {
      return [{ id: 20, secret: "clear-client-fixture" }];
    }
    if (call.op === "all" && call.sql.includes("FROM users")) {
      return [{
        id: 7,
        reset_password_token: "clear-reset-fixture",
        invitation_token: "clear-invitation-fixture",
      }];
    }
    if (call.op === "run" && call.sql.includes("UPDATE")) {
      updates.push(call);
      return true;
    }
    return undefined;
  });
  return { env: { DB: db, KV: {} as KVNamespace } as Env, updates };
}

describe("bearer token storage", () => {
  it("creates deterministic irreversible digests", async () => {
    const first = await tokenDigest("clear-token-fixture");
    const second = await tokenDigest("clear-token-fixture");
    expect(first).toBe(second);
    expect(isTokenDigest(first)).toBe(true);
    expect(first).not.toContain("clear-token-fixture");
  });

  it("converges OAuth and MCP bearer columns without retaining clear values", async () => {
    const { env, updates } = migrationEnv();
    await expect(migrateLegacyBearerTokenStorage(env)).resolves.toEqual({
      oauth: 1,
      mcp: 1,
      oauthClients: 1,
      userActions: 1,
    });
    expect(updates).toHaveLength(4);
    for (const update of updates) {
      expect(update.args.slice(0, -1).filter(Boolean).every(isTokenDigest)).toBe(true);
      expect(JSON.stringify(update.args)).not.toContain("clear-");
    }
  });
});
