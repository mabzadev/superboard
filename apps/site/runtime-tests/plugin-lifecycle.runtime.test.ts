import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";

import {
	installSuperBoardPluginCatalog,
	reconcileSuperBoardPluginLifecycleForRelease,
	loadActiveSuperBoardPluginLock,
	loadReleasableSuperBoardPluginLock,
	superBoardRuntimePluginCatalog,
	transitionSuperBoardPluginLifecycle,
} from "../src/lib/superboard-plugin-catalog.js";
import { composeUserFrontReleaseInput } from "../src/lib/user-front-release.js";

const scope = {
	instance_id: "blank-instance",
	target: "development" as const,
	approved_by: "operator-1",
};

describe("SuperBoard plugin lifecycle", () => {
	test("installs all manifests through a plan before explicit activation", async () => {
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
		const plan = await installSuperBoardPluginCatalog(env.DB, {
			...scope,
			plan_id: "plugin-plan-blank-instance",
			checked_at: "2026-09-02T08:00:00.000Z",
			expires_at: "2026-09-03T08:00:00.000Z",
		});

		expect(superBoardRuntimePluginCatalog().plugins).toHaveLength(18);
		expect(plan).toMatchObject({
			status: "installed",
			plugin_count: 18,
			target: "development",
		});
		expect(plan.plugins).toHaveLength(18);
		expect(plan.plugins).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					plugin_id: "supbrd-plugmod-analytics",
					state: "installed",
					derived: expect.objectContaining({
						stores: expect.any(Array),
						capabilities: expect.any(Array),
						settings_checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
						contributions_checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
						worker_descriptor_checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
					}),
				}),
			]),
		);
		const steps = await env.DB.prepare(
			`SELECT COUNT(*) count FROM superboard_plugin_installation_steps
			 WHERE plan_id = ? AND status = 'completed'`,
		)
			.bind(plan.plan_id)
			.first<{ count: number }>();
		expect(steps?.count).toBe(18 * 8);
		await expect(loadActiveSuperBoardPluginLock(env.DB, scope)).rejects.toThrow(
			"PLUGIN_CATALOG_ACTIVE_SET_EMPTY",
		);
		const installedStates = await env.DB.prepare(
			"SELECT COUNT(*) count FROM _plugin_state WHERE status = 'inactive'",
		).first<{ count: number }>();
		expect(installedStates?.count).toBe(18);

		const candidateLock = await loadReleasableSuperBoardPluginLock(env.DB, scope);
		expect(candidateLock).toHaveLength(18);
		await activateReleasePointer(
			env.DB,
			scope.instance_id,
			"01J00000000000000000000405",
			candidateLock,
			"2026-09-02T08:05:00.000Z",
		);
		const activation = await reconcileSuperBoardPluginLifecycleForRelease(env.DB, {
			...scope,
			release_id: "01J00000000000000000000405",
			plugin_lock: candidateLock,
			activated_at: "2026-09-02T08:05:00.000Z",
		});
		expect(activation).toMatchObject({ status: "reconciled", plugin_count: 18 });
		const activeStates = await env.DB.prepare(
			"SELECT COUNT(*) count FROM _plugin_state WHERE status = 'active'",
		).first<{ count: number }>();
		expect(activeStates?.count).toBe(18);

		const fullLock = await loadActiveSuperBoardPluginLock(env.DB, scope);
		expect(fullLock).toHaveLength(18);
		const presentation = await composeUserFrontReleaseInput({
			...releaseIdentifiers,
			plugin_lock: fullLock,
		});
		expect(
			presentation.front_route_manifest.routes.some(
				({ path_pattern: path }) => path === "/marketing/campaigns",
			),
		).toBe(true);
	});

	test("disabled and quarantined states remove contributions without changing the catalog", async () => {
		await installSuperBoardPluginCatalog(env.DB, {
			...scope,
			plan_id: "plugin-plan-state-changes",
			checked_at: "2026-09-02T09:00:00.000Z",
			expires_at: "2026-09-03T09:00:00.000Z",
		});
		const initialLock = await loadReleasableSuperBoardPluginLock(env.DB, scope);
		await activateReleasePointer(
			env.DB,
			scope.instance_id,
			"01J00000000000000000000415",
			initialLock,
			"2026-09-02T09:05:00.000Z",
		);
		await reconcileSuperBoardPluginLifecycleForRelease(env.DB, {
			...scope,
			release_id: "01J00000000000000000000415",
			plugin_lock: initialLock,
			activated_at: "2026-09-02T09:05:00.000Z",
		});

		await transitionSuperBoardPluginLifecycle(env.DB, {
			...scope,
			plugin_id: "supbrd-plugmod-marketing",
			to_state: "draining",
			changed_at: "2026-09-02T09:10:00.000Z",
			reason: "operator disable",
		});
		await transitionSuperBoardPluginLifecycle(env.DB, {
			...scope,
			plugin_id: "supbrd-plugmod-analytics",
			to_state: "quarantined",
			changed_at: "2026-09-02T09:12:00.000Z",
			reason: "integrity violation",
		});

		const reducedCandidateLock = await loadReleasableSuperBoardPluginLock(env.DB, scope);
		expect(reducedCandidateLock).toHaveLength(16);
		await activateReleasePointer(
			env.DB,
			scope.instance_id,
			"01J00000000000000000000425",
			reducedCandidateLock,
			"2026-09-02T09:15:00.000Z",
		);
		await reconcileSuperBoardPluginLifecycleForRelease(env.DB, {
			...scope,
			release_id: "01J00000000000000000000425",
			plugin_lock: reducedCandidateLock,
			activated_at: "2026-09-02T09:15:00.000Z",
		});
		const reducedLock = await loadActiveSuperBoardPluginLock(env.DB, scope);
		expect(reducedLock).toHaveLength(16);
		expect(superBoardRuntimePluginCatalog().plugins).toHaveLength(18);
		const presentation = await composeUserFrontReleaseInput({
			...releaseIdentifiers,
			plugin_lock: reducedLock,
		});
		expect(
			presentation.front_route_manifest.routes.some(
				({ path_pattern: path }) => path === "/marketing/campaigns",
			),
		).toBe(false);
		expect(
			presentation.front_route_manifest.routes.some(
				({ path_pattern: path }) => path === "/analytics/reports",
			),
		).toBe(false);
	});

	test("rejects an installation plan whose derived contract was modified", async () => {
		const plan = await installSuperBoardPluginCatalog(env.DB, {
			instance_id: "tampered-instance",
			target: "production",
			approved_by: "operator-1",
			plan_id: "plugin-plan-tampered-contract",
			checked_at: "2026-09-02T10:00:00.000Z",
			expires_at: "2026-09-03T10:00:00.000Z",
		});
		await env.DB.prepare(
			`UPDATE superboard_plugin_installation_items
			 SET derived_contract_json = json_set(derived_contract_json, '$.settings_checksum', ?)
			 WHERE plan_id = ? AND plugin_id = 'supbrd-plug-user'`,
		)
			.bind(`sha256:${"f".repeat(64)}`, plan.plan_id)
			.run();
		const tamperedLock = plan.plugins.map(({ derived }) => derived.plugin_lock);
		await activateReleasePointer(
			env.DB,
			"tampered-instance",
			"01J00000000000000000000435",
			tamperedLock,
			"2026-09-02T10:05:00.000Z",
		);

		await expect(
			reconcileSuperBoardPluginLifecycleForRelease(env.DB, {
				instance_id: "tampered-instance",
				target: "production",
				release_id: "01J00000000000000000000435",
				plugin_lock: tamperedLock,
				activated_at: "2026-09-02T10:05:00.000Z",
			}),
		).rejects.toThrow("PLUGIN_INSTALLATION_PLAN_CONTRACT_INVALID:supbrd-plug-user");
	});

	test("cannot activate plugins before the corresponding Front Release is active", async () => {
		const inactiveScope = {
			instance_id: "release-gated-instance",
			target: "local" as const,
			approved_by: "operator-1",
		};
		await installSuperBoardPluginCatalog(env.DB, {
			...inactiveScope,
			plan_id: "plugin-plan-release-gated",
			checked_at: "2026-09-02T11:00:00.000Z",
			expires_at: "2026-09-03T11:00:00.000Z",
		});
		const lock = await loadReleasableSuperBoardPluginLock(env.DB, inactiveScope);
		await expect(
			reconcileSuperBoardPluginLifecycleForRelease(env.DB, {
				...inactiveScope,
				release_id: "01J00000000000000000000445",
				plugin_lock: lock,
				activated_at: "2026-09-02T11:05:00.000Z",
			}),
		).rejects.toThrow("PLUGIN_RELEASE_NOT_ACTIVE");
	});
});

