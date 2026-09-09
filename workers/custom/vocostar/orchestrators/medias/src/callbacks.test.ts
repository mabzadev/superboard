import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
	DurableObject: class {},
	WorkflowEntrypoint: class {
		constructor(
			_ctx: unknown,
			protected env: unknown,
		) {}
	},
}));

vi.mock("@cloudflare/containers", () => ({
	Container: class {},
	getContainer: () => ({
		fetch: async (url: string) =>
			url.endsWith("/prepare")
				? Response.json({
						audio_src_url: "https://output.test/source.mp3",
						video_src_url: "",
						crv_r2_path: "converted.mp3",
						file_prefix: "converted",
						is_video: false,
					})
				: Response.json({
						audio_crv_url: "https://output.test/converted.mp3",
						audio_audio_url: "https://output.test/audio.mp3",
						audio_unlock_url: "https://output.test/unlock.mp3",
						refs_url: "https://output.test/refs.mp3",
					}),
	}),
}));

import { VocalProcessingWorkflow } from "../../vocals/src/index.js";
import { MediaProcessingWorkflow } from "./index.js";

const cases = [
	{
		kind: "medias",
		Workflow: MediaProcessingWorkflow,
		entity: { media_id: "entity-1" },
		notify: "audio_ready",
	},
	{
		kind: "vocals",
		Workflow: VocalProcessingWorkflow,
		entity: { user_vocal_id: "entity-1" },
		notify: "clone_ready",
	},
];

describe.each(cases)("$kind workflow callbacks", ({ kind, Workflow, entity, notify }) => {
	let sqlite: DatabaseSync;
	let callbacks: { path: string; body: Record<string, unknown>; token: string | null }[];
	let failures: number;

	beforeEach(() => {
		sqlite = new DatabaseSync(":memory:");
		sqlite.exec(`
			CREATE TABLE users_vocals (id TEXT PRIMARY KEY, refs TEXT, audio_audio TEXT, audio_unlock TEXT, progress REAL, processed_at TEXT, job INTEGER);
			CREATE TABLE users_medias (id TEXT PRIMARY KEY, output TEXT, progress REAL, processed_at TEXT, job INTEGER, timing TEXT, created_at TEXT);
			CREATE TABLE send_users_vocals (id TEXT PRIMARY KEY, status TEXT, last_error TEXT);
			CREATE TABLE send_users_medias (id TEXT PRIMARY KEY, status TEXT, last_error TEXT);
			INSERT INTO users_vocals (id) VALUES ('entity-1');
			INSERT INTO users_medias (id, created_at) VALUES ('entity-1', '2026-09-08T10:00:00Z');
			INSERT INTO send_users_vocals (id) VALUES ('queue-1');
			INSERT INTO send_users_medias (id) VALUES ('queue-1');
		`);
		callbacks = [];
		failures = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init: RequestInit) => {
				callbacks.push({
					path: new URL(url).pathname,
					body: JSON.parse(String(init.body)),
					token: new Headers(init.headers).get("X-VocoStar-Internal-Token"),
				});
				return new Response("{}", { status: failures-- > 0 ? 503 : 200 });
			}),
		);
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		sqlite.close();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	async function run(scope: Record<string, string> = {}) {
		const db = {
			prepare: (sql: string) => ({
				bind: (...values: (string | number | null)[]) => ({
					run: async () => sqlite.prepare(sql).run(...values),
				}),
			}),
		};
		const step = {
			do: async (
				_name: string,
				options: { retries?: { limit: number } },
				callback: () => Promise<unknown>,
			) => {
				for (let attempt = 0; ; attempt += 1) {
					try {
						return await callback();
					} catch (error) {
						if (attempt >= (options.retries?.limit ?? 0)) throw error;
					}
				}
			},
		};
		const env = {
			DB: db,
			STANDARD_MAX_INSTANCES: "1",
			GATEWAY_URL: "https://gateway.test",
			GATEWAY_INTERNAL_TOKEN: "callback-token",
			DISPATCHER: {
				idFromName: (name: string) => name,
				get: () => ({ fetch: async () => Response.json({ instanceId: 1 }) }),
			},
		};
		const workflow = new Workflow({} as never, env as never);
		return workflow.run(
			{
				payload: {
					queue_id: "queue-1",
					data: {
						...entity,
						user_id: "legacy-user",
						media_type: "audio",
						audio_src: "https://output.test/source.mp3",
						text_audio: "Preview",
						text_unlock: "Unlocked",
						...scope,
					},
				},
			} as never,
			step as never,
		);
	}

	it("preserves scoped job identity in completion and push callbacks", async () => {
		const scope = { project_ref: "project-1", job_id: "job-1", subject: "oidc-subject" };
		await expect(run(scope)).resolves.toMatchObject({ status: "completed" });
		expect(callbacks).toHaveLength(2);
		for (const callback of callbacks) {
			expect(callback.body).toMatchObject({ ...scope, user_id: "legacy-user" });
			expect(callback.token).toBe("callback-token");
		}
		expect(callbacks[0].body).toMatchObject(
			kind === "medias" ? { media_id: "entity-1", progress: 1 } : { vocal_id: "entity-1" },
		);
		expect(callbacks[1].body).toMatchObject({ notification_type: notify });
	});

	it("retries a failed completion callback before advancing to push", async () => {
		failures = 1;
		await expect(run()).resolves.toMatchObject({ status: "completed" });
		expect(callbacks.map(({ path }) => path)).toEqual([
			kind === "medias" ? "/ws/medias/progress" : "/ws/vocals/notify",
			kind === "medias" ? "/ws/medias/progress" : "/ws/vocals/notify",
			"/internal/notify",
		]);
	});

	it("keeps completed media and releases its queue after notification retries are exhausted", async () => {
		failures = 100;
		await expect(run()).resolves.toMatchObject({ status: "completed" });
		expect(callbacks).toHaveLength(7);
		expect(
			sqlite.prepare(`SELECT job FROM users_${kind} WHERE id = ?`).get("entity-1"),
		).toMatchObject({ job: 1 });
		expect(sqlite.prepare(`SELECT COUNT(*) count FROM send_users_${kind}`).get()).toMatchObject({
			count: 0,
		});
		for (const { body } of callbacks) {
			expect(body.project_ref).toBeUndefined();
			expect(body.job_id).toBeUndefined();
			expect(body.subject).toBeUndefined();
		}
	});
});
