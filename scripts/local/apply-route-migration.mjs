import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { compileFrontRelease } from "../../packages/supbrd-core/dist/index.js";
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function ulid() {
	let time = Date.now();
	let timeChars = "";
	for (let i = 9; i >= 0; i--) {
		timeChars = ENCODING[time % 32] + timeChars;
		time = Math.floor(time / 32);
	}
	let randChars = "";
	for (let i = 0; i < 16; i++) {
		randChars += ENCODING[Math.floor(Math.random() * 32)];
	}
	return timeChars + randChars;
}

const root = resolve(import.meta.dirname, "../..");
const siteEnvPath = "/Users/appmonster/.local/share/superboard/local/mbza-development/site.env";
const dbPaths = [
	"/Users/appmonster/.local/share/superboard/local/mbza-development/state/v3/d1/miniflare-D1DatabaseObject/e7352547963de7050bd7d94658afc4fe78b61811b7815da12d90be8e863abf4d.sqlite",
	resolve(
		root,
		"apps/site/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/e7352547963de7050bd7d94658afc4fe78b61811b7815da12d90be8e863abf4d.sqlite",
	),
];

const urlMap = {
	// Authentification
	"/app/users": "/auth/users",
	"/identity/en/apps": "/auth/apps?lang=en",
	"/identity/fr/apps": "/auth/apps?lang=fr",
	"/identity/en/settings": "/auth/settings?lang=en",
	"/identity/fr/settings": "/auth/settings?lang=fr",
	"/identity/en/logs": "/auth/logs?lang=en",
	"/identity/fr/logs": "/auth/logs?lang=fr",

	// Data
	"/system/content": "/data/content",
	"/system/files": "/data/files",

	// Monetization
	"/products/purchases": "/monetization/purchases",
	"/products/customers": "/monetization/customers",
	"/products": "/monetization/products",
	"/products/offerings": "/monetization/offerings",
	"/products/entitlements": "/monetization/entitlements",

	// Communication
	"/marketing/campaigns": "/communication/campaigns",
	"/marketing/in-app-messages": "/communication/in-app-messages",
	"/marketing/email": "/communication/marketing-email",
	"/notifications": "/communication/notifications",
	"/marketing/channels": "/communication/channels",
	"/marketing/statistics": "/communication/statistics",
	"/marketing/settings": "/communication/settings",
	"/system/email": "/communication/email",
	"/marketing/journeys": "/communication/journeys",

	// Acquisition
	"/paywalls": "/acquisition/paywalls",
	"/paywalls/statistics": "/acquisition/paywalls/statistics",
	"/flows/workflows": "/acquisition/workflows",
	"/flows/launchpad": "/acquisition/launchpad",
	"/flows/components": "/acquisition/components",
	"/flows/users": "/acquisition/users",
	"/flows/settings/environments": "/acquisition/settings/environments",
	"/dynamic-links/links": "/acquisition/dynamic-links",
	"/dynamic-links/campaigns": "/acquisition/dynamic-links/campaigns",
	"/dynamic-links/redirect-rules": "/acquisition/dynamic-links/redirect-rules",
	"/dynamic-links/domain": "/acquisition/dynamic-links/domain",
	"/dynamic-links/social-media-preview": "/acquisition/dynamic-links/social-media-preview",
	"/dynamic-links/tracking": "/acquisition/dynamic-links/tracking",
};

