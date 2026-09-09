import {
	customWorkerAuthorized,
	parseCustomWorkerScope,
} from "@superboard/contracts/custom-worker";
import { readJsonObjectLimited, RequestBodyError } from "@superboard/contracts/request-body";
import { configuredSecrets, matchesAnySecret } from "@superboard/contracts/secret";

import {
	registerRuntimeIdentity,
	runtimeIdentityForLegacyUser,
	runtimeIdentityForScope,
	type RuntimeIdentity,
} from "./runtime-identity.js";
import { VocoStarJobError } from "./validation.js";

type RuntimeEnv = Env & {
	VOCOSTAR_INTERNAL_CALLBACK_TOKEN?: string;
	VOCOSTAR_INTERNAL_CALLBACK_TOKEN_PREVIOUS?: string;
	VOCOSTAR_LEGACY_JWT_SECRET?: string;
	VOCOSTAR_LEGACY_JWT_SECRET_PREVIOUS?: string;
	VOCOSTAR_LEGACY_JWT_ISSUER?: string;
	VOCOSTAR_LEGACY_JWT_AUDIENCE?: string;
	VOCOSTAR_USER_VOCALS_ROOM?: DurableObjectNamespace;
	VOCOSTAR_USER_MEDIAS_ROOM?: DurableObjectNamespace;
	VOCOSTAR_NOTIFICATION_DISPATCHER?: Fetcher;
};

const CALLBACKS = new Set([
	"/internal/notify",
	"/ws/vocals/notify",
	"/ws/vocals/progress",
	"/ws/medias/notify",
	"/ws/medias/progress",
]);

