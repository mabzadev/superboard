import { compare, hash } from "bcryptjs";
import { Hono, type Context, type Next } from "hono";
import {
  EMAIL_SERVICE_SEND_PATH,
  type EmailServiceMessage,
} from "@superboard/contracts/email";
import { configuredSecrets } from "@superboard/contracts/secret";
import { inspectSqlSchemaHealth } from "@superboard/contracts/health";
import { verifyInternalProjectContextRequest } from "@superboard/contracts/project-context";
import {
  RequestBodyError,
  readJsonObjectLimited,
} from "@superboard/contracts/request-body";
import {
  issueAccessToken,
  issueOpenGrowToken,
  publicJwks,
  randomToken,
  sha256,
  ttl,
  verifyApplicationToken,
  verifyProviderToken,
} from "./crypto";
import type { IdentityEnv, IdentityUser } from "./types";

type Variables = { userId: string; sessionId: string; projectId: number };
type IdentityContext = Context<{ Bindings: IdentityEnv; Variables: Variables }>;

const app = new Hono<{ Bindings: IdentityEnv; Variables: Variables }>();

type IdentityAdminUserRow = {
  id: string;
  email: string | null;
  name: string | null;
  is_anonymous: number;
  email_verified_at: string | null;
  password_configured: number;
  providers: string | null;
  active_session_count: number;
  last_session_at: string | null;
  created_at: string;
  updated_at: string;
};

app.get("/health", async (c) => {
  try {
    const [users, sessions, schema, scope] = await Promise.all([
      c.env.DB.prepare(
        `
        SELECT COUNT(*) total,
          SUM(CASE WHEN is_anonymous=1 THEN 1 ELSE 0 END) anonymous,
          SUM(CASE WHEN email_verified_at IS NOT NULL THEN 1 ELSE 0 END) verified
        FROM application_users WHERE deleted_at IS NULL
      `,
      ).first<{ total: number; anonymous: number; verified: number }>(),
      c.env.DB.prepare(
        `
        SELECT COUNT(*) active FROM application_sessions
        WHERE revoked_at IS NULL AND datetime(expires_at)>datetime('now')
      `,
      ).first<{ active: number }>(),
      inspectSqlSchemaHealth(c.env.DB, c.env.D1_EXPECTED_MIGRATION),
      projectScopeState(c.env.DB),
    ]);
    publicJwks(c.env);
    const current = schema.status === "current" && scope.ready;
    return response(
      {
        service: "identity",
        status: current ? "ok" : "degraded",
        environment: c.env.ENVIRONMENT,
        schema,
        ...(current
          ? {}
          : {
              reason: scope.ready
                ? "database_schema_not_current"
                : "identity_project_backfill_required",
            }),
        project_scope: scope,
        users: {
          total: Number(users?.total || 0),
          anonymous: Number(users?.anonymous || 0),
          verified: Number(users?.verified || 0),
        },
        sessions: { active: Number(sessions?.active || 0) },
      },
      current ? 200 : 503,
    );
  } catch {
    return response(
      {
        service: "identity",
        status: "misconfigured",
        environment: c.env.ENVIRONMENT,
      },
      503,
    );
  }
});

app.get(
  "/.well-known/jwks.json",
  (c) =>
    new Response(JSON.stringify(publicJwks(c.env)), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=300, stale-while-revalidate=3600",
      },
    }),
);

app.get("/internal/v1/admin/users", async (c) => {
  const project = await internalProject(c);
  if (project instanceof Response) return project;
  const projectId = project.projectId;
  const query = optionalQuery(c.req.query("q"), 200);
  const limit = boundedInteger(c.req.query("limit"), 50, 1, 100, "limit");
  const offset = boundedInteger(
    c.req.query("offset"),
    0,
    0,
    1_000_000,
    "offset",
  );
  const filter = query
    ? `AND (
        lower(user.id) LIKE lower(?) ESCAPE '\\'
        OR lower(COALESCE(user.email,'')) LIKE lower(?) ESCAPE '\\'
        OR lower(COALESCE(user.name,'')) LIKE lower(?) ESCAPE '\\'
        OR EXISTS (
          SELECT 1 FROM application_identities matched_identity
          WHERE matched_identity.project_id=user.project_id
            AND matched_identity.user_id=user.id
            AND lower(matched_identity.provider) LIKE lower(?) ESCAPE '\\'
        )
      )`
    : "";
  const parameters = query ? Array(4).fill(likePattern(query)) : [];
  const [users, total] = await Promise.all([
    c.env.DB.prepare(
      `SELECT
         user.id,
         user.email,
         user.name,
         user.is_anonymous,
         user.email_verified_at,
         CASE WHEN user.password_hash IS NULL THEN 0 ELSE 1 END password_configured,
         (
           SELECT GROUP_CONCAT(provider, ',')
           FROM (
             SELECT DISTINCT identity.provider
             FROM application_identities identity
             WHERE identity.project_id=user.project_id
               AND identity.user_id=user.id
             ORDER BY identity.provider ASC
           )
         ) providers,
         (
           SELECT COUNT(*) FROM application_sessions session
           WHERE session.project_id=user.project_id
             AND session.user_id=user.id
             AND session.revoked_at IS NULL
             AND datetime(session.expires_at)>datetime('now')
         ) active_session_count,
         (
           SELECT MAX(session.created_at) FROM application_sessions session
           WHERE session.project_id=user.project_id
             AND session.user_id=user.id
         ) last_session_at,
         user.created_at,
         user.updated_at
       FROM application_users user
       WHERE user.project_id=? AND user.deleted_at IS NULL ${filter}
       ORDER BY datetime(user.created_at) DESC, user.id DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(projectId, ...parameters, limit, offset)
      .all<IdentityAdminUserRow>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) total
       FROM application_users user
       WHERE user.project_id=? AND user.deleted_at IS NULL ${filter}`,
    )
      .bind(projectId, ...parameters)
      .first<{ total: number }>(),
  ]);
  return response({
    data: users.results.map(adminUser),
    meta: {
      total: Number(total?.total || 0),
      limit,
      offset,
      has_more: offset + users.results.length < Number(total?.total || 0),
    },
  });
});

