import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const navigationPath = join(root, "config/superboard-dashboard-navigation.json");
const parityPath = join(root, "config/emdash-parity-matrix.json");
const seedPath = join(root, "apps/site/seed/seed.json");
const navigation = JSON.parse(readFileSync(navigationPath, "utf8"));
const parity = JSON.parse(readFileSync(parityPath, "utf8"));
const PATH_EDGE_SLASH_PATTERN = /^\/+|\/+$/gu;
const IDENTITY_LOCALE_PATTERN = /^\/identity\/en(?=\/|$)/u;
const VIEW_PARAMETER_PATTERN = /[:*]/gu;
const VIEW_SEPARATOR_PATTERN = /[^a-zA-Z0-9]+/gu;
const VIEW_EDGE_SEPARATOR_PATTERN = /^_+|_+$/gu;
const VIEW_DESCRIPTIONS = {
	"/dashboard": "A cross-module view of acquisition, engagement and product performance.",
	"/app/customers": "Acquisition identities and their complete app engagement history.",
	"/app/users":
		"Authentication, linked Google or Apple identities, sessions, subscriptions, entitlements and paywall activity.",
	"/app/referrals": "Referral codes, attributed customers and the complete conversion lifecycle.",
	"/app/access-key":
		"Authenticate public SuperBoard SDK requests without exposing an administrative session.",
	"/app/libraries":
		"Git-owned SDK versions, immutable release references and reusable FlutterFlow custom code.",
	"/app/android-setup":
		"Complete the five-step Android SDK integration and verify it against this project.",
	"/app/ios-setup":
		"Complete the five-step iOS SDK integration and verify it against this project.",
	"/app/web-setup":
		"Complete the five-step Web SDK integration and verify it against this project.",
	"/products/purchases": "Purchases, subscriptions, restorations, refunds and financial history.",
	"/products/customers":
		"Application identities, subscriptions, entitlements, balances, transactions and paywall activity.",
	"/products/offerings": "Manage the store catalog, packages and SDK-resolved offerings.",
	"/products/entitlements": "Define SDK access rights and the products that unlock each right.",
	"/flows": "Monitor active workflows, user activity and runtime incidents.",
	"/flows/workflows": "Create, version, publish and analyze product experiences.",
	"/flows/launchpad": "Order workflow groups, priorities and concurrency for every environment.",
	"/flows/users": "Inspect user properties, workflow state and the complete activity journal.",
	"/flows/components":
		"Manage Basics V2 and custom component libraries without silently updating instances.",
	"/flows/settings/environments":
		"Manage isolated release environments and their rotatable SDK keys.",
	"/flows/settings/localization":
		"Configure language groups, default languages and fallback chains.",
	"/flows/settings/sdk":
		"Install JavaScript, React, Flutter or FlutterFlow against the SuperBoard API.",
	"/dynamic-links/links":
		"Create, route and measure links across every platform and acquisition source.",
	"/dynamic-links/campaigns":
		"Measure every acquisition campaign from link view to referred customer and revenue.",
	"/dynamic-links/redirect-rules":
		"Resolve the first matching platform rule by priority, then fall back to the link destination.",
	"/dynamic-links/domain":
		"Serve branded dynamic links only after ownership has been verified through DNS.",
	"/dynamic-links/social-media-preview":
		"Design the default Open Graph card shown when a dynamic link is shared.",
	"/dynamic-links/tracking":
		"Inspect attributed link events and control consent-aware collection by project.",
	"/support/workforce": "Support roles, teams, availability, capacity and leave schedules.",
	"/support/channels": "Connect every customer channel to a native Support inbox.",
	"/support/automations":
		"Automate routing and actions, then enforce response and resolution targets.",
	"/support/proactive-support":
		"Reach eligible customers through Support inboxes with controlled, auditable campaigns.",
	"/support/help-center": "Author, translate, publish and index customer self-service content.",
	"/support/captain":
		"Project-isolated assistants, Copilot scenarios, allowlisted tools and traceable tasks.",
	"/support/integrations": "Connect Support workflows to your team tools and customer context.",
	"/support/reports":
		"Support volume, response, resolution, backlog, SLA, satisfaction and campaign performance.",
	"/support/settings": "Project-wide Support behavior, attachments, features and operations.",
	"/marketing/email":
		"Subscribers, consent, lists, double opt-in, segmentation and bulk operations.",
	"/marketing/campaigns":
		"Templates, media, previews, scheduled campaigns, transactional email and delivery controls.",
	"/marketing/journeys":
		"Turn product events into versioned, resumable email and omnichannel customer journeys.",
	"/marketing/channels":
		"Connect secure HTTPS destinations for SMS, push, WhatsApp, Slack and custom webhooks.",
	"/marketing/statistics":
		"Delivery, opens, clicks, bounces, complaints, unsubscribes and campaign progression.",
	"/marketing/settings":
		"Sender identities, AWS SES delivery, quotas, domain authentication, provider events and retries.",
	"/analytics":
		"A single, privacy-aware view of product usage, installations and verified revenue.",
	"/analytics/dashboards":
		"Build project dashboards from reusable product, revenue, stability and audience widgets.",
	"/analytics/users":
		"Explore pseudonymized profiles and session timelines without exposing raw SDK identifiers.",
	"/analytics/events":
		"Inspect the recent, pseudonymized event stream without exposing raw user identifiers.",
	"/analytics/dimensions":
		"Compare application versions, devices, browsers, countries, carriers and acquisition context.",
	"/analytics/views":
		"Page and screen performance, visit depth and time spent across web and mobile applications.",
	"/analytics/installations":
		"Canonical first installs only—retries and repeated attribution calls do not increase this count.",
	"/analytics/purchases":
		"Financial facts emitted only after store or billing verification, deduplicated by transaction and event type.",
	"/analytics/insights":
		"Understand conversion sequences and whether new installations return over time.",
	"/analytics/cohorts":
		"Define reusable audiences from behavior and keep their estimated size current.",
	"/analytics/crashes":
		"Group recurring errors by deterministic fingerprint, inspect occurrences and manage resolution.",
	"/analytics/feedback":
		"Review star ratings and written feedback captured from web and mobile experiences.",
	"/analytics/remote-config":
		"Publish versioned JSON values with deterministic rollouts for the selected environment.",
	"/analytics/alerts":
		"Continuously evaluate product, crash, installation and verified-payment signals at the edge.",
	"/analytics/reports": "Save reusable analysis definitions and run durable export or rollup jobs.",
	"/analytics/settings":
		"Manage applications, retention, collection, signed webhooks and timeline annotations.",
};

