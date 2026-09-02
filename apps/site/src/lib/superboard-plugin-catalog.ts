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
	approved_by: string;
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
	step_receipts: Record<PluginInstallationStep, string>;
	plugin_lock: PluginLockEntry;
}

interface PluginLockEntry {
	plugin_id: string;
	version: string;
	artifact_checksum: string;
	native: boolean;
}

type PluginInstallationStep =
	| "artifact_verified"
	| "publisher_verified"
	| "capabilities_approved"
	| "stores_provisioned"
	| "migration_graph_verified"
	| "worker_deployed_inactive"
	| "health_verified"
	| "release_contract_ready";

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
	installed: ["quarantined"],
	active: ["draining", "quarantined"],
	draining: ["quarantined"],
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
		const receipt = await loadInstallationPlanReceipt(db, input.plan_id);
		if (receipt.status === "failed") throw new Error("PLUGIN_INSTALLATION_PLAN_FAILED");
		if (receipt.status === "installed") {
			const active = await db
				.prepare(
					`SELECT plugin_id FROM superboard_plugin_lifecycle
					 WHERE instance_id = ? AND target = ? AND state = 'active'`,
				)
				.bind(input.instance_id, input.target)
				.all<{ plugin_id: string }>();
			const activeIds = new Set(active.results.map(({ plugin_id: pluginId }) => pluginId));
			await writeEmDashPluginStates(
				db,
				receipt.plugins.flatMap(({ derived }) =>
					activeIds.has(derived.plugin_lock.plugin_id)
						? []
						: [
								{
									plugin_id: derived.plugin_lock.plugin_id,
									version: derived.plugin_lock.version,
								},
							],
				),
				"inactive",
				input.checked_at,
			);
		}
		return receipt;
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
			installationStepsStatement(db, input, plugin),
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
				 SET status = ?, completed_at = ?, compensation_status = ?, failure_json = ?
				 WHERE plan_id = ? AND status = 'installing'`,
			)
			.bind(
				failed ? "failed" : "installed",
				input.checked_at,
				"not_required",
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

export async function prepareSuperBoardPluginLifecycleForRelease(
	db: D1Database,
	input: PluginScope & {
		release_id: string;
		plugin_lock: readonly PluginLockEntry[];
		prepared_at: string;
	},
) {
	assertScope(input);
	if (!input.release_id || !isCanonicalTimestamp(input.prepared_at)) {
		throw new TypeError("Plugin lifecycle preparation requires a Release and timestamp");
	}
	const candidate = await db
		.prepare(
			`SELECT release_json FROM superboard_front_release_candidates
			 WHERE instance_id = ? AND release_id = ? AND status IN ('approved', 'activated')`,
		)
		.bind(input.instance_id, input.release_id)
		.first<{ release_json: string }>();
	if (!candidate) throw new Error("PLUGIN_RELEASE_NOT_APPROVED");
	let candidatePluginLock: unknown;
	try {
		const release: unknown = JSON.parse(candidate.release_json);
		candidatePluginLock =
			typeof release === "object" &&
			release !== null &&
			"payload" in release &&
			typeof release.payload === "object" &&
			release.payload !== null &&
			"plugin_lock" in release.payload
				? release.payload.plugin_lock
				: null;
	} catch {
		throw new Error("PLUGIN_RELEASE_LOCK_INVALID");
	}
	if (
		canonicalizeReleasePayload(candidatePluginLock) !==
		canonicalizeReleasePayload(input.plugin_lock)
	) {
		throw new Error("PLUGIN_RELEASE_LOCK_MISMATCH");
	}
	const desiredLocks = input.plugin_lock.filter(
		({ plugin_id: pluginId }) => pluginId !== "supbrd-core",
	);
	const releasableLocks = await loadReleasableSuperBoardPluginLock(db, input);
	const releasable = new Map(releasableLocks.map((lock) => [lock.plugin_id, lock]));
	for (const lock of desiredLocks) {
		const current = releasable.get(lock.plugin_id);
		if (
			!current ||
			current.version !== lock.version ||
			current.artifact_checksum !== lock.artifact_checksum ||
			current.native !== lock.native
		) {
			throw new Error(`PLUGIN_RELEASE_LOCK_NOT_RELEASABLE:${lock.plugin_id}`);
		}
	}
	const desired = new Set(desiredLocks.map(({ plugin_id: pluginId }) => pluginId));
	const lifecycle = await db
		.prepare(
			`SELECT plugin_id, state FROM superboard_plugin_lifecycle
			 WHERE instance_id = ? AND target = ?
			 ORDER BY plugin_id`,
		)
		.bind(input.instance_id, input.target)
		.all<{ plugin_id: string; state: SuperBoardPluginLifecycleState }>();
	for (const row of lifecycle.results) {
		if (row.state === "active" && !desired.has(row.plugin_id)) {
			throw new Error(`PLUGIN_RELEASE_DRAIN_REQUIRED:${row.plugin_id}`);
		}
	}
	await db
		.prepare(
			`INSERT INTO superboard_plugin_release_reconciliations
			 (instance_id, target, release_id, plugin_lock_json, status, prepared_at, applied_at)
			 VALUES (?, ?, ?, ?, 'prepared', ?, NULL)
			 ON CONFLICT(instance_id, target, release_id) DO UPDATE SET
			   plugin_lock_json = excluded.plugin_lock_json,
			   prepared_at = excluded.prepared_at
			 WHERE superboard_plugin_release_reconciliations.status = 'prepared'`,
		)
		.bind(
			input.instance_id,
			input.target,
			input.release_id,
			canonicalizeReleasePayload(input.plugin_lock),
			input.prepared_at,
		)
		.run();
	return {
		instance_id: input.instance_id,
		target: input.target,
		release_id: input.release_id,
		status: "prepared" as const,
		plugin_count: desiredLocks.length,
	};
}

export async function finalizeSuperBoardPluginLifecycleForRelease(
	db: D1Database,
	input: PluginScope & { release_id: string; finalized_at: string },
) {
	assertScope(input);
	if (!input.release_id || !isCanonicalTimestamp(input.finalized_at)) {
		throw new TypeError("Plugin lifecycle finalization requires a Release and timestamp");
	}
	const reconciliation = await db
		.prepare(
			`SELECT reconciliation.status, reconciliation.plugin_lock_json,
			        active.active_release_id
			 FROM superboard_plugin_release_reconciliations reconciliation
			 LEFT JOIN superboard_front_active_releases active
			   ON active.instance_id = reconciliation.instance_id
			  AND active.active_release_id = reconciliation.release_id
			 WHERE reconciliation.instance_id = ? AND reconciliation.target = ?
			   AND reconciliation.release_id = ?`,
		)
		.bind(input.instance_id, input.target, input.release_id)
		.first<{
			status: "prepared" | "applied";
			plugin_lock_json: string;
			active_release_id: string | null;
		}>();
	if (reconciliation?.status !== "applied" || !reconciliation.active_release_id) {
		throw new Error("PLUGIN_RELEASE_RECONCILIATION_NOT_APPLIED");
	}
	const rows = await db
		.prepare(
			`SELECT lifecycle.plugin_id, lifecycle.artifact_checksum, lifecycle.state,
			        json_extract(artifact.manifest_json, '$.plugin_version') AS plugin_version
			 FROM superboard_plugin_lifecycle lifecycle
			 JOIN superboard_plugin_manifest_artifacts artifact
			   ON artifact.artifact_checksum = lifecycle.artifact_checksum
			 WHERE lifecycle.instance_id = ? AND lifecycle.target = ?
			   AND lifecycle.activated_release_id = ?
			   AND lifecycle.state IN ('active', 'disabled')
			 ORDER BY lifecycle.plugin_id`,
		)
		.bind(input.instance_id, input.target, input.release_id)
		.all<{
			plugin_id: string;
			artifact_checksum: string;
			state: "active" | "disabled";
			plugin_version: string;
		}>();
	const activated = rows.results.filter(({ state }) => state === "active");
	const disabled = rows.results.filter(({ state }) => state === "disabled");
	let preparedLock: PluginLockEntry[];
	try {
		const parsed: unknown = JSON.parse(reconciliation.plugin_lock_json);
		if (!Array.isArray(parsed)) throw new TypeError("Plugin Lock is not an array");
		preparedLock = parsed as PluginLockEntry[];
	} catch {
		throw new Error("PLUGIN_RELEASE_LOCK_INVALID");
	}
	const desired = preparedLock.filter(({ plugin_id: pluginId }) => pluginId !== "supbrd-core");
	const activeById = new Map(activated.map((row) => [row.plugin_id, row]));
	if (
		activeById.size !== desired.length ||
		desired.some((lock) => {
			const row = activeById.get(lock.plugin_id);
			return (
				!row ||
				row.plugin_version !== lock.version ||
				row.artifact_checksum !== lock.artifact_checksum
			);
		})
	) {
		throw new Error("PLUGIN_RELEASE_RECONCILIATION_INCOMPLETE");
	}
	await writeEmDashPluginStates(
		db,
		activated.map(({ plugin_id: pluginId, plugin_version: version }) => ({
			plugin_id: pluginId,
			version,
		})),
		"active",
		input.finalized_at,
	);
	await writeEmDashPluginStates(
		db,
		disabled.map(({ plugin_id: pluginId, plugin_version: version }) => ({
			plugin_id: pluginId,
			version,
		})),
		"inactive",
		input.finalized_at,
	);
	return {
		instance_id: input.instance_id,
		target: input.target,
		release_id: input.release_id,
		status: "reconciled" as const,
		plugin_count: activated.length,
		disabled_count: disabled.length,
		activated_plugin_ids: activated.map(({ plugin_id: pluginId }) => pluginId),
		disabled_plugin_ids: disabled.map(({ plugin_id: pluginId }) => pluginId),
	};
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
		approved_by: string;
		checked_at: string;
		expires_at: string;
	},
) {
	const scope = { instance_id: input.instance_id, target: input.target ?? ("local" as const) };
	const plan = await installSuperBoardPluginCatalog(db, {
		...scope,
		plan_id: input.plan_id ?? `plugin-plan-${crypto.randomUUID()}`,
		approved_by: input.approved_by,
		checked_at: input.checked_at,
		expires_at: input.expires_at,
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
			status: "installed" as const,
		})),
		templates: superBoardRuntimePluginCatalog().templates,
	};
}

export function loadActiveSuperBoardPluginLock(db: D1Database, scope: PluginScope) {
	return loadSuperBoardPluginLock(db, scope, false);
}

export function loadReleasableSuperBoardPluginLock(db: D1Database, scope: PluginScope) {
	return loadSuperBoardPluginLock(db, scope, true);
}

async function loadSuperBoardPluginLock(
	db: D1Database,
	scope: PluginScope,
	includeInstalled: boolean,
) {
	assertScope(scope);
	const result = await db
		.prepare(
			`SELECT lifecycle.plugin_id, lifecycle.artifact_checksum, artifact.manifest_json,
			        lifecycle.state, health.status AS health_status, health.expires_at,
			        item.derived_contract_json, item.derived_contract_checksum,
			        steps.step_count, steps.completed_count
			 FROM superboard_plugin_lifecycle lifecycle
			 JOIN superboard_plugin_manifest_artifacts artifact
			   ON artifact.artifact_checksum = lifecycle.artifact_checksum
			 JOIN superboard_plugin_runtime_health health
			   ON health.instance_id = lifecycle.instance_id
			  AND health.target = lifecycle.target
			  AND health.plugin_id = lifecycle.plugin_id
			  AND health.artifact_checksum = lifecycle.artifact_checksum
			 LEFT JOIN superboard_plugin_installation_items item
			   ON item.plan_id = lifecycle.plan_id AND item.plugin_id = lifecycle.plugin_id
			  AND item.artifact_checksum = lifecycle.artifact_checksum
			 LEFT JOIN (
			   SELECT plan_id, plugin_id, COUNT(*) AS step_count,
			          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count
			   FROM superboard_plugin_installation_steps GROUP BY plan_id, plugin_id
			 ) steps ON steps.plan_id = item.plan_id AND steps.plugin_id = item.plugin_id
			 WHERE lifecycle.instance_id = ? AND lifecycle.target = ?
			   AND lifecycle.state IN ('installed', 'active')
			 ORDER BY lifecycle.plugin_id`,
		)
		.bind(scope.instance_id, scope.target)
		.all<{
			plugin_id: string;
			artifact_checksum: string;
			manifest_json: string;
			state: "installed" | "active";
			health_status: "ready" | "unavailable";
			expires_at: string;
			derived_contract_json: string | null;
			derived_contract_checksum: string | null;
			step_count: number | null;
			completed_count: number | null;
		}>();
	const rows = includeInstalled
		? result.results
		: result.results.filter(({ state }) => state === "active");
	if (rows.length === 0) {
		throw new Error(
			includeInstalled ? "PLUGIN_CATALOG_RELEASABLE_SET_EMPTY" : "PLUGIN_CATALOG_ACTIVE_SET_EMPTY",
		);
	}
	const catalog = new Map(
		superBoardRuntimePluginCatalog().plugins.map(({ manifest }) => [manifest.plugin_id, manifest]),
	);
	return Promise.all(
		rows.map(async (row) => {
			if (row.health_status !== "ready" || Date.parse(row.expires_at) <= Date.now()) {
				throw new Error(`PLUGIN_CATALOG_HEALTH_NOT_READY:${row.plugin_id}`);
			}
			if (!row.derived_contract_json || !row.derived_contract_checksum) {
				throw new Error(`PLUGIN_INSTALLATION_PLAN_CONTRACT_MISSING:${row.plugin_id}`);
			}
			if (row.step_count !== 8 || row.completed_count !== 8) {
				throw new Error(`PLUGIN_INSTALLATION_PLAN_STEPS_INCOMPLETE:${row.plugin_id}`);
			}
			let derived: DerivedPluginContract;
			try {
				derived = JSON.parse(row.derived_contract_json) as DerivedPluginContract;
			} catch {
				throw new Error(`PLUGIN_INSTALLATION_PLAN_CONTRACT_INVALID:${row.plugin_id}`);
			}
			if (
				(await sha256Canonical(derived)) !== row.derived_contract_checksum ||
				derived.plugin_lock.plugin_id !== row.plugin_id ||
				derived.plugin_lock.artifact_checksum !== row.artifact_checksum
			) {
				throw new Error(`PLUGIN_INSTALLATION_PLAN_CONTRACT_INVALID:${row.plugin_id}`);
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
	if (manifest.publisher !== "superboard") {
		throw new Error(`PLUGIN_PUBLISHER_NOT_APPROVED:${manifest.plugin_id}`);
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
	const capabilities = manifest.capabilities.toSorted();
	const capabilityApprovalChecksum = await sha256Canonical({
		plugin_id: manifest.plugin_id,
		artifact_checksum: manifest.artifact_checksum,
		capabilities,
		resources: manifest.resources.toSorted(),
		approved_by: input.approved_by,
		approved_at: input.checked_at,
	});
	const settingsChecksum = await sha256Canonical(manifest.settings);
	const contributionsChecksum = await sha256Canonical({
		schemas: manifest.schemas,
		renderers: manifest.renderers,
		commands: manifest.commands,
		data_sources: manifest.data_sources,
	});
	const migrationsChecksum = await sha256Canonical(stores);
	const workerDescriptorChecksum = workerDescriptor?.checksum ?? null;
	const pluginLock = {
		plugin_id: manifest.plugin_id,
		version: manifest.plugin_version,
		artifact_checksum: manifest.artifact_checksum,
		native: manifest.execution.backend === "native",
	};
	const stepReceipts: Record<PluginInstallationStep, string> = {
		artifact_verified: await sha256Canonical({
			domain: "superboard.plugin_installation.artifact_verified.v1",
			artifact_id: manifest.artifact_id,
			artifact_checksum: manifest.artifact_checksum,
		}),
		publisher_verified: await sha256Canonical({
			domain: "superboard.plugin_installation.publisher_verified.v1",
			publisher: manifest.publisher,
			plugin_id: manifest.plugin_id,
		}),
		capabilities_approved: capabilityApprovalChecksum,
		stores_provisioned: await sha256Canonical({
			domain: "superboard.plugin_installation.stores_provisioned.v1",
			stores,
		}),
		migration_graph_verified: migrationsChecksum,
		worker_deployed_inactive: await sha256Canonical({
			domain: "superboard.plugin_installation.worker_deployed_inactive.v1",
			worker_descriptor_checksum: workerDescriptorChecksum,
			contributions_active: false,
		}),
		health_verified: await sha256Canonical({
			domain: "superboard.plugin_installation.health_verified.v1",
			worker_descriptor_checksum: workerDescriptorChecksum,
			status: workerStatus,
			checked_at: input.checked_at,
			expires_at: input.expires_at,
		}),
		release_contract_ready: await sha256Canonical({
			domain: "superboard.plugin_installation.release_contract_ready.v1",
			plugin_lock: pluginLock,
			settings_checksum: settingsChecksum,
			contributions_checksum: contributionsChecksum,
		}),
	};
	const derived: DerivedPluginContract = {
		stores,
		capabilities,
		capability_approval_checksum: capabilityApprovalChecksum,
		settings_checksum: settingsChecksum,
		contributions_checksum: contributionsChecksum,
		migrations_checksum: migrationsChecksum,
		worker_descriptor_checksum: workerDescriptorChecksum,
		worker_status: workerStatus,
		step_receipts: stepReceipts,
		plugin_lock: pluginLock,
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
	const result = await db
		.prepare(
			`SELECT plan.plan_id, plan.instance_id, plan.target, plan.status,
			        plan.catalog_checksum, plan.plugin_count, plan.created_at, plan.completed_at,
			        item.plugin_id, item.state AS item_state, item.derived_contract_json,
			        item.derived_contract_checksum, health.evidence_checksum
			 FROM superboard_plugin_installation_plans plan
			 LEFT JOIN superboard_plugin_installation_items item ON item.plan_id = plan.plan_id
			 LEFT JOIN superboard_plugin_runtime_health health
			   ON health.instance_id = plan.instance_id AND health.target = plan.target
			  AND health.plugin_id = item.plugin_id
			  AND health.artifact_checksum = item.artifact_checksum
			 WHERE plan.plan_id = ? ORDER BY item.plugin_id`,
		)
		.bind(planId)
		.all<{
			plan_id: string;
			instance_id: string;
			target: SuperBoardPluginTarget;
			status: "installing" | "installed" | "active" | "failed";
			catalog_checksum: string;
			plugin_count: number;
			created_at: string;
			completed_at: string | null;
			plugin_id: string | null;
			item_state: "staged" | "installed" | "active" | "failed" | null;
			derived_contract_json: string | null;
			derived_contract_checksum: string | null;
			evidence_checksum: string | null;
		}>();
	const first = result.results[0];
	if (!first) throw new Error("PLUGIN_INSTALLATION_PLAN_NOT_FOUND");
	const plugins = await Promise.all(
		result.results
			.flatMap((item) =>
				item.plugin_id &&
				item.item_state &&
				item.derived_contract_json &&
				item.derived_contract_checksum
					? [
							{
								plugin_id: item.plugin_id,
								item_state: item.item_state,
								derived_contract_json: item.derived_contract_json,
								derived_contract_checksum: item.derived_contract_checksum,
								evidence_checksum: item.evidence_checksum,
							},
						]
					: [],
			)
			.map(async (item) => {
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
					state: item.item_state,
					derived,
					derived_contract_checksum: item.derived_contract_checksum,
					health_evidence_checksum: item.evidence_checksum ?? undefined,
				};
			}),
	);
	return {
		plan_id: first.plan_id,
		instance_id: first.instance_id,
		target: first.target,
		status: first.status,
		catalog_checksum: first.catalog_checksum,
		plugin_count: first.plugin_count,
		created_at: first.created_at,
		completed_at: first.completed_at,
		plugins,
	};
}

function installationStepsStatement(
	db: D1Database,
	input: PlanInput,
	plugin: PlannedPlugin,
): D1PreparedStatement {
	const receipts = plugin.derived.step_receipts;
	const healthStatus = plugin.derived.worker_status === "ready" ? "completed" : "failed";
	return db
		.prepare(
			`INSERT INTO superboard_plugin_installation_steps
			 (plan_id, plugin_id, step_name, status, receipt_checksum, completed_at)
			 VALUES
			 (?, ?, 'artifact_verified', 'completed', ?, ?),
			 (?, ?, 'publisher_verified', 'completed', ?, ?),
			 (?, ?, 'capabilities_approved', 'completed', ?, ?),
			 (?, ?, 'stores_provisioned', 'completed', ?, ?),
			 (?, ?, 'migration_graph_verified', 'completed', ?, ?),
			 (?, ?, 'worker_deployed_inactive', 'completed', ?, ?),
			 (?, ?, 'health_verified', ?, ?, ?),
			 (?, ?, 'release_contract_ready', ?, ?, ?)`,
		)
		.bind(
			input.plan_id,
			plugin.manifest.plugin_id,
			receipts.artifact_verified,
			input.checked_at,
			input.plan_id,
			plugin.manifest.plugin_id,
			receipts.publisher_verified,
			input.checked_at,
			input.plan_id,
			plugin.manifest.plugin_id,
			receipts.capabilities_approved,
			input.checked_at,
			input.plan_id,
			plugin.manifest.plugin_id,
			receipts.stores_provisioned,
			input.checked_at,
			input.plan_id,
			plugin.manifest.plugin_id,
			receipts.migration_graph_verified,
			input.checked_at,
			input.plan_id,
			plugin.manifest.plugin_id,
			receipts.worker_deployed_inactive,
			input.checked_at,
			input.plan_id,
			plugin.manifest.plugin_id,
			healthStatus,
			receipts.health_verified,
			input.checked_at,
			input.plan_id,
			plugin.manifest.plugin_id,
			healthStatus,
			receipts.release_contract_ready,
			input.checked_at,
		);
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
		!input.approved_by ||
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
