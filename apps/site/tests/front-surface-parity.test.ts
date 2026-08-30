import { readFile } from "node:fs/promises";

import { resolveFrontRequest } from "@superboard/supbrd-core";
import { expect, test } from "vitest";

import { hasExecutableFrontSurface } from "../src/lib/front-surface-registry.js";
import { superBoardRuntimePluginCatalog } from "../src/lib/superboard-plugin-catalog.js";
import { composeUserFrontReleaseInput } from "../src/lib/user-front-release.js";

interface DashboardParityRow {
	id: string;
	kind: "dashboard";
	target: string;
	required: boolean;
	source_status: "delivered" | "unvalidated";
}

const identifiers = {
	instance_id: "vocostar",
	front_draft_id: "01J00000000000000000000301",
	draft_snapshot_id: "01J00000000000000000000302",
	compilation_id: "01J00000000000000000000303",
	candidate_id: "01J00000000000000000000304",
	release_id: "01J00000000000000000000305",
	release_sequence: 1,
	previous_release_id: null,
	created_at: "2026-08-30T11:30:00.000Z",
};

test("every required Dashboard surface is a real target route backed by its declared plugin renderer", async () => {
	const matrix = JSON.parse(
		await readFile(new URL("../../../config/emdash-parity-matrix.json", import.meta.url), "utf8"),
	) as { rows: DashboardParityRow[] };
	const catalog = superBoardRuntimePluginCatalog();
	const input = await composeUserFrontReleaseInput({
		...identifiers,
		plugin_lock: catalog.plugins.map(({ manifest }) => ({
			plugin_id: manifest.plugin_id,
			version: manifest.plugin_version,
			artifact_checksum: manifest.artifact_checksum,
			native: manifest.execution.backend === "native",
		})),
	});
	const requiredRows = matrix.rows.filter(
		(row) => row.kind === "dashboard" && row.required && row.source_status === "delivered",
	);
	const routesByPath = new Map(
		input.front_route_manifest.routes.map((route) => [route.path_pattern, route]),
	);
	const renderersById = new Map(
		input.renderers.map((renderer) => [renderer.renderer_id, renderer]),
	);
	const dependencyHealth = Object.fromEntries(
		input.dependency_policies.map(({ dependency_id: dependencyId }) => [dependencyId, "ready"]),
	) as Record<string, "ready">;
	const permissions = input.front_route_manifest.routes
		.map(({ permission_expression: permission }) => permission)
		.filter((permission) => permission !== "allow");

	for (const row of requiredRows) {
		const path = row.id
			.slice("dashboard:".length)
			.replaceAll("[lang]", ":lang")
			.replaceAll("[id]", ":id")
			.replaceAll("[authId]", ":authId");
		const route = routesByPath.get(path);
		expect(route, `missing target route for ${row.id}`).toBeDefined();
		expect(hasExecutableFrontSurface(path), `no executable target component for ${row.id}`).toBe(
			true,
		);
		expect(route?.renderer_ids.length, `route without renderer: ${row.id}`).toBeGreaterThan(0);
		for (const rendererId of route?.renderer_ids ?? []) {
			const renderer = renderersById.get(rendererId);
			expect(renderer, `unregistered renderer ${rendererId} for ${row.id}`).toBeDefined();
			if (row.target.startsWith("supbrd-")) {
				expect(renderer?.plugin_id, `wrong renderer owner for ${row.id}`).toBe(row.target);
			}
		}
		const resolution = resolveFrontRequest({
			last_verified_release: {
				front_route_manifest: {
					...input.front_route_manifest,
					route_manifest_checksum: "target-parity",
				},
				dependency_policies: input.dependency_policies,
			},
			requested_path: path.replaceAll(/:lang/gu, "en").replaceAll(/:[^/]+/gu, "parity-id"),
			admin_session: route?.auth_policy === "anonymous_only" ? "absent" : "valid",
			permissions,
			dependency_health: dependencyHealth,
		});
		expect(resolution.result, `target route does not render: ${row.id}`).toBe("rendered");
	}

	expect(requiredRows.length).toBeGreaterThan(80);
	expect(input.core_concrete_pages).toEqual([]);
});

test("runtime plugin manifests expose the canonical functional surface instead of catalogue-only shells", () => {
	const catalog = superBoardRuntimePluginCatalog();
	for (const { manifest } of catalog.plugins) {
		expect(manifest.commands, `${manifest.plugin_id} has no commands`).not.toHaveLength(0);
		expect(manifest.data_sources, `${manifest.plugin_id} has no data sources`).not.toHaveLength(0);
		expect(manifest.schemas, `${manifest.plugin_id} has no schemas`).not.toHaveLength(0);
		if (manifest.plugin_id !== "supbrd-plug-audit") {
			expect(manifest.renderers, `${manifest.plugin_id} has no renderers`).not.toHaveLength(0);
		}
		expect(
			manifest.commands.some(({ command_id }) => command_id.endsWith(".command.write")),
			`${manifest.plugin_id} still uses the invented generic write command`,
		).toBe(false);
	}
});
