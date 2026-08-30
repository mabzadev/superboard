import { canonicalizeReleasePayload, sha256Canonical } from "@superboard/supbrd-core";
import {
	userPluginManifest,
	validateUserPluginManifest,
} from "@superboard/supbrd-plug-user";

const USER_DEPENDENCY_ID = "dependency.supbrd_plug_user";

export async function installCompiledUserPlugin(
	db: D1Database,
	input: { instance_id: string; checked_at: string; expires_at: string },
) {
	if (
		!input.instance_id ||
		!isCanonicalTimestamp(input.checked_at) ||
		!isCanonicalTimestamp(input.expires_at) ||
		Date.parse(input.expires_at) <= Date.parse(input.checked_at)
	) {
		throw new TypeError("Compiled user plugin installation requires a bounded validity window");
	}
	const verification = await validateUserPluginManifest(userPluginManifest);
	if (!verification.valid) {
		throw new Error(`Compiled user plugin manifest is invalid: ${verification.errors.join(",")}`);
	}
	const evidence = {
		domain: "superboard.dependency_health.v1",
		instance_id: input.instance_id,
		dependency_id: USER_DEPENDENCY_ID,
		plugin_id: userPluginManifest.plugin_id,
		plugin_version: userPluginManifest.plugin_version,
		artifact_checksum: userPluginManifest.artifact_checksum,
		activation_scope: "front_release" as const,
		status: "ready" as const,
		checked_at: input.checked_at,
		expires_at: input.expires_at,
	};
	const evidenceChecksum = await sha256Canonical(evidence);
	const manifestJson = canonicalizeReleasePayload(userPluginManifest);
	await db.batch([
		db
			.prepare(
				`INSERT INTO superboard_plugin_manifest_artifacts
				 (artifact_checksum, plugin_id, manifest_json, installed_at)
				 VALUES (?, ?, ?, ?)
				 ON CONFLICT(artifact_checksum) DO NOTHING`,
			)
			.bind(
				userPluginManifest.artifact_checksum,
				userPluginManifest.plugin_id,
				manifestJson,
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
			.bind(
				userPluginManifest.plugin_id,
				userPluginManifest.artifact_checksum,
				input.checked_at,
			),
		db
			.prepare(
				`INSERT INTO superboard_dependency_health
				 (instance_id, dependency_id, status, evidence_checksum, checked_at, expires_at)
				 VALUES (?, ?, 'ready', ?, ?, ?)
				 ON CONFLICT(instance_id, dependency_id) DO UPDATE SET
				   status = excluded.status,
				   evidence_checksum = excluded.evidence_checksum,
				   checked_at = excluded.checked_at,
				   expires_at = excluded.expires_at`,
			)
			.bind(
				input.instance_id,
				USER_DEPENDENCY_ID,
				evidenceChecksum,
				input.checked_at,
				input.expires_at,
			),
	]);
	return { ...evidence, evidence_checksum: evidenceChecksum };
}

function isCanonicalTimestamp(value: string): boolean {
	return !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}