if (!Array.isArray(navigation.sections)) {
	throw new TypeError("Dashboard navigation sections are missing");
}
if (!Array.isArray(parity.rows)) {
	throw new TypeError("Dashboard parity rows are missing");
}

const views = navigation.sections.flatMap((section) =>
	section.pages.map((page) => ({ ...page, section: section.label })),
);
const hrefs = new Set(views.map(({ href }) => href));
if (hrefs.size !== views.length) {
	throw new TypeError("Dashboard navigation contains duplicate View URLs");
}
const pluginByDashboardPath = new Map(
	parity.rows.flatMap((row) =>
		row.kind === "dashboard" && typeof row.id === "string" && typeof row.target === "string"
			? [[row.id.slice("dashboard:".length), row.target]]
			: [],
	),
);

const seed = {
	$schema: "https://emdashcms.com/seed.schema.json",
	version: "1",
	defaultLocale: "en",
	meta: {
		name: "SuperBoard Admin",
		description: "Editable SuperBoard navigation and View configuration",
		author: "SuperBoard",
	},
	collections: [
		{
			slug: "views",
			label: "Views",
			labelSingular: "View",
			description: "Plugin-owned SuperBoard interfaces and their editable presentation.",
			routable: false,
			titleField: "name",
			sortOrder: 0,
			supports: ["drafts", "revisions", "search"],
			fields: [
				{ slug: "name", label: "Name", type: "string", required: true, searchable: true },
				{ slug: "plugin_id", label: "Plugin", type: "string", required: true, indexed: true },
				{
					slug: "route_id",
					label: "View key",
					type: "string",
					required: true,
					unique: true,
					indexed: true,
				},
				{ slug: "path", label: "URL", type: "string", required: true, unique: true, indexed: true },
				{ slug: "description", label: "Description", type: "text" },
				{ slug: "presentation", label: "Layout and content", type: "json", required: true },
				{ slug: "bindings", label: "Plugin data and actions", type: "json", required: true },
			],
		},
	],
	menus: [
		{
			name: "superboard-admin",
			label: "SuperBoard Admin",
			items: navigation.sections.map((section) => ({
				type: "custom",
				label: section.label,
				url: section.href,
				children: section.pages.map((view) => ({
					type: "custom",
					label: view.label,
					url: view.href,
				})),
			})),
		},
	],
	content: {
		views: views.map((view) => {
			const pluginId = pluginForView(view.href);
			return {
				id: `view:${contentSlug(view.href)}`,
				slug: contentSlug(view.href),
				status: "published",
				data: {
					name: view.label,
					plugin_id: pluginId,
					route_id: routeId(view.href),
					path: view.href,
					description: VIEW_DESCRIPTIONS[view.href] ?? "",
					presentation: viewPresentation(view.href),
					bindings: viewBindings(view.href, pluginId),
				},
			};
		}),
	},
};
const generated = `${JSON.stringify(seed, null, "\t")}\n`;