export async function handleRuntimeBridge(
	request: Request,
	env: RuntimeEnv,
): Promise<Response | null> {
	const { pathname } = new URL(request.url);
	const socket = pathname.match(/^\/(?:internal\/v1\/runtime\/)?ws\/(vocals|medias)$/u);
	const identityRoute = pathname === "/internal/v1/runtime/identities";
	if (!CALLBACKS.has(pathname) && !socket && !identityRoute) return null;
	try {
		if (identityRoute) {
			if (request.method !== "PUT") return json({ error: "method_not_allowed" }, 405);
			if (!(await authorizedService(request, env))) return json({ error: "unauthorized" }, 401);
			const body = await readJsonObjectLimited(request, 4096);
			const identity = await registerRuntimeIdentity(env.VOCOSTAR_DB, {
				legacy_user_id: identifier(body.legacyUserId, "legacy_user_id"),
				project_ref: projectRef(body.projectRef),
				subject: identifier(body.subject, "subject"),
			});
			return json({ identity });
		}
		if (socket) {
			if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
			if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
				return json({ error: "websocket_upgrade_required" }, 426);
			let identity: RuntimeIdentity;
			if (pathname.startsWith("/internal/v1/")) {
				if (!(await authorizedService(request, env))) return json({ error: "unauthorized" }, 401);
				const scope = parseCustomWorkerScope(request);
				if (!scope) return json({ error: "scope_required" }, 403);
				identity = await runtimeIdentityForScope(env.VOCOSTAR_DB, scope);
			} else {
				const claims = await verifyLegacyToken(request, env);
				identity = await runtimeIdentityForLegacyUser(
					env.VOCOSTAR_DB,
					identifier(claims.sub, "subject"),
				);
				checkIdentityClaims(claims, identity, false);
			}
			const namespace = roomNamespace(env, socket[1]);
			const headers = new Headers({ upgrade: "websocket", "x-user-id": identity.legacy_user_id });
			return namespace
				.get(namespace.idFromName(identity.legacy_user_id))
				.fetch(new Request(`https://vocostar-room.internal/ws/${socket[1]}`, { headers }));
		}
		if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
		if (
			!(await matchesAnySecret(
				request.headers.get("x-vocostar-internal-token") || "",
				configuredSecrets(
					env.VOCOSTAR_INTERNAL_CALLBACK_TOKEN,
					env.VOCOSTAR_INTERNAL_CALLBACK_TOKEN_PREVIOUS,
				),
			))
		)
			return json({ error: "unauthorized" }, 401);
		const body = await readJsonObjectLimited(request, 65536);
		const identity = await runtimeIdentityForLegacyUser(
			env.VOCOSTAR_DB,
			identifier(body.user_id, "user_id"),
		);
		checkIdentityClaims(body, identity, true);
		if (body.job_id !== undefined) await verifyJob(env.VOCOSTAR_DB, body, identity);
		if (pathname === "/internal/notify") {
			identifier(body.notification_type, "notification_type");
			if (!env.VOCOSTAR_NOTIFICATION_DISPATCHER)
				throw new VocoStarJobError("runtime_notification_unavailable", 503);
			const response = await env.VOCOSTAR_NOTIFICATION_DISPATCHER.fetch(
				new Request("https://vocostar-dispatcher.internal/notify", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...body,
						user_id: identity.legacy_user_id,
						project_ref: identity.project_ref,
					}),
					signal: AbortSignal.timeout(10000),
				}),
			);
			if (!response.ok) throw new VocoStarJobError("runtime_notification_failed", 502);
			await response.body?.cancel();
			return json({ ok: true });
		}
		const kind = pathname.startsWith("/ws/vocals/") ? "vocals" : "medias";
		const namespace = roomNamespace(env, kind);
		if (pathname.endsWith("/progress")) {
			const entityId = identifier(kind === "vocals" ? body.vocal_id : body.media_id, "entity_id");
			if (
				typeof body.progress !== "number" ||
				!Number.isFinite(body.progress) ||
				body.progress < 0 ||
				body.progress > 1
			)
				throw new VocoStarJobError("progress_invalid", 400);
			if (body.job_id !== undefined) await verifyJob(env.VOCOSTAR_DB, body, identity, entityId);
			const table = kind === "vocals" ? "users_vocals" : "users_medias";
			const result = await env.VOCOSTAR_DB.prepare(
				`UPDATE ${table} SET progress = MAX(COALESCE(progress, 0), ?) WHERE id = ? AND user_id = ?
				 AND NOT EXISTS (SELECT 1 FROM opengrow_custom_jobs WHERE entity_id = ? AND (project_ref <> ? OR user_id <> ?))`,
			)
				.bind(
					body.progress,
					entityId,
					identity.legacy_user_id,
					entityId,
					identity.project_ref,
					identity.legacy_user_id,
				)
				.run();
			if (!result.meta.changes) throw new VocoStarJobError("entity_not_found", 404);
		} else if (
			(kind === "vocals" && (body.vocal_id !== undefined || body.user_vocal_id !== undefined)) ||
			(kind === "medias" && (body.media_id !== undefined || body.user_media_id !== undefined))
		) {
			const entityId = identifier(
				kind === "vocals"
					? (body.vocal_id ?? body.user_vocal_id)
					: (body.media_id ?? body.user_media_id),
				"entity_id",
			);
			const table = kind === "vocals" ? "users_vocals" : "users_medias";
			const entity = await env.VOCOSTAR_DB.prepare(
				`SELECT id FROM ${table} WHERE id = ? AND user_id = ?
				 AND NOT EXISTS (SELECT 1 FROM opengrow_custom_jobs WHERE entity_id = ? AND (project_ref <> ? OR user_id <> ?))`,
			)
				.bind(
					entityId,
					identity.legacy_user_id,
					entityId,
					identity.project_ref,
					identity.legacy_user_id,
				)
				.first();
			if (!entity) throw new VocoStarJobError("entity_not_found", 404);
			if (body.job_id !== undefined) await verifyJob(env.VOCOSTAR_DB, body, identity, entityId);
		}
		const response = await namespace.get(namespace.idFromName(identity.legacy_user_id)).fetch(
			new Request("https://vocostar-room.internal/notify", {
				method: "POST",
				headers: { "x-user-id": identity.legacy_user_id },
			}),
		);
		if (!response.ok) throw new VocoStarJobError("runtime_room_notification_failed", 502);
		if (pathname.endsWith("/notify")) return response;
		await response.body?.cancel();
		return json({ ok: true, progress: body.progress });
	} catch (error) {
		if (error instanceof RequestBodyError) return json({ error: error.code }, error.status);
		if (error instanceof VocoStarJobError) return json({ error: error.code }, error.status);
		throw error;
	}
}

function authorizedService(request: Request, env: RuntimeEnv) {
	return customWorkerAuthorized(
		request,
		configuredSecrets(env.CUSTOM_WORKER_TOKEN, env.CUSTOM_WORKER_TOKEN_PREVIOUS),
	);
}

function roomNamespace(env: RuntimeEnv, kind: string) {
	const namespace =
		kind === "vocals" ? env.VOCOSTAR_USER_VOCALS_ROOM : env.VOCOSTAR_USER_MEDIAS_ROOM;
	if (!namespace) throw new VocoStarJobError("runtime_room_unavailable", 503);
	return namespace;
}