app.get("/internal/v1/admin/users/:userId", async (c) => {
  const project = await internalProject(c);
  if (project instanceof Response) return project;
  const projectId = project.projectId;
  const userId = internalUserId(c.req.param("userId"));
  if (!userId) {
    return error(
      "application_user_id_invalid",
      "Application user identifier is invalid",
      422,
    );
  }
  const [user, identities, sessions] = await Promise.all([
    c.env.DB.prepare(
      `SELECT
         user.id,
         user.email,
         user.name,
         user.is_anonymous,
         user.email_verified_at,
         CASE WHEN user.password_hash IS NULL THEN 0 ELSE 1 END password_configured,
         (
           SELECT GROUP_CONCAT(provider, ',')
           FROM (
             SELECT DISTINCT identity.provider
             FROM application_identities identity
             WHERE identity.project_id=user.project_id
               AND identity.user_id=user.id
             ORDER BY identity.provider ASC
           )
         ) providers,
         (
           SELECT COUNT(*) FROM application_sessions session
           WHERE session.project_id=user.project_id
             AND session.user_id=user.id
             AND session.revoked_at IS NULL
             AND datetime(session.expires_at)>datetime('now')
         ) active_session_count,
         (
           SELECT MAX(session.created_at) FROM application_sessions session
           WHERE session.project_id=user.project_id
             AND session.user_id=user.id
         ) last_session_at,
         user.created_at,
         user.updated_at
       FROM application_users user
       WHERE user.project_id=? AND user.id=? AND user.deleted_at IS NULL
       LIMIT 1`,
    )
      .bind(projectId, userId)
      .first<IdentityAdminUserRow>(),
    c.env.DB.prepare(
      `SELECT provider, provider_email, created_at linked_at
       FROM application_identities
       WHERE project_id=? AND user_id=?
       ORDER BY provider ASC`,
    )
      .bind(projectId, userId)
      .all<{
        provider: string;
        provider_email: string | null;
        linked_at: string;
      }>(),
    c.env.DB.prepare(
      `SELECT
         COUNT(*) total,
         SUM(CASE WHEN revoked_at IS NULL AND datetime(expires_at)>datetime('now') THEN 1 ELSE 0 END) active,
         SUM(CASE WHEN revoked_at IS NOT NULL THEN 1 ELSE 0 END) revoked,
         SUM(CASE WHEN revoked_at IS NULL AND datetime(expires_at)<=datetime('now') THEN 1 ELSE 0 END) expired,
         MAX(created_at) last_authenticated_at
       FROM application_sessions
       WHERE project_id=? AND user_id=?`,
    )
      .bind(projectId, userId)
      .first<{
        total: number;
        active: number;
        revoked: number;
        expired: number;
        last_authenticated_at: string | null;
      }>(),
  ]);
  if (!user) {
    return error(
      "application_user_not_found",
      "Application user was not found",
      404,
    );
  }
  return response({
    data: {
      ...adminUser(user),
      identities: identities.results.map((identity) => ({
        provider: identity.provider,
        provider_email: identity.provider_email,
        linked_at: identity.linked_at,
      })),
      sessions: {
        total: Number(sessions?.total || 0),
        active: Number(sessions?.active || 0),
        revoked: Number(sessions?.revoked || 0),
        expired: Number(sessions?.expired || 0),
        last_authenticated_at: sessions?.last_authenticated_at || null,
      },
    },
  });
});

app.delete("/internal/v1/users/:userId", async (c) => {
  const project = await internalProject(c);
  if (project instanceof Response) return project;
  const userId = internalUserId(c.req.param("userId"));
  if (!userId) {
    return error(
      "application_user_id_invalid",
      "Application user identifier is invalid",
      422,
    );
  }
  if (!(await eraseIdentityUser(c.env, project.projectId, userId))) {
    return error(
      "account_files_cleanup_failed",
      "Account files could not be deleted",
      503,
      true,
    );
  }
  return response({ deleted: true });
});

