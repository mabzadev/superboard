import { compileFrontRelease, resolveFrontRequest } from "@superboard/supbrd-core";
import { expect, test } from "vitest";

import compatibility from "../../../config/superboard-plugin-compatibility.json";
import seed from "../seed/seed.json";
import { assertReleasePresentation, type FrontPageModel } from "../src/lib/front-page.js";
import {
	assertNativeFrontRenderer,
	mountNativeFrontRenderer,
} from "../src/lib/native-front-plugins.js";
import { projectNativeFrontPresentation } from "../src/lib/native-front-presentation.js";
import {
	editableNavigationFromMenu,
	editableViewFromEntry,
	frontViewSlug,
} from "../src/lib/native-front-views.js";
import { superBoardRuntimePluginCatalog } from "../src/lib/superboard-plugin-catalog.js";
import { composeUserFrontReleaseInput } from "../src/lib/user-front-release.js";

const identifiers = {
	instance_id: "vocostar",
	front_draft_id: "01J00000000000000000000401",
	draft_snapshot_id: "01J00000000000000000000402",
	compilation_id: "01J00000000000000000000403",
	candidate_id: "01J00000000000000000000404",
	release_id: "01J00000000000000000000405",
	release_sequence: 1,
	previous_release_id: null,
	created_at: "2026-09-01T12:00:00.000Z",
};

test("EmDash menu and View records become editable Front configuration", () => {
	const navigation = editableNavigationFromMenu({
		id: "menu",
		name: "superboard-admin",
		label: "SuperBoard Admin",
		locale: "en",
		translationGroup: "menu",
		items: [
			{
				id: "analytics",
				label: "Analyse éditée",
				url: "/analytics",
				children: [
					{
						id: "remote-config",
						label: "Configuration distante",
						url: "/analytics/remote-config",
						children: [],
					},
				],
			},
		],
	});
	const view = editableViewFromEntry({
		data: {
			name: "Configuration distante",
			plugin_id: "supbrd-plugmod-analytics",
			route_id: "superboard.analytics_remote_config",
			path: "/analytics/remote-config",
			description: "Ce texte vient de la View EmDash.",
			presentation: {
				schema_version: "1.0.0",
				blocks: [
					{
						kind: "notice",
						title: "Configuration éditable",
						description: "La composition vient de la View.",
					},
				],
			},
			bindings: {
				data_sources: ["supbrd-plugmod-analytics.data_source.analytics_remote_config"],
				commands: ["supbrd-plugmod-analytics.command.upsert_analytics_remote_config"],
			},
		},
	});

	expect(frontViewSlug("/analytics/remote-config")).toBe("analytics--remote-config");
	expect(navigation).toEqual([
		{
			label: "Analyse éditée",
			items: [{ label: "Configuration distante", href: "/analytics/remote-config" }],
		},
	]);
	expect(view).toEqual({
		route_id: "superboard.analytics_remote_config",
		plugin_id: "supbrd-plugmod-analytics",
		path: "/analytics/remote-config",
		title: "Configuration distante",
		description: "Ce texte vient de la View EmDash.",
		blocks: [
			{
				kind: "notice",
				title: "Configuration éditable",
				description: "La composition vient de la View.",
			},
		],
		bindings: {
			data_sources: ["supbrd-plugmod-analytics.data_source.analytics_remote_config"],
			commands: ["supbrd-plugmod-analytics.command.upsert_analytics_remote_config"],
		},
	});
});

test("adding and removing a plugin from the Release changes the rendered Front", async () => {
	const catalog = superBoardRuntimePluginCatalog();
	const plugin = (pluginId: string) => {
		const entry = catalog.plugins.find(({ manifest }) => manifest.plugin_id === pluginId);
		if (!entry) throw new Error(`Missing test plugin: ${pluginId}`);
		return {
			plugin_id: entry.manifest.plugin_id,
			version: entry.manifest.plugin_version,
			artifact_checksum: entry.manifest.artifact_checksum,
			native: entry.manifest.execution.backend === "native",
		};
	};
	const user = plugin("supbrd-plug-user");
	const marketing = plugin("supbrd-plugmod-marketing");
	const withoutMarketing = await compile([user], "01J00000000000000000000405");
	const withMarketing = await compile([user, marketing], "01J00000000000000000000406");

	const absentMarkup = render(withoutMarketing, "/marketing/campaigns", ["users.read"]);
	const activeMarkup = render(withMarketing, "/marketing/campaigns", [
		"users.read",
		"supbrd-plugmod-marketing.read",
	]);

	expect(absentMarkup).toContain("Page not found");
	expect(absentMarkup).not.toContain('"href":"/marketing/campaigns"');
	expect(activeMarkup).toContain("Campaigns");
	expect(activeMarkup).toContain('"href":"/marketing/campaigns"');
	expect(activeMarkup).toContain("supbrd-plugmod-marketing");
});

