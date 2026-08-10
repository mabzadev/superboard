import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("Identity Worker with D1", () => {
  it("reports the applied D1 schema revision", async () => {
    const response = await SELF.fetch("https://identity.test/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      service: "identity",
      status: "ok",
      schema: {
        status: "current",
        expectedMigration: "0001_identity.sql",
        latestMigration: "0001_identity.sql",
        appliedMigrationCount: 1,
      },
    });
  });

  it("rotates anonymous sessions and issues a distinct OpenGrow identity token", async () => {
    const created = await json<Session>(
      await SELF.fetch("https://identity.test/auth/anonymous", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "192.0.2.20",
        },
        body: JSON.stringify({ installation_id: "reference-installation-1" }),
      }),
    );
    expect(created.access_token).toBeTruthy();
    expect(created.refresh_token).toMatch(/^ogr_/);
    expect(created.user.anonymous).toBe(true);

    const missingLinkAuth = await SELF.fetch(
      "https://identity.test/auth/link/google",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "not-accepted-without-authentication" }),
      },
    );
    expect(missingLinkAuth.status).toBe(401);
    const unsupportedLink = await SELF.fetch(
      "https://identity.test/auth/link/microsoft",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${created.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ token: "unsupported-provider-token" }),
      },
    );
    expect(unsupportedLink.status).toBe(404);

    const exchanged = await json<{ access_token: string; expires_in: number }>(
      await SELF.fetch("https://identity.test/auth/opengrow-token", {
        method: "POST",
        headers: { authorization: `Bearer ${created.access_token}` },
      }),
    );
    expect(exchanged.expires_in).toBe(300);
    expect(exchanged.access_token).not.toBe(created.access_token);

    const refreshed = await json<Session>(
      await SELF.fetch("https://identity.test/auth/refresh", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "192.0.2.20",
        },
        body: JSON.stringify({ refresh_token: created.refresh_token }),
      }),
    );
    expect(refreshed.refresh_token).not.toBe(created.refresh_token);

    const replay = await SELF.fetch("https://identity.test/auth/refresh", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "192.0.2.20",
      },
      body: JSON.stringify({ refresh_token: created.refresh_token }),
    });
    expect(replay.status).toBe(401);

    const logout = await SELF.fetch("https://identity.test/auth/logout", {
      method: "POST",
      headers: { authorization: `Bearer ${refreshed.access_token}` },
    });
    expect(logout.status).toBe(200);
    const afterLogout = await SELF.fetch(
      "https://identity.test/auth/opengrow-token",
      {
        method: "POST",
        headers: { authorization: `Bearer ${refreshed.access_token}` },
      },
    );
    expect(afterLogout.status).toBe(401);
  });

  it("does not reveal whether a password-reset email exists", async () => {
    const response = await SELF.fetch(
      "https://identity.test/auth/request-password-reset",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "192.0.2.21",
        },
        body: JSON.stringify({ email: "missing@example.test" }),
      },
    );
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ accepted: true });
  });

  it("erases identity only through the authenticated internal contract", async () => {
    const created = await json<Session>(
      await SELF.fetch("https://identity.test/auth/anonymous", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "192.0.2.22",
        },
        body: JSON.stringify({ installation_id: "identity-erasure-runtime" }),
      }),
    );
    const unauthorized = await SELF.fetch(
      `https://identity.test/internal/v1/users/${created.user.id}`,
      { method: "DELETE" },
    );
    expect(unauthorized.status).toBe(401);
    const incompletePublicDeletion = await SELF.fetch(
      "https://identity.test/auth/me",
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${created.access_token}` },
      },
    );
    expect(incompletePublicDeletion.status).toBe(410);
    await expect(incompletePublicDeletion.json()).resolves.toMatchObject({
      error: { code: "account_erasure_route_required", retryable: false },
    });

    const eraseRequest = () =>
      SELF.fetch(`https://identity.test/internal/v1/users/${created.user.id}`, {
        method: "DELETE",
        headers: {
          "x-internal-token": "identity-runtime-internal-token",
        },
      });
    const erased = await eraseRequest();
    expect(erased.status, await erased.clone().text()).toBe(200);
    await expect(erased.json()).resolves.toEqual({ deleted: true });
    const repeated = await eraseRequest();
    await expect(repeated.json()).resolves.toEqual({ deleted: true });

    const afterErasure = await SELF.fetch(
      "https://identity.test/auth/opengrow-token",
      {
        method: "POST",
        headers: { authorization: `Bearer ${created.access_token}` },
      },
    );
    expect(afterErasure.status).toBe(401);
    const database = env as unknown as { DB: D1Database };
    const [user, sessions, identities, tokens] = await database.DB.batch([
      database.DB.prepare(
        "SELECT email, name, password_hash, deleted_at FROM application_users WHERE id = ?",
      ).bind(created.user.id),
      database.DB.prepare(
        "SELECT COUNT(*) total FROM application_sessions WHERE user_id = ? AND revoked_at IS NULL",
      ).bind(created.user.id),
      database.DB.prepare(
        "SELECT COUNT(*) total FROM application_identities WHERE user_id = ?",
      ).bind(created.user.id),
      database.DB.prepare(
        "SELECT COUNT(*) total FROM application_identity_tokens WHERE user_id = ?",
      ).bind(created.user.id),
    ]);
    expect(user.results[0]).toMatchObject({
      email: null,
      name: null,
      password_hash: null,
      deleted_at: expect.any(String),
    });
    expect(sessions.results[0]).toMatchObject({ total: 0 });
    expect(identities.results[0]).toMatchObject({ total: 0 });
    expect(tokens.results[0]).toMatchObject({ total: 0 });
  });
});

type Session = {
  access_token: string;
  refresh_token: string;
  user: { id: string; anonymous: boolean };
};

async function json<T>(response: Response): Promise<T> {
  expect(response.status, await response.clone().text()).toBeLessThan(300);
  return response.json<T>();
}
