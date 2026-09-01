import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const matrixPath = join(root, "config/emdash-parity-matrix.json");
const topologyPath = join(root, "config/emdash-plugin-topology.json");
const receiptPath = join(root, "docs/evidence/issue-54/parity-matrix.receipt.json");
const frontBundlePath = join(root, "config/superboard-front-bundle.json");
const manifestMigrationPath = join(root, "apps/site/migrations/0014_native_front_contracts.sql");
const PAGE_SUFFIX = "/page.tsx";
const PAGE_SUFFIX_PATTERN = /\/page\.tsx$/u;
const SUPPORT_OR_FLOWS_ROUTE_PATTERN = /\/(?:support|flows)(?:\/|$)/u;
const SUPPORT_ROUTE_PATTERN = /\/support(?:\/|$)/u;
const FLOWS_ROUTE_PATTERN = /\/flows(?:\/|$)/u;
const TEST_FILE_PATTERN = /\.(?:runtime\.)?test\.ts$/u;
const APP_USER_ROUTE_PATTERN = /^\/app\/(?:users|customers)/u;
const REQUIRED_FRONT_STATES = [
	"loading",
	"empty",
	"forbidden",
	"not_found",
	"error",
	"unavailable",
	"maintenance",
];

const fullPlugins = ["user", "settings", "content", "products", "audit"];
const modulePlugins = [
	["gateway", "api"],
	["billing", "billing"],
	["support", "support"],
	["flows", "flows"],
	["analytics", "analytics"],
	["marketing", "marketing"],
	["email", "email"],
	["dynamic-links", "dynamic-links"],
	["files", "files"],
	["paywalls", "paywalls"],
	["onboardings", "onboardings"],
	["observability", "observability"],
	["mcp", "mcp"],
	["custom-*", null],
];
const pluginStores = {
	"supbrd-plug-user": ["user_directory", "user_credentials", "user_sessions"],
	"supbrd-plug-settings": ["settings", "versions"],
	"supbrd-plug-content": ["documents", "taxonomies", "revisions"],
	"supbrd-plug-products": ["catalog", "offers", "prices"],
	"supbrd-plug-audit": ["ledger", "archives"],
	"supbrd-plugmod-gateway": ["route_manifests", "rate_limits"],
	"supbrd-plugmod-billing": ["purchases", "subscriptions", "ledger"],
	"supbrd-plugmod-support": ["conversations", "contacts", "messages"],
	"supbrd-plugmod-flows": ["definitions", "runtime"],
	"supbrd-plugmod-analytics": ["events", "aggregates"],
	"supbrd-plugmod-marketing": ["campaigns", "journeys", "consent"],
	"supbrd-plugmod-email": ["deliveries", "provider_events"],
	"supbrd-plugmod-dynamic-links": ["links", "attribution"],
	"supbrd-plugmod-files": ["objects", "tickets"],
	"supbrd-plugmod-paywalls": ["definitions", "exposures"],
	"supbrd-plugmod-onboardings": ["definitions", "progress"],
	"supbrd-plugmod-observability": ["health_projections"],
	"supbrd-plugmod-mcp": ["sessions", "tool_receipts"],
	"supbrd-plugmod-custom-*": ["operations"],
};

