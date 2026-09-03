import { REQUIRED_FRONT_STATES, resolveFrontRequest } from "@superboard/supbrd-core";
import { SELF, env } from "cloudflare:test";
import { expect, test } from "vitest";

import parityRelease from "../../../config/superboard-parity-release.json";
import { createConfiguredSuperBoardPlugin } from "../../../packages/supbrd-runtime-plugins/src/runtime.js";
import { nativeFrontPlugin as coreFrontPlugin } from "../src/front-plugins/emdash-core.js";
import {
	CORE_FRONT_RENDERER_DESCRIPTORS,
	CORE_STATE_RENDERER_IDS,
} from "../src/lib/core-front-contract.js";
import { getFrontReleaseCandidate } from "../src/lib/front-workflow-repository.js";
import {
	importPluginStoreEncryptionKey,
	listPluginStoreRecords,
	putPluginStoreRecord,
} from "../src/lib/plugin-store-repository.js";
import {
	loadActiveSuperBoardPluginLock,
	superBoardRuntimePluginCatalog,
	transitionSuperBoardPluginLifecycle,
} from "../src/lib/superboard-plugin-catalog.js";

const encodedEncryptionKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const instanceId = "vocostar";
const target = "local" as const;
const projectRef = "1-test";
const checkedAt = "2026-09-03T08:05:00.000Z";
const observedGatewayRoutes = new Set<string>();
const releaseIds = {
	front_draft_id: "01J00000000000000000007101",
	draft_snapshot_id: "01J00000000000000000007102",
	compilation_id: "01J00000000000000000007103",
	candidate_id: "01J00000000000000000007104",
	release_id: "01J00000000000000000007105",
};

