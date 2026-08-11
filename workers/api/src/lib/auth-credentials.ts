import type { Env } from "../types";
import { decryptCredential, encryptCredential } from "./secrets";

export function isEncryptedAuthCredential(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]+\.[A-Za-z0-9+/=]+$/u.test(value);
}

export async function readOtpSecret(env: Env, stored: string): Promise<string> {
  return isEncryptedAuthCredential(stored)
    ? decryptCredential(env, stored)
    : stored;
}

export async function storeOtpSecret(env: Env, cleartext: string): Promise<string> {
  return encryptCredential(env, cleartext);
}

export async function migrateLegacyOtpSecrets(
  env: Env,
  limit = 100,
): Promise<number> {
  const boundedLimit = Math.max(1, Math.min(100, Number(limit || 100)));
  const rows = await env.DB.prepare(`
    SELECT id, otp_secret
    FROM users
    WHERE otp_secret IS NOT NULL AND instr(otp_secret, '.') = 0
    ORDER BY created_at ASC
    LIMIT ?
  `).bind(boundedLimit).all<{ id: string | number; otp_secret: string }>();
  let migrated = 0;
  for (const row of rows.results || []) {
    const result = await env.DB.prepare(`
      UPDATE users
      SET otp_secret = ?, updated_at = datetime('now')
      WHERE id = ? AND otp_secret = ?
    `).bind(await storeOtpSecret(env, row.otp_secret), row.id, row.otp_secret).run();
    migrated += Number(result.meta?.changes || 0);
  }
  return migrated;
}