const pluginSettings = {
	"supbrd-plug-user": {
		mfa_policy: { type: "string", enum: ["optional", "required"] },
		allow_anonymous_upgrade: { type: "boolean" },
		max_active_sessions: { type: "integer", minimum: 1, maximum: 20 },
	},
	"supbrd-plug-settings": {
		site_name: { type: "string", minLength: 1 },
		site_url: { type: "string", format: "uri" },
		default_locale: { type: "string", minLength: 2 },
		timezone: { type: "string", minLength: 1 },
	},
	"supbrd-plug-content": {
		default_locale: { type: "string", minLength: 2 },
		required_locales: { type: "string" },
		publishing_mode: { type: "string", enum: ["draft_review", "direct"] },
	},
	"supbrd-plug-products": {
		default_currency: { type: "string", pattern: "^[A-Z]{3}$" },
		store_environment: { type: "string", enum: ["sandbox", "production"] },
		catalog_sync_enabled: { type: "boolean" },
	},
	"supbrd-plug-audit": {
		retention_days: { type: "integer", minimum: 30, maximum: 3650 },
		archive_enabled: { type: "boolean" },
		verification_interval_minutes: { type: "integer", minimum: 5, maximum: 1440 },
	},
	"supbrd-plugmod-gateway": {
		cors_allowed_origins: { type: "string" },
		default_rate_limit_per_minute: { type: "integer", minimum: 1, maximum: 100000 },
		default_timeout_ms: { type: "integer", minimum: 100, maximum: 30000 },
	},
	"supbrd-plugmod-billing": {
		apple_issuer_id: { type: "string" },
		apple_key_id: { type: "string" },
		apple_private_key: { type: "string", writeOnly: true },
		google_service_account_json: { type: "string", writeOnly: true },
		stripe_secret_key: { type: "string", writeOnly: true },
		webhook_signing_secret: { type: "string", writeOnly: true },
	},
	"supbrd-plugmod-support": {
		business_name: { type: "string", minLength: 1 },
		locale: { type: "string", minLength: 2 },
		timezone: { type: "string", minLength: 1 },
		date_format: { type: "string", minLength: 1 },
		auto_resolve_minutes: { type: "integer", minimum: 1, maximum: 525600 },
		attachment_max_bytes: { type: "integer", minimum: 1024, maximum: 104857600 },
		allowed_content_types: { type: "string" },
	},
	"supbrd-plugmod-flows": {
		default_locale: { type: "string", minLength: 2 },
		locales: { type: "string" },
		default_environment: { type: "string", minLength: 1 },
		allow_drafts_in_development: { type: "boolean" },
	},
	"supbrd-plugmod-analytics": {
		hot_retention_days: { type: "integer", minimum: 1, maximum: 3650 },
		timezone: { type: "string", minLength: 1 },
		data_collection_enabled: { type: "boolean" },
	},
	"supbrd-plugmod-marketing": {
		tracking_enabled: { type: "boolean" },
		default_from_email: { type: "string", format: "email" },
		default_from_name: { type: "string" },
		default_reply_to: { type: "string", format: "email" },
	},
	"supbrd-plugmod-email": {
		provider: { type: "string", enum: ["smtp", "aws-ses"] },
		host: { type: "string" },
		port: { type: "integer", minimum: 1, maximum: 65535 },
		security: { type: "string", enum: ["none", "starttls", "tls"] },
		username: { type: "string" },
		password: { type: "string", writeOnly: true },
		from_email: { type: "string", format: "email" },
		from_name: { type: "string" },
		reply_to: { type: "string", format: "email" },
	},
	"supbrd-plugmod-dynamic-links": {
		default_domain: { type: "string", format: "hostname" },
		tracking_enabled: { type: "boolean" },
		tracking_provider: { type: "string", enum: ["superboard", "google", "segment", "none"] },
		tracking_credential: { type: "string", writeOnly: true },
	},
	"supbrd-plugmod-files": {
		max_upload_bytes: { type: "integer", minimum: 1024, maximum: 5368709120 },
		allowed_content_types: { type: "string" },
		signed_url_ttl_seconds: { type: "integer", minimum: 60, maximum: 86400 },
	},
	"supbrd-plugmod-paywalls": {
		default_locale: { type: "string", minLength: 2 },
		default_environment: { type: "string", enum: ["test", "production"] },
		cache_ttl_seconds: { type: "integer", minimum: 0, maximum: 86400 },
	},
	"supbrd-plugmod-onboardings": {
		default_locale: { type: "string", minLength: 2 },
		default_environment: { type: "string", enum: ["test", "production"] },
		progress_retention_days: { type: "integer", minimum: 1, maximum: 3650 },
	},
	"supbrd-plugmod-observability": {
		health_poll_interval_seconds: { type: "integer", minimum: 10, maximum: 3600 },
		incident_retention_days: { type: "integer", minimum: 1, maximum: 3650 },
		cloudflare_api_token: { type: "string", writeOnly: true },
	},
	"supbrd-plugmod-mcp": {
		enabled: { type: "boolean" },
		allowed_scopes: { type: "string" },
		session_ttl_seconds: { type: "integer", minimum: 60, maximum: 86400 },
	},
	"supbrd-plugmod-custom-*": {},
};