app.post("/auth/register", async (c) => {
  const project = await internalProject(c);
  if (project instanceof Response) return project;
  const projectId = project.projectId;
  if (c.env.REGISTRATION_MODE !== "open")
    return error("registration_closed", "Registration is closed", 403);
  const body = await bodyObject(c.req.raw);
  const email = normalizedEmail(body.email);
  const password = passwordValue(body.password);
  await enforceRateLimit(c.env.DB, c.req.raw, `p${projectId}:register`, email);
  const id = crypto.randomUUID();
  try {
    await c.env.DB.prepare(
      "INSERT INTO application_users (id,project_id,email,password_hash,name,is_anonymous) VALUES (?,?,?,?,?,0)",
    )
      .bind(
        id,
        projectId,
        email,
        await hash(password, 12),
        optionalText(body.name, 120),
      )
      .run();
  } catch (cause) {
    if (String(cause).toLowerCase().includes("unique"))
      return error(
        "email_already_registered",
        "Email is already registered",
        409,
      );
    throw cause;
  }
  const mailDelivered = await issueEmailToken(
    c.env,
    projectId,
    id,
    email,
    "verify_email",
  ).catch((cause) => {
    console.error(
      JSON.stringify({
        event: "identity_verification_email_failed",
        userId: id,
        error: String(cause),
      }),
    );
    return false;
  });
  return response(
    {
      ...(await createSession(c.env, projectId, id)),
      user: await publicUser(c.env.DB, projectId, id),
      verification_email_accepted: mailDelivered,
    },
    201,
  );
});

app.post("/auth/signin/password", async (c) => {
  const project = await internalProject(c);
  if (project instanceof Response) return project;
  const projectId = project.projectId;
  const body = await bodyObject(c.req.raw);
  const email = normalizedEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  await enforceRateLimit(c.env.DB, c.req.raw, `p${projectId}:password`, email);
  const user = await c.env.DB.prepare(
    "SELECT * FROM application_users WHERE project_id=? AND email=? AND deleted_at IS NULL LIMIT 1",
  )
    .bind(projectId, email)
    .first<IdentityUser>();
  if (!user?.password_hash || !(await compare(password, user.password_hash))) {
    return error("credentials_invalid", "Email or password is invalid", 401);
  }
  return response({
    ...(await createSession(c.env, projectId, user.id)),
    user: exposeUser(user),
  });
});

app.post("/auth/anonymous", async (c) => {
  const project = await internalProject(c);
  if (project instanceof Response) return project;
  const projectId = project.projectId;
  if (c.env.REGISTRATION_MODE !== "open")
    return error("registration_closed", "Registration is closed", 403);
  const body = await bodyObject(c.req.raw);
  const installationId = requiredText(
    body.installation_id ?? body.device_id,
    "installation_id",
    255,
  );
  await enforceRateLimit(
    c.env.DB,
    c.req.raw,
    `p${projectId}:anonymous`,
    installationId,
  );
  const subjectHash = await sha256(installationId);
  let user = await c.env.DB.prepare(
    `SELECT user.* FROM application_users user INNER JOIN application_identities identity ON identity.user_id=user.id
     WHERE identity.project_id=? AND user.project_id=?
       AND identity.provider='anonymous' AND identity.subject_hash=? AND user.deleted_at IS NULL LIMIT 1`,
  )
    .bind(projectId, projectId, subjectHash)
    .first<IdentityUser>();
  if (!user) {
    const id = crypto.randomUUID();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO application_users (id,project_id,is_anonymous) VALUES (?,?,1)",
      ).bind(id, projectId),
      c.env.DB.prepare(
        "INSERT INTO application_identities (id,project_id,user_id,provider,subject_hash) VALUES (?,?,?,'anonymous',?)",
      ).bind(crypto.randomUUID(), projectId, id, subjectHash),
    ]);
    user = await c.env.DB.prepare(
      "SELECT * FROM application_users WHERE project_id=? AND id=?",
    )
      .bind(projectId, id)
      .first<IdentityUser>();
  }
  return response({
    ...(await createSession(c.env, projectId, user!.id)),
    user: exposeUser(user!),
  });
});

