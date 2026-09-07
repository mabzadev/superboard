import {
	type CompiledFrontRelease,
	type LastVerifiedFrontRelease,
	parseCompiledFrontReleaseJson,
	sha256Canonical,
	verifyFrontRelease,
} from "@superboard/supbrd-core";

import type { ManagedPluginOperation } from "./managed-plugin-operation.js";

interface ActiveReleaseRow {
	recovery_snapshot: string | null;
	recovery_checksum: string | null;
	active_release_id: string;
	pointer_revision: number;
	release_json: string;
	public_jwk: string;
	signing_kid: string;
}

interface LastVerifiedCacheEntry {
	schema_version: 1;
	instance_id: string;
	active_release_id: string;
	pointer_revision: number;
	release: CompiledFrontRelease;
	public_jwk: JsonWebKey;
	verified_at: string;
}

export interface LoadedFrontRelease {
	release: CompiledFrontRelease;
	runtime_release: LastVerifiedFrontRelease;
	pointer_revision: number;
	source: "d1" | "last_verified_cache" | "preview";
}

export async function loadLastVerifiedFrontRelease(
	env: Cloudflare.Env,
	instanceId: string,
	pendingOperation?: Pick<ManagedPluginOperation, "operation_id" | "owner_token">,
): Promise<LoadedFrontRelease | null> {
	try {
		const fromD1 = await loadFromD1(env.DB, instanceId, pendingOperation);
		if (!fromD1) return null;
		await env.RELEASE_CACHE.put(cacheKey(instanceId), JSON.stringify(fromD1.cache));
		return fromD1.loaded;
	} catch (error) {
		console.warn("SuperBoard release authority unavailable; trying Last Verified Release", {
			instance_id: instanceId,
			error: error instanceof Error ? error.name : "unknown",
		});
		return loadFromCache(env.RELEASE_CACHE, instanceId);
	}
}

export async function loadDependencyHealth(
	db: D1Database,
	instanceId: string,
	now: string,
): Promise<Record<string, "ready" | "unavailable">> {
	const result = await db
		.prepare(
			`SELECT dependency_id, status
			 FROM superboard_dependency_health
			 WHERE instance_id = ? AND expires_at > ?`,
		)
		.bind(instanceId, now)
		.all<{ dependency_id: string; status: "ready" | "unavailable" }>();
	return Object.fromEntries(result.results.map((row) => [row.dependency_id, row.status]));
}

async function loadFromD1(
	db: D1Database,
	instanceId: string,
	pendingOperation?: Pick<ManagedPluginOperation, "operation_id" | "owner_token">,
): Promise<{ loaded: LoadedFrontRelease; cache: LastVerifiedCacheEntry } | null> {
	const row = await db
		.prepare(
			`SELECT CASE WHEN recovery.operation_id IS NULL THEN active.active_release_id
              WHEN json_valid(recovery.snapshot_json) THEN json_extract(recovery.snapshot_json, '$.superboard_front_active_releases[0].active_release_id') END AS active_release_id,
            active.pointer_revision, candidate.release_json, candidate.signing_kid, key.public_jwk,
            recovery.snapshot_json AS recovery_snapshot, recovery.snapshot_checksum AS recovery_checksum
     FROM superboard_front_active_releases active
     LEFT JOIN superboard_managed_plugin_operations recovery
       ON recovery.instance_id = active.instance_id AND recovery.release_id = active.active_release_id
      AND recovery.status = 'running'
      AND (? IS NULL OR recovery.operation_id <> ? OR recovery.owner_token <> ? OR recovery.recovery_error IS NOT NULL)
     JOIN superboard_front_release_candidates candidate
       ON candidate.instance_id = active.instance_id AND candidate.release_id = CASE
        WHEN recovery.operation_id IS NULL THEN active.active_release_id
        WHEN json_valid(recovery.snapshot_json) THEN json_extract(recovery.snapshot_json, '$.superboard_front_active_releases[0].active_release_id') END
     JOIN superboard_release_signing_keys key ON key.kid = candidate.signing_kid
     WHERE active.instance_id = ? AND candidate.status = 'activated'
      AND (recovery.operation_id IS NULL OR (
       json_extract(recovery.snapshot_json, '$.superboard_front_active_releases[0].active_release_id') = active.previous_release_id
       AND json_extract(recovery.snapshot_json, '$.superboard_front_active_releases[0].pointer_revision') + 1 = active.pointer_revision))`,
		)
		.bind(
			pendingOperation?.operation_id ?? null,
			pendingOperation?.operation_id ?? null,
			pendingOperation?.owner_token ?? null,
			instanceId,
		)
		.first<ActiveReleaseRow>();
	if (!row) return null;
	if (
		row.recovery_snapshot &&
		(await sha256Canonical(JSON.parse(row.recovery_snapshot))) !== row.recovery_checksum
	)
		return null;

	const release = parseCompiledFrontReleaseJson(row.release_json);
	const publicJwk = parsePublicReleaseJwk(row.public_jwk);
	await assertVerifiedRelease(
		release,
		publicJwk,
		row.signing_kid,
		instanceId,
		row.active_release_id,
	);
	const cache: LastVerifiedCacheEntry = {
		schema_version: 1,
		instance_id: instanceId,
		active_release_id: row.active_release_id,
		pointer_revision: row.pointer_revision,
		release,
		public_jwk: publicJwk,
		verified_at: new Date().toISOString(),
	};
	return { loaded: toLoaded(cache, "d1"), cache };
}