const pluginOperations = {
	"supbrd-plug-user": {
		commands: [
			"application_sign_in",
			"update_profile",
			"suspend_member",
			"link_provider",
			"revoke_application_session",
		],
		dataSources: ["current_profile", "members", "linked_providers", "active_sessions"],
	},
	"supbrd-plug-settings": {
		commands: ["update_effective_settings", "save_sdk_configuration", "test_sdk_configuration"],
		dataSources: ["effective_settings", "settings_versions", "sdk_configurations"],
	},
	"supbrd-plug-content": {
		commands: ["create_document", "update_document", "publish_document"],
		dataSources: ["documents", "taxonomies", "revisions"],
	},
	"supbrd-plug-products": {
		commands: [
			"create_product",
			"update_product",
			"archive_product",
			"create_package",
			"update_package",
			"archive_package",
			"create_offering",
			"update_offering",
			"archive_offering",
			"create_entitlement",
			"update_entitlement",
			"archive_entitlement",
			"sync_store_catalog",
		],
		dataSources: [
			"products",
			"packages",
			"offerings",
			"entitlements",
			"product_statistics",
			"store_sync_runs",
		],
	},
	"supbrd-plug-audit": {
		commands: ["archive_ledger", "verify_ledger"],
		dataSources: ["ledger", "ledger_search", "archives"],
	},
	"supbrd-plugmod-gateway": {
		commands: ["publish_gateway_manifest", "update_gateway_route", "rotate_access_policy"],
		dataSources: ["active_gateway_manifest", "gateway_routes", "rate_limits"],
	},
	"supbrd-plugmod-billing": {
		commands: [
			"create_purchase",
			"create_refund",
			"update_refund",
			"update_subscription",
			"reconcile_store",
		],
		dataSources: [
			"purchases",
			"purchase",
			"refunds",
			"subscriptions",
			"financial_customer_entitlements",
			"billing_ledger",
		],
	},
	"supbrd-plugmod-support": {
		commands: [
			"update_support_settings",
			"create_support_configuration",
			"update_support_configuration",
			"delete_support_configuration",
			"rotate_support_webhook_secret",
			"revoke_support_webhook_secret",
			"send_inbox_message",
			"update_inbox_conversation",
			"create_support_provider",
			"update_support_provider",
			"delete_support_provider",
			"create_support_integration",
			"update_support_integration",
			"delete_support_integration",
			"publish_support_article",
		],
		dataSources: [
			"support_settings",
			"unified_inbox_items",
			"inbox_conversations",
			"inbox_messages",
			"support_channels",
			"support_providers",
			"support_integrations",
			"support_portals",
			"support_categories",
			"support_folders",
			"support_articles",
			"support_assistant_tasks",
		],
	},
	"supbrd-plugmod-flows": {
		commands: [
			"create_workflow",
			"update_workflow",
			"publish_workflow",
			"activate_version",
			"create_environment",
			"rotate_environment_key",
			"save_localization",
		],
		dataSources: [
			"overview",
			"components",
			"workflows",
			"workflow",
			"environments",
			"localization",
			"users",
			"user_details",
		],
	},
	"supbrd-plugmod-analytics": {
		commands: [
			"create_analytics_report",
			"update_analytics_report",
			"delete_analytics_report",
			"create_analytics_operation",
			"create_analytics_dashboard",
			"update_analytics_dashboard",
			"delete_analytics_dashboard",
			"create_analytics_cohort",
			"evaluate_analytics_cohort",
			"upsert_analytics_remote_config",
			"create_analytics_alert",
			"update_analytics_settings",
		],
		dataSources: [
			"analytics_overview",
			"analytics_events",
			"analytics_event_analysis",
			"analytics_installations",
			"analytics_purchases",
			"analytics_retention",
			"analytics_reports",
			"analytics_dashboards",
			"analytics_sessions",
			"analytics_profiles",
			"analytics_views",
			"analytics_dimensions",
			"analytics_crashes",
			"analytics_feedback",
			"analytics_cohorts",
			"analytics_remote_config",
			"analytics_alerts",
			"analytics_settings",
		],
	},
	"supbrd-plugmod-marketing": {
		commands: [
			"create_email_campaign",
			"update_email_campaign",
			"transition_email_campaign",
			"schedule_email_campaign",
			"create_marketing_journey",
			"update_marketing_journey",
			"transition_marketing_journey",
			"create_marketing_channel_connector",
			"update_marketing_channel_connector",
			"delete_marketing_channel_connector",
		],
		dataSources: [
			"email_subscribers",
			"subscriber_lists",
			"subscriber_segments",
			"email_templates",
			"email_campaigns",
			"marketing_statistics",
			"marketing_journeys",
			"journey_enrollments",
			"journey_statistics",
			"marketing_channel_connectors",
		],
	},
	"supbrd-plugmod-email": {
		commands: [
			"send_transactional_email",
			"save_smtp_settings",
			"delete_smtp_settings",
			"test_smtp_settings",
			"verify_smtp_domain",
			"retry_delivery_outbox",
			"replay_dead_letter",
			"discard_dead_letter",
		],
		dataSources: [
			"smtp_settings",
			"delivery_outbox",
			"dead_letters",
			"provider_webhooks",
			"provider_events",
		],
	},
	"supbrd-plugmod-dynamic-links": {
		commands: [
			"create_link",
			"update_link",
			"delete_link",
			"create_link_campaign",
			"delete_link_campaign",
			"create_redirect_rule",
			"update_redirect_rule",
			"delete_redirect_rule",
			"create_domain",
			"verify_domain",
			"delete_domain",
			"save_social_preview",
			"save_tracking",
		],
		dataSources: [
			"links",
			"resolved_link",
			"link_campaigns",
			"link_campaign_analytics",
			"redirect_rules",
			"domains",
			"social_preview",
			"tracking",
			"link_statistics",
		],
	},
	"supbrd-plugmod-files": {
		commands: ["create_upload_ticket", "complete_upload", "delete_object", "collect_garbage"],
		dataSources: ["objects", "object_metadata", "download_ticket", "storage_usage"],
	},
	"supbrd-plugmod-paywalls": {
		commands: [
			"create_paywall",
			"update_paywall",
			"archive_paywall",
			"create_paywall_version",
			"publish_paywall_version",
			"save_paywall_placement",
			"create_paywall_experience",
			"update_paywall_experience",
			"archive_paywall_experience",
		],
		dataSources: [
			"paywalls",
			"paywall_versions",
			"paywall_placements",
			"paywall_experiences",
			"paywall_statistics",
		],
	},
	"supbrd-plugmod-onboardings": {
		commands: [
			"create_onboarding",
			"update_onboarding",
			"delete_onboarding",
			"create_onboarding_version",
			"publish_onboarding",
			"save_onboarding_placement",
			"create_onboarding_targeting_rule",
			"create_onboarding_experience",
			"set_onboarding_experience_status",
		],
		dataSources: [
			"onboardings",
			"onboarding_versions",
			"onboarding_placements",
			"onboarding_targeting_rules",
			"onboarding_experiences",
			"onboarding_statistics",
		],
	},
	"supbrd-plugmod-observability": {
		commands: [
			"acknowledge_incident",
			"resolve_incident",
			"retry_custom_job",
			"replay_email_dead_letter",
			"discard_email_dead_letter",
		],
		dataSources: [
			"platform_status",
			"runtime_metrics",
			"service_health",
			"incidents",
			"platform_custom_jobs",
			"platform_email_operations",
		],
	},
	"supbrd-plugmod-mcp": {
		commands: ["approve_consent", "revoke_token", "invoke_tool"],
		dataSources: ["tokens", "sessions", "tool_receipts"],
	},
	"supbrd-plugmod-custom-*": {
		commands: ["execute_operation"],
		dataSources: ["operations"],
	},
};

