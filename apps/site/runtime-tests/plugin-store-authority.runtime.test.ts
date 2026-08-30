import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";

import {
	acceptWorkerCallback,
	exportPluginStoreReverseDelta,
	issueWorkerExecutionLease,
	putPluginStoreRecord,
	verifyPluginStoreShadowRead,
} from "../src/lib/plugin-store-repository.js";

describe("EmDash plugin Store authority", () => {
	test("writes through the repository with stable aliases, CAS, idempotence and outbox", async () => {
		const input = {
			plugin_id: "supbrd-plug-user",
			store_id: "supbrd-plug-user.store.authority",
			projectId: "vocostar",
			pid: "vocostar",
			entity_type: "user",
			entity_id: "user-1",
			expected_revision: null,
			operation_id: "operation-user-1-create",
			payload: { email: "user@example.com", active: true },
			updated_at: "2026-08-30T02:00:00.000Z",
		};
		const created = await putPluginStoreRecord(env.DB, input);
		expect(created).toMatchObject({ revision: 1, instance_id: "vocostar", idempotent: false });
		expect(await putPluginStoreRecord(env.DB, input)).toMatchObject({ revision: 1, idempotent: true });
		await expect(putPluginStoreRecord(env.DB, { ...input, operation_id: "operation-stale", expected_revision: 9 })).rejects.toThrow(/REVISION_CONFLICT/u);
		const receipt = await env.DB.prepare("SELECT COUNT(*) count FROM superboard_plugin_store_outbox WHERE operation_id = ?").bind(input.operation_id).first<{ count: number }>();
		expect(receipt?.count).toBe(1);
	});

	test("fails shadow mismatches closed with metrics that contain no payload", async () => {
		await expect(verifyPluginStoreShadowRead(env.DB, {
			plugin_id: "supbrd-plug-user",
			entity_type: "user",
			source: [{ email: "private@example.com" }],
			target: [{ email: "different@example.com" }],
			observed_at: "2026-08-30T02:01:00.000Z",
		})).rejects.toThrow(/SHADOW_READ_MISMATCH/u);
		const metric = await env.DB.prepare("SELECT * FROM superboard_plugin_shadow_read_metrics ORDER BY metric_id DESC LIMIT 1").first<Record<string, unknown>>();
		expect(metric).toMatchObject({ result: "mismatch", source_count: 1, target_count: 1 });
		expect(JSON.stringify(metric)).not.toContain("example.com");
	});

	test("exports a reverse delta without delete instructions", async () => {
		const delta = await exportPluginStoreReverseDelta(env.DB, {
			plugin_id: "supbrd-plug-user",
			instance_id: "vocostar",
			updated_after: "2026-08-30T01:59:00.000Z",
		});
		expect(delta.records).toHaveLength(1);
		expect(delta.deletes).toEqual([]);
		expect(delta.checksum).toMatch(/^sha256:[a-f0-9]{64}$/u);
	});

	test("accepts a Worker callback only once with the exact attempt lease", async () => {
		await issueWorkerExecutionLease(env.DB, {
			attempt_id: "attempt-billing-1",
			plugin_id: "supbrd-plugmod-billing",
			operation_id: "billing-operation-1",
			callback_token: "callback-secret",
			issued_at: "2026-08-30T02:00:00.000Z",
			expires_at: "2026-08-30T02:10:00.000Z",
		});
		await expect(acceptWorkerCallback(env.DB, {
			attempt_id: "attempt-billing-1",
			plugin_id: "supbrd-plugmod-billing",
			callback_token: "wrong",
			completed_at: "2026-08-30T02:01:00.000Z",
		})).rejects.toThrow(/CALLBACK_REJECTED/u);
		expect(await acceptWorkerCallback(env.DB, {
			attempt_id: "attempt-billing-1",
			plugin_id: "supbrd-plugmod-billing",
			callback_token: "callback-secret",
			completed_at: "2026-08-30T02:01:00.000Z",
		})).toEqual({ operation_id: "billing-operation-1" });
		await expect(acceptWorkerCallback(env.DB, {
			attempt_id: "attempt-billing-1",
			plugin_id: "supbrd-plugmod-billing",
			callback_token: "callback-secret",
			completed_at: "2026-08-30T02:02:00.000Z",
		})).rejects.toThrow(/CALLBACK_REJECTED/u);
	});
});
