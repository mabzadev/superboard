import {
	canonicalizeReleasePayload,
	sha256Canonical,
	verifySuperBoardPluginManifest,
	type SuperBoardPluginManifest,
} from "@superboard/supbrd-core";
import { userPluginManifest, validateUserPluginManifest } from "@superboard/supbrd-plug-user";

import topologyJson from "../../../../config/emdash-plugin-topology.json";
import compatibilityJson from "../../../../config/superboard-plugin-compatibility.json";

export type SuperBoardPluginTarget = "local" | "development" | "production";
export type SuperBoardPluginLifecycleState =
	| "available"
	| "staged"
	| "installed"
	| "active"
	| "draining"
	| "disabled"
	| "quarantined"
	| "purged";

interface WorkerDescriptor {
	deployment_status: "ready" | "not_ready";
	checksum: string;
	authoritative_writes: boolean;
	store_ids: string[];
	[key: string]: unknown;
}

interface TopologyPlugin {
	manifest: SuperBoardPluginManifest;
	worker_descriptor: WorkerDescriptor | null;
}

interface PluginScope {
	instance_id: string;
	target: SuperBoardPluginTarget;
}

interface PlanInput extends PluginScope {
	plan_id: string;
	checked_at: string;
	expires_at: string;
	plugin_ids?: readonly string[];
}

interface DerivedPluginContract {
	stores: Array<{ store_id: string; schema_version: string; migrations_checksum: string }>;
	capabilities: string[];
	capability_approval_checksum: string;
	settings_checksum: string;
	contributions_checksum: string;
	migrations_checksum: string;
	worker_descriptor_checksum: string | null;
	worker_status: "ready" | "unavailable";
	plugin_lock: {
		plugin_id: string;
		version: string;
		artifact_checksum: string;
		native: boolean;
	};
}

interface PlannedPlugin {
	manifest: SuperBoardPluginManifest;
	worker_descriptor: WorkerDescriptor | null;
	derived: DerivedPluginContract;
	derived_contract_checksum: string;
	health_evidence_checksum: string;
}

const topology = topologyJson as unknown as { plugins: TopologyPlugin[] };
const compatibility = compatibilityJson as {
	artifacts: Record<string, { plugin_id: string; manifest_checksum: string }>;
};
const MISSING_PLUGIN_STATE_TABLE_PATTERN = /no such table:\s*_plugin_state/iu;
const TARGETS = new Set<SuperBoardPluginTarget>(["local", "development", "production"]);
const LIFECYCLE_TRANSITIONS: Record<
	SuperBoardPluginLifecycleState,
	readonly SuperBoardPluginLifecycleState[]
> = {
	available: ["staged"],
	staged: ["installed", "quarantined"],
	installed: ["active", "quarantined"],
	active: ["draining", "quarantined"],
	draining: ["disabled", "quarantined"],
	disabled: ["staged", "quarantined"],
	quarantined: ["staged", "purged"],
	purged: ["available"],
};

export function resolveSuperBoardPluginTarget(value: unknown): SuperBoardPluginTarget {
	if (typeof value === "string" && TARGETS.has(value as SuperBoardPluginTarget)) {
		return value as SuperBoardPluginTarget;
	}
	throw new TypeError("Plugin lifecycle requires a valid target");
}

export function resolveSuperBoardPluginLifecycleState(
	value: unknown,
): SuperBoardPluginLifecycleState {
	if (typeof value === "string" && value in LIFECYCLE_TRANSITIONS) {
		return value as SuperBoardPluginLifecycleState;
	}
	throw new TypeError("Plugin lifecycle requires a valid state");
}

export interface SuperBoardRuntimePlugin {
	manifest: SuperBoardPluginManifest;
	worker_descriptor: WorkerDescriptor | null;
}

export function superBoardRuntimePluginCatalog(): {
	plugins: SuperBoardRuntimePlugin[];
	templates: string[];
} {
	const templates: string[] = [];
	const plugins: SuperBoardRuntimePlugin[] = [];
	for (const entry of topology.plugins) {
		if (entry.manifest.plugin_id.includes("*")) {
			templates.push(entry.manifest.plugin_id);
			continue;
		}
		plugins.push({
			manifest:
				entry.manifest.plugin_id === userPluginManifest.plugin_id
					? userPluginManifest
					: entry.manifest,
			worker_descriptor: entry.worker_descriptor,
		});
	}
	return {
		plugins: plugins.toSorted((left, right) =>
			left.manifest.plugin_id.localeCompare(right.manifest.plugin_id),
		),
		templates: templates.toSorted(),
	};
}