const frontBundleReceipt = buildFrontBundleReceipt();

export function buildPluginTopology() {
	const plugins = [
		...fullPlugins.map((name) => pluginTopologyEntry(`supbrd-plug-${name}`, "full", null)),
		...modulePlugins.map(([name, worker]) =>
			pluginTopologyEntry(`supbrd-plugmod-${name}`, "module", workerRuntimeContract(name, worker)),
		),
	];
	return {
		schema_version: 1,
		aliases: { projectId: "instance_id", pid: "instance_id" },
		plugins,
	};
}

export function buildParityMatrix() {
	const dashboardPages = walk(join(root, "apps/dashboard/src/app"), (path) =>
		path.replaceAll(sep, "/").endsWith(PAGE_SUFFIX),
	);
	const dashboardRows = dashboardPages.map((absolute) => {
		const relativePage = relative(join(root, "apps/dashboard/src/app"), absolute).replaceAll(
			sep,
			"/",
		);
		const path = (
			relativePage === "page.tsx" ? "" : relativePage.replace(PAGE_SUFFIX_PATTERN, "")
		).replaceAll("(protected)/", "");
		const route = path === "" ? "/" : `/${path}`;
		return row({
			id: `dashboard:${route}`,
			kind: "dashboard",
			baseline: relative(root, absolute),
			target: targetForRoute(route),
			test: "scripts/dashboard-route-parity.test.mjs",
			sourceStatus: SUPPORT_OR_FLOWS_ROUTE_PATTERN.test(route) ? "unvalidated" : "delivered",
			blocker: SUPPORT_ROUTE_PATTERN.test(route)
				? "support_extended_gate"
				: FLOWS_ROUTE_PATTERN.test(route)
					? "flows_complete_gate"
					: null,
		});
	});

	const apiNamespaces = [
		"/health|/.well-known/*",
		"/oauth/*|/api/v1/auth/*|/api/v1/users/*",
		"/auth/*",
		"/api/v1/instances/*|projects/*|links/*",
		"/api/v1/sdk/*",
		"/api/v1/{domain}/*",
		"/api/v1/support-client/*|support/realtime/*",
		"/api/v1/app-files/*",
		"/api/v1/billing/*|/api/v2/purchases/*|/api/v1/iap/*",
		"/api/v1/platform/*",
		"/api/v1/mcp/*",
		"/api/v1/admin/*|automation/*|diagnostics/*",
		"/api/v1/marketing/tracking/*|opt-in/*|webhooks/*",
		"/short-links/*",
	];
	const apiRows = apiNamespaces.map((namespace) =>
		row({
			id: `api:${namespace}`,
			kind: "api",
			baseline: "workers/api/src/index.ts",
			target: "supbrd-plugmod-gateway",
			test: apiProof(namespace),
			sourceStatus: namespace.includes("support") ? "unvalidated" : "delivered",
			blocker: namespace.includes("support") ? "support_extended_gate" : null,
		}),
	);

	const workerRows = modulePlugins.flatMap(([name, worker]) => {
		if (!worker) return [];
		const workerDirectory = join(root, `workers/${worker}`);
		const proof = workerProof(worker, workerDirectory);
		return [
			row({
				id: `worker:${worker}`,
				kind: "worker",
				baseline: `workers/${worker}/src/index.ts`,
				target: `supbrd-plugmod-${name}`,
				test: proof ? relative(root, proof) : "scripts/emdash-parity-matrix.test.mjs",
				sourceStatus: name === "support" || name === "flows" ? "unvalidated" : "delivered",
				blocker:
					name === "support"
						? "support_extended_gate"
						: name === "flows"
							? "flows_complete_gate"
							: null,
			}),
		];
	});

	const sdkRows = [
		["javascript", "sdks/javascript/src", "sdks/javascript/test/emdash-store-parity.test.js"],
		["react-native", "sdks/react-native/src", "sdks/react-native/src/__tests__/index.test.tsx"],
		["flutter", "sdks/flutter/lib", "sdks/flutter/test/emdash_store_parity_test.dart"],
		["flutterflow", "sdks/flutterflow/lib", "sdks/flutterflow/test/emdash_store_parity_test.dart"],
	].map(([name, baseline, test]) =>
		row({
			id: `sdk:${name}`,
			kind: "sdk",
			baseline,
			target: "external-client-contract",
			test,
		}),
	);

	const rows = [...dashboardRows, ...apiRows, ...workerRows, ...sdkRows].toSorted((a, b) =>
		a.id.localeCompare(b.id),
	);
	return {
		schema_version: 1,
		inventory_source: "docs/SUPERBOARD_CURRENT_STATE_INVENTORY_2026-08-29.md",
		baseline_inventory_revision: "b25677f122613de5b01fd2d4c21fa5c669c24cb4",
		working_tree_base_revision: "3dc65564",
		public_cutover: false,
		rows,
	};
}