async function activateReleasePointer(
	db: D1Database,
	instanceId: string,
	releaseId: string,
	pluginLock: readonly unknown[],
	activatedAt: string,
) {
	const candidateId = `${releaseId}-candidate`;
	await db.batch([
		db
			.prepare(
				`INSERT INTO superboard_release_signing_keys
				 (kid, public_jwk, status, created_at, retired_at)
				 VALUES ('plugin-lifecycle-test-key', '{}', 'active', ?, NULL)
				 ON CONFLICT(kid) DO NOTHING`,
			)
			.bind(activatedAt),
		db
			.prepare(
				`INSERT INTO superboard_front_release_candidates
				 (candidate_id, instance_id, release_id, release_json, content_checksum,
				  validation_set_checksum, signing_kid, status, approval_json, created_at, approved_at)
				 VALUES (?, ?, ?, ?, 'sha256:test', 'sha256:test',
				         'plugin-lifecycle-test-key', 'approved', '{}', ?, ?)`,
			)
			.bind(
				candidateId,
				instanceId,
				releaseId,
				JSON.stringify({ payload: { plugin_lock: pluginLock } }),
				activatedAt,
				activatedAt,
			),
		db
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
			.bind(instanceId, releaseId, `${releaseId}-activation`, activatedAt),
	]);
}

const releaseIdentifiers = {
	instance_id: scope.instance_id,
	front_draft_id: "01J00000000000000000000401",
	draft_snapshot_id: "01J00000000000000000000402",
	compilation_id: "01J00000000000000000000403",
	candidate_id: "01J00000000000000000000404",
	release_id: "01J00000000000000000000405",
	release_sequence: 1,
	previous_release_id: null,
	created_at: "2026-09-02T08:10:00.000Z",
};
