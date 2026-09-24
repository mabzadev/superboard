import type { DeploymentConfiguration } from "@superboard/contracts/deployment-configuration";
import { FrontContextProvider } from "@superboard/front-ui/context";
import { QueryClient, QueryClientProvider } from "@superboard/front-ui/query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";

import InstanceConfiguration from "../../../../packages/plugins/superboard-core/src/front/settings/InstanceConfiguration.js";
import { SectionNavigationProvider } from "../../../../packages/supbrd-front-ui/src/section-navigation.js";

test("the French settings view follows configuration returned by the running API", async () => {
	let configuration: DeploymentConfiguration = {
		schemaVersion: 1,
		target: "mbza-development",
		environment: "local",
		profile: "consolidated",
		source: "infra/targets/mbza-development.json",
		checksum: "first",
		publicRouting: "staged",
		authIssuer: "https://auth.mbza.dev",
		endpoints: [
			{ surface: "mcp", url: "https://board.mbza.dev/mcp", worker: "site", clients: ["mcp"] },
		],
		workers: [{ id: "site", name: "site-local", modules: ["site"] }],
		aliases: [],
		webOrigins: [],
		customCapabilities: [],
	};
	vi.stubGlobal(
		"fetch",
		vi.fn(async () =>
			Response.json({
				configuration,
				routesStatus: "loaded",
				routes: [
					{
						method: "GET",
						path: "/users",
						surface: "sdk",
						url: "https://api.mbza.dev/users",
						worker: "api",
						clients: ["web"],
					},
				],
			}),
		),
	);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	try {
		await act(async () => {
			root.render(
				<QueryClientProvider client={client}>
					<FrontContextProvider
						value={{
							path: "/project-settings",
							parameters: {},
							locale: "fr",
							instanceId: "test-instance",
							pluginId: "supbrd-plug-settings",
							operator: null,
							projectScope: null,
							activePluginIds: ["supbrd-plug-settings"],
						}}
					>
						<SectionNavigationProvider
							value={
								<nav aria-label="Configuration">
									<a href="/app/android-setup">Android</a>
									<a href="/app/ios-setup">iOS</a>
								</nav>
							}
						>
							<InstanceConfiguration />
						</SectionNavigationProvider>
					</FrontContextProvider>
				</QueryClientProvider>,
			);
		});
		await vi.waitFor(() => {
			expect(container.textContent).toContain("https://board.mbza.dev/mcp");
		});
		expect(container.querySelector("h1")?.textContent).toBe("Configuration de l’instance");
		const navigation = container.querySelector('nav[aria-label="Configuration"]');
		expect(navigation?.querySelector('a[href="/app/android-setup"]')).not.toBeNull();
		expect(navigation?.querySelector('a[href="/app/ios-setup"]')).not.toBeNull();
		expect(navigation).not.toBeNull();
		const heading = container.querySelector("h1");
		if (!heading || !navigation) throw new Error("Settings heading and navigation are required");
		expect(
			Boolean(heading.compareDocumentPosition(navigation) & Node.DOCUMENT_POSITION_FOLLOWING),
		).toBe(true);
		expect(container.querySelector('a[href*="/_emdash/admin/plugins/"]')).toBeNull();
		expect(container.textContent).toContain("https://api.mbza.dev/users");
		expect(container.textContent).toContain("site-local");
		expect(container.textContent).toContain("https://auth.mbza.dev");
		configuration = {
			...configuration,
			checksum: "updated",
			endpoints: [
				{ surface: "mcp", url: "https://board.updated.test/mcp", worker: "site", clients: ["mcp"] },
			],
		};
		await act(async () => {
			await client.invalidateQueries({ queryKey: ["deployment-configuration"] });
		});
		await vi.waitFor(() => {
			expect(container.textContent).toContain("https://board.updated.test/mcp");
		});
		expect(container.textContent).not.toContain("https://board.mbza.dev/mcp");
	} finally {
		await act(async () => {
			root.unmount();
		});
		client.clear();
		container.remove();
		vi.unstubAllGlobals();
	}
});