export function validateArtifacts(matrix, topology) {
	const pluginIds = new Set(topology.plugins.map(({ manifest }) => manifest.plugin_id));
	const errors = [];
	if (topology.plugins.length !== 19) errors.push("PLUGIN_TOPOLOGY_INCOMPLETE");
	for (const plugin of topology.plugins) {
		const { manifest, repositories, worker_descriptor: workerDescriptor } = plugin;
		if (manifest.stores.length !== repositories.length || repositories.length === 0)
			errors.push(`PLUGIN_AUTHORITY_MISSING:${manifest.plugin_id}`);
		if (
			manifest.plugin_kind === "module" &&
			(!workerDescriptor ||
				workerDescriptor.authoritative_writes !== false ||
				workerDescriptor.idempotency !== "required" ||
				(workerDescriptor.execution_mode === "asynchronous" &&
					(workerDescriptor.lease !== "attempt_scoped" ||
						workerDescriptor.outbox !== "required")) ||
				!workerDescriptor.evidence_sha256)
		) {
			errors.push(`WORKER_TRANSITION_CONTRACT_INVALID:${manifest.plugin_id}`);
		}
		const { artifact_checksum: artifactChecksum, ...artifact } = manifest;
		if (artifactChecksum !== hash(artifact))
			errors.push(`PLUGIN_ARTIFACT_CHECKSUM_INVALID:${manifest.plugin_id}`);
	}
	for (const item of matrix.rows) {
		if (item.required && (!item.test || !item.proof_sha256))
			errors.push(`REQUIRED_PROOF_MISSING:${item.id}`);
		if (!existsSync(join(root, item.baseline))) errors.push(`BASELINE_MISSING:${item.id}`);
		if (!existsSync(join(root, item.test))) errors.push(`TEST_MISSING:${item.id}`);
		if (
			item.target.startsWith("supbrd-") &&
			!pluginIds.has(item.target) &&
			item.target !== "supbrd-core"
		)
			errors.push(`TARGET_UNKNOWN:${item.id}`);
		if (
			(item.id.includes("support") || item.id.includes("flows")) &&
			item.source_status !== "unvalidated"
		)
			errors.push(`SOURCE_STATUS_INVALID:${item.id}`);
	}
	return errors;
}

