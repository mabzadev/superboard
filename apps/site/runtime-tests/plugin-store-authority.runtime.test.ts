import { canonicalizeReleasePayload } from "@superboard/supbrd-core";
import { userPluginManifest } from "@superboard/supbrd-plug-user";
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";

import topology from "../../../config/emdash-plugin-topology.json";
import {
	restorePluginObjectStores,
	snapshotPluginObjectStores,
} from "../src/lib/plugin-store-object-backup.js";
import {
	acceptWorkerCallback,
	exportPluginStoreReverseDelta,
	issueWorkerExecutionLease,
	listPluginStoreRecords,
	putPluginStoreRecord,
	verifyPluginStoreShadowRead,
} from "../src/lib/plugin-store-repository.js";
import { synchronizeSuperBoardPluginCatalog } from "../src/lib/superboard-plugin-catalog.js";
import { installCompiledUserPlugin } from "../src/lib/user-plugin-installation.js";

describe("EmDash plugin Store authority", () => {
	test("synchronizes every concrete SuperBoard plugin into the EmDash runtime lifecycle", async () => {
		await env.DB.prepare(
			`CREATE TABLE IF NOT EXISTS _plugin_state (
			  plugin_id TEXT PRIMARY KEY, version TEXT NOT NULL,
			  status TEXT NOT NULL DEFAULT 'installed', installed_at TEXT DEFAULT (datetime('now')),
			  activated_at TEXT, deactivated_at TEXT, data TEXT,
			  source TEXT NOT NULL DEFAULT 'config', marketplace_version TEXT,
			  display_name TEXT, description TEXT, registry_publisher_did TEXT,
			  registry_slug TEXT, mcp_tools_enabled INTEGER NOT NULL DEFAULT 0,
			  mcp_tools_consent TEXT
			)`,
		).run();
		const receipt = await synchronizeSuperBoardPluginCatalog(env.DB, {
			instance_id: "vocostar",
			checked_at: "2026-08-30T08:20:00.000Z",
			expires_at: "2026-08-31T08:20:00.000Z",
		});
		expect(receipt.installed).toHaveLength(18);
		expect(receipt.templates).toEqual(["supbrd-plugmod-custom-*"]);
		expect(
			receipt.installed.find(({ plugin_id }) => plugin_id === "supbrd-plug-user"),
		).toMatchObject({
			plugin_version: "1.3.0",
			status: "active",
		});

		const states = await env.DB.prepare(
			"SELECT COUNT(*) count FROM _plugin_state WHERE source = 'config' AND status = 'active' AND plugin_id LIKE 'supbrd-%'",
		).first<{ count: number }>();
		expect(states?.count).toBe(18);
		const manifests = await env.DB.prepare(
			"SELECT COUNT(*) count FROM superboard_active_plugin_manifests WHERE plugin_id NOT LIKE '%*%'",
		).first<{ count: number }>();
		expect(manifests?.count).toBe(18);
		const health = await env.DB.prepare(
			"SELECT COUNT(*) count FROM superboard_dependency_health WHERE instance_id = ? AND status = 'ready'",
		)
			.bind("vocostar")
			.first<{ count: number }>();
		expect(health?.count).toBe(18);
	});

	test("installs the exact compiled user plugin and publishes bounded dependency health", async () => {
		const receipt = await installCompiledUserPlugin(env.DB, {
			instance_id: "vocostar",
			checked_at: "2026-08-30T08:30:00.000Z",
			expires_at: "2026-08-30T09:30:00.000Z",
		});
		expect(receipt).toMatchObject({
			plugin_id: userPluginManifest.plugin_id,
			plugin_version: userPluginManifest.plugin_version,
			artifact_checksum: userPluginManifest.artifact_checksum,
			dependency_id: "dependency.supbrd_plug_user",
			status: "ready",
		});
		expect(receipt.evidence_checksum).toMatch(/^sha256:[a-f0-9]{64}$/u);

		const installed = await env.DB.prepare(
			`SELECT artifact.artifact_checksum, artifact.manifest_json
			 FROM superboard_active_plugin_manifests active
			 JOIN superboard_plugin_manifest_artifacts artifact
			   ON artifact.artifact_checksum = active.artifact_checksum
			 WHERE active.plugin_id = ? AND active.artifact_checksum = ?`,
		)
			.bind(userPluginManifest.plugin_id, userPluginManifest.artifact_checksum)
			.first<{ artifact_checksum: string; manifest_json: string }>();
		expect(installed?.artifact_checksum).toBe(userPluginManifest.artifact_checksum);
		expect(JSON.parse(installed?.manifest_json ?? "{}")).toMatchObject({
			plugin_version: "1.3.0",
		});

		const health = await env.DB.prepare(
			"SELECT status, evidence_checksum, expires_at FROM superboard_dependency_health WHERE instance_id = ? AND dependency_id = ?",
		)
			.bind("vocostar", "dependency.supbrd_plug_user")
			.first();
		expect(health).toEqual({
			status: "ready",
			evidence_checksum: receipt.evidence_checksum,
			expires_at: receipt.expires_at,
		});
	});

	test("writes through the repository with stable aliases, CAS, idempotence and outbox", async () => {
		const encryptionKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
			"encrypt",
			"decrypt",
		]);
		const input = {
			plugin_id: "supbrd-plug-user",
			store_id: "supbrd-plug-user.store.user_directory",
			projectId: "vocostar",
			pid: "vocostar",
			project_ref: "10-test",
			entity_type: "user",
			entity_id: "user-1",
			expected_revision: null,
			operation_id: "operation-user-1-create",
			payload: { email: "user@example.com", active: true },
			updated_at: "2026-08-30T02:00:00.000Z",
			encryption_key: encryptionKey,
		};
		const created = await putPluginStoreRecord(env.DB, input);
		expect(created).toMatchObject({ revision: 1, instance_id: "vocostar", idempotent: false });
		expect(await putPluginStoreRecord(env.DB, input)).toMatchObject({
			revision: 1,
			idempotent: true,
		});
		await expect(
			putPluginStoreRecord(env.DB, {
				...input,
				operation_id: "operation-stale",
				expected_revision: 9,
			}),
		).rejects.toThrow(/REVISION_CONFLICT/u);
		const receipt = await env.DB.prepare(
			"SELECT COUNT(*) count FROM superboard_plugin_store_outbox WHERE operation_id = ?",
		)
			.bind(input.operation_id)
			.first<{ count: number }>();
		expect(receipt?.count).toBe(1);
		const stored = await env.DB.prepare(
			"SELECT payload_json FROM superboard_plugin_store_records WHERE entity_id = '10-test:user-1'",
		).first<{ payload_json: string }>();
		expect(stored?.payload_json).not.toContain("user@example.com");
		const page = await listPluginStoreRecords(env.DB, {
			plugin_id: input.plugin_id,
			store_id: input.store_id,
			instance_id: "vocostar",
			project_ref: "10-test",
			limit: 10,
			encryption_key: encryptionKey,
		});
		expect(page).toMatchObject({ next_cursor: null });
		expect(page.items).toContainEqual(
			expect.objectContaining({ entity_id: "user-1", payload: input.payload }),
		);
		await expect(putPluginStoreRecord(env.DB, { ...input, entity_id: "user-2" })).rejects.toThrow(
			/IDEMPOTENCY_TARGET_CONFLICT/u,
		);
		await expect(
			putPluginStoreRecord(env.DB, {
				...input,
				operation_id: "operation-cross-store",
				store_id: "supbrd-plug-settings.store.settings",
			}),
		).rejects.toThrow(/AUTHORITY_REJECTED|NAMESPACE_REJECTED/u);
	});

	test("fails shadow mismatches closed with metrics that contain no payload", async () => {
		await expect(
			verifyPluginStoreShadowRead(env.DB, {
				plugin_id: "supbrd-plug-user",
				entity_type: "user",
				source: [{ email: "private@example.com" }],
				target: [{ email: "different@example.com" }],
				observed_at: "2026-08-30T02:01:00.000Z",
			}),
		).rejects.toThrow(/SHADOW_READ_MISMATCH/u);
		const metric = await env.DB.prepare(
			"SELECT * FROM superboard_plugin_shadow_read_metrics ORDER BY metric_id DESC LIMIT 1",
		).first();
		expect(metric).toMatchObject({ result: "mismatch", source_count: 1, target_count: 1 });
		expect(JSON.stringify(metric)).not.toContain("example.com");
	});

	test("exports a reverse delta without delete instructions", async () => {
		const encryptionKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
			"encrypt",
			"decrypt",
		]);
		await putPluginStoreRecord(env.DB, {
			plugin_id: "supbrd-plug-settings",
			store_id: "supbrd-plug-settings.store.settings",
			instance_id: "vocostar",
			entity_type: "settings",
			entity_id: "settings-1",
			expected_revision: null,
			operation_id: "operation-settings-create",
			payload: { locale: "fr" },
			updated_at: "2026-08-30T02:00:00.000Z",
			encryption_key: encryptionKey,
		});
		const delta = await exportPluginStoreReverseDelta(env.DB, {
			plugin_id: "supbrd-plug-settings",
			instance_id: "vocostar",
			updated_after: "2026-08-30T01:59:00.000Z",
			encryption_key: encryptionKey,
		});
		expect(delta.records).toHaveLength(1);
		expect(delta.deletes).toEqual([]);
		expect(delta.checksum).toMatch(/^sha256:[a-f0-9]{64}$/u);
	});

	test("accepts a Worker callback only once with the exact attempt lease", async () => {
		const callbackKeys = await crypto.subtle.generateKey(
			{ name: "ECDSA", namedCurve: "P-256" },
			true,
			["sign", "verify"],
		);
		const callbackPublicJwk = await crypto.subtle.exportKey("jwk", callbackKeys.publicKey);
		await issueWorkerExecutionLease(env.DB, {
			attempt_id: "attempt-billing-1",
			plugin_id: "supbrd-plugmod-billing",
			operation_id: "billing-operation-1",
			callback_token: "callback-secret",
			callback_public_jwk: callbackPublicJwk,
			issued_at: "2026-08-30T02:00:00.000Z",
			expires_at: "2026-08-30T02:10:00.000Z",
		});
		await expect(
			acceptWorkerCallback(env.DB, {
				attempt_id: "attempt-billing-1",
				plugin_id: "supbrd-plugmod-billing",
				callback_token: "wrong",
				payload_checksum: `sha256:${"a".repeat(64)}`,
				signature: "invalid",
				completed_at: "2026-08-30T02:01:00.000Z",
			}),
		).rejects.toThrow(/CALLBACK_REJECTED/u);
		await issueWorkerExecutionLease(env.DB, {
			attempt_id: "attempt-billing-2",
			plugin_id: "supbrd-plugmod-billing",
			operation_id: "billing-operation-1",
			callback_token: "replacement-secret",
			callback_public_jwk: callbackPublicJwk,
			issued_at: "2026-08-30T02:02:00.000Z",
			expires_at: "2026-08-30T02:10:00.000Z",
		});
		await expect(
			acceptWorkerCallback(env.DB, {
				attempt_id: "attempt-billing-1",
				plugin_id: "supbrd-plugmod-billing",
				callback_token: "callback-secret",
				payload_checksum: `sha256:${"a".repeat(64)}`,
				signature: "invalid",
				completed_at: "2026-08-30T02:03:00.000Z",
			}),
		).rejects.toThrow(/CALLBACK_REJECTED/u);
		const completedAt = "2026-08-30T02:03:00.000Z";
		const payloadChecksum = `sha256:${"a".repeat(64)}`;
		const signature = await signWorkerCallback(callbackKeys.privateKey, {
			attempt_id: "attempt-billing-2",
			plugin_id: "supbrd-plugmod-billing",
			operation_id: "billing-operation-1",
			payload_checksum: payloadChecksum,
			completed_at: completedAt,
		});
		expect(
			await acceptWorkerCallback(env.DB, {
				attempt_id: "attempt-billing-2",
				plugin_id: "supbrd-plugmod-billing",
				callback_token: "replacement-secret",
				payload_checksum: payloadChecksum,
				signature,
				completed_at: completedAt,
			}),
		).toEqual({ operation_id: "billing-operation-1" });
		await expect(
			acceptWorkerCallback(env.DB, {
				attempt_id: "attempt-billing-2",
				plugin_id: "supbrd-plugmod-billing",
				callback_token: "replacement-secret",
				payload_checksum: payloadChecksum,
				signature,
				completed_at: "2026-08-30T02:04:00.000Z",
			}),
		).rejects.toThrow(/CALLBACK_REJECTED/u);
	});

	test("backs up and restores through real Miniflare R2 and KV bindings", async () => {
		await env.MEDIA.put("source/attachment.txt", new TextEncoder().encode("attachment"));
		await env.RELEASE_CACHE.put("source/pointer", "release-1");
		const snapshot = await snapshotPluginObjectStores({
			r2: env.MEDIA,
			kv: env.RELEASE_CACHE,
			r2_keys: ["source/attachment.txt"],
			kv_keys: ["source/pointer"],
		});
		const receipt = await restorePluginObjectStores({
			snapshot,
			r2: env.MEDIA,
			kv: env.RELEASE_CACHE,
			target_prefix: "isolated-restore/",
		});
		expect(receipt).toMatchObject({ r2_count: 1, kv_count: 1, production_mutated: false });
		expect(await (await env.MEDIA.get("isolated-restore/source/attachment.txt"))?.text()).toBe(
			"attachment",
		);
		expect(await env.RELEASE_CACHE.get("isolated-restore/source/pointer")).toBe("release-1");
	});

	test("rehearses encrypted idempotent authority for every declared domain Store", async () => {
		const encryptionKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
			"encrypt",
			"decrypt",
		]);
		let storeCount = 0;
		for (const { manifest } of topology.plugins) {
			for (const store of manifest.stores) {
				storeCount += 1;
				const entityId = `fixture-${storeCount}`;
				const input = {
					plugin_id: manifest.plugin_id,
					store_id: store.store_id,
					instance_id: "parity-all",
					entity_type: store.store_id.split(".").at(-1) ?? "record",
					entity_id: entityId,
					expected_revision: null,
					operation_id: `operation-${storeCount}`,
					payload: { fixture_id: entityId, domain: manifest.plugin_id },
					updated_at: "2026-08-30T02:05:00.000Z",
					encryption_key: encryptionKey,
				};
				const created = await putPluginStoreRecord(env.DB, input).catch((error: unknown) => {
					throw new Error(
						`${store.store_id}: ${error instanceof Error ? error.message : String(error)}`,
					);
				});
				expect(created.idempotent).toBe(false);
				expect((await putPluginStoreRecord(env.DB, input)).idempotent).toBe(true);
				await expect(
					verifyPluginStoreShadowRead(env.DB, {
						plugin_id: manifest.plugin_id,
						entity_type: input.entity_type,
						source: [input.payload],
						target: [created.payload],
						observed_at: "2026-08-30T02:06:00.000Z",
					}),
				).resolves.toMatchObject({ rows: [input.payload] });
			}
			const delta = await exportPluginStoreReverseDelta(env.DB, {
				plugin_id: manifest.plugin_id,
				instance_id: "parity-all",
				updated_after: "2026-08-30T02:04:00.000Z",
				encryption_key: encryptionKey,
			});
			expect(delta.records).toHaveLength(manifest.stores.length);
			expect(delta.deletes).toEqual([]);
		}
		expect(storeCount).toBeGreaterThan(19);
	});
});

async function signWorkerCallback(
	privateKey: CryptoKey,
	payload: {
		attempt_id: string;
		plugin_id: string;
		operation_id: string;
		payload_checksum: string;
		completed_at: string;
	},
): Promise<string> {
	const signature = await crypto.subtle.sign(
		{ name: "ECDSA", hash: "SHA-256" },
		privateKey,
		new TextEncoder().encode(canonicalizeReleasePayload(payload)),
	);
	return btoa(String.fromCodePoint(...new Uint8Array(signature)));
}
