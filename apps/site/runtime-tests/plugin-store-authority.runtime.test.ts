import { canonicalizeReleasePayload } from "@superboard/supbrd-core";
import { userPluginManifest } from "@superboard/supbrd-plug-user";
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";

import topology from "../../../config/emdash-plugin-topology.json";
import compatibility from "../../../config/superboard-plugin-compatibility.json";
import { proxyOperatorApiRequest } from "../src/lib/operator-api-proxy.js";
import {
	beginRepositoryCommand,
	completeRepositoryCommand,
	resolveRepositoryCommandScope,
} from "../src/lib/plugin-command-authority.js";
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
import {
	finalizeSuperBoardPluginLifecycleForRelease,
	loadActiveSuperBoardPluginLock,
	loadReleasableSuperBoardPluginLock,
	prepareSuperBoardPluginLifecycleForRelease,
	superBoardRuntimePluginCatalog,
	synchronizeSuperBoardPluginCatalog,
} from "../src/lib/superboard-plugin-catalog.js";
import { composeUserFrontReleaseInput } from "../src/lib/user-front-release.js";
import { installCompiledUserPlugin } from "../src/lib/user-plugin-installation.js";

const targetProof = {
	target_artifact_checksum: `sha256:${"3".repeat(64)}`,
	target_plugin_ids: superBoardRuntimePluginCatalog().plugins.map(
		({ manifest }) => manifest.plugin_id,
	),
};

