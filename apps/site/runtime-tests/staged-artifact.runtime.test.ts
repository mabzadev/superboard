import { env, SELF } from "cloudflare:test";
import { expect, test } from "vitest";

import {
	installSuperBoardPluginCatalog,
	superBoardRuntimePluginCatalog,
	loadSelectedSuperBoardPluginLock,
} from "../src/lib/superboard-plugin-catalog.js";

test("preparing a replacement artifact preserves the active artifact and its health until Release activation", async () => {
	const pluginId = "supbrd-plugmod-onboardings";
	const response = await SELF.fetch(
		`https://site.example/_emdash/api/superboard/plugins/${pluginId}/enable`,
		{
			method: "POST",
			headers: {
				Origin: "https://site.example",
				"X-EmDash-Request": "1",
				"X-Parity-Operator": "1",
			},
		},
	);
	expect(response.status).toBe(201);
	const current = superBoardRuntimePluginCatalog().plugins.find(
		({ manifest }) => manifest.plugin_id === pluginId,
	)!.manifest;
	const old = await env.DB.prepare(
		"SELECT artifact_checksum FROM superboard_plugin_manifest_artifacts WHERE plugin_id=? AND artifact_checksum<>? LIMIT 1",
	)
		.bind(pluginId, current.artifact_checksum)
		.first<{ artifact_checksum: string }>();
	expect(old).not.toBeNull();
	await env.DB.batch([
		env.DB.prepare(
			"UPDATE superboard_plugin_lifecycle SET artifact_checksum=? WHERE plugin_id=?",
		).bind(old!.artifact_checksum, pluginId),
		env.DB.prepare(
			"UPDATE superboard_plugin_runtime_health SET artifact_checksum=? WHERE plugin_id=?",
		).bind(old!.artifact_checksum, pluginId),
	]);
	const healthBefore = await env.DB.prepare(
		"SELECT * FROM superboard_plugin_runtime_health WHERE plugin_id=?",
	)
		.bind(pluginId)
		.first();
	const before = await env.DB.prepare("SELECT * FROM superboard_front_active_releases").first();
	await installSuperBoardPluginCatalog(env.DB, {
		instance_id: "reference-production",
		target: "local",
		plan_id: "replacement-plan",
		approved_by: "operator-1",
		checked_at: new Date().toISOString(),
		expires_at: new Date(Date.now() + 3600000).toISOString(),
		target_artifact_checksum: env.TARGET_ARTIFACT_CHECKSUM,
		target_plugin_ids: superBoardRuntimePluginCatalog().plugins.map(
			({ manifest }) => manifest.plugin_id,
		),
		plugin_ids: [pluginId],
	});
	expect(
		await env.DB.prepare(
			"SELECT artifact_checksum,state FROM superboard_plugin_lifecycle WHERE plugin_id=?",
		)
			.bind(pluginId)
			.first(),
	).toEqual({ artifact_checksum: old!.artifact_checksum, state: "active" });
	expect(
		await env.DB.prepare("SELECT * FROM superboard_plugin_runtime_health WHERE plugin_id=?")
			.bind(pluginId)
			.first(),
	).toEqual(healthBefore);
	expect(await env.DB.prepare("SELECT * FROM superboard_front_active_releases").first()).toEqual(
		before,
	);
	expect(
		await loadSelectedSuperBoardPluginLock(
			env.DB,
			{ instance_id: "reference-production", target: "local" },
			[pluginId],
		),
	).toContainEqual({
		plugin_id: pluginId,
		version: current.plugin_version,
		artifact_checksum: current.artifact_checksum,
		native: false,
	});
});

test("resource verification for an active plugin stages its new proof without replacing the committed proof", async () => {
	const pluginId = "supbrd-plugmod-paywalls";
	const headers = {
		Origin: "https://site.example",
		"X-EmDash-Request": "1",
		"X-Parity-Operator": "1",
		"Content-Type": "application/json",
	};
	expect(
		(
			await SELF.fetch(`https://site.example/_emdash/api/superboard/plugins/${pluginId}/enable`, {
				method: "POST",
				headers,
			})
		).status,
	).toBe(201);
	const before = await env.DB.prepare(
		"SELECT * FROM superboard_plugin_runtime_health WHERE plugin_id=?",
	)
		.bind(pluginId)
		.first();
	const sync = await SELF.fetch("https://site.example/_emdash/api/superboard/plugins/sync", {
		method: "POST",
		headers,
		body: JSON.stringify({ plugin_ids: [pluginId], expires_in_hours: 1 }),
	});
	expect(sync.status, await sync.clone().text()).toBe(201);
	expect(
		await env.DB.prepare("SELECT * FROM superboard_plugin_runtime_health WHERE plugin_id=?")
			.bind(pluginId)
			.first(),
	).toEqual(before);
	const staged = await env.DB.prepare(
		"SELECT evidence_checksum FROM superboard_plugin_staged_artifacts WHERE plugin_id=?",
	)
		.bind(pluginId)
		.first();
	expect(staged?.evidence_checksum).not.toBe(before?.evidence_checksum);
});