test("the editable Remote Config View supplies the Dashboard composition", async () => {
	const catalog = superBoardRuntimePluginCatalog();
	const locked = ["supbrd-plug-user", "supbrd-plugmod-analytics"].map((pluginId) => {
		const manifest = catalog.plugins.find(
			({ manifest: candidate }) => candidate.plugin_id === pluginId,
		)?.manifest;
		if (!manifest) throw new Error(`Missing test plugin: ${pluginId}`);
		return {
			plugin_id: manifest.plugin_id,
			version: manifest.plugin_version,
			artifact_checksum: manifest.artifact_checksum,
			native: manifest.execution.backend === "native",
		};
	});
	const release = await compile(locked, "01J00000000000000000000409");
	const seededView = seed.content.views.find(
		({ data }) => data.path === "/analytics/remote-config",
	);
	const view = editableViewFromEntry({ data: seededView?.data });
	if (!view) throw new Error("Missing Remote Config View");
	const output = render(
		release,
		"/analytics/remote-config",
		["users.read", "supbrd-plugmod-analytics.read"],
		{ view },
	);

	expect(output).toContain("Remote Config");
	expect(output).toContain("Stable assignments");
	expect(output).toContain("Publish parameter");
	expect(output).toContain("No remote parameters published.");
	expect(output).toContain('"group_id":"analytics"');
});

test("EmDash menu and View edits drive the rendered Front within the active Release", async () => {
	const catalog = superBoardRuntimePluginCatalog();
	const locked = ["supbrd-plug-user", "supbrd-plugmod-analytics"].map((pluginId) => {
		const manifest = catalog.plugins.find(
			({ manifest: candidate }) => candidate.plugin_id === pluginId,
		)?.manifest;
		if (!manifest) throw new Error(`Missing test plugin: ${pluginId}`);
		return {
			plugin_id: manifest.plugin_id,
			version: manifest.plugin_version,
			artifact_checksum: manifest.artifact_checksum,
			native: manifest.execution.backend === "native",
		};
	});
	const release = await compile(locked, "01J00000000000000000000410");
	const output = render(
		release,
		"/analytics/remote-config",
		["users.read", "supbrd-plugmod-analytics.read"],
		{
			navigation: [
				{
					label: "Analyse éditée",
					items: [
						{ label: "Configuration distante", href: "/analytics/remote-config" },
						{ label: "Hors Release", href: "/paywalls" },
					],
				},
			],
			view: {
				route_id: "superboard.analytics_remote_config",
				plugin_id: "supbrd-plugmod-analytics",
				path: "/analytics/remote-config",
				title: "Configuration distante",
				description: "Ce texte vient de la View EmDash.",
				blocks: [
					{
						kind: "notice",
						title: "Contenu éditable",
						description: "Composition de View",
					},
				],
				bindings: { data_sources: [], commands: [] },
			},
		},
	);

	expect(output).toContain("Analyse éditée");
	expect(output).toContain("Configuration distante");
	expect(output).toContain("Ce texte vient de la View EmDash.");
	expect(output).toContain("Contenu éditable");
	expect(output).not.toContain("Hors Release");
	expect(output).not.toContain('"href":"/paywalls"');
});

test("rejects routes, pages, renderers, and navigation outside the Release graph", async () => {
	const catalog = superBoardRuntimePluginCatalog();
	const userManifest = catalog.plugins.find(
		({ manifest }) => manifest.plugin_id === "supbrd-plug-user",
	)?.manifest;
	if (!userManifest) throw new Error("Missing User plugin");
	const release = await compile(
		[
			{
				plugin_id: userManifest.plugin_id,
				version: userManifest.plugin_version,
				artifact_checksum: userManifest.artifact_checksum,
				native: false,
			},
		],
		"01J00000000000000000000407",
	);
	const withoutPage = structuredClone(release.payload);
	withoutPage.presentation.pages = withoutPage.presentation.pages.filter(
		({ page_id: pageId }) => pageId !== "page.superboard_users",
	);
	expect(() => assertReleasePresentation(withoutPage)).toThrow(/page is missing/u);

	const withForeignNavigation = structuredClone(release.payload);
	withForeignNavigation.presentation.navigation.push({
		group_id: "foreign",
		label: "Foreign",
		order: 999,
		items: [
			{
				route_id: "foreign.route",
				href: "/foreign",
				label: "Foreign",
				permission: "allow",
				order: 0,
			},
		],
	});
	expect(() => assertReleasePresentation(withForeignNavigation)).toThrow(
		/navigation route is missing/u,
	);

	const withoutRenderer = structuredClone(release.payload);
	withoutRenderer.renderers = withoutRenderer.renderers.filter(
		({ renderer_id: rendererId }) => rendererId !== "supbrd-plug-user.renderer.admin_surface",
	);
	expect(() => assertReleasePresentation(withoutRenderer)).toThrow(/renderer is missing/u);
});

