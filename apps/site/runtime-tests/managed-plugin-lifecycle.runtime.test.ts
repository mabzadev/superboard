import {
	pluginPackage,
	pluginPackageOwner,
	pluginPackages,
} from "@superboard/contracts/plugin-packages";
import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, expect, test } from "vitest";

import { loadFrontPreview } from "../src/lib/front-workflow-repository.js";
import {
	beginManagedPluginOperation,
	snapshotManagedPluginOperation,
	restoreManagedPluginOperation,
} from "../src/lib/managed-plugin-operation.js";
import {
	beginRepositoryCommand,
	completeRepositoryCommand,
} from "../src/lib/plugin-command-authority.js";
import {
	importPluginStoreEncryptionKey,
	putPluginStoreRecord,
} from "../src/lib/plugin-store-repository.js";
import { loadLastVerifiedFrontRelease } from "../src/lib/release-source.js";
import { transitionSuperBoardPluginLifecycle } from "../src/lib/superboard-plugin-catalog.js";

const headers = {
	Origin: "https://site.example",
	"X-EmDash-Request": "1",
	"X-Parity-Operator": "1",
};
const plugin = "supbrd-plug-user";

function action(pluginId: string, name: string) {
	return SELF.fetch(`https://site.example/_emdash/api/superboard/plugins/${pluginId}/${name}`, {
		method: "POST",
		headers,
	});
}

beforeEach(async () => {
	const active = await env.DB.prepare(
		"SELECT plugin_id FROM superboard_plugin_lifecycle WHERE state = 'active'",
	).all<{ plugin_id: string }>();
	for (const id of new Set(active.results.map((row) => pluginPackageOwner(row.plugin_id)))) {
		if (id === "supbrd-core") continue;
		const response = await action(id, "disable");
		expect(response.ok, await response.clone().text()).toBe(true);
	}
});
afterEach(async () => {
	await env.DB.exec("DROP TRIGGER IF EXISTS reject_test_activation;");
});

test("native package controls retain the Arabic admin locale", async () => {
	const response = await SELF.fetch(
		"https://site.example/_emdash/api/plugins/supbrd-plug-journeys/admin",
		{
			method: "POST",
			headers: { ...headers, "Content-Type": "application/json", "Accept-Language": "ar" },
			body: JSON.stringify({ type: "page_load", page: "/" }),
		},
	);
	expect(response.status, await response.clone().text()).toBe(200);
	const body = await response.json<{
		data: { blocks: Array<{ type: string; elements?: Array<{ label: string }> }> };
	}>();
	expect(
		body.data.blocks
			.filter((block) => block.type === "actions")
			.flatMap((block) => block.elements?.map((element) => element.label) ?? []),
	).toEqual(["تفعيل", "تفعيل"]);
});

test("a function disabled through the native package page stays disabled after re-enabling its package", async () => {
	const owner = "supbrd-plug-journeys";
	const flows = "supbrd-plugmod-flows";
	const enabled = await action(owner, "enable");
	expect(enabled.status, await enabled.clone().text()).toBe(201);
	const previousPreference = await env.DB.prepare(
		"SELECT enabled FROM superboard_plugin_feature_preferences WHERE instance_id='reference-production' AND target='local' AND component_id=?",
	)
		.bind(flows)
		.first<{ enabled: number }>();
	try {
		const changed = await SELF.fetch(`https://site.example/_emdash/api/plugins/${owner}/admin`, {
			method: "POST",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify({ type: "block_action", action_id: `package-feature:${flows}:disable` }),
		});
		expect(changed.status, await changed.clone().text()).toBe(200);
		expect((await action(owner, "disable")).status).toBe(201);
		expect((await action(owner, "enable")).status).toBe(201);
		const states = await env.DB.prepare(
			"SELECT plugin_id,state FROM superboard_plugin_lifecycle WHERE instance_id='reference-production' AND target='local' AND plugin_id IN ('supbrd-plugmod-flows','supbrd-plugmod-onboardings') ORDER BY plugin_id",
		).all();
		expect(states.results).toEqual([
			{ plugin_id: flows, state: "disabled" },
			{ plugin_id: "supbrd-plugmod-onboardings", state: "active" },
		]);
	} finally {
		await env.DB.prepare(
			"UPDATE superboard_plugin_feature_preferences SET enabled=? WHERE instance_id='reference-production' AND target='local' AND component_id=?",
		)
			.bind(previousPreference?.enabled ?? 1, flows)
			.run();
	}
});

