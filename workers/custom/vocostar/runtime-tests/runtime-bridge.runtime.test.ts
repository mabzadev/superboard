import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const runtime = env as unknown as {
	VOCOSTAR_DB: D1Database;
	VOCOSTAR_USER_VOCALS_ROOM: DurableObjectNamespace;
	VOCOSTAR_USER_MEDIAS_ROOM: DurableObjectNamespace;
};
const sockets: WebSocket[] = [];
const PROJECT = "11-test";
const OTHER_PROJECT = "22-test";

beforeEach(async () => {
	await runtime.VOCOSTAR_DB.batch([
		runtime.VOCOSTAR_DB.prepare("DELETE FROM vocostar_runtime_identities"),
		runtime.VOCOSTAR_DB.prepare("DELETE FROM opengrow_custom_jobs"),
		runtime.VOCOSTAR_DB.prepare("DELETE FROM send_users_medias"),
		runtime.VOCOSTAR_DB.prepare("DELETE FROM send_users_vocals"),
		runtime.VOCOSTAR_DB.prepare("DELETE FROM users_medias"),
		runtime.VOCOSTAR_DB.prepare("DELETE FROM users_vocals"),
		runtime.VOCOSTAR_DB.prepare("DELETE FROM app_vocals"),
		runtime.VOCOSTAR_DB.prepare("DELETE FROM users"),
		runtime.VOCOSTAR_DB.prepare("DELETE FROM runtime_notification_deliveries"),
		runtime.VOCOSTAR_DB.prepare(
			"INSERT INTO users (id, credits) VALUES ('legacy-1', 100), ('legacy-2', 100)",
		),
		runtime.VOCOSTAR_DB.prepare(
			"INSERT INTO app_vocals (id, refs) VALUES ('voice-1', 'https://files.example.test/voice-1.mp3')",
		),
		runtime.VOCOSTAR_DB.prepare(
			"INSERT INTO users_vocals (id, user_id, progress, created_at) VALUES ('vocal-1', 'legacy-1', 0.2, '2026-09-08'), ('vocal-2', 'legacy-2', 0.2, '2026-09-08')",
		),
		runtime.VOCOSTAR_DB.prepare(
			"INSERT INTO users_medias (id, user_id, progress, created_at) VALUES ('media-1', 'legacy-1', 0.2, '2026-09-08'), ('media-2', 'legacy-2', 0.2, '2026-09-08')",
		),
	]);
});

afterEach(() => {
	for (const socket of sockets.splice(0)) socket.close(1000, "test complete");
});