app.post("/auth/signin/:provider", async (c) => {
  const project = await internalProject(c);
  if (project instanceof Response) return project;
  const projectId = project.projectId;
  const provider = c.req.param("provider");
  if (provider !== "google" && provider !== "apple")
    return error("provider_invalid", "Provider is not supported", 404);
  const body = await bodyObject(c.req.raw);
  const token = requiredText(body.token ?? body.id_token, "token", 16_384);
  await enforceRateLimit(
    c.env.DB,
    c.req.raw,
    `p${projectId}:${provider}`,
    await sha256(token).then((value) => value.slice(0, 24)),
  );
  let claims;
  try {
    claims = await verifyProviderToken(c.env, provider, token);
  } catch (cause) {
    return error(
      "provider_token_invalid",
      cause instanceof Error ? cause.message : "Provider token is invalid",
      401,
    );
  }
  const subjectHash = await sha256(String(claims.sub));
  let user = await c.env.DB.prepare(
    `SELECT user.* FROM application_users user INNER JOIN application_identities identity ON identity.user_id=user.id
     WHERE identity.project_id=? AND user.project_id=?
       AND identity.provider=? AND identity.subject_hash=? AND user.deleted_at IS NULL LIMIT 1`,
  )
    .bind(projectId, projectId, provider, subjectHash)
    .first<IdentityUser>();
  if (!user) {
    if (c.env.REGISTRATION_MODE !== "open")
      return error("registration_closed", "Registration is closed", 403);
    const email =
      typeof claims.email === "string" ? normalizedEmail(claims.email) : null;
    const emailVerified =
      claims.email_verified === true || claims.email_verified === "true";
    if (!email || !emailVerified)
      return error(
        "verified_email_required",
        "A verified provider email is required for first sign-in",
        422,
      );
    user = await c.env.DB.prepare(
      "SELECT * FROM application_users WHERE project_id=? AND email=? AND deleted_at IS NULL LIMIT 1",
    )
      .bind(projectId, email)
      .first<IdentityUser>();
    const userId = user?.id ?? crypto.randomUUID();
    const statements = [];
    if (!user) {
      statements.push(
        c.env.DB.prepare(
          "INSERT INTO application_users (id,project_id,email,name,is_anonymous,email_verified_at) VALUES (?,?,?,?,0,CURRENT_TIMESTAMP)",
        ).bind(userId, projectId, email, optionalText(body.name, 120)),
      );
    }
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO application_identities (id,project_id,user_id,provider,subject_hash,provider_email) VALUES (?,?,?,?,?,?)",
      ).bind(
        crypto.randomUUID(),
        projectId,
        userId,
        provider,
        subjectHash,
        email,
      ),
    );
    await c.env.DB.batch(statements);
    user = await c.env.DB.prepare(
      "SELECT * FROM application_users WHERE project_id=? AND id=?",
    )
      .bind(projectId, userId)
      .first<IdentityUser>();
  }
  return response({
    ...(await createSession(c.env, projectId, user!.id)),
    user: exposeUser(user!),
  });
});

app.post("/auth/refresh", async (c) => {
  const body = await bodyObject(c.req.raw);
  const refreshToken = requiredText(body.refresh_token, "refresh_token", 512);
  await enforceRateLimit(
    c.env.DB,
    c.req.raw,
    "refresh",
    refreshToken.slice(0, 24),
  );
  const tokenHash = await sha256(refreshToken);
  const nextToken = randomToken("ogr_");
  const refreshTtl = ttl(
    c.env.REFRESH_TOKEN_TTL,
    3600,
    31_536_000,
    "REFRESH_TOKEN_TTL",
  );
  const rotated = await c.env.DB.prepare(
    `UPDATE application_sessions SET refresh_token_hash=?,expires_at=?
     WHERE project_id IS NOT NULL AND refresh_token_hash=? AND revoked_at IS NULL AND datetime(expires_at)>datetime('now')
     RETURNING id,project_id,user_id`,
  )
    .bind(
      await sha256(nextToken),
      new Date(Date.now() + refreshTtl * 1000).toISOString(),
      tokenHash,
    )
    .first<{ id: string; project_id: number; user_id: string }>();
  if (!rotated)
    return error(
      "refresh_token_invalid",
      "Refresh token is invalid or expired",
      401,
    );
  return response(
    await sessionResponse(
      c.env,
      rotated.project_id,
      rotated.user_id,
      rotated.id,
      nextToken,
    ),
  );
});

app.post("/auth/request-password-reset", async (c) => {
  const project = await internalProject(c);
  if (project instanceof Response) return project;
  const projectId = project.projectId;
  const body = await bodyObject(c.req.raw);
  const email = normalizedEmail(body.email);
  await enforceRateLimit(c.env.DB, c.req.raw, `p${projectId}:reset`, email);
  const user = await c.env.DB.prepare(
    "SELECT id,email FROM application_users WHERE project_id=? AND email=? AND deleted_at IS NULL LIMIT 1",
  )
    .bind(projectId, email)
    .first<{ id: string; email: string }>();
  if (user)
    await issueEmailToken(
      c.env,
      projectId,
      user.id,
      user.email,
      "reset_password",
    ).catch((cause) => {
      console.error(
        JSON.stringify({
          event: "identity_reset_email_failed",
          userId: user.id,
          error: String(cause),
        }),
      );
    });
  return response({ accepted: true }, 202);
});

