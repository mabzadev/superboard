import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "../../../../../../packages/supbrd-front-ui/render.js";

const services = vi.hoisted(() => ({
	getPaywalls: vi.fn(),
	getPaywallPlacements: vi.fn(),
	getPaywallExperiences: vi.fn(),
	getPaywallVersions: vi.fn(),
	getPaywallStatistics: vi.fn(),
	createPaywallVersion: vi.fn(),
}));

vi.mock(
	"../../../../../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js",
	() => ({
		useProjectSelection: () => ({ selectedProject: { id: "10-test" } }),
	}),
);

vi.mock(
	"../../../../../../../../packages/plugins/superboard-acquisition/src/front/paywalls/api/paywalls/paywallsService.js",
	async (importOriginal) => ({
		...(await importOriginal<object>()),
		...services,
	}),
);

import { PaywallsPage } from "../../../../../../../../packages/plugins/superboard-acquisition/src/front/paywalls/components/modules/PaywallsPage.js";

describe("PaywallsPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		window.history.replaceState(null, "", "/acquisition/paywalls?item=paywall-1");
		services.getPaywalls.mockResolvedValue([
			{ id: "paywall-1", identifier: "spring_sale", display_name: "Spring sale" },
		]);
		services.getPaywallPlacements.mockResolvedValue([]);
		services.getPaywallExperiences.mockResolvedValue([]);
		services.getPaywallVersions.mockResolvedValue([
			{
				id: "version-1",
				paywall_id: "paywall-1",
				version: 1,
				status: "published",
				definition: {},
				created_at: "2026-10-01T10:00:00Z",
			},
		]);
		services.getPaywallStatistics.mockResolvedValue({ totals: {}, series: [] });
	});

	it("keeps the paywall as the only page title in its results", async () => {
		render(<PaywallsPage />);
		await userEvent.click(await screen.findByRole("button", { name: "Results" }));
		expect(await screen.findByText("Results for version")).toBeInTheDocument();
		expect(services.getPaywallStatistics).toHaveBeenCalledWith(
			"10-test",
			expect.objectContaining({ version_id: "version-1" }),
		);
		expect(screen.queryByRole("heading", { name: "Paywall statistics" })).not.toBeInTheDocument();
		expect(
			screen.queryByText("Conversion, revenue and event performance for the last 30 days."),
		).not.toBeInTheDocument();
	});
});