async function lifecycle() {
	return env.DB.prepare(
		"SELECT plugin_id, artifact_checksum, state, plan_id, activated_release_id, state_changed_at, reason FROM superboard_plugin_lifecycle WHERE instance_id = 'reference-production' ORDER BY plugin_id",
	).all();
}

test("repeated activation and disable keep the same Release", async () => {
	expect((await action(plugin, "enable")).status).toBe(201);
	const before = await env.DB.prepare("SELECT * FROM superboard_front_active_releases").all();
	const repeated = await action(plugin, "enable");
	expect(repeated.status, await repeated.clone().text()).toBe(200);
	expect(
		await env.DB.prepare("SELECT * FROM superboard_front_active_releases").all(),
	).toMatchObject({ results: before.results });
	expect((await action(plugin, "disable")).status).toBe(201);
	expect((await action(plugin, "disable")).status).toBe(200);
});

test("failed activation restores lifecycle and health exactly", async () => {
	expect((await action(plugin, "enable")).status).toBe(201);
	const before = await lifecycle();
	const health = await env.DB.prepare(
		"SELECT * FROM superboard_plugin_runtime_health ORDER BY plugin_id",
	).all();
	const dependency = await env.DB.prepare(
		"SELECT * FROM superboard_dependency_health ORDER BY dependency_id",
	).all();
	const pointer = await env.DB.prepare("SELECT * FROM superboard_front_active_releases").all();
	await env.DB.exec(
		"CREATE TRIGGER reject_test_activation BEFORE UPDATE ON superboard_front_active_releases BEGIN SELECT RAISE(ABORT, 'injected activation failure'); END;",
	);
	const result = await action(plugin, "disable");
	expect(result.status).toBeGreaterThanOrEqual(400);
	expect(await lifecycle()).toMatchObject({ results: before.results });
	expect(
		await env.DB.prepare("SELECT * FROM superboard_plugin_runtime_health ORDER BY plugin_id").all(),
	).toMatchObject({ results: health.results });
	expect(
		await env.DB.prepare("SELECT * FROM superboard_dependency_health ORDER BY dependency_id").all(),
	).toMatchObject({
		results: dependency.results,
	});
	expect(
		await env.DB.prepare("SELECT * FROM superboard_front_active_releases").all(),
	).toMatchObject({ results: pointer.results });
	await env.DB.exec("DROP TRIGGER reject_test_activation;");
	expect((await action(plugin, "disable")).status).toBe(201);
});

test("concurrent plugin changes cannot overwrite another completed activation", async () => {
	const results = await Promise.all([
		action(plugin, "enable"),
		action("supbrd-plug-products", "enable"),
	]);
	for (const [index, result] of results.entries()) {
		if (result.status === 409)
			expect((await action(index === 0 ? plugin : "supbrd-plug-products", "enable")).status).toBe(
				201,
			);
		else expect(result.status, await result.clone().text()).toBe(201);
	}
	const active = await env.DB.prepare(
		"SELECT plugin_id FROM superboard_plugin_lifecycle WHERE state = 'active' ORDER BY plugin_id",
	).all();
	expect(active.results).toEqual(
		[
			"supbrd-plug-products",
			"supbrd-plug-user",
			"supbrd-plugmod-billing",
			"supbrd-plugmod-paywalls",
		]
			.toSorted()
			.map((plugin_id) => ({ plugin_id })),
	);
});