function parsePublicReleaseJwk(value: string): JsonWebKey {
	const parsed: unknown = JSON.parse(value);
	if (
		parsed === null ||
		typeof parsed !== "object" ||
		!("kty" in parsed) ||
		parsed.kty !== "EC" ||
		!("crv" in parsed) ||
		parsed.crv !== "P-256" ||
		!("x" in parsed) ||
		typeof parsed.x !== "string" ||
		!("y" in parsed) ||
		typeof parsed.y !== "string"
	) {
		throw new TypeError("Stored release verification JWK is malformed");
	}
	return { kty: "EC", crv: "P-256", x: parsed.x, y: parsed.y, key_ops: ["verify"] };
}

async function loadFromCache(
	cache: KVNamespace,
	instanceId: string,
): Promise<LoadedFrontRelease | null> {
	const entry = await cache.get<LastVerifiedCacheEntry>(cacheKey(instanceId), "json");
	if (!entry || entry.schema_version !== 1 || entry.instance_id !== instanceId) return null;
	await assertVerifiedRelease(
		entry.release,
		entry.public_jwk,
		entry.release.signature.kid,
		instanceId,
		entry.active_release_id,
	);
	return toLoaded(entry, "last_verified_cache");
}

async function assertVerifiedRelease(
	release: CompiledFrontRelease,
	publicJwk: JsonWebKey,
	kid: string,
	instanceId: string,
	activeReleaseId: string,
): Promise<void> {
	if (
		release.payload.instance_id !== instanceId ||
		release.payload.release_id !== activeReleaseId ||
		release.signature.kid !== kid
	) {
		throw new Error("Active release identity mismatch");
	}
	const publicKey = await crypto.subtle.importKey(
		"jwk",
		publicJwk,
		{ name: "ECDSA", namedCurve: "P-256" },
		false,
		["verify"],
	);
	const verification = await verifyFrontRelease(release, { kid, public_key: publicKey });
	if (!verification.valid)
		throw new Error(`Active release verification failed: ${verification.errors.join(",")}`);
}

function toLoaded(
	entry: LastVerifiedCacheEntry,
	source: LoadedFrontRelease["source"],
): LoadedFrontRelease {
	return {
		release: entry.release,
		runtime_release: {
			front_route_manifest: entry.release.payload.front_route_manifest,
			dependency_policies: entry.release.payload.dependency_policies,
		},
		pointer_revision: entry.pointer_revision,
		source,
	};
}

function cacheKey(instanceId: string): string {
	return `last_verified_release:${instanceId}`;
}
