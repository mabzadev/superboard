import { env, SELF } from "cloudflare:test";
import {
  PROJECT_CONTEXT_HEADERS,
  signProjectContext,
  type InternalProjectContext,
} from "@superboard/contracts/project-context";
import { decodeJwt } from "jose";
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
        expectedMigration: "0002_project_scope.sql",
        latestMigration: "0002_project_scope.sql",
        appliedMigrationCount: 2,
      },
      project_scope: { ready: true, unscoped_rows: 0 },
    });
  });

  it("rotates anonymous sessions and issues a distinct OpenGrow identity token", async () => {
    const created = await json<Session>(
      await SELF.fetch("https://identity.test/auth/anonymous", {
        method: "POST",
        headers: await projectHeaders("POST", "/auth/anonymous", {
          "content-type": "application/json",
          "cf-connecting-ip": "192.0.2.20",
        }),
        body: JSON.stringify({ installation_id: "reference-installation-1" }),
      }),
    );
    expect(created.access_token).toBeTruthy();
    expect(decodeJwt(created.access_token).pid).toBe(101);
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
        headers: await projectHeaders(
          "POST",
          "/auth/refresh",
          {
            "content-type": "application/json",
            "cf-connecting-ip": "192.0.2.20",
          },
          secondProject,
        ),
        body: JSON.stringify({ refresh_token: created.refresh_token }),
      }),
    );
    expect(refreshed.refresh_token).not.toBe(created.refresh_token);
    expect(decodeJwt(refreshed.access_token).pid).toBe(101);

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
        headers: await projectHeaders("POST", "/auth/request-password-reset", {
          "content-type": "application/json",
          "cf-connecting-ip": "192.0.2.21",
        }),
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
        headers: await projectHeaders("POST", "/auth/anonymous", {
          "content-type": "application/json",
          "cf-connecting-ip": "192.0.2.22",
        }),
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

    const eraseRequest = async () =>
      SELF.fetch(`https://identity.test/internal/v1/users/${created.user.id}`, {
        method: "DELETE",
        headers: await projectHeaders(
          "DELETE",
          `/internal/v1/users/${created.user.id}`,
        ),
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

  it("exposes sanitized authentication state only through the internal admin contract", async () => {
    const created = await json<Session>(
      await SELF.fetch("https://identity.test/auth/anonymous", {
        method: "POST",
        headers: await projectHeaders("POST", "/auth/anonymous", {
          "content-type": "application/json",
          "cf-connecting-ip": "192.0.2.23",
        }),
        body: JSON.stringify({ installation_id: "identity-admin-runtime" }),
      }),
    );
    const database = env as unknown as { DB: D1Database };
    await database.DB.batch([
      database.DB.prepare(
        `UPDATE application_users
         SET email=?, name=?, password_hash=?, is_anonymous=0,
             email_verified_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
         WHERE project_id=? AND id=?`,
      ).bind(
        "identity-admin@example.test",
        "Identity Admin Fixture",
        "password-hash-must-never-leave-identity",
        101,
        created.user.id,
      ),
      database.DB.prepare(
        `INSERT INTO application_identities
           (id,project_id,user_id,provider,subject_hash,provider_email)
         VALUES (?,?,?,"google",?,?)`,
      ).bind(
        crypto.randomUUID(),
        101,
        created.user.id,
        "provider-subject-hash-must-never-leave-identity",
        "identity-admin@example.test",
      ),
    ]);

    const unauthorized = await SELF.fetch(
      "https://identity.test/internal/v1/admin/users",
    );
    expect(unauthorized.status).toBe(401);

    const listedResponse = await SELF.fetch(
      "https://identity.test/internal/v1/admin/users?q=google&limit=10&offset=0",
      {
        headers: await projectHeaders("GET", "/internal/v1/admin/users"),
      },
    );
    expect(listedResponse.status, await listedResponse.clone().text()).toBe(
      200,
    );
    const listed = await listedResponse.json<{
      data: Array<Record<string, unknown>>;
      meta: { total: number; limit: number; offset: number; has_more: boolean };
    }>();
    expect(listed.data).toContainEqual(
      expect.objectContaining({
        id: created.user.id,
        email: "identity-admin@example.test",
        anonymous: false,
        email_verified: true,
        password_configured: true,
        providers: ["anonymous", "google"],
        auth_methods: ["password", "anonymous", "google"],
        active_session_count: 1,
      }),
    );
    expect(listed.meta).toMatchObject({ limit: 10, offset: 0 });

    const detailResponse = await SELF.fetch(
      `https://identity.test/internal/v1/admin/users/${created.user.id}`,
      {
        headers: await projectHeaders(
          "GET",
          `/internal/v1/admin/users/${created.user.id}`,
        ),
      },
    );
    expect(detailResponse.status, await detailResponse.clone().text()).toBe(
      200,
    );
    const detailText = await detailResponse.text();
    expect(detailText).not.toContain("password-hash-must-never-leave-identity");
    expect(detailText).not.toContain(
      "provider-subject-hash-must-never-leave-identity",
    );
    expect(detailText).not.toContain(created.refresh_token);
    expect(JSON.parse(detailText)).toMatchObject({
      data: {
        id: created.user.id,
        identities: [
          { provider: "anonymous" },
          {
            provider: "google",
            provider_email: "identity-admin@example.test",
          },
        ],
        sessions: { total: 1, active: 1, revoked: 0, expired: 0 },
      },
    });

    const invalidPagination = await SELF.fetch(
      "https://identity.test/internal/v1/admin/users?limit=101",
      {
        headers: await projectHeaders("GET", "/internal/v1/admin/users"),
      },
    );
    expect(invalidPagination.status).toBe(422);
  });

  it("isolates users, providers, sessions and details between projects", async () => {
    const projectOne = await anonymous(
      "shared-installation-identity-isolation",
      "192.0.2.31",
    );
    const projectTwo = await anonymous(
      "shared-installation-identity-isolation",
      "192.0.2.32",
      secondProject,
    );
    expect(projectOne.user.id).not.toBe(projectTwo.user.id);
    expect(decodeJwt(projectOne.access_token).pid).toBe(101);
    expect(decodeJwt(projectTwo.access_token).pid).toBe(202);

    const projectOneList = await json<{ data: Array<{ id: string }> }>(
      await SELF.fetch("https://identity.test/internal/v1/admin/users", {
        headers: await projectHeaders("GET", "/internal/v1/admin/users"),
      }),
    );
    expect(projectOneList.data.map(({ id }) => id)).toContain(
      projectOne.user.id,
    );
    expect(projectOneList.data.map(({ id }) => id)).not.toContain(
      projectTwo.user.id,
    );

    const crossProjectDetail = await SELF.fetch(
      `https://identity.test/internal/v1/admin/users/${projectTwo.user.id}`,
      {
        headers: await projectHeaders(
          "GET",
          `/internal/v1/admin/users/${projectTwo.user.id}`,
        ),
      },
    );
    expect(crossProjectDetail.status).toBe(404);

    const projectTwoDetail = await SELF.fetch(
      `https://identity.test/internal/v1/admin/users/${projectTwo.user.id}`,
      {
        headers: await projectHeaders(
          "GET",
          `/internal/v1/admin/users/${projectTwo.user.id}`,
          undefined,
          secondProject,
        ),
      },
    );
    expect(projectTwoDetail.status).toBe(200);
  });

  it("fails closed while a migrated legacy identity remains unscoped", async () => {
    const database = env as unknown as { DB: D1Database };
    await database.DB.prepare(
      "DROP TRIGGER application_users_project_required_insert",
    ).run();
    await database.DB.prepare(
      "INSERT INTO application_users (id,is_anonymous) VALUES (?,1)",
    )
      .bind("legacy-unscoped-runtime-user")
      .run();
    try {
      const admin = await SELF.fetch(
        "https://identity.test/internal/v1/admin/users",
        {
          headers: await projectHeaders("GET", "/internal/v1/admin/users"),
        },
      );
      expect(admin.status).toBe(503);
      await expect(admin.json()).resolves.toMatchObject({
        error: {
          code: "identity_project_backfill_required",
          retryable: true,
        },
      });

      const health = await SELF.fetch("https://identity.test/health");
      expect(health.status).toBe(503);
      await expect(health.json()).resolves.toMatchObject({
        status: "degraded",
        reason: "identity_project_backfill_required",
        project_scope: { ready: false, unscoped_rows: 1 },
      });
    } finally {
      await database.DB.prepare(
        "DELETE FROM application_users WHERE id=? AND project_id IS NULL",
      )
        .bind("legacy-unscoped-runtime-user")
        .run();
      await database.DB.prepare(
        `CREATE TRIGGER application_users_project_required_insert
         BEFORE INSERT ON application_users
         WHEN NEW.project_id IS NULL OR NEW.project_id <= 0
         BEGIN SELECT RAISE(ABORT, 'identity_project_required'); END`,
      ).run();
    }
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

const secondProject = {
  projectId: 202,
  instanceId: 20,
  projectRef: "20-test",
} as const;

type TestProject = {
  projectId: number;
  instanceId: number;
  projectRef: string;
};

async function anonymous(
  installationId: string,
  ip: string,
  project: TestProject = {
    projectId: 101,
    instanceId: 10,
    projectRef: "10-test",
  },
): Promise<Session> {
  return json<Session>(
    await SELF.fetch("https://identity.test/auth/anonymous", {
      method: "POST",
      headers: await projectHeaders(
        "POST",
        "/auth/anonymous",
        { "content-type": "application/json", "cf-connecting-ip": ip },
        project,
      ),
      body: JSON.stringify({ installation_id: installationId }),
    }),
  );
}

async function projectHeaders(
  method: string,
  pathname: string,
  initial?: HeadersInit,
  project: TestProject = {
    projectId: 101,
    instanceId: 10,
    projectRef: "10-test",
  },
): Promise<Headers> {
  const requestId = crypto.randomUUID();
  const context: InternalProjectContext = {
    module: "identity",
    method,
    pathname,
    ...project,
    environment: "test",
    actorId: 0,
    role: "sdk",
    requestId,
    issuedAt: Math.floor(Date.now() / 1_000),
  };
  const headers = new Headers(initial);
  headers.set(PROJECT_CONTEXT_HEADERS.token, "identity-runtime-internal-token");
  headers.set(PROJECT_CONTEXT_HEADERS.projectId, String(context.projectId));
  headers.set(PROJECT_CONTEXT_HEADERS.projectRef, context.projectRef);
  headers.set(PROJECT_CONTEXT_HEADERS.instanceId, String(context.instanceId));
  headers.set(PROJECT_CONTEXT_HEADERS.environment, context.environment);
  headers.set(PROJECT_CONTEXT_HEADERS.actorId, "0");
  headers.set(PROJECT_CONTEXT_HEADERS.role, context.role);
  headers.set(PROJECT_CONTEXT_HEADERS.requestId, requestId);
  headers.set(PROJECT_CONTEXT_HEADERS.issuedAt, String(context.issuedAt));
  headers.set(PROJECT_CONTEXT_HEADERS.version, "1");
  headers.set(
    PROJECT_CONTEXT_HEADERS.signature,
    await signProjectContext(context, "identity-runtime-internal-token"),
  );
  return headers;
}
