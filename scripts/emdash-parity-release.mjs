import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compileFrontRelease } from "../packages/supbrd-core/dist/index.js";
import {
	composeParityFrontReleaseInput,
	parityRuntimePluginCatalog,
} from "../packages/supbrd-runtime-plugins/dist/front-catalog.js";
import { compileTarget } from "./target-compiler.mjs";

const root = resolve(import.meta.dirname, "..");
const artifactPath = resolve(root, "config/superboard-parity-release.json");
const target = JSON.parse(
	readFileSync(resolve(root, "deploy/targets/mbza-development.json"), "utf8"),
);
const identifiers = {
	instance_id: "mbza-development",
	front_draft_id: "01J00000000000000000007001",
	draft_snapshot_id: "01J00000000000000000007002",
	compilation_id: "01J00000000000000000007003",
	candidate_id: "01J00000000000000000007004",
	release_id: "01J00000000000000000007005",
	release_sequence: 1,
	previous_release_id: null,
	created_at: "2026-09-03T08:00:00.000Z",
};

export async function buildParityReleaseArtifact() {
	const compiledTarget = await compileTarget(target, "local");
	const manifests = new Map(
		parityRuntimePluginCatalog().map((manifest) => [manifest.plugin_id, manifest]),
	);
	const pluginLock = compiledTarget.graph.plugins
		.filter(({ pluginId }) => !pluginId.includes("*"))
		.map((plugin) => {
			const manifest = manifests.get(plugin.pluginId);
			if (
				!manifest ||
				manifest.plugin_version !== plugin.version ||
				manifest.artifact_checksum !== plugin.artifactChecksum
			) {
				throw new Error(`Compiled target manifest drift: ${plugin.pluginId}`);
			}
			return {
				plugin_id: manifest.plugin_id,
				version: manifest.plugin_version,
				artifact_checksum: manifest.artifact_checksum,
				native: false,
			};
		});
	const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
		"sign",
		"verify",
	]);
	const release = await compileFrontRelease(
		composeParityFrontReleaseInput({ ...identifiers, plugin_lock: pluginLock }),
		{ kid: "issue-70-parity", private_key: keys.privateKey },
	);
	const activePluginIds = pluginLock.map(({ plugin_id: pluginId }) => pluginId).toSorted();
	return {
		schema_version: 1,
		target: compiledTarget.target,
		environment: compiledTarget.environment,
		target_artifact_checksum: compiledTarget.checksum,
		target_graph_checksum: compiledTarget.graphChecksum,
		active_plugin_ids: activePluginIds,
		manifest_artifact_checksums: Object.fromEntries(
			pluginLock
				.map(({ plugin_id: pluginId, artifact_checksum: checksum }) => [pluginId, checksum])
				.toSorted(([left], [right]) => left.localeCompare(right)),
		),
		release: {
			content_checksum: release.content_checksum,
			payload: release.payload,
			validation_receipts: release.validation_receipts,
		},
	};
}

export async function verifyParityReleaseArtifact(options = {}) {
	const artifact = await buildParityReleaseArtifact();
	const generated = `${JSON.stringify(artifact, null, 2)}\n`;
	if (options.write) {
		writeFileSync(artifactPath, generated);
		return artifact;
	}
	if (!existsSync(artifactPath) || readFileSync(artifactPath, "utf8") !== generated) {
		throw new Error("Generated artifact drift: config/superboard-parity-release.json");
	}
	return artifact;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const artifact = await verifyParityReleaseArtifact({ write: process.argv.includes("--write") });
	console.log(
		JSON.stringify({
			release_id: artifact.release.payload.release_id,
			content_checksum: artifact.release.content_checksum,
			active_plugin_count: artifact.active_plugin_ids.length,
			target_artifact_checksum: artifact.target_artifact_checksum,
		}),
	);
}