app.get("/auth/reset-password", async (c) => {
  const token = c.req.query("token") || "";
  if (!token || token.length > 512)
    return error(
      "reset_token_invalid",
      "Reset token is invalid or expired",
      422,
    );
  const row = await c.env.DB.prepare(
    `SELECT id FROM application_identity_tokens WHERE project_id IS NOT NULL AND token_hash=? AND purpose='reset_password' AND consumed_at IS NULL
     AND datetime(expires_at)>datetime('now') LIMIT 1`,
  )
    .bind(await sha256(token))
    .first();
  return row
    ? response({ valid: true })
    : error("reset_token_invalid", "Reset token is invalid or expired", 422);
});

app.post("/auth/reset-password", async (c) => {
  const body = await bodyObject(c.req.raw);
  const token = requiredText(body.token, "token", 512);
  const password = passwordValue(body.password);
  const row = await consumeIdentityToken(c.env.DB, token, "reset_password");
  if (!row)
    return error(
      "reset_token_invalid",
      "Reset token is invalid or expired",
      422,
    );
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE application_users SET password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE project_id=? AND id=?",
    ).bind(await hash(password, 12), row.project_id, row.user_id),
    c.env.DB.prepare(
      "UPDATE application_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE project_id=? AND user_id=? AND revoked_at IS NULL",
    ).bind(row.project_id, row.user_id),
  ]);
  return response({ changed: true });
});

app.get("/auth/verify-email", async (c) => {
  const token = c.req.query("token") || "";
  const row = await consumeIdentityToken(c.env.DB, token, "verify_email");
  if (!row)
    return error(
      "verification_token_invalid",
      "Verification token is invalid or expired",
      422,
    );
  await c.env.DB.prepare(
    "UPDATE application_users SET email_verified_at=COALESCE(email_verified_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE project_id=? AND id=?",
  )
    .bind(row.project_id, row.user_id)
    .run();
  return response({ verified: true });
});

async function authenticate(c: IdentityContext, next: Next) {
  const token = bearer(c.req.raw);
  if (!token) return error("unauthorized", "Authentication is required", 401);
  try {
    const claims = await verifyApplicationToken(c.env, token);
    const projectId = Number(claims.pid);
    const active = await c.env.DB.prepare(
      "SELECT id FROM application_sessions WHERE project_id=? AND id=? AND user_id=? AND revoked_at IS NULL AND datetime(expires_at)>datetime('now')",
    )
      .bind(projectId, String(claims.sid), String(claims.sub))
      .first();
    if (!active) return error("session_inactive", "Session is inactive", 401);
    c.set("userId", String(claims.sub));
    c.set("sessionId", String(claims.sid));
    c.set("projectId", projectId);
    await next();
  } catch {
    return error("unauthorized", "Authentication is invalid or expired", 401);
  }
}

app.use("/auth/me", authenticate);
app.use("/auth/me/*", authenticate);
app.use("/auth/link/*", authenticate);
app.use("/auth/logout", authenticate);
app.use("/auth/opengrow-token", authenticate);

app.post("/auth/link/:provider", async (c) => {
  const provider = c.req.param("provider");
  if (provider !== "google" && provider !== "apple")
    return error("provider_invalid", "Provider is not supported", 404);
  const body = await bodyObject(c.req.raw);
  const token = requiredText(body.token ?? body.id_token, "token", 16_384);
  await enforceRateLimit(
    c.env.DB,
    c.req.raw,
    `p${c.get("projectId")}:link_${provider}`,
    await sha256(token).then((value) => value.slice(0, 24)),
  );
  let claims;
  try {
    claims = await verifyProviderToken(c.env, provider, token);
  } catch (cause) {
    return error(
      "provider_token_invalid",
      cause instanceof Error ? cause.message : "Provider token is invalid",
      401,
    );
  }
  const userId = c.get("userId");
  const projectId = c.get("projectId");
  const subjectHash = await sha256(String(claims.sub));
  const existing = await c.env.DB.prepare(
    `SELECT identity.user_id, user.deleted_at
     FROM application_identities identity
     INNER JOIN application_users user ON user.id=identity.user_id
     WHERE identity.project_id=? AND user.project_id=?
       AND identity.provider=? AND identity.subject_hash=? LIMIT 1`,
  )
    .bind(projectId, projectId, provider, subjectHash)
    .first<{ user_id: string; deleted_at: string | null }>();
  if (existing?.user_id === userId && existing.deleted_at === null) {
    return response({
      linked: true,
      idempotent: true,
      provider,
      user: await publicUser(c.env.DB, projectId, userId),
    });
  }
  if (existing && existing.deleted_at === null) {
    return error(
      "provider_already_linked",
      "Provider identity is already linked to another user",
      409,
    );
  }

  const providerEmail =
    typeof claims.email === "string" ? normalizedEmail(claims.email) : null;
  const emailVerified =
    claims.email_verified === true || claims.email_verified === "true";
  const emailConflict =
    providerEmail && emailVerified
      ? await c.env.DB.prepare(
          "SELECT id FROM application_users WHERE project_id=? AND email=? AND id<>? AND deleted_at IS NULL LIMIT 1",
        )
          .bind(projectId, providerEmail, userId)
          .first()
      : null;
  const adoptableEmail =
    providerEmail && emailVerified && !emailConflict ? providerEmail : null;

  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO application_identities (id,project_id,user_id,provider,subject_hash,provider_email) VALUES (?,?,?,?,?,?)",
      ).bind(
        crypto.randomUUID(),
        projectId,
        userId,
        provider,
        subjectHash,
        providerEmail,
      ),
      c.env.DB.prepare(
        `UPDATE application_users
         SET is_anonymous=0,
             email=COALESCE(email, ?),
             email_verified_at=CASE
               WHEN email IS NULL AND ? IS NOT NULL THEN COALESCE(email_verified_at,CURRENT_TIMESTAMP)
               ELSE email_verified_at
             END,
             updated_at=CURRENT_TIMESTAMP
         WHERE project_id=? AND id=? AND deleted_at IS NULL`,
      ).bind(adoptableEmail, adoptableEmail, projectId, userId),
    ]);
  } catch (cause) {
    if (String(cause).toLowerCase().includes("unique")) {
      return error(
        "provider_already_linked",
        "Provider identity is already linked to another user",
        409,
      );
    }
    throw cause;
  }
  return response({
    linked: true,
    idempotent: false,
    provider,
    user: await publicUser(c.env.DB, projectId, userId),
  });
});