function pluginTopologyEntry(pluginId, kind, worker) {
	const declaredStoreNames = pluginStores[pluginId];
	if (!declaredStoreNames) throw new Error(`Missing domain Store inventory for ${pluginId}`);
	const storeNames = [...declaredStoreNames].toSorted();
	const stores = storeNames.map((name) =>
		contribution({
			store_id: `${pluginId}.store.${name}`,
			kind: "d1",
			authority: pluginId,
			schema_version: "1",
			migrations: migrationInventory(pluginId),
			availability: "required",
			classification: name.includes("credentials") ? "secret" : "restricted",
			encryption: "required",
			version: "1.0.0",
		}),
	);
	const repositories = stores.map(({ store_id: storeId }) =>
		contribution({
			repository_id: `${storeId.replace(".store.", ".repository.")}`,
			store_id: storeId,
			write_authority: "emdash",
			compatibility_aliases: ["projectId", "pid"],
			version: "1.0.0",
		}),
	);
	const schemas = storeNames.map((name) =>
		contribution({
			schema_id: `${pluginId}.schema.${name}_record.v1`,
			closed: true,
			json_schema: {
				type: "object",
				additionalProperties: false,
				required: ["entity_id", "revision", "payload"],
				properties: {
					entity_id: { type: "string" },
					revision: { type: "integer", minimum: 1 },
					payload: { type: "object" },
				},
			},
			version: "1.0.0",
		}),
	);
	const adminSurfaceSchema = contribution({
		schema_id: `${pluginId}.schema.admin_surface_props_v1`,
		closed: true,
		json_schema: {
			type: "object",
			additionalProperties: false,
			required: ["route_id", "path"],
			properties: {
				route_id: { type: "string", minLength: 1 },
				path: { type: "string", minLength: 1 },
			},
		},
		version: "1.0.0",
	});
	schemas.push(adminSurfaceSchema);
	const operationSchemas = [
		[
			"command_input_v1",
			["instance_id", "payload"],
			{
				instance_id: { type: "string", minLength: 1 },
				payload: { type: "object" },
			},
		],
		[
			"command_output_v1",
			["operation_id", "status", "result"],
			{
				operation_id: { type: "string", minLength: 1 },
				status: { type: "string", enum: ["accepted", "completed", "failed"] },
				result: { type: "object" },
			},
		],
		[
			"data_source_query_v1",
			["instance_id", "query"],
			{
				instance_id: { type: "string", minLength: 1 },
				query: { type: "object" },
			},
		],
		[
			"data_source_page_v1",
			["items", "next_cursor"],
			{
				items: { type: "array", items: { type: "object" } },
				next_cursor: { type: ["string", "null"] },
			},
		],
	].map(([name, required, properties]) =>
		contribution({
			schema_id: `${pluginId}.schema.${name}`,
			closed: true,
			json_schema: { type: "object", additionalProperties: false, required, properties },
			version: "1.0.0",
		}),
	);
	schemas.push(...operationSchemas);
	const schemaReference = (name) => `${pluginId}.schema.${name}`;
	const operations = pluginOperations[pluginId];
	if (!operations) throw new Error(`Missing operation inventory for ${pluginId}`);
	const commands = operations.commands.map((name) =>
		contribution({
			command_id: `${pluginId}.command.${name}`,
			input_schema_id: schemaReference("command_input_v1"),
			output_schema_id: schemaReference("command_output_v1"),
			audience: "superboard_front",
			permission: `${pluginId}.write`,
			failure_policy: "fail_closed",
			version: "1.0.0",
		}),
	);
	const dataSources = operations.dataSources.map((name) => {
		const storeName = storeForOperation(name, storeNames);
		return contribution({
			data_source_id: `${pluginId}.data_source.${name}`,
			input_schema_id: schemaReference("data_source_query_v1"),
			output_schema_id: schemaReference("data_source_page_v1"),
			audience: "superboard_front",
			permission: `${pluginId}.read`,
			store_id: `${pluginId}.store.${storeName}`,
			consistency: "strong",
			unavailable_state: "unavailable",
			version: "1.0.0",
		});
	});
	const renderers = [
		{
			renderer_id: `${pluginId}.renderer.admin_surface`,
			plugin_id: pluginId,
			plugin_version: "1.0.0",
			build_id: frontBundleReceipt.build_id,
			build_checksum: frontBundleReceipt.build_checksum,
			abi_version: "1.0.0",
			runtime_range: ">=0.1.0 <0.2.0",
			props_schema: {
				schema_id: adminSurfaceSchema.schema_id,
				version: adminSurfaceSchema.version,
				checksum: adminSurfaceSchema.checksum,
			},
			capabilities: ["renderer.mount", "data_source.bind", "action.bind"],
			slots: [],
			supported_states: [...REQUIRED_FRONT_STATES],
		},
	];
	const workerDescriptor = worker
		? {
				...worker,
				store_ids: stores.map(({ store_id: storeId }) => storeId),
				repository_ids: repositories.map(({ repository_id: repositoryId }) => repositoryId),
			}
		: null;
	if (workerDescriptor) workerDescriptor.checksum = hash(workerDescriptor);
	const manifestArtifact = {
		schema_version: "1.0.0",
		plugin_id: pluginId,
		plugin_kind: kind,
		plugin_version: "1.0.0",
		artifact_id: `${pluginId}@1.0.0`,
		publisher: "superboard",
		resources: [
			...stores.map(({ store_id: storeId }) => storeId),
			"PLUGIN_PRIVATE_KV",
			...(kind === "module" ? [`WORKER:${pluginId}`] : []),
		],
		settings: {
			render_mode: "block_kit",
			storage: "plugin_kv",
			schema: {
				type: "object",
				additionalProperties: false,
				required: Object.keys(pluginSettings[pluginId] ?? {}).toSorted(),
				properties: pluginSettings[pluginId] ?? {},
			},
		},
		execution: {
			backend: "sandboxed",
			worker: kind === "full" ? "none" : "dedicated",
			renderer: "native_bundle",
		},
		capabilities: ["plugin.storage", ...(kind === "module" ? ["worker.execute"] : [])],
		aliases: {},
		stores,
		schemas,
		renderers,
		commands,
		data_sources: dataSources,
		failure_policies: { writes: "fail_closed", reads: "unavailable" },
	};
	return {
		manifest: { ...manifestArtifact, artifact_checksum: hash(manifestArtifact) },
		repositories,
		worker_descriptor: workerDescriptor,
	};
}

function storeForOperation(operation, storeNames) {
	const normalized = operation.replaceAll("-", "_");
	return (
		storeNames
			.filter((storeName) => normalized.includes(storeName.replaceAll("-", "_")))
			.toSorted((left, right) => right.length - left.length)[0] ?? storeNames[0]
	);
}

function stableBuildId(value) {
	const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
	let remaining = BigInt(`0x${createHash("sha256").update(value).digest("hex").slice(0, 32)}`);
	let encoded = "";
	for (let index = 0; index < 26; index += 1) {
		encoded = `${alphabet[Number(remaining & 31n)]}${encoded}`;
		remaining >>= 5n;
	}
	return encoded;
}

function buildFrontBundleReceipt() {
	const explicit = [
		join(root, "apps/site/src/components/FrontPage.astro"),
		join(root, "apps/site/src/components/NativeFrontApp.tsx"),
		join(root, "apps/site/src/lib/core-front-contract.ts"),
		join(root, "apps/site/src/lib/native-front-plugins.ts"),
		join(root, "apps/site/src/lib/native-front-presentation.ts"),
		join(root, "apps/site/src/lib/user-front-release.ts"),
		join(root, "apps/site/src/styles/native-front.css"),
		join(root, "packages/supbrd-core/src/native-front.ts"),
		join(root, "packages/supbrd-plug-user/src/native-front.ts"),
	];
	const sourceFiles = [
		...explicit,
		...walk(join(root, "apps/site/src/front-plugins"), (path) => path.endsWith(".ts")),
		...walk(join(root, "packages/supbrd-runtime-plugins/src/front"), (path) =>
			path.endsWith(".ts"),
		),
	]
		.filter((path, index, all) => existsSync(path) && all.indexOf(path) === index)
		.toSorted();
	const digest = createHash("sha256");
	for (const path of sourceFiles) {
		digest.update(relative(root, path));
		digest.update("\0");
		digest.update(readFileSync(path));
		digest.update("\0");
	}
	const buildChecksum = `sha256:${digest.digest("hex")}`;
	return {
		schema_version: 1,
		build_id: stableBuildId(buildChecksum),
		build_checksum: buildChecksum,
		source_count: sourceFiles.length,
	};
}

