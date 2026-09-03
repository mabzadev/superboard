import { REQUIRED_FRONT_STATES, resolveFrontRequest } from "@superboard/supbrd-core";
import { SELF, env } from "cloudflare:test";
import { expect, test } from "vitest";

import parityMatrix from "../../../config/emdash-parity-matrix.json";
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

test("exercises every required contribution and records parity blockers", async () => {
	observedGatewayRoutes.clear();
	const activeIds = parityRelease.active_plugin_ids;
	const catalog = superBoardRuntimePluginCatalog().plugins.filter(({ manifest }) =>
		activeIds.includes(manifest.plugin_id),
	);
	expect(catalog.map(({ manifest }) => manifest.plugin_id).toSorted()).toEqual(activeIds);
	const actionRows = parityMatrix.rows.filter(
		({ kind, target: pluginId }) => kind === "action" && activeIds.includes(pluginId),
	);
	expect(actionRows.length).toBeGreaterThan(0);
	expect(
		actionRows.every(
			({ source_status: sourceStatus, required, blocker }) =>
				sourceStatus === "unvalidated" &&
				required === false &&
				blocker === "plugin_command_handler_not_connected",
		),
	).toBe(true);
	const releaseRows = parityMatrix.rows.filter(
		({ release_id: releaseId }) => releaseId === parityRelease.release.payload.release_id,
	);
	const proofReceipt = parseProofReceipt(
		String(Reflect.get(env, "PARITY_VERIFIED_PROOF_RECEIPTS")),
	);
	const catalogByPlugin = new Map(catalog.map((entry) => [entry.manifest.plugin_id, entry]));
	const workerHealthProofs = new Map<string, string>();
	for (const row of releaseRows.filter(
		({ kind, required }) => kind === "worker_health" && required,
	)) {
		const entry = catalogByPlugin.get(row.target);
		if (!entry) throw new Error(`Missing plugin for Worker proof: ${row.target}`);
		if (!entry.worker_descriptor) {
			const health = await createConfiguredSuperBoardPlugin(row.target).routes.health.handler({
				kv: { get: async () => null },
			} as never);
			expect(health).toMatchObject({ status: "ready" });
			workerHealthProofs.set(row.target, row.proof_sha256);
			continue;
		}
		const verified = proofReceipt.proofs[row.test] === row.proof_sha256;
		if (proofReceipt.complete) expect(verified, row.target).toBe(true);
		if (verified) workerHealthProofs.set(row.target, row.proof_sha256);
	}
	const executablePluginIds = [...workerHealthProofs.keys()].toSorted();

	const syncResponse = await operatorRequest("/_emdash/api/superboard/plugins/sync", {
		body: {
			plan_id: "issue-70-parity-plan",
			expires_in_hours: 1,
			plugin_ids: executablePluginIds,
		},
	});
	expect(syncResponse.status).toBe(201);
	expect(await syncResponse.json()).toMatchObject({
		plan: { status: "installed", plugin_count: executablePluginIds.length },
	});
	const implicitActive = await env.DB.prepare(
		`SELECT COUNT(*) count FROM superboard_plugin_lifecycle
			 WHERE instance_id = ? AND target = ? AND state = 'active'`,
	)
		.bind(instanceId, target)
		.first<{ count: number }>();
	expect(implicitActive?.count).toBe(0);
	const healthCheckedAt = new Date().toISOString();
	const healthExpiresAt = new Date(Date.parse(healthCheckedAt) + 60 * 60 * 1_000).toISOString();
	for (const [pluginId, proofChecksum] of workerHealthProofs) {
		await env.DB.prepare(
			`UPDATE superboard_plugin_runtime_health
			 SET status = 'ready', evidence_checksum = ?, checked_at = ?, expires_at = ?
			 WHERE instance_id = ? AND target = ? AND plugin_id = ?`,
		)
			.bind(proofChecksum, healthCheckedAt, healthExpiresAt, instanceId, target, pluginId)
			.run();
		await env.DB.prepare(
			`INSERT INTO superboard_dependency_health
			 (instance_id, dependency_id, status, evidence_checksum, checked_at, expires_at)
			 VALUES (?, ?, 'ready', ?, ?, ?)`,
		)
			.bind(
				instanceId,
				`dependency.${pluginId.replaceAll("-", "_")}`,
				proofChecksum,
				healthCheckedAt,
				healthExpiresAt,
			)
			.run();
	}

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
		plugin_lifecycle: { status: "reconciled", plugin_count: executablePluginIds.length },
	});

	const scope = { instance_id: instanceId, target };
	const pluginLock = await loadActiveSuperBoardPluginLock(env.DB, scope);
	expect(pluginLock.map(({ plugin_id: pluginId }) => pluginId).toSorted()).toEqual(
		executablePluginIds,
	);
	const candidate = await getFrontReleaseCandidate(env.DB, releaseIds.candidate_id);
	if (!candidate) throw new Error("Compiled parity candidate is missing");
	const release = candidate.release.payload;
	const encryptionKey = await importPluginStoreEncryptionKey(encodedEncryptionKey);
	let storeIndex = 0;

	for (const { manifest } of catalog.filter(({ manifest: candidateManifest }) =>
		workerHealthProofs.has(candidateManifest.plugin_id),
	)) {
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
	}
	const runtimeHealth = await env.DB.prepare(
		`SELECT plugin_id, status FROM superboard_plugin_runtime_health
			 WHERE instance_id = ? AND target = ? ORDER BY plugin_id`,
	)
		.bind(instanceId, target)
		.all<{ plugin_id: string; status: string }>();
	expect(runtimeHealth.results).toHaveLength(executablePluginIds.length);
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

	const failedPlugin = catalog.find(
		({ manifest }) =>
			workerHealthProofs.has(manifest.plugin_id) && manifest.data_sources.length > 0,
	)?.manifest;
	if (!failedPlugin) throw new Error("Missing executable plugin with a data source");
	await transitionSuperBoardPluginLifecycle(env.DB, {
		instance_id: instanceId,
		target,
		plugin_id: failedPlugin.plugin_id,
		to_state: "quarantined",
		changed_at: "2026-09-03T08:06:00.000Z",
		reason: "parity failure-state exercise",
	});
	const blockedDataSource = failedPlugin.data_sources[0];
	if (!blockedDataSource) throw new Error("Missing blocked data source");
	const rejected = await operatorRequest(
		`/_emdash/api/superboard/plugins/${failedPlugin.plugin_id}/data-sources/${blockedDataSource.data_source_id}?project_ref=${projectRef}`,
		{ method: "GET" },
	);
	expect(rejected.status).toBe(503);
	expect(await rejected.json()).toEqual({ error: { code: "PLUGIN_MANIFEST_NOT_ACTIVE" } });
	const expectedGatewayRoutes = parityMatrix.rows
		.filter(
			({ kind, required, release_id: releaseId, target: pluginId }) =>
				kind === "api" &&
				required &&
				releaseId === parityRelease.release.payload.release_id &&
				(pluginId === "supbrd-core" || executablePluginIds.includes(pluginId)),
		)
		.map(({ method, path }) => `${method} ${path}`)
		.toSorted();
	const expectedGatewayRouteSet = new Set(expectedGatewayRoutes);
	const exercisedGatewayRoutes = [...observedGatewayRoutes]
		.filter((route) => expectedGatewayRouteSet.has(route))
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

function parseProofReceipt(value: string): { complete: boolean; proofs: Record<string, string> } {
	const parsed: unknown = JSON.parse(value);
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		!("complete" in parsed) ||
		typeof parsed.complete !== "boolean" ||
		!("proofs" in parsed) ||
		typeof parsed.proofs !== "object" ||
		parsed.proofs === null ||
		Array.isArray(parsed.proofs) ||
		Object.values(parsed.proofs).some((checksum) => typeof checksum !== "string")
	) {
		throw new Error("Parity proof receipt is invalid");
	}
	return { complete: parsed.complete, proofs: Object.fromEntries(Object.entries(parsed.proofs)) };
}
