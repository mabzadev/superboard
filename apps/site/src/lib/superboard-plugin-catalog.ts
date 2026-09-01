import {
	canonicalizeReleasePayload,
	sha256Canonical,
	verifySuperBoardPluginManifest,
	type SuperBoardPluginManifest,
} from "@superboard/supbrd-core";
import { userPluginManifest, validateUserPluginManifest } from "@superboard/supbrd-plug-user";

import topologyJson from "../../../../config/emdash-plugin-topology.json";
import compatibilityJson from "../../../../config/superboard-plugin-compatibility.json";

interface WorkerDescriptor {
	deployment_status: "ready" | "not_ready";
	checksum: string;
}

interface TopologyPlugin {
	manifest: SuperBoardPluginManifest;
	worker_descriptor: WorkerDescriptor | null;
}

const topology = topologyJson as unknown as { plugins: TopologyPlugin[] };
const compatibility = compatibilityJson as {
	artifacts: Record<string, { plugin_id: string; manifest_checksum: string }>;
};
const PLUGIN_ID_PREFIX_PATTERN = /^supbrd-(?:plug|plugmod)-/u;

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
		if (
			entry.manifest.plugin_kind === "module" &&
			entry.worker_descriptor?.deployment_status !== "ready"
		) {
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

export async function synchronizeSuperBoardPluginCatalog(
	db: D1Database,
	input: { instance_id: string; checked_at: string; expires_at: string },
) {
	if (
		!input.instance_id ||
		!isCanonicalTimestamp(input.checked_at) ||
		!isCanonicalTimestamp(input.expires_at) ||
		Date.parse(input.expires_at) <= Date.parse(input.checked_at)
	) {
		throw new TypeError("Plugin catalogue synchronization requires a bounded validity window");
	}
	const catalog = superBoardRuntimePluginCatalog();
	const statements: D1PreparedStatement[] = [];
	const installed = [];
	for (const { manifest, worker_descriptor: workerDescriptor } of catalog.plugins) {
		const verification =
			manifest.plugin_id === userPluginManifest.plugin_id
				? await validateUserPluginManifest(manifest)
				: await verifySuperBoardPluginManifest(manifest);
		if (!verification.valid) {
			throw new Error(
				`${manifest.plugin_id} manifest is invalid: ${verification.errors.join(",")}`,
			);
		}
		const dependencyId = `dependency.${manifest.plugin_id.replaceAll("-", "_")}`;
		const evidenceChecksum = await sha256Canonical({
			domain: "superboard.plugin_runtime_health.v1",
			instance_id: input.instance_id,
			plugin_id: manifest.plugin_id,
			plugin_version: manifest.plugin_version,
			artifact_checksum: manifest.artifact_checksum,
			worker_descriptor_checksum: workerDescriptor?.checksum ?? null,
			checked_at: input.checked_at,
			expires_at: input.expires_at,
		});
		const displayName = displayPluginName(manifest.plugin_id);
		const description = `${manifest.plugin_kind === "full" ? "Full" : "Module"} SuperBoard · ${manifest.stores.length} Stores · ${manifest.commands.length} commands`;
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
					`INSERT INTO superboard_active_plugin_manifests
					 (plugin_id, artifact_checksum, activated_at)
					 VALUES (?, ?, ?)
					 ON CONFLICT(plugin_id) DO UPDATE SET
					   artifact_checksum = excluded.artifact_checksum,
					   activated_at = excluded.activated_at`,
				)
				.bind(manifest.plugin_id, manifest.artifact_checksum, input.checked_at),
			db
				.prepare(
					`INSERT INTO _plugin_state
					 (plugin_id, version, status, installed_at, activated_at, deactivated_at,
					  data, source, marketplace_version, display_name, description,
					  registry_publisher_did, registry_slug, mcp_tools_enabled, mcp_tools_consent)
					 VALUES (?, ?, 'active', ?, ?, NULL, ?, 'config', NULL, ?, ?, NULL, NULL, 0, NULL)
					 ON CONFLICT(plugin_id) DO UPDATE SET
					   version = excluded.version,
					   status = 'active',
					   activated_at = excluded.activated_at,
					   deactivated_at = NULL,
					   data = excluded.data,
					   source = 'config',
					   display_name = excluded.display_name,
					   description = excluded.description`,
				)
				.bind(
					manifest.plugin_id,
					manifest.plugin_version,
					input.checked_at,
					input.checked_at,
					canonicalizeReleasePayload({
						artifact_checksum: manifest.artifact_checksum,
						plugin_kind: manifest.plugin_kind,
						execution: manifest.execution,
					}),
					displayName,
					description,
				),
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
					dependencyId,
					evidenceChecksum,
					input.checked_at,
					input.expires_at,
				),
		);
		installed.push({
			plugin_id: manifest.plugin_id,
			plugin_version: manifest.plugin_version,
			artifact_checksum: manifest.artifact_checksum,
			dependency_id: dependencyId,
			evidence_checksum: evidenceChecksum,
			status: "active" as const,
		});
	}
	await db.batch(statements);
	return {
		instance_id: input.instance_id,
		checked_at: input.checked_at,
		expires_at: input.expires_at,
		installed,
		templates: catalog.templates,
	};
}

export async function loadActiveSuperBoardPluginLock(db: D1Database) {
	const rows = await db
		.prepare(
			`SELECT active.plugin_id, active.artifact_checksum, artifact.manifest_json
			 FROM superboard_active_plugin_manifests active
			 JOIN superboard_plugin_manifest_artifacts artifact
			   ON artifact.artifact_checksum = active.artifact_checksum
			 WHERE active.plugin_id NOT LIKE '%*%'
			 ORDER BY active.plugin_id`,
		)
		.all<{ plugin_id: string; artifact_checksum: string; manifest_json: string }>();
	if (rows.results.length === 0) throw new Error("PLUGIN_CATALOG_ACTIVE_SET_EMPTY");
	const catalog = new Map(
		superBoardRuntimePluginCatalog().plugins.map(({ manifest }) => [manifest.plugin_id, manifest]),
	);
	return Promise.all(
		rows.results.map(async (row) => {
			const manifest = catalog.get(row.plugin_id);
			if (!manifest) {
				throw new Error(`PLUGIN_CATALOG_NOT_SYNCHRONIZED:${row.plugin_id}`);
			}
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

function displayPluginName(pluginId: string): string {
	return pluginId
		.replace(PLUGIN_ID_PREFIX_PATTERN, "")
		.split("-")
		.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
		.join(" ");
}

function isCanonicalTimestamp(value: string): boolean {
	return !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}
