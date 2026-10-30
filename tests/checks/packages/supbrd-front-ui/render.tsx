import { render as renderComponent, type RenderOptions } from "@testing-library/react";
import type { ReactNode } from "react";

import {
	FrontContextProvider,
	type FrontContextValue,
} from "../../../../packages/supbrd-front-ui/src/context.js";

export * from "@testing-library/react";
const context: FrontContextValue = {
	publicEndpoints: {
		api: "https://api.example.test",
		sdk: "https://sdk.example.test",
		shortlinks: "https://links.example.test",
		mcp: "https://mcp.example.test",
		site: "https://site.example.test",
		auth: "https://auth.example.test",
		files: "https://files.example.test",
	},
	instanceId: "1",
	pluginId: "superboard-user",
	path: "/",
	parameters: {},
	locale: "en",
	operator: {
		id: "front-test-operator",
		email: "operator@example.test",
		name: "Operator",
		role: 50,
	},
	projectScope: null,
	activePluginIds: [
		"superboard-user",
		"superboard-products",
		"superboard-settings",
		"superboard-billing",
		"superboard-analytics",
		"superboard-dynamic-links",
		"superboard-flows",
		"superboard-paywalls",
		"superboard-onboardings",
		"superboard-support",
		"superboard-marketing",
		"superboard-email",
		"superboard-mcp",
		"superboard-files",
		"superboard-observability",
	],
};
export function render(ui: ReactNode, options: RenderOptions = {}) {
	const Wrapper = options.wrapper;
	return renderComponent(ui, {
		...options,
		wrapper: ({ children }) => (
			<FrontContextProvider value={context}>
				{Wrapper ? <Wrapper>{children}</Wrapper> : children}
			</FrontContextProvider>
		),
	});
}