test("exercises every active plugin contribution through a real Instance lifecycle", async () => {
	observedGatewayRoutes.clear();
	const activeIds = parityRelease.active_plugin_ids;
	const catalog = superBoardRuntimePluginCatalog().plugins.filter(({ manifest }) =>
		activeIds.includes(manifest.plugin_id),
	);
	expect(catalog.map(({ manifest }) => manifest.plugin_id).toSorted()).toEqual(activeIds);

	const syncResponse = await operatorRequest("/_emdash/api/superboard/plugins/sync", {
		body: { plan_id: "issue-70-parity-plan", expires_in_hours: 1 },
	});
	expect(syncResponse.status).toBe(201);
	expect(await syncResponse.json()).toMatchObject({
		plan: { status: "installed", plugin_count: activeIds.length },
	});
	const implicitActive = await env.DB.prepare(
		`SELECT COUNT(*) count FROM superboard_plugin_lifecycle
			 WHERE instance_id = ? AND target = ? AND state = 'active'`,
	)
		.bind(instanceId, target)
		.first<{ count: number }>();
	expect(implicitActive?.count).toBe(0);

	const sliceResponse = await operatorRequest("/_emdash/api/superboard/releases/user-slice", {
		body: releaseIds,
	});
	expect(sliceResponse.status).toBe(201);
	expect(await sliceResponse.json()).toMatchObject({
		front_draft_id: releaseIds.front_draft_id,
		draft_snapshot_id: releaseIds.draft_snapshot_id,
		draft_revision: 1,
	});
	const compileResponse = await operatorRequest("/_emdash/api/superboard/releases/compile", {
		body: { draft_snapshot_id: releaseIds.draft_snapshot_id },
	});
	expect(compileResponse.status).toBe(201);
	const compiled = await compileResponse.json<{
		candidate_id: string;
		content_checksum: string;
		validation_set_checksum: string;
		signature: { algorithm: string; kid: string; value: string };
		validation_receipts: Array<{ receipt_id: string; level: string }>;
	}>();
	expect(compiled).toMatchObject({
		candidate_id: releaseIds.candidate_id,
		signature: { algorithm: "ES256", kid: "site-runtime-parity" },
	});
	expect(compiled.validation_receipts.length).toBeGreaterThan(0);

	const previewResponse = await operatorRequest("/_emdash/api/superboard/releases/preview", {
		body: { candidate_id: releaseIds.candidate_id, expires_in_hours: 1 },
	});
	expect(previewResponse.status).toBe(201);
	expect(await previewResponse.json()).toMatchObject({
		candidate_id: releaseIds.candidate_id,
		content_checksum: compiled.content_checksum,
	});
	const approvalResponse = await operatorRequest("/_emdash/api/superboard/releases/approve", {
		body: {
			candidate_id: releaseIds.candidate_id,
			warnings_acknowledged: compiled.validation_receipts
				.filter(({ level }) => level === "warning")
				.map(({ receipt_id: id }) => id),
		},
		reauthenticated: true,
	});
	const approval = await approvalResponse.json();
	expect(approvalResponse.status, JSON.stringify(approval)).toBe(201);
	const activationResponse = await operatorRequest("/_emdash/api/superboard/releases/activate", {
		body: {
			candidate_id: releaseIds.candidate_id,
			activation_id: "issue-70-parity-activation",
			expected_active_release_id: null,
		},
		reauthenticated: true,
	});
	const activation = await activationResponse.json();
	expect(activationResponse.status, JSON.stringify(activation)).toBe(201);
	expect(activation).toMatchObject({
		active_release_id: releaseIds.release_id,
		plugin_lifecycle: { status: "reconciled", plugin_count: activeIds.length },
	});

	const scope = { instance_id: instanceId, target };
	const pluginLock = await loadActiveSuperBoardPluginLock(env.DB, scope);
	expect(pluginLock.map(({ plugin_id: pluginId }) => pluginId).toSorted()).toEqual(activeIds);
	const candidate = await getFrontReleaseCandidate(env.DB, releaseIds.candidate_id);
	if (!candidate) throw new Error("Compiled parity candidate is missing");
	const release = candidate.release.payload;
	const encryptionKey = await importPluginStoreEncryptionKey(encodedEncryptionKey);
	let storeIndex = 0;
	let commandIndex = 0;

	for (const { manifest } of catalog) {
		const plugin = createConfiguredSuperBoardPlugin(manifest.plugin_id);
		expect(plugin.version, manifest.plugin_id).toBe(manifest.plugin_version);
		const contract = await plugin.routes.contract.handler({} as never);
		const healthResponse = await operatorRequest(
			`/_emdash/api/plugins/${encodeURIComponent(manifest.plugin_id)}/health`,
			{ method: "GET" },
		);
		expect(healthResponse.status, manifest.plugin_id).toBe(200);
		const health = await healthResponse.json();
		const commands = await plugin.routes["commands/catalog"].handler({} as never);
		const dataSources = await plugin.routes["data-sources/catalog"].handler({} as never);
		expect(contract).toMatchObject({
			plugin_id: manifest.plugin_id,
			artifact_checksum: manifest.artifact_checksum,
		});
		expect(health).toMatchObject({
			plugin_version: manifest.plugin_version,
			status: "ready",
			error_code: null,
		});
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
			const response = await operatorRequest(
				`/_emdash/api/superboard/plugins/${encodeURIComponent(manifest.plugin_id)}/data-sources/${encodeURIComponent(dataSource.data_source_id)}?project_ref=${projectRef}&entity_type=parity`,
				{ method: "GET" },
			);
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
			const inputSchema = manifest.schemas.find(
				({ schema_id: schemaId }) => schemaId === command.input_schema_id,
			);
			if (!inputSchema) throw new Error(`Missing input schema: ${command.command_id}`);
			const input = fixtureFromSchema(inputSchema.json_schema);
			const path = `/_emdash/api/superboard/plugins/${encodeURIComponent(manifest.plugin_id)}/commands/${encodeURIComponent(command.command_id)}?project_ref=${projectRef}`;
			const execute = () =>
				operatorRequest(path, {
					body: input,
					headers: { "Idempotency-Key": operationId },
				});
			const response = await execute();
			expect(response.status, command.command_id).toBe(200);
			const result = await response.json();
			expect(result).toMatchObject({
				operation_id: operationId,
				status: "completed",
				result: { plugin_id: manifest.plugin_id, command_id: command.command_id },
			});
			const replay = await execute();
			expect(replay.status, command.command_id).toBe(200);
			expect(await replay.json()).toEqual(result);
		}
	}
	const signInCommand = catalog
		.find(({ manifest }) => manifest.plugin_id === "supbrd-plug-user")
		?.manifest.commands.find(({ command_id: commandId }) =>
			commandId.endsWith(".application_sign_in"),
		);
	if (!signInCommand) throw new Error("Application sign-in command is missing");
	const executeInvalidAction = () =>
		operatorRequest(
			`/_emdash/api/superboard/plugins/supbrd-plug-user/commands/${signInCommand.command_id}?project_ref=${projectRef}`,
			{
				body: {},
				headers: { "Idempotency-Key": "issue-70-invalid-sign-in" },
			},
		);
	const invalidAction = await executeInvalidAction();
	expect(invalidAction.status).toBe(400);
	const invalidActionBody = await invalidAction.json();
	expect(invalidActionBody).toEqual({
		error: { code: "PLUGIN_COMMAND_INPUT_INVALID" },
	});
	const invalidActionReplay = await executeInvalidAction();
	expect(invalidActionReplay.status).toBe(400);
	expect(await invalidActionReplay.json()).toEqual(invalidActionBody);
	const completedCommands = await env.DB.prepare(
		`SELECT COUNT(*) count FROM superboard_plugin_command_operations
			 WHERE instance_id = ? AND state = 'completed'`,
	)
		.bind(instanceId)
		.first<{ count: number }>();
	expect(completedCommands?.count).toBe(commandIndex);
	const failedCommands = await env.DB.prepare(
		`SELECT COUNT(*) count FROM superboard_plugin_command_operations
			 WHERE instance_id = ? AND state = 'failed'`,
	)
		.bind(instanceId)
		.first<{ count: number }>();
	expect(failedCommands?.count).toBe(1);
	const commandStoreRecords = await env.DB.prepare(
		`SELECT COUNT(*) count FROM superboard_plugin_store_records
			 WHERE instance_id = ? AND entity_type = 'command_execution'`,
	)
		.bind(instanceId)
		.first<{ count: number }>();
	expect(commandStoreRecords?.count).toBe(commandIndex);

	const runtimeHealth = await env.DB.prepare(
		`SELECT plugin_id, status FROM superboard_plugin_runtime_health
			 WHERE instance_id = ? AND target = ? ORDER BY plugin_id`,
	)
		.bind(instanceId, target)
		.all<{ plugin_id: string; status: string }>();
	expect(runtimeHealth.results).toHaveLength(activeIds.length);
	expect(runtimeHealth.results.every(({ status }) => status === "ready")).toBe(true);
	const healthResponse = await operatorRequest("/superboard-system/health", { method: "GET" });
	expect(healthResponse.status).toBe(200);
	expect(await healthResponse.json()).toEqual({
		status: "ok",
		service: "superboard-site",
		schema_version: 1,
	});

	const dependencyHealth = Object.fromEntries(
		release.dependency_policies.map(({ dependency_id: id }) => [id, "ready" as const]),
	);
	const permissions = release.front_route_manifest.routes
		.map(({ permission_expression: permission }) => permission)
		.filter((permission) => permission !== "allow");
	for (const route of release.front_route_manifest.routes) {
		const path = concretePath(route.path_pattern);
		expect(
			resolveFrontRequest({
				last_verified_release: {
					front_route_manifest: release.front_route_manifest,
					dependency_policies: release.dependency_policies,
				},
				requested_path: path,
				admin_session: route.auth_policy === "anonymous_only" ? "absent" : "valid",
				permissions,
				dependency_health: dependencyHealth,
			}).result,
			route.route_id,
		).toBe("rendered");
	}
	expect(
		resolveFrontRequest({
			last_verified_release: null,
			requested_path: "/dashboard",
			admin_session: "valid",
			permissions,
			dependency_health: {},
		}).result,
	).toBe("maintenance");
	expect(
		resolveFrontRequest({
			last_verified_release: {
				front_route_manifest: release.front_route_manifest,
				dependency_policies: release.dependency_policies,
			},
			requested_path: "/outside-release",
			admin_session: "valid",
			permissions,
			dependency_health: dependencyHealth,
		}).result,
	).toBe("not_found");
	const protectedRoute = release.front_route_manifest.routes.find(
		({ auth_policy: authPolicy }) => authPolicy === "authenticated",
	);
	if (!protectedRoute) throw new Error("Protected parity route is missing");
	expect(
		resolveFrontRequest({
			last_verified_release: {
				front_route_manifest: release.front_route_manifest,
				dependency_policies: release.dependency_policies,
			},
			requested_path: concretePath(protectedRoute.path_pattern),
			admin_session: "valid",
			permissions: [],
			dependency_health: dependencyHealth,
		}).result,
	).toBe("forbidden");
	const unavailableHealth = {
		...dependencyHealth,
		[protectedRoute.dependencies[0]!]: "unavailable" as const,
	};
	expect(
		resolveFrontRequest({
			last_verified_release: {
				front_route_manifest: release.front_route_manifest,
				dependency_policies: release.dependency_policies,
			},
			requested_path: concretePath(protectedRoute.path_pattern),
			admin_session: "valid",
			permissions,
			dependency_health: unavailableHealth,
		}).result,
	).toBe("unavailable");

	await env.RELEASE_CACHE.put(
		"runtime:health",
		JSON.stringify({ status: "unavailable", error_code: "WORKER_UNREACHABLE" }),
	);
	const failedHealthResponse = await operatorRequest(
		"/_emdash/api/plugins/supbrd-plugmod-analytics/health",
		{ method: "GET" },
	);
	expect(failedHealthResponse.status).toBe(200);
	const failedHealth = await failedHealthResponse.json();
	expect(failedHealth).toMatchObject({
		status: "unavailable",
		error_code: "WORKER_UNREACHABLE",
	});
	await env.RELEASE_CACHE.delete("runtime:health");
	for (const state of REQUIRED_FRONT_STATES) {
		const rendererId = CORE_STATE_RENDERER_IDS[state];
		const renderer = CORE_FRONT_RENDERER_DESCRIPTORS.find(
			({ renderer_id: candidateId }) => candidateId === rendererId,
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

	const analytics = catalog.find(
		({ manifest }) => manifest.plugin_id === "supbrd-plugmod-analytics",
	)?.manifest;
	if (!analytics) throw new Error("Missing Analytics plugin");
	await transitionSuperBoardPluginLifecycle(env.DB, {
		instance_id: instanceId,
		target,
		plugin_id: analytics.plugin_id,
		to_state: "quarantined",
		changed_at: "2026-09-03T08:06:00.000Z",
		reason: "parity failure-state exercise",
	});
	const rejected = await operatorRequest(
		`/_emdash/api/superboard/plugins/${analytics.plugin_id}/commands/${analytics.commands[0]!.command_id}?project_ref=${projectRef}`,
		{
			body: {},
			headers: { "Idempotency-Key": "issue-70-quarantined-command" },
		},
	);
	expect(rejected.status).toBe(409);
	expect(await rejected.json()).toEqual({ error: { code: "PLUGIN_MANIFEST_NOT_ACTIVE" } });
	const expectedGatewayRoutes = release.gateway_manifest.routes
		.map(({ method, path_pattern: path }) => `${method} ${path}`)
		.toSorted();
	const exercisedGatewayRoutes = [...observedGatewayRoutes]
		.filter(
			(route) =>
				route.includes("/superboard-system/health") ||
				route.includes("/_emdash/api/plugins/") ||
				route.includes("/commands/") ||
				route.includes("/data-sources/"),
		)
		.toSorted();
	expect(exercisedGatewayRoutes).toEqual(expectedGatewayRoutes);
}, 60_000);

function operatorRequest(
	path: string,
	options: {
		method?: "GET" | "POST";
		body?: unknown;
		headers?: Record<string, string>;
		reauthenticated?: boolean;
	} = {},
) {
	const method = options.method ?? "POST";
	observedGatewayRoutes.add(`${method} ${new URL(path, "https://site.example").pathname}`);
	return SELF.fetch(`https://site.example${path}`, {
		method,
		headers: {
			Origin: "https://site.example",
			"X-EmDash-Request": "1",
			"X-Parity-Operator": "1",
			...(options.reauthenticated ? { "X-Parity-Reauthenticated": "1" } : {}),
			...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
			...options.headers,
		},
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});
}

function concretePath(path: string) {
	return path
		.replaceAll(/:lang/gu, "en")
		.replaceAll(/:[^/]+/gu, "parity-id")
		.replaceAll(/\*[^/]+/gu, "parity/path");
}

function fixtureFromSchema(schema: unknown): unknown {
	if (!isRecord(schema)) return {};
	if ("const" in schema) return schema.const;
	if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
	if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
		return fixtureFromSchema(schema.oneOf[0]);
	}
	const types = Array.isArray(schema.type) ? schema.type : [schema.type];
	const type = types.find((candidate) => candidate !== "null");
	if (type === "string") {
		if (schema.format === "email") return "parity@example.com";
		if (schema.format === "uri") return "https://example.test";
		return typeof schema.pattern === "string" && schema.pattern.includes("[A-Z]{3}")
			? "USD"
			: "parity-value";
	}
	if (type === "integer" || type === "number") {
		return typeof schema.minimum === "number" ? schema.minimum : 1;
	}
	if (type === "boolean") return true;
	if (type === "array") {
		return typeof schema.minItems === "number" && schema.minItems > 0
			? [fixtureFromSchema(schema.items)]
			: [];
	}
	if (type === "object" || isRecord(schema.properties)) {
		const properties = isRecord(schema.properties) ? schema.properties : {};
		const required = Array.isArray(schema.required)
			? schema.required.filter((key): key is string => typeof key === "string")
			: [];
		return Object.fromEntries(required.map((key) => [key, fixtureFromSchema(properties[key])]));
	}
	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
