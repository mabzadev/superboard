import { env, SELF } from "cloudflare:test";
import { expect, test } from "vitest";

const origin = "https://site.example";
const headers = { Origin: origin, "X-EmDash-Request": "1", "X-Parity-Operator": "1" };

interface SettingsPackage {
	label: string;
	pluginId: string;
	artifactComponent: string;
	setting: [key: string, value: unknown];
	apis: Array<[path: string, method: string]>;
	disabledComponents: Array<[component: string, prefix: string]>;
}

const packages: SettingsPackage[] = [
	{
		label: "Acquisition",
		pluginId: "supbrd-plug-journeys",
		artifactComponent: "superboard-flows",
		setting: ["plugin:superboard-flows:settings:default_locale", "fr-CH"],
		apis: [
			["/api/v1/flows/projects/1-prod/environments", "GET"],
			["/api/v1/flows/projects/1-prod/environments", "POST"],
			["/api/v1/flows/projects/1-prod/localization", "GET"],
			["/api/v1/flows/projects/1-prod/localization", "PUT"],
		],
		disabledComponents: [["superboard-flows", "/api/v1/flows/"]],
	},
	{
		label: "Analytics",
		pluginId: "supbrd-plug-analytics",
		artifactComponent: "superboard-analytics",
		setting: ["plugin:superboard-analytics:settings:enabled", true],
		apis: [
			["/api/v1/analytics/projects/project-test/settings", "GET"],
			["/api/v1/analytics/projects/project-test/settings", "PUT"],
			["/api/v1/analytics/projects/project-test/applications", "GET"],
			["/api/v1/analytics/projects/project-test/applications/test-app", "PUT"],
			["/api/v1/analytics/projects/project-test/hooks", "GET"],
			["/api/v1/analytics/projects/project-test/hooks", "POST"],
			["/api/v1/analytics/projects/project-test/annotations", "GET"],
			["/api/v1/analytics/projects/project-test/annotations", "POST"],
		],
		disabledComponents: [],
	},
	{
		label: "Communication",
		pluginId: "supbrd-plug-communication",
		artifactComponent: "superboard-marketing",
		setting: ["plugin:superboard-marketing:settings:sender_name", "Preserved sender"],
		apis: [
			...["marketing", "email"].flatMap(
				(service): Array<[string, string]> => [
					[`/api/v1/${service}/projects/1-prod/settings/smtp`, "GET"],
					[`/api/v1/${service}/projects/1-prod/settings/smtp`, "PUT"],
					[`/api/v1/${service}/projects/1-prod/settings/provider-webhooks`, "GET"],
					[`/api/v1/${service}/projects/1-prod/settings/provider-webhooks`, "POST"],
				],
			),
			["/api/v1/marketing/projects/1-prod/studio/settings", "GET"],
			["/api/v1/marketing/projects/1-prod/studio/settings", "PUT"],
			["/api/v1/marketing/projects/1-prod/channel-connectors", "GET"],
			["/api/v1/marketing/projects/1-prod/channel-connectors", "POST"],
		],
		disabledComponents: [
			["superboard-marketing", "/api/v1/marketing/"],
			["superboard-email", "/api/v1/email/"],
		],
	},
	{
		label: "Data",
		pluginId: "supbrd-plug-data",
		artifactComponent: "superboard-files",
		setting: ["plugin:superboard-content:settings:default_locale", "fr"],
		apis: [],
		disabledComponents: [],
	},
	{
		label: "Monetization",
		pluginId: "supbrd-plug-commerce",
		artifactComponent: "superboard-billing",
		setting: ["plugin:superboard-products:settings:default_currency", "CHF"],
		apis: [],
		disabledComponents: [],
	},
	{
		label: "Support",
		pluginId: "supbrd-plug-support",
		artifactComponent: "superboard-support",
		setting: ["plugin:superboard-support:settings:business_name", "Preserved sender"],
		apis: [
			["/api/v1/support/projects/1-prod/settings", "GET"],
			["/api/v1/support/projects/1-prod/settings", "PATCH"],
			["/api/v1/support/projects/1-prod/settings/entities", "POST"],
			["/api/v1/support/projects/1-prod/notifications/preferences", "GET"],
			["/api/v1/support/projects/1-prod/notifications/preferences", "PUT"],
		],
		disabledComponents: [["superboard-support", "/api/v1/support/"]],
	},
];

const pluginActions = (pluginId: string): Array<[string, string]> => [
	[`/_emdash/api/superboard/plugins/${pluginId}/diagnostic`, "GET"],
	[`/_emdash/api/superboard/plugins/${pluginId}/health`, "POST"],
];

const editorCases = packages.flatMap(({ label, pluginId, apis }) =>
	[...pluginActions(pluginId), ...apis].map(([path, method]) => [label, method, path] as const),
);

async function expectNotActive(response: Response) {
	expect(response.status).toBe(404);
	expect(await response.json()).toEqual({ error: { code: "PLUGIN_NOT_ACTIVE" } });
}

test.each(editorCases)("%s refuses an editor: %s %s", async (_label, method, path) => {
	const response = await SELF.fetch(origin + path, {
		method,
		headers: {
			...headers,
			"X-Parity-Role": "editor",
			"Content-Type": "application/json",
			"Idempotency-Key": crypto.randomUUID(),
		},
		...(method === "GET" ? {} : { body: "{}" }),
	});
	expect(response.status).toBe(403);
});

test.each(
	packages.flatMap((entry) =>
		["diagnostic", "health"].map((action) => [entry.label, action, entry] as const),
	),
)(
	"disabled %s refuses %s without removing its settings",
	async (_label, action, { pluginId, artifactComponent, setting: [key, value] }) => {
		await env.DB.prepare("INSERT OR REPLACE INTO options (name, value) VALUES (?, ?)")
			.bind(key, JSON.stringify(value))
			.run();
		await env.DB.prepare(
			"INSERT OR REPLACE INTO superboard_plugin_lifecycle (instance_id, target, plugin_id, artifact_checksum, state, state_changed_at) SELECT ?, 'local', ?, artifact_checksum, 'disabled', datetime('now') FROM superboard_plugin_manifest_artifacts WHERE plugin_id = ? LIMIT 1",
		)
			.bind(env.SUPERBOARD_INSTANCE_ID, pluginId, artifactComponent)
			.run();
		expect(
			await env.DB.prepare("SELECT state FROM superboard_plugin_lifecycle WHERE plugin_id = ?")
				.bind(pluginId)
				.first("state"),
		).toBe("disabled");
		await expectNotActive(
			await SELF.fetch(`${origin}/_emdash/api/superboard/plugins/${pluginId}/${action}`, {
				method: action === "health" ? "POST" : "GET",
				headers,
			}),
		);
		expect(
			await env.DB.prepare("SELECT value FROM options WHERE name = ?").bind(key).first("value"),
		).toBe(JSON.stringify(value));
	},
);

test.each(
	packages.flatMap(({ apis, disabledComponents }) =>
		disabledComponents.map(
			([component, prefix]) =>
				[component, apis.filter(([path]) => path.startsWith(prefix))] as const,
		),
	),
)("disabled %s refuses its settings APIs", async (component, apis) => {
	await env.DB.prepare(
		"UPDATE superboard_plugin_lifecycle SET state = 'disabled' WHERE instance_id = ? AND target = 'local' AND plugin_id = ?",
	)
		.bind(env.SUPERBOARD_INSTANCE_ID, component)
		.run();
	for (const [path, method] of apis) {
		await expectNotActive(await SELF.fetch(origin + path, { method, headers }));
	}
});
