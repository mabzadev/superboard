import { webcrypto } from "node:crypto";

import { compileFrontRelease, resolveFrontRequest } from "@superboard/supbrd-core";
import { getMenu } from "emdash";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

import { NativeFrontNavigation } from "../../../../apps/site/src/components/NativeFrontNavigation.js";
import type { FrontPageModel } from "../../../../apps/site/src/lib/front-page.js";
import { projectNativeFrontPresentation } from "../../../../apps/site/src/lib/native-front-presentation.js";
import { editableNavigationFromMenu } from "../../../../apps/site/src/lib/native-front-views.js";
import { organizeProductNavigation } from "../../../../apps/site/src/lib/product-navigation.js";
import { superBoardRuntimePluginCatalog } from "../../../../apps/site/src/lib/superboard-plugin-catalog.js";
import { resolveUserFrontRequestLocale } from "../../../../apps/site/src/lib/user-front-i18n.js";
import { composeUserFrontReleaseInput } from "../../../../apps/site/src/lib/user-front-release.js";
import {
	handleMenuCreate,
	handleMenuGet,
	handleMenuItemCreate,
	handleMenuItemUpdate,
	handleMenuItemReorder,
	handleMenuItemDelete,
} from "../../../../packages/core/src/api/handlers/menus.js";
import type { ApiResult } from "../../../../packages/core/src/api/types.js";
import { __setObjectCacheBackendForTests } from "../../../../packages/core/src/object-cache/index.js";
import { createObjectCache } from "../../../../packages/core/src/object-cache/memory.js";
import { runWithContext } from "../../../../packages/core/src/request-context.js";
import { setupTestDatabase, teardownTestDatabase } from "../../packages/core/utils/test-db.js";

const anchorPattern = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gu;
const markupPattern = /<[^>]+>/gu;

vi.mock("virtual:emdash/wait-until", () => ({ waitUntil: undefined }), { virtual: true });
let db: Awaited<ReturnType<typeof setupTestDatabase>> | undefined;
afterEach(async () => {
	__setObjectCacheBackendForTests(null);
	if (db) await teardownTestDatabase(db);
});
function result<T>(value: ApiResult<T>): T {
	if (!value.success) throw new Error(value.error.message);
	return value.data;
}

async function model(): Promise<FrontPageModel> {
	const keys = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
		"sign",
		"verify",
	]);
	const locked = superBoardRuntimePluginCatalog()
		.plugins.filter(({ manifest }) =>
			["supbrd-plug-user", "supbrd-plugmod-analytics"].includes(manifest.plugin_id),
		)
		.map(({ manifest }) => ({
			plugin_id: manifest.plugin_id,
			version: manifest.plugin_version,
			artifact_checksum: manifest.artifact_checksum,
			native: manifest.execution.backend === "native",
		}));
	const release = await compileFrontRelease(
		await composeUserFrontReleaseInput({
			instance_id: "menu-integration",
			front_draft_id: "01J00000000000000000000401",
			draft_snapshot_id: "01J00000000000000000000402",
			compilation_id: "01J00000000000000000000403",
			candidate_id: "01J00000000000000000000404",
			release_id: "01J00000000000000000000405",
			release_sequence: 1,
			previous_release_id: null,
			created_at: "2026-09-08T12:00:00.000Z",
			plugin_lock: locked,
		}),
		{ kid: "menu-test", private_key: keys.privateKey },
	);
	const permissions = ["users.read", "supbrd-plugmod-analytics.read"];
	const runtime = {
		front_route_manifest: release.payload.front_route_manifest,
		dependency_policies: release.payload.dependency_policies,
	};
	return {
		instance_id: "menu-integration",
		requested_path: "/analytics",
		release: { release, runtime_release: runtime, pointer_revision: 1, source: "preview" },
		resolution: resolveFrontRequest({
			last_verified_release: runtime,
			requested_path: "/analytics",
			admin_session: "valid",
			permissions,
			dependency_health: Object.fromEntries(
				release.payload.dependency_policies.map((item) => [item.dependency_id, "ready" as const]),
			),
		}),
		page_title: "Analytics",
		operator: {
			id: "menu-operator",
			email: "operator@example.test",
			name: "Operator",
			role: 100,
			disabled: false,
		},
		permissions,
	};
}

