import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";

import {
	finalizeSuperBoardPluginLifecycleForRelease,
	installSuperBoardPluginCatalog,
	loadActiveSuperBoardPluginLock,
	loadActiveSuperBoardPluginIdsRequiringValidation,
	loadReleasableSuperBoardPluginLock,
	loadSelectedSuperBoardPluginLock,
	prepareSuperBoardPluginLifecycleForRelease,
	superBoardRuntimePluginCatalog,
	transitionSuperBoardPluginLifecycle,
} from "../src/lib/superboard-plugin-catalog.js";
import { composeUserFrontReleaseInput } from "../src/lib/user-front-release.js";

const targetProof = {
	target_artifact_checksum: `sha256:${"1".repeat(64)}`,
	target_plugin_ids: superBoardRuntimePluginCatalog().plugins.map(
		({ manifest }) => manifest.plugin_id,
	),
};
const scope = {
	...targetProof,
	instance_id: "blank-instance",
	target: "development" as const,
	approved_by: "operator-1",
};

describe("SuperBoard plugin lifecycle", () => {
	test("revalidates unchanged active plugins when the target gains additional plugins", async () => {
		const oldTarget = {
			instance_id: "expanded-target-instance",
			target: "local" as const,
			approved_by: "operator-1",
			target_artifact_checksum: `sha256:${"7".repeat(64)}`,
			target_plugin_ids: ["supbrd-plug-user"],
			checked_at: "2026-09-05T08:00:00.000Z",
			expires_at: "2999-09-05T08:00:00.000Z",
		};
		await installSuperBoardPluginCatalog(env.DB, {
			...oldTarget,
			plan_id: "plugin-plan-before-expansion",
		});
		const oldLock = await loadReleasableSuperBoardPluginLock(env.DB, oldTarget);
		const previousReleaseId = "01J00000000000000000000470";
		await activatePluginRelease(
			env.DB,
			oldTarget,
			previousReleaseId,
			oldLock,
			oldTarget.checked_at,
		);
		const addedPluginIds = ["supbrd-plugmod-paywalls", "supbrd-plugmod-onboardings"];
		const expandedTarget = {
			...oldTarget,
			target_artifact_checksum: `sha256:${"8".repeat(64)}`,
			target_plugin_ids: [...oldTarget.target_plugin_ids, ...addedPluginIds],
			checked_at: "2026-09-05T08:10:00.000Z",
		};
		expect(await loadActiveSuperBoardPluginIdsRequiringValidation(env.DB, expandedTarget)).toEqual([
			"supbrd-plug-user",
		]);
		await installSuperBoardPluginCatalog(env.DB, {
			...expandedTarget,
			plan_id: "plugin-plan-after-expansion",
		});
		const lock = await loadSelectedSuperBoardPluginLock(env.DB, expandedTarget, addedPluginIds);
		expect(lock.map(({ plugin_id }) => plugin_id).toSorted()).toEqual([
			"supbrd-plug-user",
			"supbrd-plugmod-onboardings",
			"supbrd-plugmod-paywalls",
		]);
		const active = await env.DB.prepare(
			`SELECT state, activated_release_id FROM superboard_plugin_lifecycle
			 WHERE instance_id = ? AND target = 'local' AND plugin_id = 'supbrd-plug-user'`,
		)
			.bind(oldTarget.instance_id)
			.first();
		expect(active).toMatchObject({ state: "active", activated_release_id: previousReleaseId });
	});

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
			expires_at: "2999-09-03T08:00:00.000Z",
		});

		expect(superBoardRuntimePluginCatalog().plugins).toHaveLength(18);
		expect(plan).toMatchObject({
			status: "installed",
			plugin_count: 18,
			target: "development",
			target_artifact_checksum: targetProof.target_artifact_checksum,
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
		const activation = await activatePluginRelease(
			env.DB,
			scope,
			"01J00000000000000000000405",
			candidateLock,
			"2026-09-02T08:05:00.000Z",
		);
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
			expires_at: "2999-09-03T09:00:00.000Z",
		});
		const initialLock = await loadReleasableSuperBoardPluginLock(env.DB, scope);
		await activatePluginRelease(
			env.DB,
			scope,
			"01J00000000000000000000415",
			initialLock,
			"2026-09-02T09:05:00.000Z",
		);
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
		await activatePluginRelease(
			env.DB,
			scope,
			"01J00000000000000000000425",
			reducedCandidateLock,
			"2026-09-02T09:15:00.000Z",
		);
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
			...targetProof,
			instance_id: "tampered-instance",
			target: "production",
			approved_by: "operator-1",
			plan_id: "plugin-plan-tampered-contract",
			checked_at: "2026-09-02T10:00:00.000Z",
			expires_at: "2999-09-03T10:00:00.000Z",
		});
		await env.DB.prepare(
			`UPDATE superboard_plugin_installation_items
			 SET derived_contract_json = json_set(derived_contract_json, '$.settings_checksum', ?)
			 WHERE plan_id = ? AND plugin_id = 'supbrd-plug-user'`,
		)
			.bind(`sha256:${"f".repeat(64)}`, plan.plan_id)
			.run();
		const tamperedLock = plan.plugins.map(({ derived }) => derived.plugin_lock);
		await stageReleaseCandidate(
			env.DB,
			"tampered-instance",
			"01J00000000000000000000435",
			tamperedLock,
			"2026-09-02T10:05:00.000Z",
		);

		await expect(
			prepareSuperBoardPluginLifecycleForRelease(env.DB, {
				instance_id: "tampered-instance",
				target: "production",
				release_id: "01J00000000000000000000435",
				plugin_lock: tamperedLock,
				prepared_at: "2026-09-02T10:05:00.000Z",
			}),
		).rejects.toThrow("PLUGIN_INSTALLATION_PLAN_CONTRACT_INVALID:supbrd-plug-user");
	});

	test("cannot activate plugins before the corresponding Front Release is active", async () => {
		const inactiveScope = {
			...targetProof,
			instance_id: "release-gated-instance",
			target: "local" as const,
			approved_by: "operator-1",
		};
		await installSuperBoardPluginCatalog(env.DB, {
			...inactiveScope,
			plan_id: "plugin-plan-release-gated",
			checked_at: "2026-09-02T11:00:00.000Z",
			expires_at: "2999-09-03T11:00:00.000Z",
		});
		const lock = await loadReleasableSuperBoardPluginLock(env.DB, inactiveScope);
		await stageReleaseCandidate(
			env.DB,
			inactiveScope.instance_id,
			"01J00000000000000000000445",
			lock,
			"2026-09-02T11:05:00.000Z",
		);
		await expect(
			activateReleasePointer(
				env.DB,
				inactiveScope.instance_id,
				"01J00000000000000000000445",
				"2026-09-02T11:05:00.000Z",
			),
		).rejects.toThrow(/plugin lifecycle reconciliation is not prepared/u);
		await prepareSuperBoardPluginLifecycleForRelease(env.DB, {
			...inactiveScope,
			release_id: "01J00000000000000000000445",
			plugin_lock: lock,
			prepared_at: "2026-09-02T11:05:00.000Z",
		});
		await expect(
			finalizeSuperBoardPluginLifecycleForRelease(env.DB, {
				...inactiveScope,
				release_id: "01J00000000000000000000445",
				finalized_at: "2026-09-02T11:05:00.000Z",
			}),
		).rejects.toThrow("PLUGIN_RELEASE_RECONCILIATION_NOT_APPLIED");
	});

	test("rejects a Plugin Lock when its health evidence has expired", async () => {
		const expiredScope = {
			...targetProof,
			instance_id: "expired-health-instance",
			target: "local" as const,
			approved_by: "operator-1",
		};
		await installSuperBoardPluginCatalog(env.DB, {
			...expiredScope,
			plan_id: "plugin-plan-expired-health",
			checked_at: "2026-09-02T07:00:00.000Z",
			expires_at: "2026-09-02T07:01:00.000Z",
		});
		await expect(loadReleasableSuperBoardPluginLock(env.DB, expiredScope)).rejects.toThrow(
			/PLUGIN_CATALOG_HEALTH_NOT_READY/u,
		);
	});

	test("rejects a prepared Release when lifecycle changes before the pointer swap", async () => {
		const staleScope = {
			...targetProof,
			instance_id: "stale-preparation-instance",
			target: "development" as const,
			approved_by: "operator-1",
		};
		await installSuperBoardPluginCatalog(env.DB, {
			...staleScope,
			plan_id: "plugin-plan-stale-preparation",
			checked_at: "2026-09-02T12:00:00.000Z",
			expires_at: "2999-09-03T12:00:00.000Z",
		});
		const lock = await loadReleasableSuperBoardPluginLock(env.DB, staleScope);
		const releaseId = "01J00000000000000000000455";
		await stageReleaseCandidate(env.DB, staleScope.instance_id, releaseId, lock, staleScopeTime);
		await prepareSuperBoardPluginLifecycleForRelease(env.DB, {
			...staleScope,
			release_id: releaseId,
			plugin_lock: lock,
			prepared_at: staleScopeTime,
		});
		await transitionSuperBoardPluginLifecycle(env.DB, {
			...staleScope,
			plugin_id: "supbrd-plug-user",
			to_state: "quarantined",
			changed_at: "2026-09-02T12:01:00.000Z",
			reason: "integrity changed after preparation",
		});
		await expect(
			activateReleasePointer(env.DB, staleScope.instance_id, releaseId, staleScopeTime),
		).rejects.toThrow(/plugin lifecycle reconciliation is stale/u);
	});

	test("keeps plugins outside the compiled target available but not releasable", async () => {
		const targetPluginIds = targetProof.target_plugin_ids.filter(
			(pluginId) =>
				pluginId !== "supbrd-plugmod-paywalls" && pluginId !== "supbrd-plugmod-onboardings",
		);
		const targetScope = {
			instance_id: "feature-scoped-instance",
			target: "development" as const,
			approved_by: "operator-1",
			target_artifact_checksum: `sha256:${"2".repeat(64)}`,
			target_plugin_ids: targetPluginIds,
		};
		const plan = await installSuperBoardPluginCatalog(env.DB, {
			...targetScope,
			plan_id: "plugin-plan-feature-scoped",
			checked_at: "2026-09-02T13:00:00.000Z",
			expires_at: "2999-09-03T13:00:00.000Z",
		});
		expect(plan.plugin_count).toBe(16);
		expect(await loadReleasableSuperBoardPluginLock(env.DB, targetScope)).toHaveLength(16);
		const available = await env.DB.prepare(
			`SELECT COUNT(*) count FROM superboard_plugin_lifecycle
			 WHERE instance_id = ? AND target = ? AND state = 'available'`,
		)
			.bind(targetScope.instance_id, targetScope.target)
			.first<{ count: number }>();
		expect(available?.count).toBe(2);
		expect(superBoardRuntimePluginCatalog().plugins).toHaveLength(18);
	});
});

