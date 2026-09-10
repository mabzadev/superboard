import { FrontContextProvider } from "@superboard/front-ui/context";
import type { FrontContextValue } from "@superboard/front-ui/context";
import { NavigationProvider } from "@superboard/front-ui/navigation";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LinksPageContent from "../../../../packages/plugins/supbrd-plug-communication/src/front/dynamic-links/components/dynamic_links/links/LinksPageContent.js";
import { TooltipProvider } from "../../../../packages/supbrd-front-ui/src/shared/components/ui/tooltip.js";
import { ProjectSelectionProvider } from "../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js";

const network = vi.hoisted(() => ({ failCampaigns: false }));
vi.mock("../../../../packages/supbrd-front-ui/src/shared/lib/api.js", () => {
	async function GET(path: string) {
		if (path.endsWith("/campaigns")) {
			if (network.failCampaigns) throw new Error("Campaign service unavailable");
			return {
				status: 200,
				data: {
					data: [
						{
							id: "campaign-1",
							name: "Autumn launch",
							slug: "autumn-launch",
							status: "active",
							metadata: {},
							created_at: "2026-09-01",
						},
					],
				},
			};
		}
		return { status: 200, data: { data: [] } };
	}
	return { GET, createPluginApiClient: () => ({ GET }) };
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
	pluginId: "supbrd-plugmod-dynamic-links",
	path: "/dynamic-links/campaigns/campaign-1",
	parameters: {},
	locale: "en",
	operator: { id: "operator-1", email: "operator@example.test", name: "Operator", role: 50 },
	activePluginIds: ["supbrd-plugmod-dynamic-links"],
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
async function render(campaignId = "campaign-1") {
	await act(async () => {
		root!.render(
			<FrontContextProvider value={context}>
				<NavigationProvider path={context.path} parameters={{}}>
					<ProjectSelectionProvider>
						<TooltipProvider>
							<LinksPageContent campaignId={campaignId} />
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
	network.failCampaigns = false;
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root?.unmount());
	root = undefined;
	document.body.replaceChildren();
});
describe("Dynamic Links campaign detail", () => {
	it("identifies the campaign even when it has no links", async () => {
		await render();
		expect(container.querySelector("h1")?.textContent).toBe("Autumn launch");
		expect(container.textContent).not.toContain("Campaign not found");
		expect(
			[...container.querySelectorAll("button")].some((button) =>
				button.textContent?.includes("Create Link"),
			),
		).toBe(true);
	});
	it("reports an unknown campaign and prevents creating links for that ID", async () => {
		await render("missing-campaign");
		expect(container.querySelector('[role="alert"]')?.textContent).toContain("Campaign not found");
		expect(
			[...container.querySelectorAll("button")].some((button) =>
				/create link/i.test(button.textContent ?? ""),
			),
		).toBe(false);
	});
	it("keeps a failed lookup distinct from a missing campaign", async () => {
		network.failCampaigns = true;
		await render();
		expect(container.querySelector('[role="alert"]')?.textContent).toContain(
			"Campaign service unavailable",
		);
		expect(container.textContent).not.toContain("Campaign not found");
	});
});