describe("Vocostar runtime bridge with D1 and external Durable Objects", () => {
	it("keeps a pre-existing legacy connection and its namespace while accepting an SDK connection", async () => {
		expect((await register("legacy-1", PROJECT, "oidc:subject-1")).status).toBe(200);
		const namespace = runtime.VOCOSTAR_USER_VOCALS_ROOM;
		const legacy = await connect(
			await namespace
				.get(namespace.idFromName("legacy-1"))
				.fetch(
					new Request("https://legacy.test/ws/vocals", {
						headers: { upgrade: "websocket", "x-user-id": "legacy-1" },
					}),
				),
		);
		expect(legacy.snapshot).toMatchObject({
			type: "snapshot",
			table: "users_vocals",
			count: 1,
			data: [{ id: "vocal-1" }],
		});
		const sdk = await connect(
			await service("/internal/v1/runtime/ws/vocals", {
				headers: {
					upgrade: "websocket",
					"x-custom-worker-project": PROJECT,
					"x-custom-worker-subject": "oidc:subject-1",
					"x-user-id": "legacy-2",
				},
			}),
		);
		expect(sdk.snapshot).toMatchObject({ data: [{ id: "vocal-1" }] });
		const legacyUpdate = nextMessage(legacy.socket);
		const sdkUpdate = nextMessage(sdk.socket);
		const response = await callback("/ws/vocals/progress", {
			user_id: "legacy-1",
			vocal_id: "vocal-1",
			progress: 0.7,
		});
		expect(response.status).toBe(200);
		for (const update of await Promise.all([legacyUpdate, sdkUpdate]))
			expect(update).toMatchObject({
				type: "update",
				table: "users_vocals",
				data: [{ id: "vocal-1", progress: 0.7 }],
			});
	});

	it("preserves legacy JWT query tokens and reads the media view through the existing room", async () => {
		await register();
		const token = await jwt({ sub: "legacy-1" }, "runtime-legacy-jwt-previous");
		const connected = await connect(
			await SELF.fetch(`https://custom.test/ws/medias?token=${token}`, {
				headers: {
					upgrade: "websocket",
					"x-user-id": "legacy-2",
					"x-custom-worker-project": OTHER_PROJECT,
				},
			}),
		);
		expect(connected.snapshot).toMatchObject({
			type: "snapshot",
			table: "users_medias",
			count: 1,
			data: [{ id: "media-1" }],
		});
		const update = nextMessage(connected.socket);
		expect(
			(await callback("/ws/medias/notify", { user_id: "legacy-1", media_id: "media-1" })).status,
		).toBe(200);
		expect(await update).toMatchObject({
			type: "update",
			table: "users_medias",
			data: [{ id: "media-1" }],
		});
	});

	it.each([
		["expired", { exp: 1 }, "HS256", "runtime-legacy-jwt-current"],
		["missing expiry", { exp: undefined }, "HS256", "runtime-legacy-jwt-current"],
		["string expiry", { exp: "9999999999" }, "HS256", "runtime-legacy-jwt-current"],
		["future activation", { nbf: 9999999999 }, "HS256", "runtime-legacy-jwt-current"],
		["forged signature", {}, "HS256", "wrong-secret"],
		["wrong algorithm", {}, "none", "runtime-legacy-jwt-current"],
		["missing subject", { sub: undefined }, "HS256", "runtime-legacy-jwt-current"],
	] as const)("rejects %s JWTs", async (_name, claims, algorithm, secret) => {
		await register();
		const response = await SELF.fetch(
			`https://custom.test/ws/vocals?token=${await jwt({ sub: "legacy-1", ...claims }, secret, algorithm)}`,
			{
				headers: { upgrade: "websocket" },
			},
		);
		expect(response.status).toBe(401);
	});

	it("rejects a token's conflicting project and scopes from unauthenticated SDK callers", async () => {
		await register();
		const legacy = await SELF.fetch(
			`https://custom.test/ws/vocals?token=${await jwt({ sub: "legacy-1", project_ref: OTHER_PROJECT })}`,
			{
				headers: { upgrade: "websocket" },
			},
		);
		expect(legacy.status).toBe(403);
		const untrusted = await SELF.fetch("https://custom.test/internal/v1/runtime/ws/vocals", {
			headers: {
				upgrade: "websocket",
				"x-custom-worker-project": PROJECT,
				"x-custom-worker-subject": "legacy-1",
			},
		});
		expect(untrusted.status).toBe(401);
		const otherProject = await service("/internal/v1/runtime/ws/vocals", {
			headers: {
				upgrade: "websocket",
				"x-custom-worker-project": OTHER_PROJECT,
				"x-custom-worker-subject": "legacy-1",
			},
		});
		expect(otherProject.status).toBe(403);
	});

	it("requires callback authentication, accepts rotation overlap and rejects malformed progress", async () => {
		await register();
		const payload = { user_id: "legacy-1", vocal_id: "vocal-1", progress: 0.8 };
		expect((await callback("/ws/vocals/progress", payload, "wrong-secret")).status).toBe(401);
		for (const progress of [-1, 1.1, "0.5", null])
			expect((await callback("/ws/vocals/progress", { ...payload, progress })).status).toBe(400);
		expect(
			(await callback("/ws/vocals/progress", payload, "runtime-callback-previous")).status,
		).toBe(200);
		expect(await progressOf("users_vocals", "vocal-1")).toBe(0.8);
	});

	it("never updates or notifies an entity belonging to another user or project", async () => {
		await register();
		await register("legacy-2", OTHER_PROJECT, "legacy-2");
		for (const [path, entity] of [
			["vocals", { vocal_id: "vocal-2" }],
			["medias", { media_id: "media-2" }],
		] as const) {
			expect(
				(await callback(`/ws/${path}/progress`, { user_id: "legacy-1", ...entity, progress: 0.9 }))
					.status,
			).toBe(404);
			expect(
				(await callback(`/ws/${path}/notify`, { user_id: "legacy-1", ...entity })).status,
			).toBe(404);
		}
		expect(
			(
				await callback("/ws/medias/progress", {
					user_id: "legacy-1",
					media_id: "media-1",
					project_ref: OTHER_PROJECT,
					progress: 0.9,
				})
			).status,
		).toBe(403);
		expect(await progressOf("users_vocals", "vocal-2")).toBe(0.2);
		expect(await progressOf("users_medias", "media-2")).toBe(0.2);
	});

	it("registers identities idempotently and refuses reassignment or an unknown user", async () => {
		expect((await register()).status).toBe(200);
		expect((await register()).status).toBe(200);
		expect((await register("legacy-1", OTHER_PROJECT, "legacy-1")).status).toBe(409);
		expect((await register("legacy-1", PROJECT, "different-subject")).status).toBe(409);
		expect((await register("legacy-2", PROJECT, "legacy-1")).status).toBe(409);
		expect((await register("unknown", PROJECT, "unknown")).status).toBe(409);
		const unauthorized = await SELF.fetch("https://custom.test/internal/v1/runtime/identities", {
			method: "PUT",
			body: JSON.stringify({ legacyUserId: "legacy-2", projectRef: PROJECT, subject: "legacy-2" }),
		});
		expect(unauthorized.status).toBe(401);
	});

	it("backfills an unambiguous new job on first SDK connection and refuses cross-project jobs afterwards", async () => {
		const job = await createMediaJob();
		expect(job.status).toBe(202);
		const connected = await connect(
			await service("/internal/v1/runtime/ws/medias", {
				headers: {
					upgrade: "websocket",
					"x-custom-worker-project": PROJECT,
					"x-custom-worker-subject": "legacy-1",
				},
			}),
		);
		expect(connected.snapshot.count).toBe(2);
		const rejected = await createMediaJob(OTHER_PROJECT);
		expect(rejected.status).toBe(403);
		await expect(rejected.json()).resolves.toEqual({ error: "runtime_identity_project_conflict" });
		await expect(
			runtime.VOCOSTAR_DB.prepare(
				"UPDATE opengrow_custom_jobs SET project_ref = ? WHERE user_id = 'legacy-1'",
			)
				.bind(OTHER_PROJECT)
				.run(),
		).rejects.toThrow("runtime_identity_project_conflict");
	});

	it("refuses guessing the project for a user with jobs in multiple projects", async () => {
		expect((await createMediaJob()).status).toBe(202);
		expect((await createMediaJob(OTHER_PROJECT)).status).toBe(202);
		expect((await callback("/ws/vocals/notify", { user_id: "legacy-1" })).status).toBe(403);
		expect((await register()).status).toBe(409);
	});

	it("resolves a mapped application subject for job creation and validates callback job identity", async () => {
		await register("legacy-1", PROJECT, "oidc:subject-1");
		const created = await createMediaJob(PROJECT, "oidc:subject-1");
		expect(created.status).toBe(202);
		const job = await created.json<{ id: string; entityId: string }>();
		expect(
			(
				await callback("/ws/medias/progress", {
					user_id: "legacy-1",
					media_id: job.entityId,
					job_id: job.id,
					project_ref: PROJECT,
					progress: 0.6,
				})
			).status,
		).toBe(200);
		expect(
			(
				await callback("/ws/medias/progress", {
					user_id: "legacy-1",
					media_id: "media-1",
					job_id: job.id,
					progress: 0.9,
				})
			).status,
		).toBe(404);
		expect(
			(
				await callback("/internal/notify", {
					user_id: "legacy-1",
					job_id: "unknown-job",
					notification_type: "clone_ready",
				})
			).status,
		).toBe(404);
	});

	it("forwards validated push notifications and returns downstream failures for retries", async () => {
		await register();
		expect(
			(
				await callback("/internal/notify", {
					user_id: "legacy-1",
					notification_type: "clone_ready",
					payload: { vocal_id: "vocal-1" },
				})
			).status,
		).toBe(200);
		const delivery = await runtime.VOCOSTAR_DB.prepare(
			"SELECT body FROM runtime_notification_deliveries",
		).first<{ body: string }>();
		expect(JSON.parse(delivery!.body)).toMatchObject({
			user_id: "legacy-1",
			project_ref: PROJECT,
			notification_type: "clone_ready",
			payload: { vocal_id: "vocal-1" },
		});
		expect(
			(
				await callback("/internal/notify", {
					user_id: "legacy-1",
					project_ref: OTHER_PROJECT,
					notification_type: "clone_ready",
				})
			).status,
		).toBe(403);
		expect(
			(
				await callback("/internal/notify", {
					user_id: "legacy-1",
					notification_type: "runtime_failure",
				})
			).status,
		).toBe(502);
		const count = await runtime.VOCOSTAR_DB.prepare(
			"SELECT COUNT(*) AS count FROM runtime_notification_deliveries",
		).first<{ count: number }>();
		expect(count?.count).toBe(1);
	});
});

