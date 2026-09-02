import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";

import {
	activateSuperBoardPluginInstallationPlan,
	installSuperBoardPluginCatalog,
	loadActiveSuperBoardPluginLock,
	superBoardRuntimePluginCatalog,
	transitionSuperBoardPluginLifecycle,
} from "../src/lib/superboard-plugin-catalog.js";
import { composeUserFrontReleaseInput } from "../src/lib/user-front-release.js";

const scope = {
	instance_id: "blank-instance",
	target: "development" as const,
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
		await expect(loadActiveSuperBoardPluginLock(env.DB, scope)).rejects.toThrow(
			"PLUGIN_CATALOG_ACTIVE_SET_EMPTY",
		);
		const installedStates = await env.DB.prepare(
			"SELECT COUNT(*) count FROM _plugin_state WHERE status = 'inactive'",
		).first<{ count: number }>();
		expect(installedStates?.count).toBe(18);

		const activation = await activateSuperBoardPluginInstallationPlan(env.DB, {
			...scope,
			plan_id: plan.plan_id,
			changed_at: "2026-09-02T08:05:00.000Z",
		});
		expect(activation).toMatchObject({ status: "active", plugin_count: 18 });
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
		const plan = await installSuperBoardPluginCatalog(env.DB, {
			...scope,
			plan_id: "plugin-plan-state-changes",
			checked_at: "2026-09-02T09:00:00.000Z",
			expires_at: "2026-09-03T09:00:00.000Z",
		});
		await activateSuperBoardPluginInstallationPlan(env.DB, {
			...scope,
			plan_id: plan.plan_id,
			changed_at: "2026-09-02T09:05:00.000Z",
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
			plugin_id: "supbrd-plugmod-marketing",
			to_state: "disabled",
			changed_at: "2026-09-02T09:11:00.000Z",
			reason: "drain complete",
		});
		await transitionSuperBoardPluginLifecycle(env.DB, {
			...scope,
			plugin_id: "supbrd-plugmod-analytics",
			to_state: "quarantined",
			changed_at: "2026-09-02T09:12:00.000Z",
			reason: "integrity violation",
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

		await expect(
			activateSuperBoardPluginInstallationPlan(env.DB, {
				instance_id: "tampered-instance",
				target: "production",
				plan_id: plan.plan_id,
				changed_at: "2026-09-02T10:05:00.000Z",
			}),
		).rejects.toThrow("PLUGIN_INSTALLATION_PLAN_CONTRACT_INVALID:supbrd-plug-user");
	});
});

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