test("legacy renderer checksums stay scoped to their plugin renderer", async () => {
	const catalog = superBoardRuntimePluginCatalog();
	const locked = ["supbrd-plug-user", "supbrd-plugmod-analytics"].map((pluginId) => {
		const manifest = catalog.plugins.find(
			({ manifest: candidate }) => candidate.plugin_id === pluginId,
		)?.manifest;
		if (!manifest) throw new Error(`Missing test plugin: ${pluginId}`);
		return {
			plugin_id: manifest.plugin_id,
			version: manifest.plugin_version,
			artifact_checksum: manifest.artifact_checksum,
			native: manifest.execution.backend === "native",
		};
	});
	const release = await compile(locked, "01J00000000000000000000411");
	const analyticsRenderer = release.payload.renderers.find(
		({ plugin_id: pluginId }) => pluginId === "supbrd-plugmod-analytics",
	);
	if (!analyticsRenderer) throw new Error("Missing Analytics renderer");

	expect(() =>
		assertNativeFrontRenderer(
			{
				...analyticsRenderer,
				build_checksum: "sha256:d7b1bda9489908a0fc50539a8a305d0c18e8c54f92fac05980ec30af32f28ba2",
			},
			release.payload.plugin_lock,
		),
	).toThrow(/Native renderer build is unavailable/u);
});

test("keeps an active multi-plugin Release renderable across renderer upgrades", async () => {
	const catalog = superBoardRuntimePluginCatalog();
	const locked = ["supbrd-plug-user", "supbrd-plugmod-analytics"].map((pluginId) => {
		const manifest = catalog.plugins.find(
			({ manifest: candidate }) => candidate.plugin_id === pluginId,
		)?.manifest;
		if (!manifest) throw new Error(`Missing test plugin: ${pluginId}`);
		return {
			plugin_id: manifest.plugin_id,
			version: manifest.plugin_version,
			artifact_checksum: manifest.artifact_checksum,
			native: manifest.execution.backend === "native",
		};
	});
	const release = await compile(locked, "01J00000000000000000000412");
	const legacyAnalyticsBuild = Object.values(compatibility.artifacts).find(
		({ plugin_id: pluginId }) => pluginId === "supbrd-plugmod-analytics",
	)?.renderer_builds["supbrd-plugmod-analytics.renderer.admin_surface"];
	if (!legacyAnalyticsBuild) throw new Error("Missing legacy Analytics renderer build");
	const analyticsRenderer = release.payload.renderers.find(
		({ renderer_id: rendererId }) =>
			rendererId === "supbrd-plugmod-analytics.renderer.admin_surface",
	);
	if (!analyticsRenderer) throw new Error("Missing Analytics renderer");
	analyticsRenderer.build_checksum = legacyAnalyticsBuild;
	const seededView = seed.content.views.find(
		({ data }) => data.path === "/analytics/remote-config",
	);
	const view = editableViewFromEntry({ data: seededView?.data });
	if (!view) throw new Error("Missing Remote Config View");

	expect(() => assertReleasePresentation(release.payload)).not.toThrow();
	expect(() =>
		render(release, "/analytics/remote-config", ["users.read", "supbrd-plugmod-analytics.read"], {
			view,
		}),
	).not.toThrow();
});