test.each([
	[
		"snapshot",
		"CREATE TRIGGER reject_test_activation BEFORE INSERT ON superboard_front_draft_snapshots BEGIN SELECT RAISE(ABORT, 'injected snapshot failure'); END;",
	],
	[
		"compilation",
		"CREATE TRIGGER reject_test_activation BEFORE INSERT ON superboard_front_compilations BEGIN SELECT RAISE(ABORT, 'injected compilation failure'); END;",
	],
	[
		"approval",
		"CREATE TRIGGER reject_test_activation BEFORE UPDATE ON superboard_front_release_candidates WHEN NEW.status = 'approved' BEGIN SELECT RAISE(ABORT, 'injected approval failure'); END;",
	],
] as const)(
	"a failure during %s preserves active views, proofs and custom data",
	async (_stage, trigger) => {
		expect((await action(plugin, "enable")).status).toBe(201);
		await putPluginStoreRecord(env.DB, {
			instance_id: "reference-production",
			target: "local",
			plugin_id: plugin,
			store_id: `${plugin}.store.user_directory`,
			project_ref: "1-prod",
			entity_type: "settings",
			entity_id: `failure-customization-${_stage}`,
			expected_revision: null,
			operation_id: crypto.randomUUID(),
			updated_at: new Date().toISOString(),
			encryption_key: await importPluginStoreEncryptionKey(
				env.SUPERBOARD_PLUGIN_STORE_ENCRYPTION_KEY,
			),
			payload: { name: "Operator customization" },
		});
		const url = `https://site.example/_emdash/api/superboard/plugins/${plugin}/data-sources/current_profile?project_ref=1-prod`;
		const data = await SELF.fetch(url, { headers });
		expect(data.status).toBe(200);
		const saved = await data.json();
		const state = await lifecycle();
		const health = await env.DB.prepare(
			"SELECT * FROM superboard_plugin_runtime_health ORDER BY plugin_id",
		).all();
		const pointer = await env.DB.prepare("SELECT * FROM superboard_front_active_releases").all();
		await env.DB.exec(trigger);
		try {
			const failed = await action("supbrd-plug-products", "enable");
			expect(failed.status).toBeGreaterThanOrEqual(400);
			expect((await lifecycle()).results).toEqual(state.results);
			expect(
				(
					await env.DB.prepare(
						"SELECT * FROM superboard_plugin_runtime_health ORDER BY plugin_id",
					).all()
				).results,
			).toEqual(health.results);
			expect(
				(await env.DB.prepare("SELECT * FROM superboard_front_active_releases").all()).results,
			).toEqual(pointer.results);
			expect(await (await SELF.fetch(url, { headers })).json()).toEqual(saved);
		} finally {
			await env.DB.exec("DROP TRIGGER reject_test_activation;");
		}
		expect((await action("supbrd-plug-products", "enable")).status).toBe(201);
	},
);

test("inactive plugin data is unavailable with 404 and restored on reactivation", async () => {
	expect((await action(plugin, "enable")).status).toBe(201);
	await putPluginStoreRecord(env.DB, {
		plugin_id: plugin,
		store_id: `${plugin}.store.user_directory`,
		instance_id: "reference-production",
		target: "local",
		project_ref: "1-prod",
		entity_type: "settings",
		entity_id: "custom-setting",
		expected_revision: null,
		operation_id: crypto.randomUUID(),
		payload: { name: "Preserved customization" },
		updated_at: new Date().toISOString(),
		encryption_key: await importPluginStoreEncryptionKey(
			env.SUPERBOARD_PLUGIN_STORE_ENCRYPTION_KEY,
		),
	});
	const url = `https://site.example/_emdash/api/superboard/plugins/${plugin}/data-sources/current_profile?project_ref=1-prod`;
	const before = await SELF.fetch(url, { headers });
	expect(before.status).toBe(200);
	const saved = await before.json();
	expect((await action(plugin, "disable")).status).toBe(201);
	expect((await SELF.fetch(url, { headers })).status).toBe(404);
	expect((await action(plugin, "enable")).status).toBe(201);
	const after = await SELF.fetch(url, { headers });
	expect(after.status).toBe(200);
	expect(await after.json()).toEqual(saved);
});