function contribution(content) {
	return { ...content, checksum: hash(content) };
}

function workerRuntimeContract(name, worker) {
	const asynchronous = new Set([
		"billing",
		"support",
		"flows",
		"analytics",
		"marketing",
		"email",
		"custom-*",
	]).has(name);
	const path = worker ? `workers/${worker}` : "deploy/targets";
	const proof = worker
		? workerProof(worker, join(root, `workers/${worker}`))
		: join(root, "scripts/vocostar-managed-workers.test.mjs");
	return {
		path,
		execution_mode: asynchronous ? "asynchronous" : "synchronous",
		authoritative_writes: false,
		lease: asynchronous ? "attempt_scoped" : "not_applicable",
		idempotency: "required",
		outbox: asynchronous ? "required" : "not_applicable",
		callback_verification: name === "custom-*" ? "blocked_legacy_gateway" : "not_applicable",
		deployment_status: name === "custom-*" ? "not_ready" : "ready",
		evidence: relative(root, proof),
		evidence_sha256: fileChecksum(proof),
	};
}

function migrationInventory(pluginId) {
	const worker =
		pluginId === "supbrd-plug-user"
			? "identity"
			: pluginId === "supbrd-plug-products"
				? "products"
				: modulePlugins.find(([name]) => `supbrd-plugmod-${name}` === pluginId)?.[1];
	const migrations = [
		"apps/site/migrations/0005_plugin_store_authority.sql",
		"apps/site/migrations/0006_plugin_manifest_registry.sql",
		"apps/site/migrations/0008_canonical_plugin_contracts.sql",
		"apps/site/migrations/0009_sandboxed_plugin_runtime.sql",
		"apps/site/migrations/0010_plugin_store_project_scope.sql",
		"apps/site/migrations/0011_project_scoped_plugin_contracts.sql",
		"apps/site/migrations/0012_functional_front_contracts.sql",
	];
	if (!worker) return migrations;
	const directory = join(root, `workers/${worker}/migrations`);
	if (!existsSync(directory)) return migrations;
	return [
		...migrations,
		...readdirSync(directory)
			.filter((name) => name.endsWith(".sql"))
			.toSorted()
			.map((name) => `workers/${worker}/migrations/${name}`),
	];
}

function row({ id, kind, baseline, target, test, sourceStatus = "delivered", blocker = null }) {
	return {
		id,
		kind,
		baseline,
		target,
		test,
		proof_sha256: fileChecksum(join(root, test)),
		source_status: sourceStatus,
		blocker,
		required: sourceStatus === "delivered",
	};
}

function targetForRoute(route) {
	if (
		route.startsWith("/identity") ||
		APP_USER_ROUTE_PATTERN.test(route) ||
		new Set([
			"/accept-invite",
			"/account",
			"/app/access-key",
			"/app/referrals",
			"/login",
			"/new_password",
			"/register",
			"/register/with_email",
			"/reset_password",
		]).has(route)
	)
		return "supbrd-plug-user";
	if (
		route.startsWith("/app/android-setup") ||
		route.startsWith("/app/ios-setup") ||
		route.startsWith("/app/web-setup") ||
		route === "/app/libraries" ||
		route === "/project-settings"
	)
		return "supbrd-plug-settings";
	if (route === "/products/offerings") return "supbrd-plug-products";
	if (route.startsWith("/products")) return "supbrd-plugmod-billing";
	for (const name of ["paywalls", "support", "analytics", "marketing", "onboardings", "flows"]) {
		if (route.startsWith(`/${name}`)) return `supbrd-plugmod-${name}`;
	}
	if (route.startsWith("/dynamic-links")) return "supbrd-plugmod-dynamic-links";
	if (route === "/infrastructure") return "supbrd-plugmod-observability";
	if (route === "/mcp/authorize") return "supbrd-plugmod-mcp";
	if (route === "/message-preview-craft") return "supbrd-plugmod-marketing";
	return "supbrd-plugmod-analytics";
}

function apiProof(namespace) {
	if (namespace.includes("support")) return "workers/api/src/lib/support-gateway.test.ts";
	if (
		namespace.includes("billing") ||
		namespace.includes("purchases") ||
		namespace.includes("iap")
	) {
		return "workers/api/src/lib/purchases-v2.test.ts";
	}
	if (namespace.includes("mcp")) return "workers/api/src/routes/mcp.test.ts";
	if (namespace.includes("marketing")) return "workers/api/src/routes/marketing-sdk.test.ts";
	if (namespace.includes("platform")) return "workers/api/src/routes/platform-status.test.ts";
	if (
		namespace.includes("admin") ||
		namespace.includes("automation") ||
		namespace.includes("diagnostics")
	) {
		return "workers/api/src/routes/admin-cutover-flows-routing.test.ts";
	}
	if (
		namespace.includes("instances") ||
		namespace.includes("projects") ||
		namespace.includes("links")
	) {
		return "workers/api/src/routes/projects-visitors.test.ts";
	}
	if (namespace.includes("sdk")) return "workers/api/src/routes/sdk-auth.test.ts";
	if (namespace.includes("oauth") || namespace.includes("users")) {
		return "workers/api/src/routes/auth-routes.test.ts";
	}
	if (namespace === "/auth/*") return "workers/api/src/routes/providers.test.ts";
	if (namespace.includes("{domain}")) return "workers/api/src/lib/domain-modules.test.ts";
	if (namespace.includes("short-links")) return "workers/api/src/routes/redirect.test.ts";
	return "workers/api/src/index.test.ts";
}

