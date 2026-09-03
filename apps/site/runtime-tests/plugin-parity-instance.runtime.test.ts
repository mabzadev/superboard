import { REQUIRED_FRONT_STATES, resolveFrontRequest } from "@superboard/supbrd-core";
import { env } from "cloudflare:workers";
import { expect, test, vi } from "vitest";

import parityRelease from "../../../config/superboard-parity-release.json";
import { createConfiguredSuperBoardPlugin } from "../../../packages/supbrd-runtime-plugins/src/runtime.js";
import { nativeFrontPlugin as coreFrontPlugin } from "../src/front-plugins/emdash-core.js";
import {
	CORE_FRONT_RENDERER_DESCRIPTORS,
	CORE_STATE_RENDERER_IDS,
} from "../src/lib/core-front-contract.js";
import {
	beginRepositoryCommand,
	completeRepositoryCommand,
} from "../src/lib/plugin-command-authority.js";
import {
	importPluginStoreEncryptionKey,
	listPluginStoreRecords,
	putPluginStoreRecord,
} from "../src/lib/plugin-store-repository.js";
import {
	finalizeSuperBoardPluginLifecycleForRelease,
	installSuperBoardPluginCatalog,
	loadActiveSuperBoardPluginLock,
	loadReleasableSuperBoardPluginLock,
	prepareSuperBoardPluginLifecycleForRelease,
	superBoardRuntimePluginCatalog,
	transitionSuperBoardPluginLifecycle,
} from "../src/lib/superboard-plugin-catalog.js";
import { GET as queryDataSource } from "../src/pages/_superboard/api/plugins/[pluginId]/data-sources/[dataSourceId].js";
import { GET as siteHealth } from "../src/pages/_superboard/health.js";

const encodedEncryptionKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const instanceId = "vocostar";
const target = "local" as const;
const projectRef = "1-test";
const checkedAt = "2026-09-03T08:05:00.000Z";