test("recovers a drained plugin after the lifecycle worker restarts", async () => {
	expect((await action(plugin, "enable")).status).toBe(201);
	const before = await lifecycle();
	const started = await beginManagedPluginOperation(env.DB, {
		operation_id: crypto.randomUUID(),
		instance_id: "reference-production",
		target: "local",
		plugin_id: plugin,
		action: "disable",
	});
	if (!("operation" in started)) throw new Error("operation should acquire lock");
	await snapshotManagedPluginOperation(env.DB, started.operation, "interrupted-release");
	await transitionSuperBoardPluginLifecycle(env.DB, {
		instance_id: "reference-production",
		target: "local",
		plugin_id: plugin,
		to_state: "draining",
		changed_at: new Date().toISOString(),
		reason: "interruption test",
	});
	await env.DB.prepare(
		"UPDATE superboard_managed_plugin_operations SET expires_at = ? WHERE operation_id = ?",
	)
		.bind(new Date(Date.now() - 1000).toISOString(), started.operation.operation_id)
		.run();
	const resumed = await action(plugin, "enable");
	expect(resumed.status, await resumed.clone().text()).toBe(200);
	expect(await lifecycle()).toMatchObject({ results: before.results });
});

test("replays an idempotency key and rejects reuse for another plugin", async () => {
	const replayHeaders = { ...headers, "Idempotency-Key": crypto.randomUUID() };
	const url = `https://site.example/_emdash/api/superboard/plugins/${plugin}/enable`;
	const first = await SELF.fetch(url, { method: "POST", headers: replayHeaders });
	expect(first.status).toBe(201);
	const again = await SELF.fetch(url, { method: "POST", headers: replayHeaders });
	expect(again.status).toBe(201);
	expect(await again.json()).toEqual(await first.json());
	const conflict = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/supbrd-plug-products/enable",
		{ method: "POST", headers: replayHeaders },
	);
	expect(conflict.status).toBe(409);
});

test("every business package activates and disables all its declared functions together", async () => {
	for (const owner of pluginPackages.filter((item) => item.kind === "business")) {
		const enabled = await action(owner.id, "enable");
		expect(enabled.status, `${owner.id}: ${await enabled.clone().text()}`).toBe(201);
		const active = await env.DB.prepare(
			"SELECT plugin_id FROM superboard_plugin_lifecycle WHERE state = 'active' ORDER BY plugin_id",
		).all();
		expect(
			active.results.filter((row) => pluginPackageOwner(row.plugin_id) !== "supbrd-core"),
		).toEqual(owner.components.toSorted().map((plugin_id) => ({ plugin_id })));
		const disabled = await action(owner.id, "disable");
		expect(disabled.status, `${owner.id}: ${await disabled.clone().text()}`).toBe(201);
	}
}, 30000);