export async function installSuperBoardPluginCatalog(db: D1Database, input: PlanInput) {
	assertPlanInput(input);
	const existing = await db
		.prepare(
			`SELECT instance_id, target FROM superboard_plugin_installation_plans
			 WHERE plan_id = ?`,
		)
		.bind(input.plan_id)
		.first<{ instance_id: string; target: SuperBoardPluginTarget }>();
	if (existing) {
		if (existing.instance_id !== input.instance_id || existing.target !== input.target) {
			throw new Error("PLUGIN_INSTALLATION_PLAN_SCOPE_MISMATCH");
		}
		return loadInstallationPlanReceipt(db, input.plan_id);
	}

	const catalog = superBoardRuntimePluginCatalog();
	const selectedIds = input.plugin_ids ? new Set(input.plugin_ids) : null;
	const selected = selectedIds
		? catalog.plugins.filter(({ manifest }) => selectedIds.has(manifest.plugin_id))
		: catalog.plugins;
	if (selected.length === 0 || (selectedIds && selected.length !== selectedIds.size)) {
		throw new Error("PLUGIN_INSTALLATION_PLAN_UNKNOWN_PLUGIN");
	}
	const planned = await Promise.all(selected.map((plugin) => derivePluginContract(plugin, input)));
	const catalogChecksum = await sha256Canonical(planned.map(({ derived }) => derived.plugin_lock));
	const unavailable = planned.filter(({ derived }) => derived.worker_status !== "ready");
	const currentRows = await db
		.prepare(
			`SELECT plugin_id, state FROM superboard_plugin_lifecycle
			 WHERE instance_id = ? AND target = ?`,
		)
		.bind(input.instance_id, input.target)
		.all<{ plugin_id: string; state: SuperBoardPluginLifecycleState }>();
	const currentStates = new Map(currentRows.results.map((row) => [row.plugin_id, row.state]));
	for (const { manifest } of planned) {
		const state = currentStates.get(manifest.plugin_id);
		if (state === "draining" || state === "quarantined") {
			throw new Error(`PLUGIN_INSTALLATION_PLAN_STATE_CONFLICT:${manifest.plugin_id}:${state}`);
		}
	}

	const failed = unavailable.length > 0;
	const statements: D1PreparedStatement[] = [
		db
			.prepare(
				`INSERT INTO superboard_plugin_installation_plans
				 (plan_id, instance_id, target, status, catalog_checksum, plugin_count,
				  created_at, completed_at, failure_json)
				 VALUES (?, ?, ?, 'installing', ?, ?, ?, NULL, NULL)`,
			)
			.bind(
				input.plan_id,
				input.instance_id,
				input.target,
				catalogChecksum,
				planned.length,
				input.checked_at,
			),
	];
	for (const plugin of planned) {
		const { manifest, derived } = plugin;
		const currentState = currentStates.get(manifest.plugin_id);
		statements.push(
			db
				.prepare(
					`INSERT INTO superboard_plugin_manifest_artifacts
					 (artifact_checksum, plugin_id, manifest_json, installed_at)
					 VALUES (?, ?, ?, ?)
					 ON CONFLICT(artifact_checksum) DO NOTHING`,
				)
				.bind(
					manifest.artifact_checksum,
					manifest.plugin_id,
					canonicalizeReleasePayload(manifest),
					input.checked_at,
				),
			db
				.prepare(
					`INSERT INTO superboard_plugin_installation_items
					 (plan_id, plugin_id, artifact_checksum, state, derived_contract_json,
					  derived_contract_checksum, health_status)
					 VALUES (?, ?, ?, ?, ?, ?, ?)`,
				)
				.bind(
					input.plan_id,
					manifest.plugin_id,
					manifest.artifact_checksum,
					failed ? (derived.worker_status === "ready" ? "staged" : "failed") : "installed",
					canonicalizeReleasePayload(derived),
					plugin.derived_contract_checksum,
					derived.worker_status,
				),
			db
				.prepare(
					`INSERT INTO superboard_plugin_runtime_health
					 (instance_id, target, plugin_id, artifact_checksum, status,
					  evidence_checksum, checked_at, expires_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
					 ON CONFLICT(instance_id, target, plugin_id) DO UPDATE SET
					   artifact_checksum = excluded.artifact_checksum,
					   status = excluded.status,
					   evidence_checksum = excluded.evidence_checksum,
					   checked_at = excluded.checked_at,
					   expires_at = excluded.expires_at`,
				)
				.bind(
					input.instance_id,
					input.target,
					manifest.plugin_id,
					manifest.artifact_checksum,
					derived.worker_status,
					plugin.health_evidence_checksum,
					input.checked_at,
					input.expires_at,
				),
		);

		const nextState: SuperBoardPluginLifecycleState = failed ? "staged" : "installed";
		statements.push(
			db
				.prepare(
					`INSERT INTO superboard_plugin_lifecycle
					 (instance_id, target, plugin_id, artifact_checksum, state, plan_id,
					  state_changed_at, reason)
					 VALUES (?, ?, ?, ?, ?, ?, ?, 'installation plan')
					 ON CONFLICT(instance_id, target, plugin_id) DO UPDATE SET
					   artifact_checksum = excluded.artifact_checksum,
					   state = excluded.state,
					   plan_id = excluded.plan_id,
					   state_changed_at = excluded.state_changed_at,
					   reason = excluded.reason
					 WHERE superboard_plugin_lifecycle.state IN
					   ('available', 'staged', 'installed', 'disabled', 'purged')`,
				)
				.bind(
					input.instance_id,
					input.target,
					manifest.plugin_id,
					manifest.artifact_checksum,
					nextState,
					input.plan_id,
					input.checked_at,
				),
			...lifecycleInstallationEvents(db, {
				...input,
				plugin_id: manifest.plugin_id,
				artifact_checksum: manifest.artifact_checksum,
				current_state: currentState,
				to_state: nextState,
			}),
		);
	}
	statements.push(
		db
			.prepare(
				`UPDATE superboard_plugin_installation_plans
				 SET status = ?, completed_at = ?, failure_json = ?
				 WHERE plan_id = ? AND status = 'installing'`,
			)
			.bind(
				failed ? "failed" : "installed",
				input.checked_at,
				failed
					? canonicalizeReleasePayload({
							code: "PLUGIN_INSTALLATION_PLAN_NOT_READY",
							plugins: unavailable.map(({ manifest }) => manifest.plugin_id),
						})
					: null,
				input.plan_id,
			),
	);
	await db.batch(statements);
	await writeEmDashPluginStates(
		db,
		planned
			.map(({ manifest }) => ({
				plugin_id: manifest.plugin_id,
				version: manifest.plugin_version,
			}))
			.filter(({ plugin_id: pluginId }) => currentStates.get(pluginId) !== "active"),
		"inactive",
		input.checked_at,
	);
	if (failed) {
		throw new Error(
			`PLUGIN_INSTALLATION_PLAN_NOT_READY:${unavailable.map(({ manifest }) => manifest.plugin_id).join(",")}`,
		);
	}
	return loadInstallationPlanReceipt(db, input.plan_id);
}

