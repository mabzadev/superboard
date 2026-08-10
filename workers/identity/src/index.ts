import { compare, hash } from "bcryptjs";
import { Hono, type Context, type Next } from "hono";
import {
  EMAIL_SERVICE_SEND_PATH,
  type EmailServiceMessage,
} from "@opengrow/contracts/email";
import {
  configuredSecrets,
  matchesAnySecret,
} from "@opengrow/contracts/secret";
import { inspectSqlSchemaHealth } from "@opengrow/contracts/health";
import {
  RequestBodyError,
  readJsonObjectLimited,
} from "@opengrow/contracts/request-body";
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

type Variables = { userId: string; sessionId: string };
type IdentityContext = Context<{ Bindings: IdentityEnv; Variables: Variables }>;

const app = new Hono<{ Bindings: IdentityEnv; Variables: Variables }>();

app.get("/health", async (c) => {
  try {
    const [users, sessions, schema] = await Promise.all([
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
    ]);
    publicJwks(c.env);
    const current = schema.status === "current";
    return response(
      {
        service: "identity",
        status: current ? "ok" : "degraded",
        environment: c.env.ENVIRONMENT,
        schema,
        ...(current ? {} : { reason: "database_schema_not_current" }),
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

app.delete("/internal/v1/users/:userId", async (c) => {
  const authorized = await matchesAnySecret(
    c.req.header("x-internal-token") || "",
    configuredSecrets(
      c.env.INTERNAL_API_TOKEN,
      c.env.INTERNAL_API_TOKEN_PREVIOUS,
    ),
  );
  if (!authorized) {
    return error(
      "internal_auth_invalid",
      "Internal authentication failed",
      401,
    );
  }
  const userId = internalUserId(c.req.param("userId"));
  if (!userId) {
    return error(
      "application_user_id_invalid",
      "Application user identifier is invalid",
      422,
    );
  }
  if (!(await eraseIdentityUser(c.env, userId))) {
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
  if (c.env.REGISTRATION_MODE !== "open")
    return error("registration_closed", "Registration is closed", 403);
  const body = await bodyObject(c.req.raw);
  const email = normalizedEmail(body.email);
  const password = passwordValue(body.password);
  await enforceRateLimit(c.env.DB, c.req.raw, "register", email);
  const id = crypto.randomUUID();
  try {
    await c.env.DB.prepare(
      "INSERT INTO application_users (id,email,password_hash,name,is_anonymous) VALUES (?,?,?,?,0)",
    )
      .bind(id, email, await hash(password, 12), optionalText(body.name, 120))
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
      ...(await createSession(c.env, id)),
      user: await publicUser(c.env.DB, id),
      verification_email_accepted: mailDelivered,
    },
    201,
  );
});

app.post("/auth/signin/password", async (c) => {
  const body = await bodyObject(c.req.raw);
  const email = normalizedEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  await enforceRateLimit(c.env.DB, c.req.raw, "password", email);
  const user = await c.env.DB.prepare(
    "SELECT * FROM application_users WHERE email=? AND deleted_at IS NULL LIMIT 1",
  )
    .bind(email)
    .first<IdentityUser>();
  if (!user?.password_hash || !(await compare(password, user.password_hash))) {
    return error("credentials_invalid", "Email or password is invalid", 401);
  }
  return response({
    ...(await createSession(c.env, user.id)),
    user: exposeUser(user),
  });
});

app.post("/auth/anonymous", async (c) => {
  if (c.env.REGISTRATION_MODE !== "open")
    return error("registration_closed", "Registration is closed", 403);
  const body = await bodyObject(c.req.raw);
  const installationId = requiredText(
    body.installation_id ?? body.device_id,
    "installation_id",
    255,
  );
  await enforceRateLimit(c.env.DB, c.req.raw, "anonymous", installationId);
  const subjectHash = await sha256(installationId);
  let user = await c.env.DB.prepare(
    `SELECT user.* FROM application_users user INNER JOIN application_identities identity ON identity.user_id=user.id
     WHERE identity.provider='anonymous' AND identity.subject_hash=? AND user.deleted_at IS NULL LIMIT 1`,
  )
    .bind(subjectHash)
    .first<IdentityUser>();
  if (!user) {
    const id = crypto.randomUUID();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO application_users (id,is_anonymous) VALUES (?,1)",
      ).bind(id),
      c.env.DB.prepare(
        "INSERT INTO application_identities (id,user_id,provider,subject_hash) VALUES (?,?,'anonymous',?)",
      ).bind(crypto.randomUUID(), id, subjectHash),
    ]);
    user = await c.env.DB.prepare("SELECT * FROM application_users WHERE id=?")
      .bind(id)
      .first<IdentityUser>();
  }
  return response({
    ...(await createSession(c.env, user!.id)),
    user: exposeUser(user!),
  });
});

app.post("/auth/signin/:provider", async (c) => {
  const provider = c.req.param("provider");
  if (provider !== "google" && provider !== "apple")
    return error("provider_invalid", "Provider is not supported", 404);
  const body = await bodyObject(c.req.raw);
  const token = requiredText(body.token ?? body.id_token, "token", 16_384);
  await enforceRateLimit(
    c.env.DB,
    c.req.raw,
    provider,
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
     WHERE identity.provider=? AND identity.subject_hash=? AND user.deleted_at IS NULL LIMIT 1`,
  )
    .bind(provider, subjectHash)
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
      "SELECT * FROM application_users WHERE email=? AND deleted_at IS NULL LIMIT 1",
    )
      .bind(email)
      .first<IdentityUser>();
    const userId = user?.id ?? crypto.randomUUID();
    const statements = [];
    if (!user) {
      statements.push(
        c.env.DB.prepare(
          "INSERT INTO application_users (id,email,name,is_anonymous,email_verified_at) VALUES (?,?,?,0,CURRENT_TIMESTAMP)",
        ).bind(userId, email, optionalText(body.name, 120)),
      );
    }
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO application_identities (id,user_id,provider,subject_hash,provider_email) VALUES (?,?,?,?,?)",
      ).bind(crypto.randomUUID(), userId, provider, subjectHash, email),
    );
    await c.env.DB.batch(statements);
    user = await c.env.DB.prepare("SELECT * FROM application_users WHERE id=?")
      .bind(userId)
      .first<IdentityUser>();
  }
  return response({
    ...(await createSession(c.env, user!.id)),
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
     WHERE refresh_token_hash=? AND revoked_at IS NULL AND datetime(expires_at)>datetime('now')
     RETURNING id,user_id`,
  )
    .bind(
      await sha256(nextToken),
      new Date(Date.now() + refreshTtl * 1000).toISOString(),
      tokenHash,
    )
    .first<{ id: string; user_id: string }>();
  if (!rotated)
    return error(
      "refresh_token_invalid",
      "Refresh token is invalid or expired",
      401,
    );
  return response(
    await sessionResponse(c.env, rotated.user_id, rotated.id, nextToken),
  );
});

app.post("/auth/request-password-reset", async (c) => {
  const body = await bodyObject(c.req.raw);
  const email = normalizedEmail(body.email);
  await enforceRateLimit(c.env.DB, c.req.raw, "reset", email);
  const user = await c.env.DB.prepare(
    "SELECT id,email FROM application_users WHERE email=? AND deleted_at IS NULL LIMIT 1",
  )
    .bind(email)
    .first<{ id: string; email: string }>();
  if (user)
    await issueEmailToken(c.env, user.id, user.email, "reset_password").catch(
      (cause) => {
        console.error(
          JSON.stringify({
            event: "identity_reset_email_failed",
            userId: user.id,
            error: String(cause),
          }),
        );
      },
    );
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
    `SELECT id FROM application_identity_tokens WHERE token_hash=? AND purpose='reset_password' AND consumed_at IS NULL
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
      "UPDATE application_users SET password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    ).bind(await hash(password, 12), row.user_id),
    c.env.DB.prepare(
      "UPDATE application_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=? AND revoked_at IS NULL",
    ).bind(row.user_id),
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
    "UPDATE application_users SET email_verified_at=COALESCE(email_verified_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=?",
  )
    .bind(row.user_id)
    .run();
  return response({ verified: true });
});

async function authenticate(c: IdentityContext, next: Next) {
  const token = bearer(c.req.raw);
  if (!token) return error("unauthorized", "Authentication is required", 401);
  try {
    const claims = await verifyApplicationToken(c.env, token);
    const active = await c.env.DB.prepare(
      "SELECT id FROM application_sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND datetime(expires_at)>datetime('now')",
    )
      .bind(String(claims.sid), String(claims.sub))
      .first();
    if (!active) return error("session_inactive", "Session is inactive", 401);
    c.set("userId", String(claims.sub));
    c.set("sessionId", String(claims.sid));
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
    `link_${provider}`,
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
  const subjectHash = await sha256(String(claims.sub));
  const existing = await c.env.DB.prepare(
    `SELECT identity.user_id, user.deleted_at
     FROM application_identities identity
     INNER JOIN application_users user ON user.id=identity.user_id
     WHERE identity.provider=? AND identity.subject_hash=? LIMIT 1`,
  )
    .bind(provider, subjectHash)
    .first<{ user_id: string; deleted_at: string | null }>();
  if (existing?.user_id === userId && existing.deleted_at === null) {
    return response({
      linked: true,
      idempotent: true,
      provider,
      user: await publicUser(c.env.DB, userId),
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
          "SELECT id FROM application_users WHERE email=? AND id<>? AND deleted_at IS NULL LIMIT 1",
        )
          .bind(providerEmail, userId)
          .first()
      : null;
  const adoptableEmail =
    providerEmail && emailVerified && !emailConflict ? providerEmail : null;

  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO application_identities (id,user_id,provider,subject_hash,provider_email) VALUES (?,?,?,?,?)",
      ).bind(crypto.randomUUID(), userId, provider, subjectHash, providerEmail),
      c.env.DB.prepare(
        `UPDATE application_users
         SET is_anonymous=0,
             email=COALESCE(email, ?),
             email_verified_at=CASE
               WHEN email IS NULL AND ? IS NOT NULL THEN COALESCE(email_verified_at,CURRENT_TIMESTAMP)
               ELSE email_verified_at
             END,
             updated_at=CURRENT_TIMESTAMP
         WHERE id=? AND deleted_at IS NULL`,
      ).bind(adoptableEmail, adoptableEmail, userId),
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
    user: await publicUser(c.env.DB, userId),
  });
});

app.get("/auth/me", async (c) => {
  const user = await c.env.DB.prepare(
    "SELECT * FROM application_users WHERE id=? AND deleted_at IS NULL",
  )
    .bind(c.get("userId"))
    .first<IdentityUser>();
  return user
    ? response({ user: exposeUser(user) })
    : error("user_not_found", "User was not found", 404);
});

app.patch("/auth/me", async (c) => {
  const body = await bodyObject(c.req.raw);
  await c.env.DB.prepare(
    "UPDATE application_users SET name=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND deleted_at IS NULL",
  )
    .bind(optionalText(body.name, 120), c.get("userId"))
    .run();
  return response({ user: await publicUser(c.env.DB, c.get("userId")) });
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
  userId: string,
): Promise<boolean> {
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
      "UPDATE application_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=? AND revoked_at IS NULL",
    ).bind(userId),
    env.DB.prepare(
      "UPDATE application_users SET email=NULL,password_hash=NULL,name=NULL,deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    ).bind(userId),
    env.DB.prepare("DELETE FROM application_identities WHERE user_id=?").bind(
      userId,
    ),
    env.DB.prepare(
      "DELETE FROM application_identity_tokens WHERE user_id=?",
    ).bind(userId),
  ]);
  return true;
}

function internalUserId(value: string): string | null {
  const resolved = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/u.test(resolved)
    ? resolved
    : null;
}

app.post("/auth/logout", async (c) => {
  await c.env.DB.prepare(
    "UPDATE application_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE id=?",
  )
    .bind(c.get("sessionId"))
    .run();
  return response({ logged_out: true });
});

app.post("/auth/opengrow-token", async (c) =>
  response(await issueOpenGrowToken(c.env, c.get("userId"))),
);

async function createSession(env: IdentityEnv, userId: string) {
  const session = await newSession(env, userId, null);
  await session.statement.run();
  return sessionResponse(env, userId, session.id, session.refreshToken);
}

async function newSession(
  env: IdentityEnv,
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
      "INSERT INTO application_sessions (id,user_id,refresh_token_hash,expires_at,rotated_from_id) VALUES (?,?,?,?,?)",
    ).bind(id, userId, await sha256(refreshToken), expiresAt, rotatedFromId),
  };
}

async function sessionResponse(
  env: IdentityEnv,
  userId: string,
  sessionId: string,
  refreshToken: string,
) {
  return {
    access_token: await issueAccessToken(env, userId, sessionId),
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: ttl(env.ACCESS_TOKEN_TTL, 300, 3600, "ACCESS_TOKEN_TTL"),
    user_id: userId,
  };
}

async function issueEmailToken(
  env: IdentityEnv,
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
    "INSERT INTO application_identity_tokens (id,user_id,purpose,token_hash,expires_at) VALUES (?,?,?,?,?)",
  )
    .bind(crypto.randomUUID(), userId, purpose, tokenHash, expiresAt)
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
): Promise<{ id: string; user_id: string } | null> {
  if (!token || token.length > 512) return null;
  const row = await db
    .prepare(
      `SELECT id,user_id FROM application_identity_tokens WHERE token_hash=? AND purpose=? AND consumed_at IS NULL
     AND datetime(expires_at)>datetime('now') LIMIT 1`,
    )
    .bind(await sha256(token), purpose)
    .first<{ id: string; user_id: string }>();
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
async function publicUser(db: D1Database, id: string) {
  const user = await db
    .prepare(
      "SELECT * FROM application_users WHERE id=? AND deleted_at IS NULL",
    )
    .bind(id)
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