describe("EmDash plugin Store authority", () => {
	test("synchronizes every concrete SuperBoard plugin into the EmDash runtime lifecycle", async () => {
		const scope = { ...targetProof, instance_id: "vocostar", target: "local" as const };
		const receipt = await synchronizeSuperBoardPluginCatalog(env.DB, {
			...scope,
			approved_by: "operator-1",
			checked_at: "2026-08-30T08:20:00.000Z",
			expires_at: "2999-08-31T08:20:00.000Z",
		});
		expect(receipt.installed).toHaveLength(18);
		expect(receipt.templates).toEqual(["supbrd-plugmod-custom-*"]);
		expect(
			receipt.installed.find(({ plugin_id }) => plugin_id === "supbrd-plug-user"),
		).toMatchObject({
			plugin_version: "1.4.0",
			status: "installed",
		});

		const states = await env.DB.prepare(
			`SELECT COUNT(*) count FROM superboard_plugin_lifecycle
			 WHERE instance_id = ? AND target = ? AND state = 'installed'`,
		)
			.bind(scope.instance_id, scope.target)
			.first<{ count: number }>();
		expect(states?.count).toBe(18);
		const health = await env.DB.prepare(
			`SELECT COUNT(*) count FROM superboard_plugin_runtime_health
			 WHERE instance_id = ? AND target = ? AND status = 'ready'`,
		)
			.bind(scope.instance_id, scope.target)
			.first<{ count: number }>();
		expect(health?.count).toBe(18);
		const candidateLock = await loadReleasableSuperBoardPluginLock(env.DB, scope);
		await activatePluginRelease(
			env.DB,
			scope,
			"01J00000000000000000000501",
			candidateLock,
			"2026-08-30T08:25:00.000Z",
		);
		const fullLock = await loadActiveSuperBoardPluginLock(env.DB, scope);
		const fullPresentation = await composeUserFrontReleaseInput({
			...releaseIdentifiers,
			plugin_lock: fullLock,
		});
		expect(
			fullPresentation.front_route_manifest.routes.some(
				({ path_pattern: path }) => path === "/marketing/campaigns",
			),
		).toBe(true);

		const compatibleAnalyticsChecksum = Object.entries(compatibility.artifacts).find(
			([, value]) => value.plugin_id === "supbrd-plugmod-analytics",
		)?.[0];
		expect(compatibleAnalyticsChecksum).toBeDefined();
		const previousAnalytics = await env.DB.prepare(
			`SELECT artifact.artifact_checksum
			 FROM superboard_plugin_manifest_artifacts artifact
			 WHERE artifact.artifact_checksum = ?`,
		)
			.bind(compatibleAnalyticsChecksum)
			.first<{ artifact_checksum: string }>();
		expect(previousAnalytics).not.toBeNull();
		await env.DB.batch([
			env.DB.prepare(
				"UPDATE superboard_plugin_lifecycle SET artifact_checksum = ? WHERE instance_id = ? AND target = ? AND plugin_id = 'supbrd-plugmod-analytics'",
			).bind(previousAnalytics!.artifact_checksum, scope.instance_id, scope.target),
			env.DB.prepare(
				"UPDATE superboard_plugin_runtime_health SET artifact_checksum = ? WHERE instance_id = ? AND target = ? AND plugin_id = 'supbrd-plugmod-analytics'",
			).bind(previousAnalytics!.artifact_checksum, scope.instance_id, scope.target),
		]);
		await expect(loadActiveSuperBoardPluginLock(env.DB, scope)).rejects.toThrow(
			/PLUGIN_INSTALLATION_PLAN_CONTRACT_MISSING:.*analytics/u,
		);
		const currentAnalytics = superBoardRuntimePluginCatalog().plugins.find(
			({ manifest }) => manifest.plugin_id === "supbrd-plugmod-analytics",
		)?.manifest.artifact_checksum;
		await env.DB.batch([
			env.DB.prepare(
				"UPDATE superboard_plugin_lifecycle SET artifact_checksum = ? WHERE instance_id = ? AND target = ? AND plugin_id = 'supbrd-plugmod-analytics'",
			).bind(currentAnalytics, scope.instance_id, scope.target),
			env.DB.prepare(
				"UPDATE superboard_plugin_runtime_health SET artifact_checksum = ? WHERE instance_id = ? AND target = ? AND plugin_id = 'supbrd-plugmod-analytics'",
			).bind(currentAnalytics, scope.instance_id, scope.target),
		]);
		const restoredLock = await loadActiveSuperBoardPluginLock(env.DB, scope);
		expect(
			restoredLock.find(({ plugin_id: pluginId }) => pluginId === "supbrd-plugmod-analytics")
				?.artifact_checksum,
		).toBe(currentAnalytics);

		await env.DB.prepare(
			`DELETE FROM superboard_plugin_lifecycle
			 WHERE instance_id = ? AND target = ? AND plugin_id = 'supbrd-plugmod-marketing'`,
		)
			.bind(scope.instance_id, scope.target)
			.run();
		const reducedLock = await loadActiveSuperBoardPluginLock(env.DB, scope);
		expect(reducedLock).toHaveLength(17);
		expect(
			reducedLock.some(({ plugin_id: pluginId }) => pluginId === "supbrd-plugmod-marketing"),
		).toBe(false);
		const reducedPresentation = await composeUserFrontReleaseInput({
			...releaseIdentifiers,
			plugin_lock: reducedLock,
		});
		expect(
			reducedPresentation.front_route_manifest.routes.some(
				({ path_pattern: path }) => path === "/marketing/campaigns",
			),
		).toBe(false);
	});

	test("installs the exact compiled user plugin and publishes bounded dependency health", async () => {
		const receipt = await installCompiledUserPlugin(env.DB, {
			...targetProof,
			instance_id: "vocostar",
			approved_by: "operator-1",
			checked_at: "2026-08-30T08:30:00.000Z",
			expires_at: "2999-08-30T09:30:00.000Z",
		});
		expect(receipt).toMatchObject({
			plugin_id: userPluginManifest.plugin_id,
			plugin_version: userPluginManifest.plugin_version,
			artifact_checksum: userPluginManifest.artifact_checksum,
			dependency_id: "dependency.supbrd_plug_user",
			status: "installed",
		});
		expect(receipt.evidence_checksum).toMatch(/^sha256:[a-f0-9]{64}$/u);

		const installed = await env.DB.prepare(
			`SELECT artifact.artifact_checksum, artifact.manifest_json
			 FROM superboard_plugin_installation_items item
			 JOIN superboard_plugin_manifest_artifacts artifact
			   ON artifact.artifact_checksum = item.artifact_checksum
			 WHERE item.plan_id = ? AND item.plugin_id = ? AND item.state = 'installed'`,
		)
			.bind(receipt.plan_id, userPluginManifest.plugin_id)
			.first<{ artifact_checksum: string; manifest_json: string }>();
		expect(installed?.artifact_checksum).toBe(userPluginManifest.artifact_checksum);
		expect(JSON.parse(installed?.manifest_json ?? "{}")).toMatchObject({
			plugin_version: "1.4.0",
		});

		const health = await env.DB.prepare(
			`SELECT status, evidence_checksum, expires_at FROM superboard_plugin_runtime_health
			 WHERE instance_id = ? AND target = 'local' AND plugin_id = ?`,
		)
			.bind("vocostar", userPluginManifest.plugin_id)
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

	test("commits compatibility mutations before transient execution and replays receipts", async () => {
		await synchronizeSuperBoardPluginCatalog(env.DB, {
			...targetProof,
			instance_id: "vocostar",
			approved_by: "operator-1",
			checked_at: "2026-08-30T08:20:00.000Z",
			expires_at: "2999-08-31T08:20:00.000Z",
		});
		const encryptionKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
			"encrypt",
			"decrypt",
		]);
		const scope = resolveRepositoryCommandScope(
			new URL("https://site.example.test/api/v1/analytics/10-test/reports"),
		);
		expect(scope).toEqual({
			plugin_id: "supbrd-plugmod-analytics",
			project_ref: "10-test",
			adapter_operation: "api-v1:supbrd-plugmod-analytics",
		});
		const input = {
			operation_id: "operation-analytics-report-1",
			instance_id: "vocostar",
			project_ref: scope.project_ref,
			plugin_id: scope.plugin_id,
			command_id: "supbrd-plugmod-analytics.command.create_analytics_report",
			adapter_operation: scope.adapter_operation,
			method: "POST" as const,
			request_path: "/api/v1/analytics/10-test/reports",
			request_body: new TextEncoder().encode('{"email":"private@example.com"}'),
			accepted_at: "2026-08-30T09:00:00.000Z",
			encryption_key: encryptionKey,
		};
		await expect(beginRepositoryCommand(env.DB, input)).resolves.toMatchObject({
			status: "accepted",
			operation: { state: "accepted", plugin_id: scope.plugin_id },
		});
		const encrypted = await env.DB.prepare(
			"SELECT request_payload_json FROM superboard_plugin_command_operations WHERE operation_id = ?",
		)
			.bind(input.operation_id)
			.first<{ request_payload_json: string }>();
		expect(encrypted?.request_payload_json).not.toContain("private@example.com");
		const response = Response.json({ id: "report-1", status: "created" }, { status: 201 });
		await expect(
			completeRepositoryCommand(env.DB, {
				operation_id: input.operation_id,
				response,
				completed_at: "2026-08-30T09:00:01.000Z",
				encryption_key: encryptionKey,
			}),
		).resolves.toMatchObject({ state: "completed", response_status: 201 });
		const replay = await beginRepositoryCommand(env.DB, input);
		expect(replay.status).toBe("replay");
		if (replay.status !== "replay") throw new Error("expected replay");
		expect(replay.response.status).toBe(201);
		await expect(replay.response.json()).resolves.toEqual({ id: "report-1", status: "created" });
		const outbox = await env.DB.prepare(
			"SELECT event_kind FROM superboard_plugin_command_outbox WHERE operation_id = ? ORDER BY event_id",
		)
			.bind(input.operation_id)
			.all<{ event_kind: string }>();
		expect(outbox.results).toEqual([{ event_kind: "accepted" }, { event_kind: "completed" }]);
		await expect(
			beginRepositoryCommand(env.DB, {
				...input,
				request_path: "/api/v1/analytics/10-test/reports/other",
			}),
		).rejects.toThrow(/IDEMPOTENCY_CONFLICT/u);
	});

	test("keeps the compatibility Worker transient behind the repository-first gateway", async () => {
		await synchronizeSuperBoardPluginCatalog(env.DB, {
			...targetProof,
			instance_id: "vocostar",
			approved_by: "operator-1",
			checked_at: "2026-08-30T09:10:00.000Z",
			expires_at: "2999-08-31T09:10:00.000Z",
		});
		const rawKey = crypto.getRandomValues(new Uint8Array(32));
		const encodedKey = btoa(String.fromCodePoint(...rawKey));
		let dispatches = 0;
		const apiService = {
			fetch: async () => {
				dispatches += 1;
				const accepted = await env.DB.prepare(
					"SELECT state FROM superboard_plugin_command_operations WHERE operation_id = ?",
				)
					.bind("operation-gateway-report-1")
					.first<{ state: string }>();
				expect(accepted).toEqual({ state: "accepted" });
				return Response.json({ id: "report-gateway-1" }, { status: 201 });
			},
		};
		const buildRequest = () =>
			new Request("https://site.example.test/api/v1/analytics/10-test/reports", {
				method: "POST",
				headers: {
					Origin: "https://site.example.test",
					"Content-Type": "application/json",
					"Idempotency-Key": "operation-gateway-report-1",
					"X-SuperBoard-Command-Id": "supbrd-plugmod-analytics.command.create_analytics_report",
				},
				body: JSON.stringify({ name: "Repository first" }),
			});
		const proxyEnv = {
			API_SERVICE: apiService,
			SITE_OPERATOR_BRIDGE_TOKEN: "bridge-token",
			DB: env.DB,
			SUPERBOARD_INSTANCE_ID: "vocostar",
			SUPERBOARD_PLUGIN_STORE_ENCRYPTION_KEY: encodedKey,
		};
		const first = await proxyOperatorApiRequest({
			request: buildRequest(),
			operator_email: "operator@example.com",
			env: proxyEnv,
		});
		expect({ status: first.status, payload: await first.clone().json() }).toEqual({
			status: 201,
			payload: { id: "report-gateway-1" },
		});
		await expect(first.json()).resolves.toEqual({ id: "report-gateway-1" });
		const replay = await proxyOperatorApiRequest({
			request: buildRequest(),
			operator_email: "operator@example.com",
			env: proxyEnv,
		});
		expect(replay.status).toBe(201);
		await expect(replay.json()).resolves.toEqual({ id: "report-gateway-1" });
		expect(dispatches).toBe(1);
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
		await synchronizeSuperBoardPluginCatalog(env.DB, {
			...targetProof,
			instance_id: "parity-all",
			target: "local",
			approved_by: "operator-1",
			checked_at: "2026-08-30T02:00:00.000Z",
			expires_at: "2999-08-31T02:00:00.000Z",
		});
		const parityScope = { instance_id: "parity-all", target: "local" as const };
		const parityLock = await loadReleasableSuperBoardPluginLock(env.DB, parityScope);
		await activatePluginRelease(
			env.DB,
			parityScope,
			"01J00000000000000000000511",
			parityLock,
			"2026-08-30T02:01:00.000Z",
		);
		const encryptionKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
			"encrypt",
			"decrypt",
		]);
		let storeCount = 0;
		for (const { manifest } of topology.plugins.filter(
			({ manifest }) => !manifest.plugin_id.includes("*"),
		)) {
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

async function activatePluginRelease(
	db: D1Database,
	releaseScope: { instance_id: string; target: "local" | "development" | "production" },
	releaseId: string,
	pluginLock: Parameters<typeof prepareSuperBoardPluginLifecycleForRelease>[1]["plugin_lock"],
	activatedAt: string,
) {
	const instanceId = releaseScope.instance_id;
	await db.batch([
		db
			.prepare(
				`INSERT INTO superboard_release_signing_keys
				 (kid, public_jwk, status, created_at, retired_at)
				 VALUES ('plugin-authority-test-key', '{}', 'active', ?, NULL)
				 ON CONFLICT(kid) DO NOTHING`,
			)
			.bind(activatedAt),
		db
			.prepare(
				`INSERT INTO superboard_front_release_candidates
				 (candidate_id, instance_id, release_id, release_json, content_checksum,
				  validation_set_checksum, signing_kid, status, approval_json, created_at, approved_at)
				 VALUES (?, ?, ?, ?, 'sha256:test', 'sha256:test',
				         'plugin-authority-test-key', 'approved', '{}', ?, ?)`,
			)
			.bind(
				`${releaseId}-candidate`,
				instanceId,
				releaseId,
				JSON.stringify({ payload: { plugin_lock: pluginLock } }),
				activatedAt,
				activatedAt,
			),
	]);
	await prepareSuperBoardPluginLifecycleForRelease(db, {
		...releaseScope,
		release_id: releaseId,
		plugin_lock: pluginLock,
		prepared_at: activatedAt,
	});
	await db
		.prepare(
			`INSERT INTO superboard_front_active_releases
			 (instance_id, active_release_id, previous_release_id, pointer_revision,
			  activation_id, activated_at)
			 VALUES (?, ?, NULL, 1, ?, ?)
			 ON CONFLICT(instance_id) DO UPDATE SET
			   previous_release_id = superboard_front_active_releases.active_release_id,
			   active_release_id = excluded.active_release_id,
			   pointer_revision = superboard_front_active_releases.pointer_revision + 1,
			   activation_id = excluded.activation_id,
			   activated_at = excluded.activated_at`,
		)
		.bind(instanceId, releaseId, `${releaseId}-activation`, activatedAt)
		.run();
	return finalizeSuperBoardPluginLifecycleForRelease(db, {
		...releaseScope,
		release_id: releaseId,
		finalized_at: activatedAt,
	});
}

const releaseIdentifiers = {
	instance_id: "vocostar",
	front_draft_id: "01J00000000000000000000501",
	draft_snapshot_id: "01J00000000000000000000502",
	compilation_id: "01J00000000000000000000503",
	candidate_id: "01J00000000000000000000504",
	release_id: "01J00000000000000000000505",
	release_sequence: 1,
	previous_release_id: null,
	created_at: "2026-09-01T13:00:00.000Z",
};

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