async function verifyJob(
	db: D1Database,
	body: Record<string, unknown>,
	identity: RuntimeIdentity,
	entityId?: string,
) {
	const id = identifier(body.job_id, "job_id");
	const job = await db
		.prepare(
			"SELECT entity_id FROM opengrow_custom_jobs WHERE id = ? AND user_id = ? AND project_ref = ?",
		)
		.bind(id, identity.legacy_user_id, identity.project_ref)
		.first<{ entity_id: string }>();
	if (!job || (entityId && job.entity_id !== entityId))
		throw new VocoStarJobError("job_not_found", 404);
}

function checkIdentityClaims(
	body: Record<string, unknown>,
	identity: RuntimeIdentity,
	includeSubject: boolean,
) {
	if (
		(body.project_ref !== undefined && body.project_ref !== identity.project_ref) ||
		(includeSubject && body.subject !== undefined && body.subject !== identity.subject)
	)
		throw new VocoStarJobError("runtime_identity_mismatch", 403);
}

async function verifyLegacyToken(
	request: Request,
	env: RuntimeEnv,
): Promise<Record<string, unknown>> {
	try {
		const authorization = request.headers.get("authorization");
		const token = authorization?.startsWith("Bearer ")
			? authorization.slice(7)
			: new URL(request.url).searchParams.get("token");
		if (!token || token.length > 8192) throw new Error("token_invalid");
		const parts = token.split(".");
		if (parts.length !== 3) throw new Error("token_invalid");
		const header = JSON.parse(
			new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(decodeSegment(parts[0])),
		);
		if (
			!header ||
			header.alg !== "HS256" ||
			(header.typ !== undefined && header.typ !== "JWT") ||
			header.crit !== undefined
		)
			throw new Error("token_invalid");
		const signature = decodeSegment(parts[2]);
		const input = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
		const secrets = configuredSecrets(
			env.VOCOSTAR_LEGACY_JWT_SECRET,
			env.VOCOSTAR_LEGACY_JWT_SECRET_PREVIOUS,
		);
		const verified = await Promise.all(
			secrets.map(async (secret) => {
				const key = await crypto.subtle.importKey(
					"raw",
					new TextEncoder().encode(secret),
					{ name: "HMAC", hash: "SHA-256" },
					false,
					["verify"],
				);
				return crypto.subtle.verify("HMAC", key, signature, input);
			}),
		);
		if (!verified.some(Boolean)) throw new Error("token_invalid");
		const claims = JSON.parse(
			new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(decodeSegment(parts[1])),
		);
		const now = Math.floor(Date.now() / 1000);
		if (
			!claims ||
			typeof claims !== "object" ||
			Array.isArray(claims) ||
			!Number.isSafeInteger(claims.exp) ||
			claims.exp <= now ||
			(claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > now))
		)
			throw new Error("token_invalid");
		identifier(claims.sub, "subject");
		if (env.VOCOSTAR_LEGACY_JWT_ISSUER && claims.iss !== env.VOCOSTAR_LEGACY_JWT_ISSUER)
			throw new Error("token_invalid");
		if (
			env.VOCOSTAR_LEGACY_JWT_AUDIENCE &&
			!(
				claims.aud === env.VOCOSTAR_LEGACY_JWT_AUDIENCE ||
				(Array.isArray(claims.aud) && claims.aud.includes(env.VOCOSTAR_LEGACY_JWT_AUDIENCE))
			)
		)
			throw new Error("token_invalid");
		return claims;
	} catch {
		throw new VocoStarJobError("unauthorized", 401);
	}
}

function decodeSegment(value: string): Uint8Array<ArrayBuffer> {
	if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("token_invalid");
	const binary = atob(
		value.replace(/-/gu, "+").replace(/_/gu, "/") + "=".repeat((4 - (value.length % 4)) % 4),
	);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function identifier(value: unknown, field: string) {
	if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value))
		throw new VocoStarJobError(`${field}_invalid`, 400);
	return value;
}

function projectRef(value: unknown) {
	if (typeof value !== "string" || !/^\d+-(?:prod|test)$/u.test(value) || value.length > 64)
		throw new VocoStarJobError("project_ref_invalid", 400);
	return value;
}

function json(value: unknown, status = 200) {
	return Response.json(value, {
		status,
		headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
	});
}