export async function activateSuperBoardPluginInstallationPlan(
	db: D1Database,
	input: PluginScope & { plan_id: string; changed_at: string },
) {
	assertScope(input);
	if (!input.plan_id || !isCanonicalTimestamp(input.changed_at)) {
		throw new TypeError("Plugin activation requires a plan and canonical timestamp");
	}
	const plan = await loadInstallationPlanReceipt(db, input.plan_id);
	if (plan.instance_id !== input.instance_id || plan.target !== input.target) {
		throw new Error("PLUGIN_INSTALLATION_PLAN_SCOPE_MISMATCH");
	}
	if (plan.status === "active") {
		return { ...input, status: "active" as const, plugin_count: plan.plugin_count };
	}
	if (plan.status !== "installed") throw new Error("PLUGIN_INSTALLATION_PLAN_NOT_INSTALLED");
	const rows = await db
		.prepare(
			`SELECT item.plugin_id, item.artifact_checksum, item.health_status,
			        health.evidence_checksum, health.expires_at, lifecycle.state,
			        json_extract(item.derived_contract_json, '$.plugin_lock.version') AS plugin_version
			 FROM superboard_plugin_installation_items item
			 JOIN superboard_plugin_runtime_health health
			   ON health.instance_id = ? AND health.target = ?
			  AND health.plugin_id = item.plugin_id
			 JOIN superboard_plugin_lifecycle lifecycle
			   ON lifecycle.instance_id = ? AND lifecycle.target = ?
			  AND lifecycle.plugin_id = item.plugin_id
			 WHERE item.plan_id = ?
			 ORDER BY item.plugin_id`,
		)
		.bind(input.instance_id, input.target, input.instance_id, input.target, input.plan_id)
		.all<{
			plugin_id: string;
			artifact_checksum: string;
			health_status: "ready" | "unavailable";
			evidence_checksum: string;
			expires_at: string;
			state: SuperBoardPluginLifecycleState;
			plugin_version: string;
		}>();
	if (rows.results.length !== plan.plugin_count)
		throw new Error("PLUGIN_INSTALLATION_PLAN_INCOMPLETE");
	for (const row of rows.results) {
		if (
			row.health_status !== "ready" ||
			Date.parse(row.expires_at) <= Date.parse(input.changed_at)
		) {
			throw new Error(`PLUGIN_ACTIVATION_HEALTH_NOT_READY:${row.plugin_id}`);
		}
		if (row.state !== "installed" && row.state !== "active") {
			throw new Error(`PLUGIN_ACTIVATION_STATE_INVALID:${row.plugin_id}:${row.state}`);
		}
	}

	const statements: D1PreparedStatement[] = [];
	for (const row of rows.results) {
		statements.push(
			db
				.prepare(
					`UPDATE superboard_plugin_lifecycle
					 SET artifact_checksum = ?, state = 'active', plan_id = ?,
					     state_changed_at = ?, reason = 'explicit plan activation'
					 WHERE instance_id = ? AND target = ? AND plugin_id = ?`,
				)
				.bind(
					row.artifact_checksum,
					input.plan_id,
					input.changed_at,
					input.instance_id,
					input.target,
					row.plugin_id,
				),
			db
				.prepare(
					`INSERT INTO superboard_plugin_lifecycle_events
					 (instance_id, target, plugin_id, artifact_checksum, from_state, to_state,
					  plan_id, reason, changed_at)
					 VALUES (?, ?, ?, ?, ?, 'active', ?, 'explicit plan activation', ?)`,
				)
				.bind(
					input.instance_id,
					input.target,
					row.plugin_id,
					row.artifact_checksum,
					row.state,
					input.plan_id,
					input.changed_at,
				),
			db
				.prepare(
					`UPDATE superboard_plugin_installation_items
					 SET state = 'active' WHERE plan_id = ? AND plugin_id = ?`,
				)
				.bind(input.plan_id, row.plugin_id),
			db
				.prepare(
					`INSERT INTO superboard_active_plugin_manifests
					 (plugin_id, artifact_checksum, activated_at)
					 VALUES (?, ?, ?)
					 ON CONFLICT(plugin_id) DO UPDATE SET
					   artifact_checksum = excluded.artifact_checksum,
					   activated_at = excluded.activated_at`,
				)
				.bind(row.plugin_id, row.artifact_checksum, input.changed_at),
			db
				.prepare(
					`INSERT INTO superboard_dependency_health
					 (instance_id, dependency_id, status, evidence_checksum, checked_at, expires_at)
					 VALUES (?, ?, 'ready', ?, ?, ?)
					 ON CONFLICT(instance_id, dependency_id) DO UPDATE SET
					   status = 'ready', evidence_checksum = excluded.evidence_checksum,
					   checked_at = excluded.checked_at, expires_at = excluded.expires_at`,
				)
				.bind(
					input.instance_id,
					dependencyId(row.plugin_id),
					row.evidence_checksum,
					input.changed_at,
					row.expires_at,
				),
		);
	}
	statements.push(
		db
			.prepare(
				`UPDATE superboard_plugin_installation_plans
				 SET status = 'active', completed_at = ? WHERE plan_id = ?`,
			)
			.bind(input.changed_at, input.plan_id),
	);
	await db.batch(statements);
	await writeEmDashPluginStates(
		db,
		rows.results.map((row) => ({ plugin_id: row.plugin_id, version: row.plugin_version })),
		"active",
		input.changed_at,
	);
	return { ...input, status: "active" as const, plugin_count: rows.results.length };
}