test("native EmDash edits, moves and deletions propagate through the warm cache to the front", async () => {
	db = await setupTestDatabase();
	const database = db;
	const cache = createObjectCache({});
	const reads = vi.spyOn(cache, "get");
	__setObjectCacheBackendForTests(cache, { revalidate: 60_000, defaultTtl: 3600 });
	const page = await model();
	const name = "superboard-admin";
	const fr = { locale: "fr" };
	result(await handleMenuCreate(database, { name, label: "Navigation du front", locale: "fr" }));
	result(await handleMenuCreate(database, { name, label: "Front navigation", locale: "en" }));
	const group = result(
		await handleMenuItemCreate(
			database,
			name,
			{ type: "custom", label: "Statistiques", customUrl: "/analytics" },
			fr,
		),
	);
	const overview = result(
		await handleMenuItemCreate(
			database,
			name,
			{
				type: "custom",
				label: "Vue locale",
				customUrl: "/analytics",
				parentId: group.id,
				sortOrder: 0,
			},
			fr,
		),
	);
	const events = result(
		await handleMenuItemCreate(
			database,
			name,
			{
				type: "custom",
				label: "Événements locaux",
				customUrl: "/analytics/events",
				parentId: group.id,
				sortOrder: 1,
			},
			fr,
		),
	);
	result(
		await handleMenuItemCreate(
			database,
			name,
			{ type: "custom", label: "English overview", customUrl: "/analytics" },
			{ locale: "en" },
		),
	);
	let lastMarkup = "";
	const render = async (language: string, headers: HeadersInit = {}) =>
		runWithContext({ editMode: false, db: database }, async () => {
			const locale = resolveUserFrontRequestLocale(
				new Request(`https://console.test/analytics?lang=${language}`, { headers }),
			);
			const menu = await getMenu(name, { locale });
			const projection = projectNativeFrontPresentation(page, locale, {
				navigation: editableNavigationFromMenu(menu),
			});
			const navigation = organizeProductNavigation(projection.navigation, page.requested_path);
			const markup = renderToStaticMarkup(
				<NativeFrontNavigation
					navigation={navigation}
					collapsed={false}
					expand={() => {}}
					closeMobile={() => {}}
				/>,
			);
			lastMarkup = markup;
			return Array.from(markup.matchAll(anchorPattern), (match) => ({
				label: match[2]!.replace(markupPattern, ""),
				href: match[1],
			}));
		});
	const initial = await render("fr", { Cookie: "superboard-locale=en", "Accept-Language": "en" });
	expect(initial.map((item) => item.label)).toEqual(["Vue locale", "Événements locaux"]);
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(await render("fr")).toEqual(initial);
	expect(
		(
			await Promise.all(
				reads.mock.results.filter((item) => item.type === "return").map((item) => item.value),
			)
		).some((value) => value !== null),
	).toBe(true);
	result(await handleMenuItemUpdate(database, name, overview.id, { label: "Mes chiffres" }, fr));
	expect((await render("fr")).map((item) => item.label)).toEqual([
		"Mes chiffres",
		"Événements locaux",
	]);
	expect((await render("en")).map((item) => item.label)).toEqual(["English overview"]);
	result(
		await handleMenuItemReorder(
			database,
			name,
			[
				{ id: events.id, parentId: group.id, sortOrder: 0 },
				{ id: overview.id, parentId: group.id, sortOrder: 1 },
			],
			fr,
		),
	);
	expect((await render("fr")).map((item) => item.label)).toEqual([
		"Événements locaux",
		"Mes chiffres",
	]);
	result(await handleMenuItemUpdate(database, name, overview.id, { parentId: null }, fr));
	await render("fr");
	expect(lastMarkup.indexOf("Mes chiffres")).toBeGreaterThan(lastMarkup.indexOf("</details>"));
	result(await handleMenuItemUpdate(database, name, overview.id, { parentId: group.id }, fr));
	await render("fr");
	expect(lastMarkup.indexOf("Mes chiffres")).toBeLessThan(lastMarkup.indexOf("</details>"));
	result(await handleMenuItemDelete(database, name, events.id, fr));
	expect(await render("fr")).toEqual([{ label: "Mes chiffres", href: "/analytics" }]);
	expect(
		result(await handleMenuGet(database, name, fr)).items.some((item) => item.id === events.id),
	).toBe(false);
	result(await handleMenuItemDelete(database, name, overview.id, fr));
	expect(await render("fr")).toEqual([{ label: "Statistiques", href: "/analytics" }]);
	result(await handleMenuItemDelete(database, name, group.id, fr));
	expect(await render("fr")).toEqual([]);
	expect((await render("en")).map((item) => item.label)).toEqual(["English overview"]);
});