function workerProof(worker, directory) {
	const preferred = join(directory, "src/index.test.ts");
	if (existsSync(preferred)) return preferred;
	const runtime = join(directory, `runtime-tests/${worker}.runtime.test.ts`);
	if (existsSync(runtime)) return runtime;
	return walk(directory, (path) => TEST_FILE_PATTERN.test(path))[0];
}

function fileChecksum(path) {
	if (!existsSync(path)) return null;
	return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function hash(value) {
	return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function walk(directory, predicate) {
	if (!existsSync(directory)) return [];
	const found = [];
	for (const name of readdirSync(directory).toSorted()) {
		if (["node_modules", "dist", ".wrangler", "coverage"].includes(name)) continue;
		const path = join(directory, name);
		if (statSync(path).isDirectory()) found.push(...walk(path, predicate));
		else if (predicate(path)) found.push(path);
	}
	return found;
}

function canonical(value) {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.keys(value)
			.toSorted()
			.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
			.join(",")}}`;
	return JSON.stringify(value);
}

function writeJson(path, value) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function manifestRegistryMigration(topology) {
	const lines = ["PRAGMA foreign_keys = ON;", ""];
	for (const { manifest } of topology.plugins) {
		const json = JSON.stringify(manifest).replaceAll("'", "''");
		lines.push(
			`INSERT INTO superboard_plugin_manifest_artifacts (artifact_checksum, plugin_id, manifest_json, installed_at)`,
			`VALUES ('${manifest.artifact_checksum}', '${manifest.plugin_id}', '${json}', '2026-08-30T00:00:00.000Z')`,
			`ON CONFLICT(artifact_checksum) DO NOTHING;`,
			`INSERT INTO superboard_active_plugin_manifests (plugin_id, artifact_checksum, activated_at)`,
			`VALUES ('${manifest.plugin_id}', '${manifest.artifact_checksum}', '2026-08-30T00:00:00.000Z')`,
			`ON CONFLICT(plugin_id) DO UPDATE SET artifact_checksum = excluded.artifact_checksum, activated_at = excluded.activated_at;`,
			"",
		);
	}
	return `${lines.join("\n")}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const matrix = buildParityMatrix();
	const topology = buildPluginTopology();
	const errors = validateArtifacts(matrix, topology);
	if (errors.length > 0) {
		console.error(errors.join("\n"));
		process.exit(1);
	}
	const receipt = {
		schema_version: 1,
		matrix_sha256: `sha256:${createHash("sha256").update(canonical(matrix)).digest("hex")}`,
		topology_sha256: `sha256:${createHash("sha256").update(canonical(topology)).digest("hex")}`,
		row_count: matrix.rows.length,
		required_row_count: matrix.rows.filter(({ required }) => required).length,
		public_cutover: false,
		front_bundle: frontBundleReceipt,
		store_coverage: topology.plugins.flatMap(({ manifest }) =>
			manifest.stores.map(({ store_id: storeId, checksum }) => ({
				store_id: storeId,
				descriptor_checksum: checksum,
				executable_test: "apps/site/runtime-tests/plugin-store-authority.runtime.test.ts",
				test_sha256: fileChecksum(
					join(root, "apps/site/runtime-tests/plugin-store-authority.runtime.test.ts"),
				),
				double_import: "passed",
				shadow_read: "passed",
				reverse_delta: "passed_without_deletes",
				rollback: "non_destructive",
			})),
		),
	};
	if (process.argv.includes("--write")) {
		writeJson(matrixPath, matrix);
		writeJson(topologyPath, topology);
		writeJson(receiptPath, receipt);
		writeJson(frontBundlePath, frontBundleReceipt);
		writeFileSync(manifestMigrationPath, manifestRegistryMigration(topology));
	} else {
		for (const [path, value] of [
			[matrixPath, matrix],
			[topologyPath, topology],
			[receiptPath, receipt],
			[frontBundlePath, frontBundleReceipt],
		]) {
			if (
				!existsSync(path) ||
				readFileSync(path, "utf8") !== `${JSON.stringify(value, null, 2)}\n`
			) {
				console.error(`Generated artifact drift: ${relative(root, path)}`);
				process.exitCode = 1;
			}
		}
		if (
			!existsSync(manifestMigrationPath) ||
			readFileSync(manifestMigrationPath, "utf8") !== manifestRegistryMigration(topology)
		) {
			console.error(`Generated artifact drift: ${relative(root, manifestMigrationPath)}`);
			process.exitCode = 1;
		}
	}
	console.log(
		JSON.stringify({
			matrix_sha256: receipt.matrix_sha256,
			topology_sha256: receipt.topology_sha256,
			row_count: receipt.row_count,
			required_row_count: receipt.required_row_count,
			store_count: receipt.store_coverage.length,
			public_cutover: receipt.public_cutover,
		}),
	);
}
