import { pluginPackage, pluginPackages } from "@superboard/contracts/plugin-packages";

import catalog from "../../../../scripts/config/superboard-plugin-catalog.json";

export interface PluginPackageScope {
	instance_id: string;
	target: "local" | "development" | "production";
}

export async function migratePluginPackages(
	db: D1Database,
	scope: PluginPackageScope,
	targetComponents: readonly string[],
) {
	const migration = await db
		.prepare(
			"SELECT 1 FROM superboard_plugin_package_migrations WHERE instance_id = ? AND target = ? AND migration_id = 'packages-v1'",
		)
		.bind(scope.instance_id, scope.target)
		.first();
	if (migration) return false;
	const busy = await db
		.prepare(
			"SELECT 1 FROM superboard_managed_plugin_operations WHERE instance_id=? AND status='running'",
		)
		.bind(scope.instance_id)
		.first();
	if (busy) throw new Error("PLUGIN_OPERATION_IN_PROGRESS");
	const states = await db
		.prepare(
			"SELECT plugin_id, state FROM superboard_plugin_lifecycle WHERE instance_id = ? AND target = ?",
		)
		.bind(scope.instance_id, scope.target)
		.all<{ plugin_id: string; state: string }>();
	const current = new Map(states.results.map((row) => [row.plugin_id, row.state]));
	const now = new Date().toISOString();
	const statements: D1PreparedStatement[] = [];
	for (const owner of pluginPackages) {
		for (const component of owner.components) {
			const state = current.get(component);
			const enabled =
				state === "active" ||
				((!state || ["available", "staged", "installed"].includes(state)) &&
					targetComponents.includes(component));
			statements.push(
				db
					.prepare(
						"INSERT OR IGNORE INTO superboard_plugin_feature_preferences (instance_id,target,component_id,enabled,updated_at) VALUES (?,?,?,?,?)",
					)
					.bind(scope.instance_id, scope.target, component, Number(enabled), now),
			);
		}
	}
	await db.batch(statements);
	await syncInstalledPluginPackages(db, scope);
	await db
		.prepare(
			"INSERT OR IGNORE INTO superboard_plugin_package_migrations (instance_id,target,migration_id,completed_at) VALUES (?,?,'packages-v1',?)",
		)
		.bind(scope.instance_id, scope.target, now)
		.run();
	return true;
}

export async function syncInstalledPluginPackages(db: D1Database, scope: PluginPackageScope) {
	const rows = await db
		.prepare(
			"SELECT plugin_id,state FROM superboard_plugin_lifecycle WHERE instance_id = ? AND target = ?",
		)
		.bind(scope.instance_id, scope.target)
		.all<{ plugin_id: string; state: string }>();
	const active = new Set(
		rows.results.filter((row) => row.state === "active").map((row) => row.plugin_id),
	);
	const now = new Date().toISOString();
	const result = catalog.plugins.map((owner) => ({
		plugin_id: owner.manifest.plugin_id,
		version: owner.manifest.plugin_version,
		artifact_checksum: owner.manifest.artifact_checksum,
		status:
			owner.kind === "core" || owner.components.some((id) => active.has(id))
				? ("active" as const)
				: ("inactive" as const),
	}));
	await db.batch(
		result.flatMap((row) => [
			db
				.prepare(`INSERT INTO superboard_plugin_packages (instance_id,target,package_id,enabled,version,artifact_checksum,updated_at)
		 VALUES (?,?,?,?,?,?,?) ON CONFLICT(instance_id,target,package_id) DO UPDATE SET enabled=excluded.enabled,version=excluded.version,artifact_checksum=excluded.artifact_checksum,updated_at=excluded.updated_at
		 WHERE enabled <> excluded.enabled OR version <> excluded.version OR artifact_checksum <> excluded.artifact_checksum`)
				.bind(
					scope.instance_id,
					scope.target,
					row.plugin_id,
					Number(row.status === "active"),
					row.version,
					row.artifact_checksum,
					now,
				),
			db
				.prepare(`INSERT INTO _plugin_state (plugin_id,version,status,installed_at,activated_at,deactivated_at,source)
		 VALUES (?,?,?,?,?,?,'config') ON CONFLICT(plugin_id) DO UPDATE SET version=excluded.version,status=excluded.status,activated_at=excluded.activated_at,deactivated_at=excluded.deactivated_at
		 WHERE status <> excluded.status OR version <> excluded.version`)
				.bind(
					row.plugin_id,
					row.version,
					row.status,
					now,
					row.status === "active" ? now : null,
					row.status === "inactive" ? now : null,
				),
		]),
	);
	return result;
}

export async function packageActionComponents(
	db: D1Database,
	scope: PluginPackageScope,
	input: {
		packageId: string;
		action: "enable" | "disable";
		targetComponents: readonly string[];
		featureId?: string;
	},
) {
	const owner = pluginPackage(input.packageId);
	if (!owner) throw new Error("PLUGIN_NOT_FOUND");
	if (input.featureId && !owner.components.includes(input.featureId))
		throw new Error("PLUGIN_FEATURE_NOT_FOUND");
	if (
		input.action === "disable" &&
		owner.kind === "core" &&
		(!input.featureId || owner.required_components.includes(input.featureId))
	)
		throw new Error("CORE_COMPONENT_REQUIRED");
	if (input.featureId) {
		if (input.action === "enable" && !input.targetComponents.includes(input.featureId))
			throw new Error("PLUGIN_FEATURE_NOT_IN_TARGET");
		return { owner, components: [input.featureId] };
	}
	if (input.action === "disable") return { owner, components: owner.components };
	const preferences = await db
		.prepare(
			"SELECT component_id,enabled FROM superboard_plugin_feature_preferences WHERE instance_id = ? AND target = ?",
		)
		.bind(scope.instance_id, scope.target)
		.all<{ component_id: string; enabled: number }>();
	const enabled = new Map(preferences.results.map((row) => [row.component_id, row.enabled === 1]));
	const components = owner.components.filter(
		(id) => input.targetComponents.includes(id) && (enabled.get(id) ?? true),
	);
	if (!components.length) throw new Error("PLUGIN_NO_ENABLED_FEATURES");
	return { owner, components };
}

export async function setPluginFeaturePreference(
	db: D1Database,
	scope: PluginPackageScope,
	componentId: string,
	enabled: boolean,
) {
	await db
		.prepare(
			"INSERT INTO superboard_plugin_feature_preferences (instance_id,target,component_id,enabled,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(instance_id,target,component_id) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at",
		)
		.bind(scope.instance_id, scope.target, componentId, Number(enabled), new Date().toISOString())
		.run();
}

export async function syncPluginPackageRuntime(
	db: D1Database,
	scope: PluginPackageScope,
	runtime: { setPluginStatus(id: string, status: "active" | "inactive"): Promise<void> },
) {
	const packages = await syncInstalledPluginPackages(db, scope);
	for (const owner of packages) await runtime.setPluginStatus(owner.plugin_id, owner.status);
}
