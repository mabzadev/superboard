import { FrontContextProvider } from "@superboard/front-ui/context";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import SdkSetupWizard from "../../../packages/supbrd-runtime-plugins/src/front/client/plugins/supbrd-plug-settings/source/components/app/SdkSetupWizard.js";
import SocialPreview from "../../../packages/supbrd-runtime-plugins/src/front/client/plugins/supbrd-plugmod-dynamic-links/source/components/dynamic_links/social-preview/SocialPreviewPageContent.js";
import McpTokensSection from "../../../packages/supbrd-runtime-plugins/src/front/client/plugins/supbrd-plugmod-mcp/source/components/account/McpTokensSection.js";

const selection = vi.hoisted(() => ({ selectedProject: { id: "42-prod" } }));
vi.mock("../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js", () => ({
	useProjectSelection: () => selection,
}));
vi.mock(
	"../../../packages/supbrd-runtime-plugins/src/front/client/plugins/supbrd-plug-settings/source/api/app/appService.js",
	() => ({
		getSdkConfiguration: async () => null,
		getAccessKey: async () => null,
		saveSdkConfiguration: async () => null,
		testSdkConfiguration: async () => null,
		deleteSdkConfiguration: async () => null,
	}),
);
vi.mock(
	"../../../packages/supbrd-runtime-plugins/src/front/client/plugins/supbrd-plugmod-mcp/source/hooks/queries/useMcpQueries.js",
	() => ({
		useMcpTokensQuery: () => ({ data: [], isLoading: false }),
		useRevokeMcpTokenMutation: () => ({ mutateAsync: async () => undefined }),
	}),
);
vi.mock(
	"../../../packages/supbrd-runtime-plugins/src/front/client/plugins/supbrd-plugmod-dynamic-links/source/api/dynamic-links/dynamicLinksService.js",
	() => ({ getSocialPreview: async () => null, saveSocialPreview: async () => null }),
);
function tree(child: ReactNode, target?: string) {
	return (
		<FrontContextProvider
			value={{
				instanceId: target ?? "missing",
				pluginId: "supbrd-plug-settings",
				operator: null,
				projectScope: null,
				activePluginIds: [],
				parameters: {},
				path: "/settings",
				locale: "en",
				publicEndpoints: target
					? {
							sdk: `https://sdk.${target}.example`,
							shortlinks: `https://in.${target}.example`,
							mcp: `https://mcp.${target}.example`,
							api: `https://api.${target}.example`,
						}
					: {},
			}}
		>
			{child}
		</FrontContextProvider>
	);
}
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
	Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
		configurable: true,
		value: true,
	});
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});
test("MCP endpoint rendering isolates target domains across SSR requests", () => {
	for (const target of ["alpha", "beta", "alpha"]) {
		const html = renderToString(tree(<McpTokensSection />, target));
		expect(html).toContain(`https://mcp.${target}.example/mcp`);
		expect(html).not.toContain(`https://mcp.${target === "alpha" ? "beta" : "alpha"}.example`);
	}
});
test("short-link previews use the target short-link host during SSR", () => {
	const html = renderToString(tree(<SocialPreview />, "alpha"));
	expect(html).toContain("in.alpha.example");
});
test("missing MCP configuration is explicit and does not invent an endpoint", () => {
	const html = renderToString(tree(<McpTokensSection />));
	expect(html).toContain("MCP endpoint is not configured");
	expect(html).not.toContain('href="/mcp"');
});
test("SDK snippets use the configured SDK origin and update with the target", async () => {
	await act(async () => root.render(tree(<SdkSetupWizard platform="web" />, "alpha")));
	const button = [...container.querySelectorAll("button")].find((item) =>
		item.textContent?.includes("Integrate the SDK"),
	)!;
	expect(button).toBeDefined();
	await act(async () => button.click());
	expect(container.textContent).toContain("https://sdk.alpha.example");
	expect(container.textContent).not.toContain("/app/libraries");
	await act(async () => root.render(tree(<SdkSetupWizard platform="web" />, "beta")));
	expect(container.textContent).toContain("https://sdk.beta.example");
	expect(container.textContent).not.toContain("https://sdk.alpha.example");
});

test("Android intent filters use the configured short-link host", async () => {
	await act(async () => root.render(tree(<SdkSetupWizard platform="android" />, "alpha")));
	const button = [...container.querySelectorAll("button")].find((item) =>
		item.textContent?.includes("Intent Filters"),
	)!;
	await act(async () => button.click());
	expect(container.textContent).toContain('android:host="in.alpha.example"');
});
test("missing SDK origin omits executable snippets and reports configuration", async () => {
	await act(async () => root.render(tree(<SdkSetupWizard platform="web" />)));
	const button = [...container.querySelectorAll("button")].find((item) =>
		item.textContent?.includes("Integrate the SDK"),
	)!;
	await act(async () => button.click());
	expect(container.textContent).toContain("SDK endpoint is not configured");
	expect(container.textContent).not.toContain("new SuperBoard(");
});