if (process.argv.includes("--write")) {
	mkdirSync(dirname(seedPath), { recursive: true });
	writeFileSync(seedPath, generated);
	console.log(
		`Generated ${relative(root, seedPath)} with ${navigation.sections.length} menu sections and ${views.length} Views`,
	);
} else if (!existsSync(seedPath) || readFileSync(seedPath, "utf8") !== generated) {
	console.error(`Generated artifact drift: ${relative(root, seedPath)}`);
	process.exitCode = 1;
}

function pluginForView(href) {
	const inventoryPath = href.replace(IDENTITY_LOCALE_PATTERN, "/identity/[lang]");
	const pluginId = pluginByDashboardPath.get(inventoryPath);
	if (!pluginId) throw new TypeError(`Dashboard View plugin is missing: ${href}`);
	return pluginId;
}

function routeId(href) {
	if (href === "/app/users") return "superboard.users";
	const pattern = href.replace(IDENTITY_LOCALE_PATTERN, "/identity/:lang");
	return `superboard.${surfaceName(pattern)}`;
}

function surfaceName(path) {
	return path
		.slice(1)
		.replaceAll(VIEW_PARAMETER_PATTERN, "by_")
		.replaceAll(VIEW_SEPARATOR_PATTERN, "_")
		.replaceAll(VIEW_EDGE_SEPARATOR_PATTERN, "")
		.toLowerCase();
}

function viewPresentation(href) {
	return {
		schema_version: "1.0.0",
		blocks: href === "/analytics/remote-config" ? remoteConfigBlocks() : [],
	};
}

function remoteConfigBlocks() {
	return [
		{
			kind: "notice",
			title: "Stable assignments",
			description:
				"Rollout buckets are computed from a pseudonymous identity, project and key. The same installation always receives the same result.",
		},
		{
			kind: "columns",
			columns: [
				{
					title: "Publish parameter",
					description: "Environment: production",
					fields: [
						{ label: "Parameter key", control: "text", placeholder: "checkout_banner" },
						{ label: "JSON value", control: "textarea", value: '{\n  "enabled": true\n}' },
						{ label: "Rollout · 100%", control: "range", value: "100" },
					],
					action_label: "Publish",
				},
				{
					title: "Parameters",
					description: "Each update increments an immutable client-visible version.",
					empty_state: "No remote parameters published.",
				},
			],
		},
	];
}

function viewBindings(href, pluginId) {
	if (href !== "/analytics/remote-config") return { data_sources: [], commands: [] };
	return {
		data_sources: [`${pluginId}.data_source.analytics_remote_config`],
		commands: [`${pluginId}.command.upsert_analytics_remote_config`],
	};
}

function contentSlug(href) {
	const normalized = href.replace(PATH_EDGE_SLASH_PATTERN, "");
	return normalized ? normalized.replaceAll("/", "--") : "home";
}
