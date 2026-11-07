import type { DataEnv, Deferral } from "./platform/env.js";
import { DataError, base64UrlEncode, nowIso, sha256Hex } from "./platform/http.js";

const SECRET_PATTERN = /^sb_secret_[A-Za-z0-9_-]{43}$/u;
const NAME_PATTERN = /^[\p{L}\p{N} ._-]{1,64}$/u;
const MAXIMUM_ACTIVE_KEYS = 20;
const LAST_USED_RESOLUTION_MS = 60_000;

interface ServiceKey {
	id: string;
	name: string;
	hint: string;
	created_by: string | null;
	created_at: string;
	last_used_at: string | null;
	revoked_at: string | null;
}

export async function findServiceKey(
	env: DataEnv,
	secret: string,
	deferral: Deferral,
): Promise<{ id: string; projectId: number } | null> {
	if (!SECRET_PATTERN.test(secret)) return null;
	const row = await env.DB.prepare(
		"SELECT id, project_id, last_used_at FROM data_service_keys WHERE key_hash = ? AND revoked_at IS NULL",
	)
		.bind(await sha256Hex(secret))
		.first<{ id: string; project_id: number; last_used_at: string | null }>();
	if (!row) return null;
	const now = Date.now();
	if (!row.last_used_at || now - Date.parse(row.last_used_at) > LAST_USED_RESOLUTION_MS)
		deferral.waitUntil(
			env.DB.prepare("UPDATE data_service_keys SET last_used_at = ? WHERE id = ?")
				.bind(new Date(now).toISOString(), row.id)
				.run(),
		);
	return { id: row.id, projectId: Number(row.project_id) };
}

export async function listServiceKeys(env: DataEnv, projectId: number): Promise<ServiceKey[]> {
	const { results } = await env.DB.prepare(
		`SELECT id, name, hint, created_by, created_at, last_used_at, revoked_at
		 FROM data_service_keys WHERE project_id = ? ORDER BY created_at DESC, id DESC`,
	)
		.bind(projectId)
		.all<ServiceKey>();
	return results;
}

export async function createServiceKey(
	env: DataEnv,
	projectId: number,
	name: unknown,
	createdBy: string | null,
): Promise<{ key: ServiceKey; secret: string }> {
	if (typeof name !== "string" || !NAME_PATTERN.test(name.trim()))
		throw new DataError(422, "key_name_invalid", "Key name must contain 1 to 64 characters");
	const active = await env.DB.prepare(
		"SELECT COUNT(*) AS total FROM data_service_keys WHERE project_id = ? AND revoked_at IS NULL",
	)
		.bind(projectId)
		.first<{ total: number }>();
	if (Number(active?.total ?? 0) >= MAXIMUM_ACTIVE_KEYS)
		throw new DataError(
			409,
			"key_limit_reached",
			`A project keeps at most ${MAXIMUM_ACTIVE_KEYS} active keys`,
		);
	const secret = `sb_secret_${base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))}`;
	const key: ServiceKey = {
		id: crypto.randomUUID(),
		name: name.trim(),
		hint: `${secret.slice(0, 14)}…`,
		created_by: createdBy,
		created_at: nowIso(),
		last_used_at: null,
		revoked_at: null,
	};
	await env.DB.prepare(
		`INSERT INTO data_service_keys (id, project_id, name, key_hash, hint, created_by, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(key.id, projectId, key.name, await sha256Hex(secret), key.hint, createdBy, key.created_at)
		.run();
	return { key, secret };
}

export async function revokeServiceKey(env: DataEnv, projectId: number, id: string): Promise<void> {
	const result = await env.DB.prepare(
		"UPDATE data_service_keys SET revoked_at = ? WHERE project_id = ? AND id = ? AND revoked_at IS NULL",
	)
		.bind(nowIso(), projectId, id)
		.run();
	if (!result.meta.changes) throw new DataError(404, "key_not_found", "Key does not exist");
}
