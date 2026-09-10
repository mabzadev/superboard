import { FrontContextProvider, type FrontContextValue } from "@superboard/front-ui/context";
import { NavigationProvider } from "@superboard/front-ui/navigation";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DashboardPageContent from "../../../../packages/plugins/supbrd-plug-analytics/src/front/components/dashboard/DashboardPageContent.js";
import { TooltipProvider } from "../../../../packages/supbrd-front-ui/src/shared/components/ui/tooltip.js";
import { ProjectSelectionProvider } from "../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js";

const network = vi.hoisted(() => ({
	paths: [] as string[],
	owners: [] as Array<{ path: string; pluginId: string | undefined }>,
	failProducts: false,
	failAnalytics: false,
	deferLinkStatistics: false,
	rejectLinkStatistics: null as ((cause: Error) => void) | null,
}));

vi.mock("../../../../packages/supbrd-front-ui/src/shared/lib/api.js", () => {
	async function request(_method: string, path: string, pluginId?: string) {
		network.paths.push(path);
		network.owners.push({ path, pluginId });
		if (
			network.deferLinkStatistics &&
			path.includes("/dynamic-links/") &&
			path.includes("/statistics")
		) {
			return new Promise<never>((_resolve, reject) => {
				network.rejectLinkStatistics = reject;
			});
		}
		if (network.failProducts && path.includes("/products/"))
			throw new Error("Products unavailable");
		if (network.failAnalytics && path.includes("/analytics/"))
			throw new Error("Analytics unavailable");
		let payload: unknown = [];
		if (path.includes("/analytics/") && path.includes("/overview"))
			payload = {
				events: 137,
				unique_subjects: 17,
				sessions: 21,
				installations: 4,
				successful_purchases: 2,
				series: [],
			};
		else if (path.includes("/dynamic-links/") && path.includes("/statistics"))
			payload = { totals: { views: 42, installs: 3, app_opens: 9, user_referred: 1 }, series: [] };
		else if (path.includes("/dynamic-links/") && path.includes("/links"))
			payload = [{ id: "link-1", name: "Campaign landing", slug: "campaign", total_views: 42 }];
		else if (path.includes("/app/") && path.endsWith("/access-key")) payload = null;
		else if (path.includes("/app/")) payload = { customers: 8, configured_platforms: 1 };
		return { status: 200, data: { data: payload } };
	}
	const client = (pluginId?: string) => ({
		GET: (path: string) => request("GET", path, pluginId),
		POST: (path: string) => request("POST", path, pluginId),
		PUT: (path: string) => request("PUT", path, pluginId),
		PATCH: (path: string) => request("PATCH", path, pluginId),
		DELETE: (path: string) => request("DELETE", path, pluginId),
	});
	return { ...client(), createPluginApiClient: client };
});

const project = {
	id: "42-prod",
	internal_id: "101",
	name: "Production",
	identifier: "production",
	is_test: false,
	created_at: "2026-08-01",
	updated_at: "2026-08-01",
};
const testProject = { ...project, id: "42-test", internal_id: "102", is_test: true };
const context: FrontContextValue = {
	instanceId: "42",
	pluginId: "supbrd-plugmod-analytics",
	path: "/dashboard",
	parameters: {},
	locale: "en",
	operator: { id: "operator-1", email: "operator@example.test", name: "Operator", role: 50 },
	activePluginIds: ["supbrd-plugmod-analytics"],
	projectScope: {
		production_project_ref: project.id,
		test_project_ref: testProject.id,
		instance: {
			id: "42",
			name: "Test instance",
			uri_scheme: "test",
			get_started_dismissed: false,
			created_at: "2026-08-01",
			updated_at: "2026-08-01",
			production: project,
			test: testProject,
			projects: [project, testProject],
		},
	},
};

let root: Root | undefined;
let container: HTMLDivElement;

async function render(activePluginIds = context.activePluginIds) {
	await act(async () => {
		root!.render(
			<FrontContextProvider value={{ ...context, activePluginIds }}>
				<NavigationProvider path={context.path} parameters={{}}>
					<ProjectSelectionProvider>
						<TooltipProvider>
							<DashboardPageContent />
						</TooltipProvider>
					</ProjectSelectionProvider>
				</NavigationProvider>
			</FrontContextProvider>,
		);
	});
}