test("keeps an active legacy Release renderable during the native Front upgrade", async () => {
	const userManifest = superBoardRuntimePluginCatalog().plugins.find(
		({ manifest }) => manifest.plugin_id === "supbrd-plug-user",
	)?.manifest;
	if (!userManifest) throw new Error("Missing User plugin");
	const legacyRelease = structuredClone(
		await compile(
			[
				{
					plugin_id: userManifest.plugin_id,
					version: userManifest.plugin_version,
					artifact_checksum: userManifest.artifact_checksum,
					native: false,
				},
			],
			"01J00000000000000000000408",
		),
	);
	legacyRelease.payload.presentation.navigation =
		legacyRelease.payload.presentation.navigation.flatMap((group) =>
			typeof group === "object" && group !== null && "items" in group && Array.isArray(group.items)
				? group.items.map(({ route_id, label, permission }) => ({ route_id, label, permission }))
				: [],
		);
	legacyRelease.payload.presentation.navigation = [
		...legacyRelease.payload.presentation.navigation.filter(
			(item) =>
				typeof item === "object" &&
				item !== null &&
				"route_id" in item &&
				typeof item.route_id === "string" &&
				!item.route_id.startsWith("superboard.identity_by_lang"),
		),
		{ route_id: "superboard.identity", label: "Identity", permission: "users.read" },
	];
	legacyRelease.payload.renderers = legacyRelease.payload.renderers
		.filter(({ plugin_id: pluginId }) => pluginId !== "supbrd-core")
		.map((renderer) => {
			const legacyBuilds: Record<string, string> = {
				"supbrd-plug-user.renderer.admin_surface":
					"sha256:d7b1bda9489908a0fc50539a8a305d0c18e8c54f92fac05980ec30af32f28ba2",
				"supbrd-plug-user.renderer.login_form":
					"sha256:fb7093abcf297a8b10024c579ec6faeb0336a91e3551e0c397a670ead659d9d9",
				"supbrd-plug-user.renderer.members_table":
					"sha256:83e314240c11dfd0118ed0a0d2496e1589513f2c18b199e65e6e791ea430d0cb",
				"supbrd-plug-user.renderer.profile_card":
					"sha256:a6ca9335d1dc37ecaabddcce6f5c6add578ec1bdd2b5b637e44b97606825d86d",
			};
			return legacyBuilds[renderer.renderer_id]
				? {
						...renderer,
						build_checksum: legacyBuilds[renderer.renderer_id]!,
					}
				: renderer;
		});
	const legacyUsersRoute = legacyRelease.payload.front_route_manifest.routes.find(
		({ route_id: routeId }) => routeId === "superboard.users",
	);
	const legacyUsersPage = legacyRelease.payload.presentation.pages.find(
		({ page_id: pageId }) => pageId === "page.superboard_users",
	);
	if (!legacyUsersRoute || !legacyUsersPage) throw new Error("Missing legacy Users surface");
	legacyUsersRoute.renderer_ids = ["supbrd-plug-user.renderer.members_table"];
	legacyUsersPage.root_renderer_id = "supbrd-plug-user.renderer.members_table";

	expect(() => assertReleasePresentation(legacyRelease.payload)).not.toThrow();
	const legacyMarkup = render(legacyRelease, "/app/users", ["users.read"], {
		navigation: [
			{ label: "App", items: [{ label: "Users", href: "/app/users" }] },
			{
				label: "Identity",
				items: [{ label: "Overview", href: "/identity/en/dashboard" }],
			},
		],
	});
	expect(legacyMarkup).toContain("App · Users");
	expect(legacyMarkup).toContain('"label":"Identity"');
	expect(legacyMarkup).toContain('"href":"/identity/en/dashboard"');
	expect(legacyMarkup).not.toContain('"group_id":"legacy"');
});

async function compile(
	pluginLock: Parameters<typeof composeUserFrontReleaseInput>[0]["plugin_lock"],
	releaseId: string,
) {
	const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
		"sign",
		"verify",
	]);
	return compileFrontRelease(
		await composeUserFrontReleaseInput({
			...identifiers,
			release_id: releaseId,
			plugin_lock: pluginLock,
		}),
		{ kid: "native-front-test", private_key: keys.privateKey },
	);
}

function render(
	release: Awaited<ReturnType<typeof compile>>,
	path: string,
	permissions: string[],
	editorial?: Parameters<typeof projectNativeFrontPresentation>[2],
): string {
	const dependencyHealth = Object.fromEntries(
		release.payload.dependency_policies.map(({ dependency_id: dependencyId }) => [
			dependencyId,
			"ready" as const,
		]),
	);
	const resolution = resolveFrontRequest({
		last_verified_release: {
			front_route_manifest: release.payload.front_route_manifest,
			dependency_policies: release.payload.dependency_policies,
		},
		requested_path: path,
		admin_session: "valid",
		permissions,
		dependency_health: dependencyHealth,
	});
	const model: FrontPageModel = {
		instance_id: identifiers.instance_id,
		requested_path: path,
		release: {
			release,
			runtime_release: {
				front_route_manifest: release.payload.front_route_manifest,
				dependency_policies: release.payload.dependency_policies,
			},
			pointer_revision: 1,
			source: "preview",
		},
		resolution,
		page_title:
			resolution.result === "rendered"
				? (release.payload.presentation.pages.find(
						({ page_id: pageId }) => pageId === resolution.page_id,
					)?.title ?? null)
				: null,
		operator: {
			id: "operator",
			email: "operator@example.com",
			name: "Operator",
			role: 100,
			disabled: false,
		},
		permissions,
	};
	const projection = projectNativeFrontPresentation(model, "en", editorial);
	const mounts = [
		...projection.layout_mounts,
		...projection.content_mounts,
		...(projection.state_mount ? [projection.state_mount] : []),
	];
	const documents = mounts.map((mount) =>
		mountNativeFrontRenderer({ mount, plugin_lock: projection.plugin_lock }),
	);
	return JSON.stringify({ projection, documents });
}
