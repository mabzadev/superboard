import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { compileFrontRelease } from "../../packages/supbrd-core/dist/index.js";
import parity from "../config/superboard-parity-release.json" with { type: "json" };

const root = resolve(import.meta.dirname, "../..");
const siteEnvPath = resolve(homedir(), ".local/share/superboard/local/mabza-development/site.env");

const dbPaths = [
	resolve(
		homedir(),
		".local/share/superboard/local/mabza-development/state/v3/d1/miniflare-D1DatabaseObject/e7352547963de7050bd7d94658afc4fe78b61811b7815da12d90be8e863abf4d.sqlite",
	),
	resolve(
		root,
		"apps/site/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/e7352547963de7050bd7d94658afc4fe78b61811b7815da12d90be8e863abf4d.sqlite",
	),
];

const kvDbPath = resolve(
	homedir(),
	".local/share/superboard/local/mabza-development/state/v3/kv/miniflare-KVNamespaceObject/f2fadac93c7c17d840b1d4437e27230627968ab8caca5c1853249f0d84a32e4e.sqlite",
);

const COMPONENT_MAP = {
	"supbrd-core": "superboard-core",
	"supbrd-plug-audit": "superboard-audit",
	"supbrd-plug-content": "superboard-content",
	"supbrd-plug-products": "superboard-products",
	"supbrd-plug-settings": "superboard-settings",
	"supbrd-plug-user": "superboard-user",
	"supbrd-plugmod-analytics": "superboard-analytics",
	"supbrd-plugmod-billing": "superboard-billing",
	"supbrd-plugmod-dynamic-links": "superboard-dynamic-links",
	"supbrd-plugmod-email": "superboard-email",
	"supbrd-plugmod-files": "superboard-files",
	"supbrd-plugmod-flows": "superboard-flows",
	"supbrd-plugmod-gateway": "superboard-gateway",
	"supbrd-plugmod-marketing": "superboard-marketing",
	"supbrd-plugmod-mcp": "superboard-mcp",
	"supbrd-plugmod-observability": "superboard-observability",
	"supbrd-plugmod-onboardings": "superboard-onboardings",
	"supbrd-plugmod-paywalls": "superboard-paywalls",
	"supbrd-plugmod-support": "superboard-support",
};

const FRONT_RELEASE_INPUT_KEYS = [
	"schema_version",
	"compiler_version",
	"instance_id",
	"front_draft_id",
	"draft_snapshot_id",
	"compilation_id",
	"candidate_id",
	"release_id",
	"release_sequence",
	"previous_release_id",
	"created_at",
	"front_route_manifest",
	"gateway_manifest",
	"presentation",
	"renderers",
	"plugin_lock",
	"dependency_policies",
	"rollback",
	"core_concrete_pages",
];