const staleScopeTime = "2026-09-02T12:05:00.000Z";

async function activatePluginRelease(
	db: D1Database,
	releaseScope: { instance_id: string; target: "local" | "development" | "production" },
	releaseId: string,
	pluginLock: Parameters<typeof prepareSuperBoardPluginLifecycleForRelease>[1]["plugin_lock"],
	activatedAt: string,
) {
	await stageReleaseCandidate(db, releaseScope.instance_id, releaseId, pluginLock, activatedAt);
	await prepareSuperBoardPluginLifecycleForRelease(db, {
		...releaseScope,
		release_id: releaseId,
		plugin_lock: pluginLock,
		prepared_at: activatedAt,
	});
	await activateReleasePointer(db, releaseScope.instance_id, releaseId, activatedAt);
	return finalizeSuperBoardPluginLifecycleForRelease(db, {
		...releaseScope,
		release_id: releaseId,
		finalized_at: activatedAt,
	});
}

async function stageReleaseCandidate(
	db: D1Database,
	instanceId: string,
	releaseId: string,
	pluginLock: Parameters<typeof prepareSuperBoardPluginLifecycleForRelease>[1]["plugin_lock"],
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
	]);
}

async function activateReleasePointer(
	db: D1Database,
	instanceId: string,
	releaseId: string,
	activatedAt: string,
) {
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