function service(path: string, init: RequestInit = {}) {
	const headers = new Headers(init.headers);
	headers.set("x-custom-worker-token", "custom-runtime-secret");
	return SELF.fetch(`https://custom.test${path}`, { ...init, headers });
}

function register(legacyUserId = "legacy-1", projectRef = PROJECT, subject = legacyUserId) {
	return service("/internal/v1/runtime/identities", {
		method: "PUT",
		body: JSON.stringify({ legacyUserId, projectRef, subject }),
	});
}

function callback(
	path: string,
	body: Record<string, unknown>,
	secret = "runtime-callback-current",
) {
	return SELF.fetch(`https://custom.test${path}`, {
		method: "POST",
		headers: { "content-type": "application/json", "x-vocostar-internal-token": secret },
		body: JSON.stringify(body),
	});
}

async function createMediaJob(projectRef = PROJECT, subject = "legacy-1") {
	return service("/internal/v1/jobs", {
		method: "POST",
		headers: { "x-custom-worker-project": projectRef, "x-custom-worker-subject": subject },
		body: JSON.stringify({
			idempotencyKey: crypto.randomUUID(),
			projectRef,
			capability: "vocostar.media.convert",
			requestedAt: new Date().toISOString(),
			payload: {
				vocalId: "voice-1",
				vocalType: "app",
				mediaType: "text",
				creditCost: 0,
				input: { text: "Bonjour", language: "fr" },
			},
		}),
	});
}