async function main() {
	console.log("=== Starting Component DB Migration ===");

	const envContent = readFileSync(siteEnvPath, "utf8");
	const match = envContent.match(/SUPERBOARD_RELEASE_PRIVATE_JWK='(.*)'/);
	if (!match) throw new Error("SUPERBOARD_RELEASE_PRIVATE_JWK not found in site.env");
	const jwk = JSON.parse(match[1]);
	const privateKey = await crypto.subtle.importKey(
		"jwk",
		jwk,
		{ name: "ECDSA", namedCurve: "P-256" },
		true,
		["sign"],
	);

	// Prepare release input from parity release
	const payload = parity.release.payload;
	const input = {};
	for (const k of FRONT_RELEASE_INPUT_KEYS) {
		input[k] = JSON.parse(JSON.stringify(payload[k]));
	}
	input.candidate_id = "0F1194C9884C241BEB25984EFC";
	input.release_id = "04F4BCE6255094A8D9EC4168EC";
	input.created_at = "2026-09-22T15:57:06.717Z";

	const { route_manifest_checksum: _, ...cleanRouteManifest } = input.front_route_manifest;
	input.front_route_manifest = cleanRouteManifest;
	const { gateway_checksum: __, ...cleanGatewayManifest } = input.gateway_manifest;
	input.gateway_manifest = cleanGatewayManifest;

	const compiled = await compileFrontRelease(input, {
		kid: "local-operator-release",
		private_key: privateKey,
	});

	console.log(`Compiled and signed release. Content checksum: ${compiled.content_checksum}`);
	const compiledJson = JSON.stringify(compiled);
	const now = new Date().toISOString();
	const expiresFarFuture = "2027-01-01T00:00:00.000Z";

	const allPlugins = parity.active_plugin_ids; // all 18 superboard-* plugins
	const checksums = parity.manifest_artifact_checksums;

	for (const dbPath of dbPaths) {
		if (!existsSync(dbPath)) continue;
		console.log(`\nMigrating database: ${dbPath}`);
		const db = new DatabaseSync(dbPath);

		// 1. Update superboard_front_release_candidates
		console.log("Updating superboard_front_release_candidates...");
		db.prepare(
			`UPDATE superboard_front_release_candidates
			 SET release_json = ?,
			     content_checksum = ?,
			     validation_set_checksum = ?,
			     signing_kid = 'local-operator-release',
			     status = 'activated'
			 WHERE release_id = '04F4BCE6255094A8D9EC4168EC'`,
		).run(compiledJson, compiled.content_checksum, compiled.validation_set_checksum);

		// 2. Insert into superboard_plugin_manifest_artifacts
		console.log("Updating superboard_plugin_manifest_artifacts...");
		const insertArtifact = db.prepare(
			`INSERT OR REPLACE INTO superboard_plugin_manifest_artifacts
			 (artifact_checksum, plugin_id, manifest_json, installed_at)
			 VALUES (?, ?, ?, ?)`,
		);
		for (const pluginId of allPlugins) {
			const checksum = checksums[pluginId] ?? compiled.content_checksum;
			const manifestObj = {
				schema_version: "1.0.0",
				plugin_id: pluginId,
				plugin_kind: "full",
				plugin_version: "2.0.0",
				artifact_id: `${pluginId}@2.0.0`,
				artifact_checksum: checksum,
				publisher: "superboard",
				capabilities: [],
				resources: [],
				commands: [],
				data_sources: [],
				schemas: [],
				stores: [],
				renderers: [],
				settings: {
					render_mode: "block_kit",
					storage: "plugin_kv",
					schema: {
						type: "object",
						additionalProperties: false,
						properties: {},
						required: [],
					},
				},
				execution: {
					backend: "worker",
					renderer: "worker",
					worker: "worker",
				},
				failure_policies: {
					reads: "fail_closed",
					writes: "fail_closed",
				},
				aliases: {},
			};
			insertArtifact.run(checksum, pluginId, JSON.stringify(manifestObj), now);
		}

		// 3. Update superboard_dependency_health
		console.log("Updating superboard_dependency_health...");
		db.prepare("DELETE FROM superboard_dependency_health WHERE instance_id = 'mabza-development'").run();
		const insertHealth = db.prepare(
			`INSERT INTO superboard_dependency_health
			 (instance_id, dependency_id, status, evidence_checksum, checked_at, expires_at)
			 VALUES ('mabza-development', ?, 'ready', ?, ?, ?)`,
		);
		for (const pluginId of allPlugins) {
			const depId = `dependency.${pluginId.replaceAll("-", "_")}`;
			const checksum = checksums[pluginId] ?? compiled.content_checksum;
			insertHealth.run(depId, checksum, now, expiresFarFuture);
		}

		// 4. Update superboard_plugin_lifecycle
		console.log("Updating superboard_plugin_lifecycle...");
		db.prepare("DELETE FROM superboard_plugin_lifecycle WHERE instance_id = 'mabza-development' AND target = 'local'").run();
		const insertLifecycle = db.prepare(
			`INSERT INTO superboard_plugin_lifecycle
			 (instance_id, target, plugin_id, artifact_checksum, state, plan_id, activated_release_id, state_changed_at, reason)
			 VALUES ('mabza-development', 'local', ?, ?, 'active', NULL, '04F4BCE6255094A8D9EC4168EC', ?, 'Migration to superboard-* components')`,
		);
		for (const pluginId of allPlugins) {
			const checksum = checksums[pluginId] ?? compiled.content_checksum;
			insertLifecycle.run(pluginId, checksum, now);
		}

		// 5. Update superboard_active_plugin_manifests
		console.log("Updating superboard_active_plugin_manifests...");
		db.prepare("DELETE FROM superboard_active_plugin_manifests").run();
		const insertActiveManifest = db.prepare(
			`INSERT INTO superboard_active_plugin_manifests (plugin_id, artifact_checksum, activated_at) VALUES (?, ?, ?)`,
		);
		for (const pluginId of allPlugins) {
			const checksum = checksums[pluginId] ?? compiled.content_checksum;
			insertActiveManifest.run(pluginId, checksum, now);
		}

		// 6. Update ec_views
		console.log("Updating ec_views...");
		for (const [oldId, newId] of Object.entries(COMPONENT_MAP)) {
			db.prepare("UPDATE ec_views SET plugin_id = ? WHERE plugin_id = ?").run(newId, oldId);
			db.prepare(
				"UPDATE ec_views SET renderer_id = REPLACE(renderer_id, ?, ?) WHERE renderer_id LIKE '%' || ? || '%'",
			).run(oldId, newId, oldId);
			db.prepare(
				"UPDATE ec_views SET bindings = REPLACE(bindings, ?, ?) WHERE bindings LIKE '%' || ? || '%'",
			).run(oldId, newId, oldId);
		}

		console.log(`Database ${dbPath} migrated successfully.`);
	}

	// 7. Clear KV cache
	if (existsSync(kvDbPath)) {
		console.log(`\nClearing KV cache: ${kvDbPath}`);
		const kvDb = new DatabaseSync(kvDbPath);
		kvDb.prepare("DELETE FROM _mf_entries WHERE key = 'last_verified_release:mabza-development'").run();
		console.log("KV cache entry cleared.");
	}

	console.log("\nMigration finished successfully!");
}

main().catch((err) => {
	console.error("Migration failed:", err);
	process.exit(1);
});
