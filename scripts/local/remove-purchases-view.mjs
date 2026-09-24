import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { compileFrontRelease } from "../../packages/supbrd-core/dist/index.js";

const root = resolve(import.meta.dirname, "../..");
const siteEnvPath = "/Users/appmonster/.local/share/superboard/local/mbza-development/site.env";
const dbPaths = [
	"/Users/appmonster/.local/share/superboard/local/mbza-development/state/v3/d1/miniflare-D1DatabaseObject/e7352547963de7050bd7d94658afc4fe78b61811b7815da12d90be8e863abf4d.sqlite",
	resolve(
		root,
		"apps/site/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/e7352547963de7050bd7d94658afc4fe78b61811b7815da12d90be8e863abf4d.sqlite",
	),
];

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
	const envContent = readFileSync(siteEnvPath, "utf8");
	const match = envContent.match(/SUPERBOARD_RELEASE_PRIVATE_JWK=\x27(.*)\x27/);
	if (!match) throw new Error("SUPERBOARD_RELEASE_PRIVATE_JWK not found in site.env");
	const jwk = JSON.parse(match[1]);
	const privateKey = await crypto.subtle.importKey(
		"jwk",
		jwk,
		{ name: "ECDSA", namedCurve: "P-256" },
		true,
		["sign"],
	);

	for (const dbPath of dbPaths) {
		if (!existsSync(dbPath)) continue;
		console.log(`\n=== Processing database: ${dbPath} ===`);

		// 1. Remove purchases from _emdash_menu_items
		console.log("Cleaning _emdash_menu_items...");
		execSync(
			`sqlite3 "${dbPath}" "DELETE FROM _emdash_menu_items WHERE custom_url IN ('/monetization/purchases', '/products/purchases') AND parent_id IS NOT NULL;"`,
		);
		execSync(
			`sqlite3 "${dbPath}" "UPDATE _emdash_menu_items SET custom_url = '/monetization/customers' WHERE custom_url IN ('/monetization/purchases', '/products/purchases') AND parent_id IS NULL;"`,
		);

		// 2. Remove purchases from ec_views
		console.log("Cleaning ec_views...");
		execSync(
			`sqlite3 "${dbPath}" "DELETE FROM ec_views WHERE path IN ('/monetization/purchases', '/products/purchases') OR slug IN ('monetization--purchases', 'products--purchases');"`,
		);

		// 3. Update candidates in superboard_front_release_candidates
		console.log("Updating superboard_front_release_candidates...");
		const candidateRowsJson = execSync(
			`sqlite3 -json "${dbPath}" "SELECT candidate_id, status FROM superboard_front_release_candidates;"`,
			{ encoding: "utf8" },
		).trim();
		const candidates = candidateRowsJson ? JSON.parse(candidateRowsJson) : [];

		for (const cand of candidates) {
			const activeRelJson = execSync(
				`sqlite3 "${dbPath}" "SELECT release_json FROM superboard_front_release_candidates WHERE candidate_id = '${cand.candidate_id}';"`,
				{ encoding: "utf8" },
			).trim();
			if (!activeRelJson) continue;

			const rel = JSON.parse(activeRelJson);
			const routes = rel.payload?.front_route_manifest?.routes || [];
			const hasPurchasesRoute = routes.some(
				(r) =>
					r.route_id === "superboard.products_purchases" ||
					r.route_id === "superboard.products_purchases_legacy" ||
					r.path_pattern === "/monetization/purchases" ||
					r.path_pattern === "/products/purchases",
			);

			if (!hasPurchasesRoute) {
				continue;
			}

			console.log(`Candidate ${cand.candidate_id} has purchases routes. Recompiling...`);
			const input = {};
			for (const k of FRONT_RELEASE_INPUT_KEYS) {
				input[k] = JSON.parse(JSON.stringify(rel.payload[k]));
			}
			const { route_manifest_checksum: _route_manifest_checksum, ...cleanRouteManifest } =
				input.front_route_manifest;
			input.front_route_manifest = cleanRouteManifest;
			const { gateway_checksum: _gateway_checksum, ...cleanGatewayManifest } =
				input.gateway_manifest;
			input.gateway_manifest = cleanGatewayManifest;

			// Filter out purchases routes
			input.front_route_manifest.routes = input.front_route_manifest.routes.filter(
				(r) =>
					r.route_id !== "superboard.products_purchases" &&
					r.route_id !== "superboard.products_purchases_legacy" &&
					r.path_pattern !== "/monetization/purchases" &&
					r.path_pattern !== "/products/purchases",
			);

			// Filter out purchases navigation items
			if (input.presentation?.navigation) {
				for (const group of input.presentation.navigation) {
					if (group.items) {
						group.items = group.items.filter(
							(item) =>
								item.href !== "/monetization/purchases" && item.href !== "/products/purchases",
						);
					}
				}
			}

			// Compile and re-sign release
			const compiled = await compileFrontRelease(input, {
				kid: "local-operator-release",
				private_key: privateKey,
			});
			console.log(
				`Candidate ${cand.candidate_id} recompiled. New checksum: ${compiled.content_checksum}`,
			);

			// Update DB candidate
			const compiledJson = JSON.stringify(compiled).replace(/'/g, "''");
			const updateSql = `
UPDATE superboard_front_release_candidates
SET release_json = '${compiledJson}',
    content_checksum = '${compiled.content_checksum}',
    validation_set_checksum = '${compiled.validation_set_checksum}'
WHERE candidate_id = '${cand.candidate_id}';
UPDATE superboard_front_previews
SET content_checksum = '${compiled.content_checksum}'
WHERE candidate_id = '${cand.candidate_id}';
`;
			const res = spawnSync("sqlite3", [dbPath], {
				input: updateSql,
				encoding: "utf8",
				maxBuffer: 50 * 1024 * 1024,
			});
			if (res.status !== 0) {
				throw new Error(`sqlite3 failed: ${res.stderr}`);
			}
			console.log(`Updated candidate ${cand.candidate_id} in database.`);
		}
	}

	console.log("\nPurchases view removal completed successfully!");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