app.get("/auth/me", async (c) => {
  const user = await c.env.DB.prepare(
    "SELECT * FROM application_users WHERE project_id=? AND id=? AND deleted_at IS NULL",
  )
    .bind(c.get("projectId"), c.get("userId"))
    .first<IdentityUser>();
  return user
    ? response({ user: exposeUser(user) })
    : error("user_not_found", "User was not found", 404);
});

app.patch("/auth/me", async (c) => {
  const body = await bodyObject(c.req.raw);
  await c.env.DB.prepare(
    "UPDATE application_users SET name=?,updated_at=CURRENT_TIMESTAMP WHERE project_id=? AND id=? AND deleted_at IS NULL",
  )
    .bind(optionalText(body.name, 120), c.get("projectId"), c.get("userId"))
    .run();
  return response({
    user: await publicUser(c.env.DB, c.get("projectId"), c.get("userId")),
  });
});

app.delete("/auth/me", () => {
  return error(
    "account_erasure_route_required",
    "Use the authenticated application account-erasure endpoint",
    410,
  );
});

async function eraseIdentityUser(
  env: IdentityEnv,
  projectId: number,
  userId: string,
): Promise<boolean> {
  const exists = await env.DB.prepare(
    "SELECT id FROM application_users WHERE project_id=? AND id=? LIMIT 1",
  )
    .bind(projectId, userId)
    .first();
  if (!exists) return true;
  const files = await env.FILES_SERVICE.fetch(
    `https://files.internal/internal/v1/users/${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
      headers: { "x-internal-token": env.FILES_INTERNAL_TOKEN },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!files.ok) return false;
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE application_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE project_id=? AND user_id=? AND revoked_at IS NULL",
    ).bind(projectId, userId),
    env.DB.prepare(
      "UPDATE application_users SET email=NULL,password_hash=NULL,name=NULL,deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE project_id=? AND id=?",
    ).bind(projectId, userId),
    env.DB.prepare(
      "DELETE FROM application_identities WHERE project_id=? AND user_id=?",
    ).bind(projectId, userId),
    env.DB.prepare(
      "DELETE FROM application_identity_tokens WHERE project_id=? AND user_id=?",
    ).bind(projectId, userId),
  ]);
  return true;
}

function internalUserId(value: string): string | null {
  const resolved = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/u.test(resolved)
    ? resolved
    : null;
}

async function internalProject(c: IdentityContext) {
  const verified = await verifyInternalProjectContextRequest(
    c.req.raw,
    configuredSecrets(
      c.env.INTERNAL_API_TOKEN,
      c.env.INTERNAL_API_TOKEN_PREVIOUS,
    ),
    "identity",
  );
  if (!verified.ok) {
    return error(
      verified.code,
      verified.message,
      verified.code === "internal_auth_invalid" ? 401 : 403,
    );
  }
  const readiness = await projectScopeReadiness(c.env.DB);
  if (readiness) return readiness;
  return verified.context;
}

async function projectScopeReadiness(db: D1Database): Promise<Response | null> {
  const state = await projectScopeState(db);
  if (state.ready) return null;
  return error(
    "identity_project_backfill_required",
    "Identity project scoping is incomplete; backfill legacy rows before querying users",
    503,
    true,
  );
}

async function projectScopeState(
  db: D1Database,
): Promise<{ ready: boolean; unscoped_rows: number | null }> {
  try {
    const row = await db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM application_users WHERE project_id IS NULL) +
          (SELECT COUNT(*) FROM application_identities WHERE project_id IS NULL) +
          (SELECT COUNT(*) FROM application_sessions WHERE project_id IS NULL) +
          (SELECT COUNT(*) FROM application_identity_tokens WHERE project_id IS NULL)
          AS unscoped`,
      )
      .first<{ unscoped: number }>();
    const unscoped = Number(row?.unscoped || 0);
    return { ready: unscoped === 0, unscoped_rows: unscoped };
  } catch {
    // A pre-0002 schema is also unsafe: do not silently fall back to global data.
    return { ready: false, unscoped_rows: null };
  }
}