test("exercises every active plugin contribution in a migrated Instance", async () => {
	const activeIds = parityRelease.active_plugin_ids;
	const catalog = superBoardRuntimePluginCatalog().plugins.filter(({ manifest }) =>
		activeIds.includes(manifest.plugin_id),
	);
	expect(catalog.map(({ manifest }) => manifest.plugin_id).toSorted()).toEqual(activeIds);
	await env.DB.prepare(
		`CREATE TABLE IF NOT EXISTS _plugin_state (
			  plugin_id TEXT PRIMARY KEY,
			  version TEXT NOT NULL,
			  status TEXT NOT NULL DEFAULT 'installed',
			  installed_at TEXT,
			  activated_at TEXT,
			  deactivated_at TEXT,
			  source TEXT NOT NULL DEFAULT 'config'
			)`,
	).run();
	const scope = {
		instance_id: instanceId,
		target,
		target_artifact_checksum: parityRelease.target_artifact_checksum,
		target_plugin_ids: activeIds,
	};
	const plan = await installSuperBoardPluginCatalog(env.DB, {
		...scope,
		plan_id: "issue-70-parity-plan",
		approved_by: "operator-1",
		checked_at: checkedAt,
		expires_at: "2999-09-04T08:05:00.000Z",
	});
	expect(plan.plugin_count).toBe(activeIds.length);
	await expect(loadActiveSuperBoardPluginLock(env.DB, scope)).rejects.toThrow(
		"PLUGIN_CATALOG_ACTIVE_SET_EMPTY",
	);
	const implicitActive = await env.DB.prepare(
		`SELECT COUNT(*) count FROM superboard_plugin_lifecycle
			 WHERE instance_id = ? AND target = ? AND state = 'active'`,
	)
		.bind(instanceId, target)
		.first<{ count: number }>();
	expect(implicitActive?.count).toBe(0);

	const pluginLock = await loadReleasableSuperBoardPluginLock(env.DB, scope);
	await activatePluginRelease(
		env.DB,
		scope,
		parityRelease.release.payload.release_id,
		pluginLock,
		checkedAt,
	);
	expect(await loadActiveSuperBoardPluginLock(env.DB, scope)).toEqual(pluginLock);
	const encryptionKey = await importPluginStoreEncryptionKey(encodedEncryptionKey);
	const kv = { get: vi.fn(async () => null) };
	let storeIndex = 0;
	let commandIndex = 0;

	for (const { manifest } of catalog) {
		const plugin = createConfiguredSuperBoardPlugin(manifest.plugin_id);
		const contract = await plugin.routes.contract.handler({} as never);
		const health = await plugin.routes.health.handler({ kv } as never);
		const commands = await plugin.routes["commands/catalog"].handler({} as never);
		const dataSources = await plugin.routes["data-sources/catalog"].handler({} as never);
		expect(contract).toMatchObject({
			plugin_id: manifest.plugin_id,
			artifact_checksum: manifest.artifact_checksum,
		});
		expect(health).toMatchObject({ status: "ready" });
		expect(commands).toEqual({ items: manifest.commands });
		expect(dataSources).toEqual({ items: manifest.data_sources });

		for (const store of manifest.stores) {
			storeIndex += 1;
			const stored = await putPluginStoreRecord(env.DB, {
				plugin_id: manifest.plugin_id,
				store_id: store.store_id,
				instance_id: instanceId,
				target,
				project_ref: projectRef,
				entity_type: "parity",
				entity_id: `record-${storeIndex}`,
				expected_revision: null,
				operation_id: `issue-70-store-${storeIndex}`,
				payload: { plugin_id: manifest.plugin_id, store_id: store.store_id },
				updated_at: checkedAt,
				encryption_key: encryptionKey,
			});
			expect(stored).toMatchObject({ revision: 1, idempotent: false });
			const page = await listPluginStoreRecords(env.DB, {
				plugin_id: manifest.plugin_id,
				store_id: store.store_id,
				instance_id: instanceId,
				project_ref: projectRef,
				entity_type: "parity",
				encryption_key: encryptionKey,
			});
			expect(page.items).toHaveLength(1);
		}

		for (const dataSource of manifest.data_sources) {
			const url = new URL(
				`https://site.example/_emdash/api/plugins/${manifest.plugin_id}/data-sources/${dataSource.data_source_id}?project_ref=${projectRef}&entity_type=parity`,
			);
			const response = await queryDataSource({
				locals: { user: { role: 50 } },
				params: {
					pluginId: manifest.plugin_id,
					dataSourceId: dataSource.data_source_id,
				},
				request: new Request(url),
				url,
			} as Parameters<typeof queryDataSource>[0]);
			expect(response.status, dataSource.data_source_id).toBe(200);
			expect(await response.json()).toMatchObject({
				plugin_id: manifest.plugin_id,
				data_source_id: dataSource.data_source_id,
				store_id: dataSource.store_id,
				items: expect.any(Array),
			});
		}

		for (const command of manifest.commands) {
			commandIndex += 1;
			const operationId = `issue-70-command-${commandIndex}`;
			const requestBody = new TextEncoder().encode(
				JSON.stringify({ command_id: command.command_id }),
			);
			const input = {
				operation_id: operationId,
				instance_id: instanceId,
				target,
				project_ref: projectRef,
				plugin_id: manifest.plugin_id,
				command_id: command.command_id,
				adapter_operation: "parity-gate",
				method: "POST" as const,
				request_path: `/api/v1/parity/${commandIndex}`,
				request_body: requestBody,
				accepted_at: checkedAt,
				encryption_key: encryptionKey,
			};
			expect(await beginRepositoryCommand(env.DB, input)).toMatchObject({
				status: "accepted",
			});
			await completeRepositoryCommand(env.DB, {
				operation_id: operationId,
				response: Response.json({ command_id: command.command_id }),
				completed_at: checkedAt,
				encryption_key: encryptionKey,
			});
			expect(await beginRepositoryCommand(env.DB, input)).toMatchObject({ status: "replay" });
		}
	}

	const runtimeHealth = await env.DB.prepare(
		`SELECT plugin_id, status FROM superboard_plugin_runtime_health
			 WHERE instance_id = ? AND target = ? ORDER BY plugin_id`,
	)
		.bind(instanceId, target)
		.all<{ plugin_id: string; status: string }>();
	expect(runtimeHealth.results).toHaveLength(activeIds.length);
	expect(runtimeHealth.results.every(({ status }) => status === "ready")).toBe(true);
	const healthResponse = await siteHealth({} as never);
	expect(healthResponse.status).toBe(200);
	expect(await healthResponse.json()).toEqual({
		status: "ok",
		service: "superboard-site",
		schema_version: 1,
	});

	const dependencyHealth = Object.fromEntries(
		parityRelease.release.payload.dependency_policies.map(({ dependency_id: id }) => [
			id,
			"ready" as const,
		]),
	);
	const permissions = parityRelease.release.payload.front_route_manifest.routes
		.map(({ permission_expression: permission }) => permission)
		.filter((permission) => permission !== "allow");
	for (const route of parityRelease.release.payload.front_route_manifest.routes) {
		const path = route.path_pattern
			.replaceAll(/:lang/gu, "en")
			.replaceAll(/:[^/]+/gu, "parity-id")
			.replaceAll(/\*[^/]+/gu, "parity/path");
		const resolution = resolveFrontRequest({
			last_verified_release: {
				front_route_manifest: parityRelease.release.payload.front_route_manifest,
				dependency_policies: parityRelease.release.payload.dependency_policies,
			},
			requested_path: path,
			admin_session: route.auth_policy === "anonymous_only" ? "absent" : "valid",
			permissions,
			dependency_health: dependencyHealth,
		});
		expect(resolution.result, route.route_id).toBe("rendered");
	}
	for (const state of REQUIRED_FRONT_STATES) {
		const rendererId = CORE_STATE_RENDERER_IDS[state];
		const renderer = CORE_FRONT_RENDERER_DESCRIPTORS.find(
			({ renderer_id: candidate }) => candidate === rendererId,
		);
		if (!renderer) throw new Error(`Missing state renderer: ${state}`);
		expect(
			coreFrontPlugin.mount_renderer({
				renderer,
				route_id: null,
				path: "/parity-state",
				view_title: null,
				parameters: {},
				operator: null,
			}),
		).toMatchObject({ kind: "state", state });
	}

	const quarantinedPlugin = catalog.find(
		({ manifest }) => manifest.plugin_id === "supbrd-plugmod-analytics",
	)?.manifest;
	if (!quarantinedPlugin) throw new Error("Missing Analytics plugin");
	await transitionSuperBoardPluginLifecycle(env.DB, {
		instance_id: instanceId,
		target,
		plugin_id: quarantinedPlugin.plugin_id,
		to_state: "quarantined",
		changed_at: "2026-09-03T08:06:00.000Z",
		reason: "parity failure-state exercise",
	});
	await expect(
		beginRepositoryCommand(env.DB, {
			operation_id: "issue-70-quarantined-command",
			instance_id: instanceId,
			target,
			project_ref: projectRef,
			plugin_id: quarantinedPlugin.plugin_id,
			command_id: quarantinedPlugin.commands[0]!.command_id,
			adapter_operation: "parity-gate",
			method: "POST",
			request_path: "/api/v1/parity/quarantined",
			request_body: new Uint8Array(),
			accepted_at: "2026-09-03T08:06:00.000Z",
			encryption_key: encryptionKey,
		}),
	).rejects.toThrow("PLUGIN_MANIFEST_NOT_ACTIVE");
}, 60_000);