test("rejects a stale module database and permits disabling an unhealthy plugin", async () => {
	const bindings = env as unknown as Record<string, D1Database>;
	const database = bindings.HEALTH_PAYWALLS_DB!;
	const migration = await database
		.prepare("SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1")
		.first<{ name: string }>();
	await database
		.prepare("UPDATE d1_migrations SET name = '0000_missing_test_schema.sql' WHERE name = ?")
		.bind(migration!.name)
		.run();
	try {
		const failed = await action("supbrd-plugmod-paywalls", "enable");
		expect(failed.status).toBeGreaterThanOrEqual(400);
		expect(
			await env.DB.prepare(
				"SELECT plugin_id FROM superboard_plugin_lifecycle WHERE plugin_id = 'supbrd-plugmod-paywalls' AND state = 'active'",
			).first(),
		).toBeNull();
	} finally {
		await database
			.prepare("UPDATE d1_migrations SET name = ? WHERE name = '0000_missing_test_schema.sql'")
			.bind(migration!.name)
			.run();
	}
	expect((await action("supbrd-plugmod-paywalls", "enable")).status).toBe(201);
	await database
		.prepare("UPDATE d1_migrations SET name = '0000_missing_test_schema.sql' WHERE name = ?")
		.bind(migration!.name)
		.run();
	await env.DB.prepare(
		"UPDATE superboard_plugin_runtime_health SET status = 'unavailable' WHERE plugin_id = 'supbrd-plugmod-paywalls'",
	).run();
	try {
		expect((await action("supbrd-plugmod-paywalls", "disable")).status).toBe(201);
	} finally {
		await database
			.prepare("UPDATE d1_migrations SET name = ? WHERE name = '0000_missing_test_schema.sql'")
			.bind(migration!.name)
			.run();
	}
});

test("preserves the other packages when one package is disabled from the complete catalogue", async () => {
	const ids = pluginPackages.filter((item) => item.kind === "business").map((item) => item.id);
	for (const id of ids) expect((await action(id, "enable")).status).toBe(201);
	for (const id of ids) {
		expect((await action(id, "disable")).status).toBe(201);
		const active = await env.DB.prepare(
			"SELECT plugin_id FROM superboard_plugin_lifecycle WHERE state = 'active' ORDER BY plugin_id",
		).all<{ plugin_id: string }>();
		expect(
			active.results
				.map((row) => row.plugin_id)
				.filter((component) => pluginPackageOwner(component) !== "supbrd-core"),
		).toEqual(
			ids
				.filter((pluginId) => pluginId !== id)
				.flatMap((ownerId) => pluginPackage(ownerId)?.components ?? [])
				.toSorted(),
		);
		expect((await action(id, "enable")).status).toBe(201);
	}
}, 30000);

test("waits for accepted operations before disabling their plugin", async () => {
	expect((await action(plugin, "enable")).status).toBe(201);
	const encryptionKey = await importPluginStoreEncryptionKey(
		env.SUPERBOARD_PLUGIN_STORE_ENCRYPTION_KEY,
	);
	const operationId = crypto.randomUUID();
	await beginRepositoryCommand(env.DB, {
		operation_id: operationId,
		instance_id: "reference-production",
		target: "local",
		project_ref: "1-prod",
		plugin_id: plugin,
		command_id: `${plugin}.command.update_profile`,
		adapter_operation: "profile.update",
		method: "POST",
		request_path: "/api/v1/users",
		request_body: new TextEncoder().encode("{}"),
		accepted_at: new Date().toISOString(),
		encryption_key: encryptionKey,
	});
	const busy = await action(plugin, "disable");
	expect(busy.status).toBe(409);
	expect(await busy.json()).toMatchObject({ error: { code: "PLUGIN_OPERATIONS_IN_PROGRESS" } });
	expect(
		await env.DB.prepare("SELECT state FROM superboard_plugin_lifecycle WHERE plugin_id = ?")
			.bind(plugin)
			.first(),
	).toEqual({ state: "active" });
	await completeRepositoryCommand(env.DB, {
		operation_id: operationId,
		response: Response.json({ saved: true }),
		completed_at: new Date().toISOString(),
		encryption_key: encryptionKey,
	});
	expect((await action(plugin, "disable")).status).toBe(201);
});

