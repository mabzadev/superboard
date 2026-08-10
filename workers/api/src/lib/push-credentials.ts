import type { Env } from "../types";
import { decryptCredential, encryptCredential } from "./secrets";

type LegacyCredentialRow = {
  id: string | number;
  cleartext: string | null;
};

type LegacyRpushCredentialRow = {
  id: string | number;
  certificate: string | null;
  password: string | null;
  auth_key: string | null;
  client_secret: string | null;
};

export type PushCredentialMigrationSummary = {
  iosConfigurations: number;
  androidConfigurations: number;
  rpushApns: number;
  rpushFcm: number;
  rpushLegacy: number;
};

function changes(result: D1Result): number {
  return Number(result.meta?.changes || 0);
}

async function migrateSingleCredential(
  env: Env,
  selectSql: string,
  updateSql: string,
  limit: number,
): Promise<number> {
  const rows = await env.DB.prepare(selectSql)
    .bind(limit)
    .all<LegacyCredentialRow>();
  let migrated = 0;
  for (const row of rows.results || []) {
    if (!row.cleartext) continue;
    const encrypted = await encryptCredential(env, row.cleartext);
    const result = await env.DB.prepare(updateSql)
      .bind(encrypted, row.id)
      .run();
    migrated += changes(result);
  }
  return migrated;
}

/**
 * Bounded and idempotent runtime convergence for credentials created before
 * migration 0054. It is safe to call from both maintenance and queue consumers.
 */
export async function migrateLegacyPushCredentials(
  env: Env,
  limit = 100,
): Promise<PushCredentialMigrationSummary> {
  const boundedLimit = Math.max(1, Math.min(100, Number(limit || 100)));
  const iosConfigurations = await migrateSingleCredential(
    env,
    `SELECT id, p8_key AS cleartext
     FROM ios_push_configurations
     WHERE p8_key IS NOT NULL AND encrypted_p8_key IS NULL
     ORDER BY created_at ASC
     LIMIT ?`,
    `UPDATE ios_push_configurations
     SET encrypted_p8_key = ?, p8_key = NULL, updated_at = datetime('now')
     WHERE id = ? AND encrypted_p8_key IS NULL`,
    boundedLimit,
  );
  const androidConfigurations = await migrateSingleCredential(
    env,
    `SELECT id, fcm_server_key AS cleartext
     FROM android_push_configurations
     WHERE fcm_server_key IS NOT NULL AND encrypted_fcm_server_key IS NULL
     ORDER BY created_at ASC
     LIMIT ?`,
    `UPDATE android_push_configurations
     SET encrypted_fcm_server_key = ?, fcm_server_key = NULL, updated_at = datetime('now')
     WHERE id = ? AND encrypted_fcm_server_key IS NULL`,
    boundedLimit,
  );
  const rpushApns = await migrateSingleCredential(
    env,
    `SELECT id, apn_key AS cleartext
     FROM rpush_apps
     WHERE apn_key IS NOT NULL AND encrypted_apn_key IS NULL
     ORDER BY created_at ASC
     LIMIT ?`,
    `UPDATE rpush_apps
     SET encrypted_apn_key = ?, apn_key = NULL, updated_at = datetime('now')
     WHERE id = ? AND encrypted_apn_key IS NULL`,
    boundedLimit,
  );
  const rpushFcm = await migrateSingleCredential(
    env,
    `SELECT id, json_key AS cleartext
     FROM rpush_apps
     WHERE json_key IS NOT NULL AND encrypted_json_key IS NULL
     ORDER BY created_at ASC
     LIMIT ?`,
    `UPDATE rpush_apps
     SET encrypted_json_key = ?, json_key = NULL, updated_at = datetime('now')
     WHERE id = ? AND encrypted_json_key IS NULL`,
    boundedLimit,
  );

  const legacyRows = await env.DB.prepare(`
    SELECT id, certificate, password, auth_key, client_secret
    FROM rpush_apps
    WHERE encrypted_legacy_credentials IS NULL
      AND (certificate IS NOT NULL OR password IS NOT NULL OR auth_key IS NOT NULL OR client_secret IS NOT NULL)
    ORDER BY created_at ASC
    LIMIT ?
  `).bind(boundedLimit).all<LegacyRpushCredentialRow>();
  let rpushLegacy = 0;
  for (const row of legacyRows.results || []) {
    const encrypted = await encryptCredential(env, JSON.stringify({
      certificate: row.certificate,
      password: row.password,
      authKey: row.auth_key,
      clientSecret: row.client_secret,
    }));
    const result = await env.DB.prepare(`
      UPDATE rpush_apps
      SET encrypted_legacy_credentials = ?,
          certificate = NULL,
          password = NULL,
          auth_key = NULL,
          client_secret = NULL,
          updated_at = datetime('now')
      WHERE id = ? AND encrypted_legacy_credentials IS NULL
    `).bind(encrypted, row.id).run();
    rpushLegacy += changes(result);
  }

  return {
    iosConfigurations,
    androidConfigurations,
    rpushApns,
    rpushFcm,
    rpushLegacy,
  };
}

export async function requirePushCredential(
  env: Env,
  ciphertext: unknown,
  provider: "APNs" | "FCM",
): Promise<string> {
  if (typeof ciphertext !== "string" || !ciphertext) {
    throw new Error(`${provider} credential is not configured`);
  }
  return decryptCredential(env, ciphertext);
}