export async function transitionSuperBoardPluginLifecycle(
	db: D1Database,
	input: PluginScope & {
		plugin_id: string;
		to_state: SuperBoardPluginLifecycleState;
		changed_at: string;
		reason: string;
	},
) {
	assertScope(input);
	if (!input.plugin_id || !input.reason.trim() || !isCanonicalTimestamp(input.changed_at)) {
		throw new TypeError("Plugin lifecycle transition requires plugin, reason and timestamp");
	}
	const current = await db
		.prepare(
			`SELECT lifecycle.artifact_checksum, lifecycle.state, lifecycle.plan_id,
			        json_extract(artifact.manifest_json, '$.plugin_version') AS plugin_version
			 FROM superboard_plugin_lifecycle lifecycle
			 JOIN superboard_plugin_manifest_artifacts artifact
			   ON artifact.artifact_checksum = lifecycle.artifact_checksum
			 WHERE lifecycle.instance_id = ? AND lifecycle.target = ? AND lifecycle.plugin_id = ?`,
		)
		.bind(input.instance_id, input.target, input.plugin_id)
		.first<{
			artifact_checksum: string;
			state: SuperBoardPluginLifecycleState;
			plan_id: string | null;
			plugin_version: string;
		}>();
	if (!current) throw new Error("PLUGIN_LIFECYCLE_NOT_FOUND");
	if (!LIFECYCLE_TRANSITIONS[current.state].includes(input.to_state)) {
		throw new Error(`PLUGIN_LIFECYCLE_TRANSITION_INVALID:${current.state}:${input.to_state}`);
	}
	if (input.to_state === "active") {
		const health = await db
			.prepare(
				`SELECT status, expires_at FROM superboard_plugin_runtime_health
				 WHERE instance_id = ? AND target = ? AND plugin_id = ?`,
			)
			.bind(input.instance_id, input.target, input.plugin_id)
			.first<{ status: "ready" | "unavailable"; expires_at: string }>();
		if (
			!health ||
			health.status !== "ready" ||
			Date.parse(health.expires_at) <= Date.parse(input.changed_at)
		) {
			throw new Error(`PLUGIN_ACTIVATION_HEALTH_NOT_READY:${input.plugin_id}`);
		}
	}

	const statements: D1PreparedStatement[] = [
		db
			.prepare(
				`UPDATE superboard_plugin_lifecycle
				 SET state = ?, state_changed_at = ?, reason = ?
				 WHERE instance_id = ? AND target = ? AND plugin_id = ? AND state = ?`,
			)
			.bind(
				input.to_state,
				input.changed_at,
				input.reason,
				input.instance_id,
				input.target,
				input.plugin_id,
				current.state,
			),
		db
			.prepare(
				`INSERT INTO superboard_plugin_lifecycle_events
				 (instance_id, target, plugin_id, artifact_checksum, from_state, to_state,
				  plan_id, reason, changed_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				input.instance_id,
				input.target,
				input.plugin_id,
				current.artifact_checksum,
				current.state,
				input.to_state,
				current.plan_id,
				input.reason,
				input.changed_at,
			),
	];
	if (input.to_state !== "active") {
		const unavailableEvidence = await sha256Canonical({
			domain: "superboard.plugin_runtime_health.v1",
			...input,
			artifact_checksum: current.artifact_checksum,
			status: "unavailable",
		});
		statements.push(
			db
				.prepare(
					`DELETE FROM superboard_active_plugin_manifests
					 WHERE plugin_id = ? AND artifact_checksum = ?`,
				)
				.bind(input.plugin_id, current.artifact_checksum),
			db
				.prepare(
					`UPDATE superboard_plugin_runtime_health
					 SET status = 'unavailable', evidence_checksum = ?, checked_at = ?
					 WHERE instance_id = ? AND target = ? AND plugin_id = ?`,
				)
				.bind(
					unavailableEvidence,
					input.changed_at,
					input.instance_id,
					input.target,
					input.plugin_id,
				),
			db
				.prepare(
					`UPDATE superboard_dependency_health
					 SET status = 'unavailable', evidence_checksum = ?, checked_at = ?
					 WHERE instance_id = ? AND dependency_id = ?`,
				)
				.bind(
					unavailableEvidence,
					input.changed_at,
					input.instance_id,
					dependencyId(input.plugin_id),
				),
		);
	}
	await db.batch(statements);
	await writeEmDashPluginStates(
		db,
		[{ plugin_id: input.plugin_id, version: current.plugin_version }],
		input.to_state === "active" ? "active" : "inactive",
		input.changed_at,
	);
	return { ...input, from_state: current.state, state: input.to_state };
}

export async function synchronizeSuperBoardPluginCatalog(
	db: D1Database,
	input: {
		instance_id: string;
		target?: SuperBoardPluginTarget;
		plan_id?: string;
		checked_at: string;
		expires_at: string;
	},
) {
	const scope = { instance_id: input.instance_id, target: input.target ?? ("local" as const) };
	const plan = await installSuperBoardPluginCatalog(db, {
		...scope,
		plan_id: input.plan_id ?? `plugin-plan-${crypto.randomUUID()}`,
		checked_at: input.checked_at,
		expires_at: input.expires_at,
	});
	await activateSuperBoardPluginInstallationPlan(db, {
		...scope,
		plan_id: plan.plan_id,
		changed_at: input.checked_at,
	});
	return {
		instance_id: input.instance_id,
		target: scope.target,
		plan_id: plan.plan_id,
		checked_at: input.checked_at,
		expires_at: input.expires_at,
		installed: plan.plugins.map((plugin) => ({
			plugin_id: plugin.plugin_id,
			plugin_version: plugin.derived.plugin_lock.version,
			artifact_checksum: plugin.derived.plugin_lock.artifact_checksum,
			dependency_id: dependencyId(plugin.plugin_id),
			evidence_checksum: plugin.health_evidence_checksum,
			status: "active" as const,
		})),
		templates: superBoardRuntimePluginCatalog().templates,
	};
}

export async function loadActiveSuperBoardPluginLock(db: D1Database, scope: PluginScope) {
	assertScope(scope);
	const rows = await db
		.prepare(
			`SELECT lifecycle.plugin_id, lifecycle.artifact_checksum, artifact.manifest_json,
			        health.status AS health_status
			 FROM superboard_plugin_lifecycle lifecycle
			 JOIN superboard_plugin_manifest_artifacts artifact
			   ON artifact.artifact_checksum = lifecycle.artifact_checksum
			 JOIN superboard_plugin_runtime_health health
			   ON health.instance_id = lifecycle.instance_id
			  AND health.target = lifecycle.target
			  AND health.plugin_id = lifecycle.plugin_id
			  AND health.artifact_checksum = lifecycle.artifact_checksum
			 WHERE lifecycle.instance_id = ? AND lifecycle.target = ?
			   AND lifecycle.state = 'active'
			 ORDER BY lifecycle.plugin_id`,
		)
		.bind(scope.instance_id, scope.target)
		.all<{
			plugin_id: string;
			artifact_checksum: string;
			manifest_json: string;
			health_status: "ready" | "unavailable";
		}>();
	if (rows.results.length === 0) throw new Error("PLUGIN_CATALOG_ACTIVE_SET_EMPTY");
	const catalog = new Map(
		superBoardRuntimePluginCatalog().plugins.map(({ manifest }) => [manifest.plugin_id, manifest]),
	);
	return Promise.all(
		rows.results.map(async (row) => {
			if (row.health_status !== "ready") {
				throw new Error(`PLUGIN_CATALOG_HEALTH_NOT_READY:${row.plugin_id}`);
			}
			const manifest = catalog.get(row.plugin_id);
			if (!manifest) throw new Error(`PLUGIN_CATALOG_NOT_SYNCHRONIZED:${row.plugin_id}`);
			let stored: unknown;
			try {
				stored = JSON.parse(row.manifest_json);
			} catch {
				throw new Error(`PLUGIN_CATALOG_STORED_MANIFEST_INVALID:${row.plugin_id}`);
			}
			const verification =
				row.artifact_checksum === manifest.artifact_checksum
					? row.plugin_id === userPluginManifest.plugin_id
						? await validateUserPluginManifest(stored)
						: await verifySuperBoardPluginManifest(stored)
					: await verifyCompatibleStoredManifest(stored, row.plugin_id, row.artifact_checksum);
			if (
				!verification.valid ||
				typeof stored !== "object" ||
				stored === null ||
				!("plugin_id" in stored) ||
				stored.plugin_id !== row.plugin_id ||
				!("artifact_checksum" in stored) ||
				stored.artifact_checksum !== row.artifact_checksum
			) {
				throw new Error(
					`PLUGIN_CATALOG_STORED_MANIFEST_INVALID:${row.plugin_id}:${verification.errors.join(",")}`,
				);
			}
			const storedManifest = stored as SuperBoardPluginManifest;
			return {
				plugin_id: storedManifest.plugin_id,
				version: storedManifest.plugin_version,
				artifact_checksum: storedManifest.artifact_checksum,
				native: storedManifest.execution.backend === "native",
			};
		}),
	);
}

async function derivePluginContract(
	plugin: SuperBoardRuntimePlugin,
	input: PlanInput,
): Promise<PlannedPlugin> {
	const { manifest, worker_descriptor: workerDescriptor } = plugin;
	const verification =
		manifest.plugin_id === userPluginManifest.plugin_id
			? await validateUserPluginManifest(manifest)
			: await verifySuperBoardPluginManifest(manifest);
	if (!verification.valid) {
		throw new Error(`${manifest.plugin_id} manifest is invalid: ${verification.errors.join(",")}`);
	}
	for (const store of manifest.stores) {
		if (store.authority !== manifest.plugin_id || store.migrations.length === 0) {
			throw new Error(
				`PLUGIN_STORE_MIGRATION_CONTRACT_INVALID:${manifest.plugin_id}:${store.store_id}`,
			);
		}
	}
	assertNamespacedContributions(manifest);
	if (workerDescriptor) {
		const { checksum, ...descriptorPayload } = workerDescriptor;
		if ((await sha256Canonical(descriptorPayload)) !== checksum) {
			throw new Error(`PLUGIN_WORKER_DESCRIPTOR_CHECKSUM_INVALID:${manifest.plugin_id}`);
		}
		if (
			workerDescriptor.authoritative_writes ||
			workerDescriptor.store_ids.toSorted().join("\n") !==
				manifest.stores
					.map(({ store_id: storeId }) => storeId)
					.toSorted()
					.join("\n")
		) {
			throw new Error(`PLUGIN_WORKER_DESCRIPTOR_SCOPE_INVALID:${manifest.plugin_id}`);
		}
	}
	const stores = await Promise.all(
		manifest.stores.map(async (store) => ({
			store_id: store.store_id,
			schema_version: store.schema_version,
			migrations_checksum: await sha256Canonical(store.migrations),
		})),
	);
	const workerStatus =
		manifest.plugin_kind === "full" || workerDescriptor?.deployment_status === "ready"
			? ("ready" as const)
			: ("unavailable" as const);
	const derived: DerivedPluginContract = {
		stores,
		capabilities: manifest.capabilities.toSorted(),
		capability_approval_checksum: await sha256Canonical({
			plugin_id: manifest.plugin_id,
			artifact_checksum: manifest.artifact_checksum,
			capabilities: manifest.capabilities.toSorted(),
			resources: manifest.resources.toSorted(),
		}),
		settings_checksum: await sha256Canonical(manifest.settings),
		contributions_checksum: await sha256Canonical({
			schemas: manifest.schemas,
			renderers: manifest.renderers,
			commands: manifest.commands,
			data_sources: manifest.data_sources,
		}),
		migrations_checksum: await sha256Canonical(stores),
		worker_descriptor_checksum: workerDescriptor?.checksum ?? null,
		worker_status: workerStatus,
		plugin_lock: {
			plugin_id: manifest.plugin_id,
			version: manifest.plugin_version,
			artifact_checksum: manifest.artifact_checksum,
			native: manifest.execution.backend === "native",
		},
	};
	return {
		manifest,
		worker_descriptor: workerDescriptor,
		derived,
		derived_contract_checksum: await sha256Canonical(derived),
		health_evidence_checksum: await sha256Canonical({
			domain: "superboard.plugin_runtime_health.v1",
			instance_id: input.instance_id,
			target: input.target,
			plugin_id: manifest.plugin_id,
			plugin_version: manifest.plugin_version,
			artifact_checksum: manifest.artifact_checksum,
			worker_descriptor_checksum: workerDescriptor?.checksum ?? null,
			status: workerStatus,
			checked_at: input.checked_at,
			expires_at: input.expires_at,
		}),
	};
}

async function loadInstallationPlanReceipt(db: D1Database, planId: string) {
	const plan = await db
		.prepare(
			`SELECT plan_id, instance_id, target, status, catalog_checksum, plugin_count,
			        created_at, completed_at
			 FROM superboard_plugin_installation_plans WHERE plan_id = ?`,
		)
		.bind(planId)
		.first<{
			plan_id: string;
			instance_id: string;
			target: SuperBoardPluginTarget;
			status: "installing" | "installed" | "active" | "failed";
			catalog_checksum: string;
			plugin_count: number;
			created_at: string;
			completed_at: string | null;
		}>();
	if (!plan) throw new Error("PLUGIN_INSTALLATION_PLAN_NOT_FOUND");
	const items = await db
		.prepare(
			`SELECT plugin_id, state, derived_contract_json, derived_contract_checksum
			 FROM superboard_plugin_installation_items
			 WHERE plan_id = ? ORDER BY plugin_id`,
		)
		.bind(planId)
		.all<{
			plugin_id: string;
			state: "staged" | "installed" | "active" | "failed";
			derived_contract_json: string;
			derived_contract_checksum: string;
		}>();
	const healthRows = await db
		.prepare(
			`SELECT plugin_id, evidence_checksum FROM superboard_plugin_runtime_health
			 WHERE instance_id = ? AND target = ?`,
		)
		.bind(plan.instance_id, plan.target)
		.all<{ plugin_id: string; evidence_checksum: string }>();
	const health = new Map(healthRows.results.map((row) => [row.plugin_id, row.evidence_checksum]));
	const plugins = await Promise.all(
		items.results.map(async (item) => {
			let derived: DerivedPluginContract;
			try {
				derived = JSON.parse(item.derived_contract_json) as DerivedPluginContract;
			} catch {
				throw new Error(`PLUGIN_INSTALLATION_PLAN_CONTRACT_INVALID:${item.plugin_id}`);
			}
			if ((await sha256Canonical(derived)) !== item.derived_contract_checksum) {
				throw new Error(`PLUGIN_INSTALLATION_PLAN_CONTRACT_INVALID:${item.plugin_id}`);
			}
			return {
				plugin_id: item.plugin_id,
				state: item.state,
				derived,
				derived_contract_checksum: item.derived_contract_checksum,
				health_evidence_checksum: health.get(item.plugin_id),
			};
		}),
	);
	return {
		...plan,
		plugins,
	};
}

function lifecycleInstallationEvents(
	db: D1Database,
	input: PlanInput & {
		plugin_id: string;
		artifact_checksum: string;
		current_state: SuperBoardPluginLifecycleState | undefined;
		to_state: "staged" | "installed";
	},
): D1PreparedStatement[] {
	const path: SuperBoardPluginLifecycleState[] = [];
	if (!input.current_state) path.push("available", "staged");
	else if (input.current_state === "available") path.push("staged");
	else if (input.current_state === "disabled") path.push("staged");
	else if (input.current_state === "purged") path.push("available", "staged");
	if (input.to_state === "installed" && input.current_state !== "installed") path.push("installed");
	const statements: D1PreparedStatement[] = [];
	let fromState: SuperBoardPluginLifecycleState | null = input.current_state ?? null;
	for (const toState of path) {
		statements.push(
			db
				.prepare(
					`INSERT INTO superboard_plugin_lifecycle_events
					 (instance_id, target, plugin_id, artifact_checksum, from_state, to_state,
					  plan_id, reason, changed_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, 'installation plan', ?)`,
				)
				.bind(
					input.instance_id,
					input.target,
					input.plugin_id,
					input.artifact_checksum,
					fromState,
					toState,
					input.plan_id,
					input.checked_at,
				),
		);
		fromState = toState;
	}
	return statements;
}

async function writeEmDashPluginStates(
	db: D1Database,
	plugins: readonly { plugin_id: string; version: string }[],
	status: "active" | "inactive",
	changedAt: string,
): Promise<void> {
	if (plugins.length === 0) return;
	try {
		await db.batch(
			plugins.map(({ plugin_id: pluginId, version }) =>
				db
					.prepare(
						`INSERT INTO _plugin_state
						 (plugin_id, version, status, installed_at, activated_at, deactivated_at, source)
						 VALUES (?, ?, ?, ?, ?, ?, 'config')
						 ON CONFLICT(plugin_id) DO UPDATE SET
						   version = excluded.version,
						   status = excluded.status,
						   activated_at = excluded.activated_at,
						   deactivated_at = excluded.deactivated_at,
						   source = 'config'`,
					)
					.bind(
						pluginId,
						version,
						status,
						changedAt,
						status === "active" ? changedAt : null,
						status === "inactive" ? changedAt : null,
					),
			),
		);
	} catch (error) {
		if (error instanceof Error && MISSING_PLUGIN_STATE_TABLE_PATTERN.test(error.message)) return;
		throw error;
	}
}

function assertNamespacedContributions(manifest: SuperBoardPluginManifest): void {
	const ids = [
		...manifest.stores.map(({ store_id: id }) => id),
		...manifest.schemas.map(({ schema_id: id }) => id),
		...manifest.renderers.map(({ renderer_id: id }) => id),
		...manifest.commands.map(({ command_id: id }) => id),
		...manifest.data_sources.map(({ data_source_id: id }) => id),
	];
	if (ids.some((id) => !id.startsWith(`${manifest.plugin_id}.`))) {
		throw new Error(`PLUGIN_CONTRIBUTION_NAMESPACE_INVALID:${manifest.plugin_id}`);
	}
	if (new Set(ids).size !== ids.length) {
		throw new Error(`PLUGIN_CONTRIBUTION_COLLISION:${manifest.plugin_id}`);
	}
}

async function verifyCompatibleStoredManifest(
	stored: unknown,
	pluginId: string,
	artifactChecksum: string,
): Promise<{ valid: boolean; errors: string[] }> {
	const structural = await verifySuperBoardPluginManifest(stored);
	const errors = structural.errors.filter((error) => error !== "ARTIFACT_CHECKSUM_MISMATCH");
	const registered = compatibility.artifacts[artifactChecksum];
	if (
		!registered ||
		registered.plugin_id !== pluginId ||
		(await sha256Canonical(stored)) !== registered.manifest_checksum
	) {
		errors.push("ARTIFACT_CHECKSUM_MISMATCH");
	}
	return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

function dependencyId(pluginId: string): string {
	return `dependency.${pluginId.replaceAll("-", "_")}`;
}

function assertPlanInput(input: PlanInput): void {
	assertScope(input);
	if (
		!input.plan_id ||
		!isCanonicalTimestamp(input.checked_at) ||
		!isCanonicalTimestamp(input.expires_at) ||
		Date.parse(input.expires_at) <= Date.parse(input.checked_at)
	) {
		throw new TypeError("Plugin installation plan requires a bounded validity window");
	}
}

function assertScope(input: PluginScope): void {
	if (!input.instance_id || !TARGETS.has(input.target)) {
		throw new TypeError("Plugin lifecycle requires a valid Instance and target");
	}
}

function isCanonicalTimestamp(value: string): boolean {
	return !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}
