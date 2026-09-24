import type { PluginDiagnosticData } from "@superboard/contracts/plugin-diagnostic";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";

import { render } from "../utils/render.tsx";

const diagnostic = vi.fn();
const settings = vi.fn();
vi.mock("../../../../../packages/admin/src/lib/api/plugins.js", () => ({
	fetchPluginSettings: (...args: unknown[]) => settings(...args),
}));
vi.mock("../../../../../packages/admin/src/lib/api/plugin-configuration.js", () => ({
	fetchPluginDiagnostic: (...args: unknown[]) => diagnostic(...args),
}));
vi.mock("../../../../../packages/admin/src/components/RouterLinkButton.js", () => ({
	RouterLinkButton: () => null,
}));
const { PluginConfiguration } =
	await import("../../../../../packages/admin/src/components/PluginConfiguration.js");
const data: PluginDiagnosticData = {
	pluginId: "superboard-data",
	label: "Data",
	lifecycle: { state: "disabled", changedAt: null, reason: null },
	configuration: {
		pluginId: "superboard-data",
		label: "Data",
		version: "2.0.0",
		capabilities: [],
		failurePolicies: { reads: "unavailable", writes: "fail_closed" },
	},
	health: { status: "unknown", checkedAt: null, reason: null },
	workers: [
		{
			service: "files",
			workerName: "files",
			physicalName: "local-files",
			deploymentGroup: "files",
			modules: ["files"],
			isShared: false,
			sharedWith: [],
		},
	],
	dependencies: [],
	routes: { views: [{ routeId: "files", path: "/data/files", method: "GET" }], api: [] },
};
beforeEach(() => {
	diagnostic.mockReset().mockResolvedValue(data);
	settings.mockReset().mockResolvedValue({
		schema: {
			language: { type: "string", label: "Language", default: "en" },
			token: { type: "secret", label: "Token" },
		},
		values: { language: "fr", token: "never-render-this-secret" },
		secretsSet: { token: true },
	});
});
function screen() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<PluginConfiguration pluginId="superboard-data" />
		</QueryClientProvider>,
	);
}
it("shows disabled plugin details, stored values and secret presence without exposing a secret", async () => {
	const view = await screen();
	await expect.element(view.getByText("Disabled", { exact: true })).toBeInTheDocument();
	await expect.element(view.getByRole("cell", { name: "fr", exact: true })).toBeInTheDocument();
	await expect
		.element(view.getByRole("cell", { name: "Configured", exact: true }))
		.toBeInTheDocument();
	await expect
		.element(view.getByRole("cell", { name: "local-files", exact: true }))
		.toBeInTheDocument();
	await expect
		.element(view.getByRole("cell", { name: "/data/files", exact: true }))
		.toBeInTheDocument();
	expect(document.body.textContent).not.toContain("never-render-this-secret");
});
it("refreshes worker observations after a health check", async () => {
	const view = await screen();
	await expect.element(view.getByRole("heading", { name: "Verified Health" })).toBeInTheDocument();
	diagnostic.mockResolvedValue({
		...data,
		workers: [{ ...data.workers[0], physicalName: "verified-files" }],
		health: { status: "ready", checkedAt: "2026-09-22T12:00:00Z", reason: null },
	});
	await view.getByRole("button", { name: "Re-check Health" }).click();
	await expect
		.element(view.getByRole("cell", { name: "verified-files", exact: true }))
		.toBeInTheDocument();
	await expect.element(view.getByText("Ready", { exact: true })).toBeInTheDocument();
});