const routeMappings = [
	{
		from: "/app/users",
		to: "/auth/users",
		slug: "auth--users",
		name: "Users",
		pluginId: "supbrd-plug-user",
		routeId: "superboard.users",
		rendererId: "supbrd-plug-user.renderer.admin_surface",
	},
	{
		from: "/identity/:lang/apps",
		to: "/auth/apps",
		slug: "auth--apps",
		name: "Applications",
		pluginId: "supbrd-plug-user",
		routeId: "superboard.identity_by_lang_apps",
		rendererId: "supbrd-plug-user.renderer.admin_surface",
		query: { lang: { required: false, type: "string" } },
		parameters: {},
	},
	{
		from: "/identity/:lang/settings",
		to: "/auth/settings",
		slug: "auth--settings",
		name: "Settings",
		pluginId: "supbrd-plug-user",
		routeId: "superboard.identity_by_lang_settings",
		rendererId: "supbrd-plug-user.renderer.admin_surface",
		query: { lang: { required: false, type: "string" } },
		parameters: {},
	},
	{
		from: "/identity/:lang/logs",
		to: "/auth/logs",
		slug: "auth--logs",
		name: "Logs",
		pluginId: "supbrd-plug-user",
		routeId: "superboard.identity_by_lang_logs",
		rendererId: "supbrd-plug-user.renderer.admin_surface",
		query: { lang: { required: false, type: "string" } },
		parameters: {},
	},
	{
		from: "/system/content",
		to: "/data/content",
		slug: "data--content",
		name: "Content repository",
		pluginId: "supbrd-plug-content",
		routeId: "superboard.system_content",
		rendererId: "supbrd-plug-content.renderer.admin_surface",
	},
	{
		from: "/system/files",
		to: "/data/files",
		slug: "data--files",
		name: "File storage",
		pluginId: "supbrd-plugmod-files",
		routeId: "superboard.system_files",
		rendererId: "supbrd-plugmod-files.renderer.admin_surface",
	},
	{
		from: "/products/purchases",
		to: "/monetization/purchases",
		slug: "monetization--purchases",
		name: "Purchases",
		pluginId: "supbrd-plugmod-billing",
		routeId: "superboard.products_purchases",
		rendererId: "supbrd-plugmod-billing.renderer.admin_surface",
	},
	{
		from: "/products/customers",
		to: "/monetization/customers",
		slug: "monetization--customers",
		name: "Customers",
		pluginId: "supbrd-plugmod-billing",
		routeId: "superboard.products_customers",
		rendererId: "supbrd-plugmod-billing.renderer.admin_surface",
	},
	{
		from: "/products",
		to: "/monetization/products",
		slug: "monetization--products",
		name: "Products",
		pluginId: "supbrd-plug-products",
		routeId: "superboard.products",
		rendererId: "supbrd-plug-products.renderer.admin_surface",
	},
	{
		from: "/products/offerings",
		to: "/monetization/offerings",
		slug: "monetization--offerings",
		name: "Offerings",
		pluginId: "supbrd-plug-products",
		routeId: "superboard.products_offerings",
		rendererId: "supbrd-plug-products.renderer.admin_surface",
	},
	{
		from: "/products/entitlements",
		to: "/monetization/entitlements",
		slug: "monetization--entitlements",
		name: "Entitlements",
		pluginId: "supbrd-plugmod-billing",
		routeId: "superboard.products_entitlements",
		rendererId: "supbrd-plugmod-billing.renderer.admin_surface",
	},
	{
		from: "/marketing/campaigns",
		to: "/communication/campaigns",
		slug: "communication--campaigns",
		name: "Campaigns",
		pluginId: "supbrd-plugmod-marketing",
		routeId: "superboard.marketing_campaigns",
		rendererId: "supbrd-plugmod-marketing.renderer.admin_surface",
	},
	{
		from: "/marketing/in-app-messages",
		to: "/communication/in-app-messages",
		slug: "communication--in-app-messages",
		name: "In-app Messages",
		pluginId: "supbrd-plugmod-marketing",
		routeId: "superboard.marketing_in_app_messages",
		rendererId: "supbrd-plugmod-marketing.renderer.admin_surface",
	},
	{
		from: "/marketing/email",
		to: "/communication/marketing-email",
		slug: "communication--marketing-email",
		name: "Email",
		pluginId: "supbrd-plugmod-marketing",
		routeId: "superboard.marketing_email",
		rendererId: "supbrd-plugmod-marketing.renderer.admin_surface",
	},
	{
		from: "/notifications",
		to: "/communication/notifications",
		slug: "communication--notifications",
		name: "Push notifications",
		pluginId: "supbrd-plugmod-marketing",
		routeId: "superboard.notifications",
		rendererId: "supbrd-plugmod-marketing.renderer.admin_surface",
	},
	{
		from: "/marketing/channels",
		to: "/communication/channels",
		slug: "communication--channels",
		name: "Channels",
		pluginId: "supbrd-plugmod-marketing",
		routeId: "superboard.marketing_channels",
		rendererId: "supbrd-plugmod-marketing.renderer.admin_surface",
	},
	{
		from: "/marketing/statistics",
		to: "/communication/statistics",
		slug: "communication--statistics",
		name: "Statistics",
		pluginId: "supbrd-plugmod-marketing",
		routeId: "superboard.marketing_statistics",
		rendererId: "supbrd-plugmod-marketing.renderer.admin_surface",
	},
	{
		from: "/marketing/settings",
		to: "/communication/settings",
		slug: "communication--settings",
		name: "Settings",
		pluginId: "supbrd-plugmod-marketing",
		routeId: "superboard.marketing_settings",
		rendererId: "supbrd-plugmod-marketing.renderer.admin_surface",
	},
	{
		from: "/system/email",
		to: "/communication/email",
		slug: "communication--email",
		name: "Email delivery",
		pluginId: "supbrd-plugmod-email",
		routeId: "superboard.system_email",
		rendererId: "supbrd-plugmod-email.renderer.admin_surface",
	},
	{
		from: "/marketing/journeys",
		to: "/communication/journeys",
		slug: "communication--journeys",
		name: "Journeys",
		pluginId: "supbrd-plugmod-marketing",
		routeId: "superboard.marketing_journeys",
		rendererId: "supbrd-plugmod-marketing.renderer.admin_surface",
	},
	{
		from: "/paywalls",
		to: "/acquisition/paywalls",
		slug: "acquisition--paywalls",
		name: "Paywalls",
		pluginId: "supbrd-plugmod-paywalls",
		routeId: "superboard.paywalls",
		rendererId: "supbrd-plugmod-paywalls.renderer.admin_surface",
	},
	{
		from: "/paywalls/statistics",
		to: "/acquisition/paywalls/statistics",
		slug: "acquisition--paywalls--statistics",
		name: "Paywall statistics",
		pluginId: "supbrd-plugmod-paywalls",
		routeId: "superboard.paywalls_statistics",
		rendererId: "supbrd-plugmod-paywalls.renderer.admin_surface",
	},
	{
		from: "/flows/workflows",
		to: "/acquisition/workflows",
		slug: "acquisition--workflows",
		name: "Workflows",
		pluginId: "supbrd-plugmod-flows",
		routeId: "superboard.flows_workflows",
		rendererId: "supbrd-plugmod-flows.renderer.admin_surface",
	},
	{
		from: "/flows/launchpad",
		to: "/acquisition/launchpad",
		slug: "acquisition--launchpad",
		name: "Launchpad",
		pluginId: "supbrd-plugmod-flows",
		routeId: "superboard.flows_launchpad",
		rendererId: "supbrd-plugmod-flows.renderer.admin_surface",
	},
	{
		from: "/flows/components",
		to: "/acquisition/components",
		slug: "acquisition--components",
		name: "Components",
		pluginId: "supbrd-plugmod-flows",
		routeId: "superboard.flows_components",
		rendererId: "supbrd-plugmod-flows.renderer.admin_surface",
	},
	{
		from: "/flows/users",
		to: "/acquisition/users",
		slug: "acquisition--users",
		name: "Users",
		pluginId: "supbrd-plugmod-flows",
		routeId: "superboard.flows_users",
		rendererId: "supbrd-plugmod-flows.renderer.admin_surface",
	},
	{
		from: "/flows/settings/environments",
		to: "/acquisition/settings/environments",
		slug: "acquisition--settings--environments",
		name: "Environments",
		pluginId: "supbrd-plugmod-flows",
		routeId: "superboard.flows_settings_environments",
		rendererId: "supbrd-plugmod-flows.renderer.admin_surface",
	},
	{
		from: "/dynamic-links/links",
		to: "/acquisition/dynamic-links",
		slug: "acquisition--dynamic-links",
		name: "Links",
		pluginId: "supbrd-plugmod-dynamic-links",
		routeId: "superboard.dynamic_links_links",
		rendererId: "supbrd-plugmod-dynamic-links.renderer.admin_surface",
	},
	{
		from: "/dynamic-links/campaigns",
		to: "/acquisition/dynamic-links/campaigns",
		slug: "acquisition--dynamic-links--campaigns",
		name: "Campaigns",
		pluginId: "supbrd-plugmod-dynamic-links",
		routeId: "superboard.dynamic_links_campaigns",
		rendererId: "supbrd-plugmod-dynamic-links.renderer.admin_surface",
	},
	{
		from: "/dynamic-links/redirect-rules",
		to: "/acquisition/dynamic-links/redirect-rules",
		slug: "acquisition--dynamic-links--redirect-rules",
		name: "Redirect Rules",
		pluginId: "supbrd-plugmod-dynamic-links",
		routeId: "superboard.dynamic_links_redirect_rules",
		rendererId: "supbrd-plugmod-dynamic-links.renderer.admin_surface",
	},
	{
		from: "/dynamic-links/domain",
		to: "/acquisition/dynamic-links/domain",
		slug: "acquisition--dynamic-links--domain",
		name: "Domain",
		pluginId: "supbrd-plugmod-dynamic-links",
		routeId: "superboard.dynamic_links_domain",
		rendererId: "supbrd-plugmod-dynamic-links.renderer.admin_surface",
	},
	{
		from: "/dynamic-links/social-media-preview",
		to: "/acquisition/dynamic-links/social-media-preview",
		slug: "acquisition--dynamic-links--social-media-preview",
		name: "Social Media Preview",
		pluginId: "supbrd-plugmod-dynamic-links",
		routeId: "superboard.dynamic_links_social_media_preview",
		rendererId: "supbrd-plugmod-dynamic-links.renderer.admin_surface",
	},
	{
		from: "/dynamic-links/tracking",
		to: "/acquisition/dynamic-links/tracking",
		slug: "acquisition--dynamic-links--tracking",
		name: "Tracking",
		pluginId: "supbrd-plugmod-dynamic-links",
		routeId: "superboard.dynamic_links_tracking",
		rendererId: "supbrd-plugmod-dynamic-links.renderer.admin_surface",
	},
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
		console.log(`\n=== Migrating database: ${dbPath} ===`);

		// 1. Update _emdash_menu_items
		console.log("Updating _emdash_menu_items...");
		let updatedMenuItems = 0;
		for (const [fromUrl, toUrl] of Object.entries(urlMap)) {
			const count = execSync(
				`sqlite3 "${dbPath}" "SELECT count(*) FROM _emdash_menu_items WHERE custom_url = '${fromUrl}';"`,
				{ encoding: "utf8" },
			).trim();
			if (parseInt(count, 10) > 0) {
				execSync(
					`sqlite3 "${dbPath}" "UPDATE _emdash_menu_items SET custom_url = '${toUrl}' WHERE custom_url = '${fromUrl}';"`,
				);
				updatedMenuItems += parseInt(count, 10);
			}
		}
		console.log(`Updated ${updatedMenuItems} menu item URLs in _emdash_menu_items.`);

		// 2. Insert/update ec_views
		console.log("Updating ec_views...");
		let insertedViews = 0;
		for (const m of routeMappings) {
			const existing = execSync(
				`sqlite3 -json "${dbPath}" "SELECT * FROM ec_views WHERE slug = '${m.slug}';"`,
				{ encoding: "utf8" },
			).trim();
			const rows = existing ? JSON.parse(existing) : [];
			if (rows.length === 0) {
				// Find bindings from source view if available
				const sourceJson = execSync(
					`sqlite3 -json "${dbPath}" "SELECT * FROM ec_views WHERE route_id = '${m.routeId}' LIMIT 1;"`,
					{ encoding: "utf8" },
				).trim();
				const sourceRows = sourceJson ? JSON.parse(sourceJson) : [];
				const bindings = sourceRows[0]?.bindings ?? '{"data_sources":[],"commands":[]}';
				const presentation =
					sourceRows[0]?.presentation ?? '{"schema_version":"1.0.0","blocks":[]}';
				const description = sourceRows[0]?.description ?? "";
				const id = ulid();
				const now = new Date().toISOString();

				execSync(
					`sqlite3 "${dbPath}" "INSERT INTO ec_views (id, slug, status, author_id, primary_byline_id, created_at, updated_at, published_at, scheduled_at, deleted_at, version, live_revision_id, draft_revision_id, locale, translation_group, name, plugin_id, route_id, path, description, renderer_id, presentation, bindings) VALUES ('${id}', '${m.slug}', 'published', NULL, NULL, '${now}', '${now}', '${now}', NULL, NULL, 1, NULL, NULL, 'en', '${id}', '${m.name.replace(/'/g, "''")}', '${m.pluginId}', '${m.routeId}', '${m.to}', '${description.replace(/'/g, "''")}', '${m.rendererId}', '${presentation.replace(/'/g, "''")}', '${bindings.replace(/'/g, "''")}');"`,
				);
				insertedViews++;
			}
		}
		console.log(`Inserted ${insertedViews} views into ec_views.`);

		// 3. Update release candidate
		console.log("Updating superboard_front_release_candidates...");
		const candidateId = "028EB65DB83A646B3822608769";
		const activeRelJson = execSync(
			`sqlite3 "${dbPath}" "SELECT release_json FROM superboard_front_release_candidates WHERE candidate_id = '${candidateId}';"`,
			{ encoding: "utf8" },
		).trim();
		if (!activeRelJson) {
			console.warn(`Candidate ${candidateId} not found in ${dbPath}`);
			continue;
		}
		const rel = JSON.parse(activeRelJson);

		const input = {};
		for (const k of FRONT_RELEASE_INPUT_KEYS) {
			input[k] = JSON.parse(JSON.stringify(rel.payload[k]));
		}
		const { route_manifest_checksum: _route_manifest_checksum, ...cleanRouteManifest } =
			input.front_route_manifest;
		input.front_route_manifest = cleanRouteManifest;
		const { gateway_checksum: _gateway_checksum, ...cleanGatewayManifest } = input.gateway_manifest;
		input.gateway_manifest = cleanGatewayManifest;

		// Update routes
		for (const m of routeMappings) {
			const source = input.front_route_manifest.routes.find((r) => r.route_id === m.routeId);
			if (source) {
				source.path_pattern = m.to;
				if (m.parameters !== undefined) source.parameters = m.parameters;
				if (m.query !== undefined) source.query = m.query;
			}

			// Add or update legacy alias
			const aliasId = `${m.routeId}_legacy`;
			let alias = input.front_route_manifest.routes.find((r) => r.route_id === aliasId);
			if (!alias && source) {
				alias = JSON.parse(JSON.stringify(source));
				alias.route_id = aliasId;
				alias.path_pattern = m.from;
				alias.priority = 100;
				input.front_route_manifest.routes.push(alias);
			} else if (alias) {
				alias.path_pattern = m.from;
				alias.priority = 100;
			}
		}

		// Update presentation navigation
		for (const group of input.presentation.navigation) {
			for (const item of group.items) {
				if (item.href === "/identity/en/apps") item.href = "/auth/apps";
				else if (item.href === "/identity/en/settings") item.href = "/auth/settings";
				else if (item.href === "/identity/en/logs") item.href = "/auth/logs";
				else {
					const map = routeMappings.find((m) => m.from === item.href);
					if (map) item.href = map.to;
				}
			}
		}

		// Compile and re-sign release
		const compiled = await compileFrontRelease(input, {
			kid: "local-operator-release",
			private_key: privateKey,
		});
		console.log(`Recompiled release. Content checksum: ${compiled.content_checksum}`);

		// Update DB candidate
		const compiledJson = JSON.stringify(compiled).replace(/'/g, "''");
		const updateSql = `
UPDATE superboard_front_release_candidates
SET release_json = '${compiledJson}',
    content_checksum = '${compiled.content_checksum}',
    validation_set_checksum = '${compiled.validation_set_checksum}'
WHERE candidate_id = '${candidateId}';
UPDATE superboard_front_previews
SET content_checksum = '${compiled.content_checksum}'
WHERE candidate_id = '${candidateId}';
`;
		const res = spawnSync("sqlite3", [dbPath], {
			input: updateSql,
			encoding: "utf8",
			maxBuffer: 50 * 1024 * 1024,
		});
		if (res.status !== 0) {
			throw new Error(`sqlite3 failed: ${res.stderr}`);
		}
		console.log("Updated candidate in database.");
	}

	console.log("\nMigration completed successfully!");
}

main().catch((err) => {
	console.error("Migration failed:", err);
	process.exit(1);
});