test("compensates a permanently failing new plugin after the Release pointer commits", async () => {
	await env.DB.exec(
		"CREATE TABLE IF NOT EXISTS _plugin_state (plugin_id TEXT PRIMARY KEY, version TEXT NOT NULL, status TEXT NOT NULL, installed_at TEXT, activated_at TEXT, deactivated_at TEXT, source TEXT);",
	);
	expect((await action(plugin, "enable")).status).toBe(201);
	const previous = await env.DB.prepare(
		"SELECT active_release_id, pointer_revision FROM superboard_front_active_releases",
	).first<{ active_release_id: string; pointer_revision: number }>();
	const before = await lifecycle();
	const health = await env.DB.prepare(
		"SELECT * FROM superboard_plugin_runtime_health ORDER BY plugin_id",
	).all();
	await env.DB.exec(
		"CREATE TRIGGER fail_runtime_activation BEFORE INSERT ON _plugin_state WHEN NEW.status = 'active' AND NEW.plugin_id = 'supbrd-plugmod-paywalls' BEGIN SELECT RAISE(ABORT, 'injected runtime status failure'); END;",
	);
	try {
		const failed = await action("supbrd-plugmod-paywalls", "enable");
		expect(failed.status, await failed.clone().text()).toBe(500);
		expect(await failed.json()).toMatchObject({ error: { code: "PLUGIN_ACTIVATION_COMPENSATED" } });
		expect(
			await env.DB.prepare(
				"SELECT active_release_id, pointer_revision FROM superboard_front_active_releases",
			).first(),
		).toEqual({
			active_release_id: previous!.active_release_id,
			pointer_revision: previous!.pointer_revision + 2,
		});
		expect(await lifecycle()).toMatchObject({ results: before.results });
		expect(
			await env.DB.prepare(
				"SELECT * FROM superboard_plugin_runtime_health ORDER BY plugin_id",
			).all(),
		).toMatchObject({ results: health.results });
		expect(
			await env.DB.prepare(
				"SELECT status FROM superboard_plugin_compensations ORDER BY created_at DESC LIMIT 1",
			).first(),
		).toEqual({ status: "completed" });
	} finally {
		await env.DB.exec("DROP TRIGGER IF EXISTS fail_runtime_activation;");
	}
	expect((await action("supbrd-plugmod-paywalls", "enable")).status).toBe(201);
});

