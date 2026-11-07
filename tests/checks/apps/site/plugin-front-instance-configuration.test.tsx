import type { DeploymentConfiguration } from "@superboard/contracts/deployment-configuration";
import { FrontContextProvider } from "@superboard/front-ui/context";
import { QueryClient, QueryClientProvider } from "@superboard/front-ui/query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";

import RunningConfiguration from "../../../../packages/plugins/superboard-core/src/front/observability/DeploymentConfiguration.js";

test("the French Service health view follows configuration returned by the running API", async () => {
	window.history.replaceState({}, "", "/core/infrastructure");
	let configuration: DeploymentConfiguration = {
		schemaVersion: 1,
		target: "mabza-development",
		environment: "local",
		profile: "consolidated",
		source: "infra/targets/mabza-development.json",
		checksum: "first",
		publicRouting: "staged",
		authIssuer: "https://auth.mabza.dev",
		endpoints: [
			{ surface: "mcp", url: "https://board.mabza.dev/mcp", worker: "site", clients: ["mcp"] },
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
						url: "https://api.mabza.dev/users",
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
							path: "/core/infrastructure",
							parameters: {},
							locale: "fr",
							instanceId: "test-instance",
							pluginId: "superboard-observability",
							operator: null,
							projectScope: null,
							activePluginIds: ["superboard-observability"],
						}}
					>
						<RunningConfiguration />
					</FrontContextProvider>
				</QueryClientProvider>,
			);
		});
		await vi.waitFor(() => {
			expect(container.textContent).toContain("https://board.mabza.dev/mcp");
		});
		expect(container.textContent).toContain("Configuration exécutée");
		expect(container.querySelector('a[href*="/_emdash/admin/plugins/"]')).toBeNull();
		expect(container.textContent).toContain("https://api.mabza.dev/users");
		expect(container.textContent).toContain("site-local");
		expect(container.textContent).toContain("https://auth.mabza.dev");
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
		expect(container.textContent).not.toContain("https://board.mabza.dev/mcp");
	} finally {
		await act(async () => {
			root.unmount();
		});
		client.clear();
		container.remove();
		vi.unstubAllGlobals();
		window.history.replaceState({}, "", "/");
	}
});