function optionalQuery(value: string | undefined, maximum: number): string {
  const query = value?.trim() || "";
  if (query.length > maximum) {
    throw new IdentityInputError(
      "query_too_long",
      `Query exceeds ${maximum} characters`,
      422,
    );
  }
  return query;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/u.test(value)) {
    throw new IdentityInputError(`${name}_invalid`, `${name} is invalid`, 422);
  }
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new IdentityInputError(`${name}_invalid`, `${name} is invalid`, 422);
  }
  return result;
}

function likePattern(value: string): string {
  return `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function adminUser(user: IdentityAdminUserRow) {
  const providers = (user.providers || "")
    .split(",")
    .map((provider) => provider.trim())
    .filter(Boolean);
  const methods = [
    ...(user.password_configured ? ["password"] : []),
    ...providers,
  ];
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    anonymous: user.is_anonymous === 1,
    email_verified: Boolean(user.email_verified_at),
    password_configured: user.password_configured === 1,
    providers,
    auth_methods: [...new Set(methods)],
    active_session_count: Number(user.active_session_count || 0),
    last_session_at: user.last_session_at,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

app.post("/auth/logout", async (c) => {
  await c.env.DB.prepare(
    "UPDATE application_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE project_id=? AND id=?",
  )
    .bind(c.get("projectId"), c.get("sessionId"))
    .run();
  return response({ logged_out: true });
});

app.post("/auth/opengrow-token", async (c) =>
  response(
    await issueOpenGrowToken(c.env, c.get("projectId"), c.get("userId")),
  ),
);

async function createSession(
  env: IdentityEnv,
  projectId: number,
  userId: string,
) {
  const session = await newSession(env, projectId, userId, null);
  await session.statement.run();
  return sessionResponse(
    env,
    projectId,
    userId,
    session.id,
    session.refreshToken,
  );
}

async function newSession(
  env: IdentityEnv,
  projectId: number,
  userId: string,
  rotatedFromId: string | null,
) {
  const id = crypto.randomUUID();
  const refreshToken = randomToken("ogr_");
  const refreshTtl = ttl(
    env.REFRESH_TOKEN_TTL,
    3600,
    31_536_000,
    "REFRESH_TOKEN_TTL",
  );
  const expiresAt = new Date(Date.now() + refreshTtl * 1000).toISOString();
  return {
    id,
    refreshToken,
    statement: env.DB.prepare(
      "INSERT INTO application_sessions (id,project_id,user_id,refresh_token_hash,expires_at,rotated_from_id) VALUES (?,?,?,?,?,?)",
    ).bind(
      id,
      projectId,
      userId,
      await sha256(refreshToken),
      expiresAt,
      rotatedFromId,
    ),
  };
}

async function sessionResponse(
  env: IdentityEnv,
  projectId: number,
  userId: string,
  sessionId: string,
  refreshToken: string,
) {
  return {
    access_token: await issueAccessToken(env, projectId, userId, sessionId),
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: ttl(env.ACCESS_TOKEN_TTL, 300, 3600, "ACCESS_TOKEN_TTL"),
    user_id: userId,
  };
}

async function issueEmailToken(
  env: IdentityEnv,
  projectId: number,
  userId: string,
  email: string,
  purpose: "verify_email" | "reset_password",
): Promise<boolean> {
  const token = randomToken(purpose === "verify_email" ? "ogv_" : "ogp_");
  const expiresAt = new Date(
    Date.now() + (purpose === "verify_email" ? 86_400_000 : 3_600_000),
  ).toISOString();
  const tokenHash = await sha256(token);
  await env.DB.prepare(
    "INSERT INTO application_identity_tokens (id,project_id,user_id,purpose,token_hash,expires_at) VALUES (?,?,?,?,?,?)",
  )
    .bind(crypto.randomUUID(), projectId, userId, purpose, tokenHash, expiresAt)
    .run();
  const base = env.PUBLIC_API_URL.replace(/\/+$/, "");
  const path = purpose === "verify_email" ? "verify-email" : "reset-password";
  const link = `${base}/auth/${path}?token=${encodeURIComponent(token)}`;
  const message: EmailServiceMessage = {
    kind: "transactional",
    to: email,
    idempotencyKey: `identity.${purpose}:${tokenHash}`,
    subject:
      purpose === "verify_email" ? "Verify your email" : "Reset your password",
    text:
      purpose === "verify_email"
        ? `Verify your email: ${link}`
        : `Reset your password: ${link}`,
    templateKey: `identity.${purpose}`,
    metadata: { purpose },
  };
  const result = await env.EMAIL_SERVICE.fetch(
    `https://email.internal${EMAIL_SERVICE_SEND_PATH}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-token": env.EMAIL_INTERNAL_TOKEN,
      },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(10_000),
    },
  );
  return result.ok;
}

