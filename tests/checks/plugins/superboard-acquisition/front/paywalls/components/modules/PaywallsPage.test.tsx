import { FrontContextProvider } from "@superboard/front-ui/context";
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

import {
	PaywallStatisticsPage,
	PaywallsPage,
} from "../../../../../../../../packages/plugins/superboard-acquisition/src/front/paywalls/components/modules/PaywallsPage.js";

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

	it("names the paywall results in French", async () => {
		services.getPaywallStatistics.mockResolvedValue({
			filters: {},
			totals: {
				impression: 4,
				cta: 2,
				conversion_rate: 0,
				revenue_micros: 0,
				revenue_by_currency: {},
			},
			series: [{ bucket: "2026-10-01", event_type: "dismiss", count: 2 }],
		});
		render(
			<FrontContextProvider
				value={{
					instanceId: "1",
					pluginId: "superboard-paywalls",
					path: "/acquisition/paywalls/statistics",
					parameters: {},
					locale: "fr",
					operator: null,
					projectScope: null,
					activePluginIds: ["superboard-paywalls"],
				}}
			>
				<PaywallStatisticsPage />
			</FrontContextProvider>,
		);
		expect(await screen.findByText("Aucun achat")).toBeInTheDocument();
		expect(screen.getByText("affichages").nextElementSibling).toHaveTextContent("4");
		expect(screen.getByText("clics sur l’appel à l’action")).toBeInTheDocument();
		expect(screen.getByRole("cell", { name: "Fermetures" })).toBeInTheDocument();
		expect(screen.getByLabelText("Fuseau horaire")).toBeInTheDocument();
		expect(screen.getByPlaceholderText("Tous les emplacements")).toBeInTheDocument();
		expect(screen.getByRole("option", { name: "Semaine" })).toBeInTheDocument();
	});
});
