// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
	FrontContextProvider,
	type FrontContextValue,
} from "../../../../../packages/supbrd-front-ui/src/context.js";
import {
	PluginDiagnosticsLink,
	pluginDiagnosticsHref,
} from "../../../../../packages/supbrd-front-ui/src/plugin-diagnostics-link.js";

const context = (pluginId: string, locale: string): FrontContextValue => ({
	instanceId: "1",
	pluginId,
	path: "/",
	parameters: {},
	locale,
	operator: null,
	projectScope: null,
	activePluginIds: [pluginId],
});

afterEach(cleanup);

describe("PluginDiagnosticsLink", () => {
	it.each([
		["superboard-flows", "superboard-acquisition"],
		["supbrd-plug-commerce", "superboard-monetization"],
		["superboard-billing", "superboard-monetization"],
		["superboard-analytics", "superboard-analytics"],
	])("sends %s to the Plugins page of its package", (pluginId, directory) => {
		expect(pluginDiagnosticsHref(pluginId)).toBe(
			`/_emdash/admin/plugins-manager/${directory}/configuration`,
		);
	});

	it("uses the current plugin and locale from the front context", () => {
		render(
			<FrontContextProvider value={context("superboard-content", "fr")}>
				<PluginDiagnosticsLink />
			</FrontContextProvider>,
		);
		expect(screen.getByText(/santé, le cycle de vie et les diagnostics/)).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Ouvrir dans Plugins" })).toHaveAttribute(
			"href",
			"/_emdash/admin/plugins-manager/superboard-data/configuration",
		);
	});

	it("works outside a front context with an explicit plugin", () => {
		render(<PluginDiagnosticsLink pluginId="superboard-support" locale="en" />);
		expect(screen.getByRole("link", { name: "Open in Plugins" })).toHaveAttribute(
			"href",
			"/_emdash/admin/plugins-manager/superboard-support/configuration",
		);
	});

	it("renders nothing without a plugin", () => {
		const { container } = render(<PluginDiagnosticsLink />);
		expect(container).toBeEmptyDOMElement();
	});
});