async function progressOf(table: "users_vocals" | "users_medias", id: string) {
	return (
		await runtime.VOCOSTAR_DB.prepare(`SELECT progress FROM ${table} WHERE id = ?`)
			.bind(id)
			.first<{ progress: number }>()
	)?.progress;
}

type Snapshot = { type: string; table: string; count: number; data: Record<string, unknown>[] };

function nextMessage(socket: WebSocket) {
	return new Promise<Snapshot>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("WebSocket snapshot timeout")), 3000);
		socket.addEventListener(
			"message",
			(event) => {
				clearTimeout(timer);
				resolve(JSON.parse(String(event.data)));
			},
			{ once: true },
		);
	});
}

async function connect(response: Response) {
	expect(response.status, response.status === 101 ? undefined : await response.text()).toBe(101);
	const socket = response.webSocket!;
	sockets.push(socket);
	const message = nextMessage(socket);
	socket.accept();
	return { socket, snapshot: await message };
}

async function jwt(
	claims: Record<string, unknown>,
	secret = "runtime-legacy-jwt-current",
	algorithm = "HS256",
) {
	const encode = (bytes: Uint8Array) =>
		btoa(String.fromCharCode(...bytes))
			.replace(/\+/gu, "-")
			.replace(/\//gu, "_")
			.replace(/=+$/gu, "");
	const part = (value: unknown) => encode(new TextEncoder().encode(JSON.stringify(value)));
	const input = `${part({ alg: algorithm, typ: "JWT" })}.${part({ exp: Math.floor(Date.now() / 1000) + 300, ...claims })}`;
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input));
	return `${input}.${encode(new Uint8Array(signature))}`;
}