beforeEach(() => {
	Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
		configurable: true,
		value: true,
	});
	network.paths.length = 0;
	network.owners.length = 0;
	network.failProducts = false;
	network.failAnalytics = false;
	network.deferLinkStatistics = false;
	network.rejectLinkStatistics = null;
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root?.unmount());
	root = undefined;
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

describe("Analytics with optional frontend integrations", () => {
	it("loads its real overview alone without requesting or linking to inactive plugins", async () => {
		await render();
		expect(network.paths.length).toBeGreaterThan(0);
		expect(network.paths.every((path) => path.startsWith("/api/v1/analytics/"))).toBe(true);
		expect(container.textContent).toContain("137");
		expect(container.textContent).toContain("Unique people");
		expect(
			container.querySelector(
				'a[href^="/app/"], a[href^="/products/"], a[href^="/dynamic-links/"]',
			),
		).toBeNull();
		expect(container.textContent).not.toContain("Some module data is temporarily unavailable");
	});
	it("restores only an enabled integration and removes its calls and links on disable", async () => {
		await render([...context.activePluginIds, "supbrd-plugmod-dynamic-links"]);
		expect(network.paths.some((path) => path.startsWith("/api/v1/dynamic-links/"))).toBe(true);
		expect(
			network.owners
				.filter(({ path }) => path.startsWith("/api/v1/dynamic-links/"))
				.every(({ pluginId }) => pluginId === "supbrd-plugmod-dynamic-links"),
		).toBe(true);
		expect(network.paths.some((path) => /\/api\/v1\/(?:app|products)\//u.test(path))).toBe(false);
		expect(container.textContent).toContain("Campaign landing");
		expect(container.querySelector('a[href^="/dynamic-links/"]')).not.toBeNull();
		network.paths.length = 0;
		await render();
		expect(network.paths.some((path) => path.includes("/dynamic-links/"))).toBe(false);
		expect(container.querySelector('a[href^="/dynamic-links/"]')).toBeNull();
		expect(container.textContent).toContain("137");
	});

	it("uses each provider identity for optional User and Products reads", async () => {
		await render([...context.activePluginIds, "supbrd-plug-user", "supbrd-plug-products"]);
		for (const [prefix, owner] of [
			["/api/v1/app/", "supbrd-plug-user"],
			["/api/v1/products/", "supbrd-plug-products"],
		]) {
			const calls = network.owners.filter(({ path }) => path.startsWith(prefix));
			expect(calls.length).toBeGreaterThan(0);
			expect(calls.every(({ pluginId }) => pluginId === owner)).toBe(true);
		}
	});

	it("keeps Analytics available when a provider fails and leaves unknown metrics unknown", async () => {
		network.failProducts = true;
		await render([...context.activePluginIds, "supbrd-plug-products"]);
		expect(container.textContent).toContain("137");
		expect(container.textContent).toContain("Products unavailable");
		const label = [...container.querySelectorAll("span")].find(
			(element) => element.textContent === "Purchases",
		);
		expect(label?.parentElement?.parentElement?.textContent).toContain("—");
	});

	it("ignores an old provider failure after that provider is disabled", async () => {
		network.deferLinkStatistics = true;
		await render([...context.activePluginIds, "supbrd-plugmod-dynamic-links"]);
		expect(network.rejectLinkStatistics).not.toBeNull();
		await render([...context.activePluginIds, "supbrd-plug-user"]);
		await act(async () => {
			network.rejectLinkStatistics?.(new Error("Stale link provider failure"));
		});
		expect(container.textContent).not.toContain("Stale link provider failure");
		expect(container.querySelector('a[href^="/dynamic-links/"]')).toBeNull();
		expect(container.textContent).toContain("137");
	});

	it("does not display zero events when its own overview request fails", async () => {
		network.failAnalytics = true;
		await render();
		expect(container.textContent).toContain("Analytics unavailable");
		const label = [...container.querySelectorAll("p")].find(
			(element) => element.textContent === "Events",
		);
		expect(label?.parentElement?.textContent).toContain("—");
	});
});