async function consumeIdentityToken(
  db: D1Database,
  token: string,
  purpose: "verify_email" | "reset_password",
): Promise<{ id: string; project_id: number; user_id: string } | null> {
  if (!token || token.length > 512) return null;
  const row = await db
    .prepare(
      `SELECT id,project_id,user_id FROM application_identity_tokens WHERE project_id IS NOT NULL AND token_hash=? AND purpose=? AND consumed_at IS NULL
     AND datetime(expires_at)>datetime('now') LIMIT 1`,
    )
    .bind(await sha256(token), purpose)
    .first<{ id: string; project_id: number; user_id: string }>();
  if (!row) return null;
  const consumed = await db
    .prepare(
      "UPDATE application_identity_tokens SET consumed_at=CURRENT_TIMESTAMP WHERE id=? AND consumed_at IS NULL",
    )
    .bind(row.id)
    .run();
  return consumed.meta.changes === 1 ? row : null;
}

async function enforceRateLimit(
  db: D1Database,
  request: Request,
  operation: string,
  subject: string,
) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const key = await sha256(`${operation}:${ip}:${subject.toLowerCase()}`);
  const row = await db
    .prepare(
      `INSERT INTO application_auth_rate_limits (key_hash,window_started_at,attempt_count) VALUES (?,CURRENT_TIMESTAMP,1)
     ON CONFLICT(key_hash) DO UPDATE SET
       window_started_at=CASE WHEN datetime(window_started_at)<datetime('now','-10 minutes') THEN CURRENT_TIMESTAMP ELSE window_started_at END,
       attempt_count=CASE WHEN datetime(window_started_at)<datetime('now','-10 minutes') THEN 1 ELSE attempt_count+1 END
     RETURNING attempt_count`,
    )
    .bind(key)
    .first<{ attempt_count: number }>();
  if (Number(row?.attempt_count || 0) > 10)
    throw new IdentityInputError("rate_limited", "Too many attempts", 429);
}

async function bodyObject(request: Request): Promise<Record<string, unknown>> {
  try {
    return await readJsonObjectLimited(request, 64 * 1024);
  } catch (cause) {
    if (cause instanceof RequestBodyError) {
      throw new IdentityInputError(
        cause.code === "body_too_large" ? "payload_too_large" : "json_invalid",
        cause.message,
        cause.status,
      );
    }
    throw cause;
  }
}

function normalizedEmail(value: unknown): string {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    throw new IdentityInputError(
      "email_invalid",
      "A valid email is required",
      422,
    );
  }
  return email;
}

function passwordValue(value: unknown): string {
  if (typeof value !== "string" || value.length < 12 || value.length > 1024) {
    throw new IdentityInputError(
      "password_invalid",
      "Password must contain 12 to 1024 characters",
      422,
    );
  }
  return value;
}

function requiredText(value: unknown, name: string, maximum: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > maximum)
    throw new IdentityInputError(`${name}_invalid`, `${name} is invalid`, 422);
  return text;
}
function optionalText(value: unknown, maximum: number): string | null {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (text.length > maximum)
    throw new IdentityInputError(
      "value_too_long",
      `Value exceeds ${maximum} characters`,
      422,
    );
  return text || null;
}
function bearer(request: Request) {
  return (
    request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] || ""
  );
}
function requestId(request: Request) {
  return (
    request.headers.get("x-request-id")?.slice(0, 128) || crypto.randomUUID()
  );
}
function exposeUser(user: IdentityUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    anonymous: user.is_anonymous === 1,
    email_verified: Boolean(user.email_verified_at),
    created_at: user.created_at,
  };
}
async function publicUser(db: D1Database, projectId: number, id: string) {
  const user = await db
    .prepare(
      "SELECT * FROM application_users WHERE project_id=? AND id=? AND deleted_at IS NULL",
    )
    .bind(projectId, id)
    .first<IdentityUser>();
  return user ? exposeUser(user) : null;
}

class IdentityInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

app.onError((cause, c) => {
  if (cause instanceof IdentityInputError)
    return error(cause.code, cause.message, cause.status);
  console.error(
    JSON.stringify({
      event: "identity_worker_error",
      requestId: requestId(c.req.raw),
      error: cause instanceof Error ? cause.message : String(cause),
    }),
  );
  return error("identity_internal_error", "Identity service failed", 500, true);
});

function error(
  code: string,
  message: string,
  status: number,
  retryable = false,
): Response {
  return response({ error: { code, message, retryable } }, status);
}
function response(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export default app;