test("recovers an interrupted compensation without retrying the failing plugin activation", async () => {
	await env.DB.exec(
		"CREATE TABLE IF NOT EXISTS _plugin_state (plugin_id TEXT PRIMARY KEY, version TEXT NOT NULL, status TEXT NOT NULL, installed_at TEXT, activated_at TEXT, deactivated_at TEXT, source TEXT);",
	);
	expect((await action(plugin, "enable")).status).toBe(201);
	const previousPluginState = await env.DB.prepare(
		"SELECT state FROM superboard_plugin_lifecycle WHERE plugin_id = 'supbrd-plugmod-paywalls'",
	).first();
	const previous = await env.DB.prepare(
		"SELECT active_release_id FROM superboard_front_active_releases",
	).first();
	await env.DB.exec(
		"CREATE TRIGGER fail_runtime_activation BEFORE INSERT ON _plugin_state WHEN NEW.status = 'active' AND NEW.plugin_id = 'supbrd-plugmod-paywalls' BEGIN SELECT RAISE(ABORT, 'injected runtime status failure'); END;",
	);
	await env.DB.exec(
		"CREATE TRIGGER fail_compensation BEFORE UPDATE ON superboard_front_active_releases WHEN NEW.activation_id LIKE 'plugin-compensation:%' BEGIN SELECT RAISE(ABORT, 'injected compensation failure'); END;",
	);
	try {
		const failed = await action("supbrd-plugmod-paywalls", "enable");
		expect(failed.status, await failed.clone().text()).toBe(503);
		expect(
			await env.DB.prepare(
				"SELECT recovery_error FROM superboard_managed_plugin_operations WHERE status = 'running'",
			).first(),
		).toEqual({ recovery_error: "PLUGIN_RECOVERY_REQUIRED" });
		expect(
			(await loadLastVerifiedFrontRelease(env, "reference-production"))?.release.payload.release_id,
		).toBe((previous as { active_release_id: string }).active_release_id);
		const pending = await env.DB.prepare(
			"SELECT operation_id, snapshot_json, release_id FROM superboard_managed_plugin_operations WHERE status = 'running'",
		).first<{ operation_id: string; snapshot_json: string; release_id: string }>();
		const previewId = crypto.randomUUID();
		await env.DB.prepare(`INSERT INTO superboard_front_previews (preview_id, candidate_id, release_id, content_checksum, audience, mutation_mode, issued_at, expires_at)
   SELECT ?, candidate_id, release_id, content_checksum, 'front_preview', 'dry_run', ?, ? FROM superboard_front_release_candidates WHERE release_id = ?`)
			.bind(
				previewId,
				new Date().toISOString(),
				new Date(Date.now() + 60000).toISOString(),
				pending!.release_id,
			)
			.run();
		expect(await loadFrontPreview(env.DB, previewId, new Date().toISOString())).toBeNull();
		await env.DB.prepare(
			"UPDATE superboard_managed_plugin_operations SET snapshot_json = ? WHERE operation_id = ?",
		)
			.bind(
				JSON.stringify({ ...JSON.parse(pending!.snapshot_json), tampered: true }),
				pending!.operation_id,
			)
			.run();
		expect(await loadLastVerifiedFrontRelease(env, "reference-production")).toBeNull();
		await env.DB.prepare(
			"UPDATE superboard_managed_plugin_operations SET snapshot_json = ? WHERE operation_id = ?",
		)
			.bind(pending!.snapshot_json, pending!.operation_id)
			.run();
		expect(await loadLastVerifiedFrontRelease(env, "other-instance")).toBeNull();
		await env.DB.exec("DROP TRIGGER fail_compensation;");
		await env.DB.prepare(
			"UPDATE superboard_managed_plugin_operations SET expires_at = ? WHERE status = 'running'",
		)
			.bind(new Date(Date.now() - 1000).toISOString())
			.run();
		const recovered = await action(plugin, "enable");
		expect(recovered.status, await recovered.clone().text()).toBe(200);
		expect(
			await env.DB.prepare(
				"SELECT active_release_id FROM superboard_front_active_releases",
			).first(),
		).toEqual(previous);
		expect(
			await env.DB.prepare(
				"SELECT state FROM superboard_plugin_lifecycle WHERE plugin_id = 'supbrd-plugmod-paywalls'",
			).first(),
		).toEqual(previousPluginState);
	} finally {
		await env.DB.exec(
			"DROP TRIGGER IF EXISTS fail_runtime_activation; DROP TRIGGER IF EXISTS fail_compensation;",
		);
	}
});

test("a damaged recovery snapshot cannot overwrite valid plugin state", async () => {
	expect((await action(plugin, "enable")).status).toBe(201);
	const started = await beginManagedPluginOperation(env.DB, {
		operation_id: crypto.randomUUID(),
		instance_id: "reference-production",
		target: "local",
		plugin_id: plugin,
		action: "disable",
	});
	if (!("operation" in started)) throw new Error("operation missing");
	await snapshotManagedPluginOperation(env.DB, started.operation, "never-activated");
	const before = await lifecycle();
	await env.DB.prepare(
		"UPDATE superboard_managed_plugin_operations SET snapshot_json = json_set(snapshot_json, '$.superboard_plugin_lifecycle[0].reason', 'tampered') WHERE operation_id=?",
	)
		.bind(started.operation.operation_id)
		.run();
	await expect(restoreManagedPluginOperation(env.DB, started.operation)).rejects.toThrow(
		"PLUGIN_OPERATION_SNAPSHOT_INVALID",
	);
	expect((await lifecycle()).results).toEqual(before.results);
	await env.DB.prepare(
		"UPDATE superboard_managed_plugin_operations SET status='failed' WHERE operation_id=?",
	)
		.bind(started.operation.operation_id)
		.run();
});