async function activatePluginRelease(
	db: D1Database,
	scope: {
		instance_id: string;
		target: "local" | "development" | "production";
		target_artifact_checksum: string;
	},
	releaseId: string,
	pluginLock: Parameters<typeof prepareSuperBoardPluginLifecycleForRelease>[1]["plugin_lock"],
	activatedAt: string,
) {
	await db.batch([
		db
			.prepare(
				`INSERT INTO superboard_release_signing_keys
				 (kid, public_jwk, status, created_at, retired_at)
				 VALUES ('issue-70-parity-key', '{}', 'active', ?, NULL)
				 ON CONFLICT(kid) DO NOTHING`,
			)
			.bind(activatedAt),
		db
			.prepare(
				`INSERT INTO superboard_front_release_candidates
				 (candidate_id, instance_id, release_id, release_json, content_checksum,
				  validation_set_checksum, signing_kid, status, approval_json, created_at, approved_at)
				 VALUES (?, ?, ?, ?, 'sha256:issue-70', 'sha256:issue-70',
				         'issue-70-parity-key', 'approved', '{}', ?, ?)`,
			)
			.bind(
				`${releaseId}-candidate`,
				scope.instance_id,
				releaseId,
				JSON.stringify({ payload: { plugin_lock: pluginLock } }),
				activatedAt,
				activatedAt,
			),
	]);
	await prepareSuperBoardPluginLifecycleForRelease(db, {
		...scope,
		release_id: releaseId,
		plugin_lock: pluginLock,
		prepared_at: activatedAt,
	});
	await db
		.prepare(
			`INSERT INTO superboard_front_active_releases
			 (instance_id, active_release_id, previous_release_id, pointer_revision,
			  activation_id, activated_at)
			 VALUES (?, ?, NULL, 1, ?, ?)`,
		)
		.bind(scope.instance_id, releaseId, `${releaseId}-activation`, activatedAt)
		.run();
	return finalizeSuperBoardPluginLifecycleForRelease(db, {
		...scope,
		release_id: releaseId,
		finalized_at: activatedAt,
	});
}
