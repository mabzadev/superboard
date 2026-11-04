import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "../../../../../../packages/supbrd-front-ui/render.js";

const services = vi.hoisted(() => ({
	getOnboardings: vi.fn(),
	getOnboardingPlacements: vi.fn(),
	getOnboardingTargetingRules: vi.fn(),
	getOnboardingExperiences: vi.fn(),
	getOnboardingVersions: vi.fn(),
	getOnboardingStatistics: vi.fn(),
	createOnboardingVersion: vi.fn(),
}));

vi.mock(
	"../../../../../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js",
	() => ({
		useProjectSelection: () => ({ selectedProject: { id: "10-test" } }),
	}),
);

vi.mock(
	"../../../../../../../../packages/plugins/superboard-acquisition/src/front/onboardings/api/onboardings/onboardingsService.js",
	async (importOriginal) => ({
		...(await importOriginal<object>()),
		...services,
	}),
);

import { OnboardingsPage } from "../../../../../../../../packages/plugins/superboard-acquisition/src/front/onboardings/components/modules/OnboardingPages.js";

describe("OnboardingsPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		window.history.replaceState(null, "", "/onboardings?item=onboarding-1");
		services.getOnboardings.mockResolvedValue([
			{ id: "onboarding-1", identifier: "welcome", display_name: "Welcome" },
		]);
		services.getOnboardingPlacements.mockResolvedValue([]);
		services.getOnboardingTargetingRules.mockResolvedValue([]);
		services.getOnboardingExperiences.mockResolvedValue([]);
		services.getOnboardingVersions.mockResolvedValue([
			{ id: "version-1", version: 1, state: "published", configuration: {} },
		]);
		services.getOnboardingStatistics.mockResolvedValue({
			filters: {},
			totals: {},
			series: [],
			funnel: [],
		});
	});

	it("keeps the onboarding as the only page title in its results", async () => {
		render(<OnboardingsPage />);
		await userEvent.click(await screen.findByRole("button", { name: "Results" }));
		expect(await screen.findByText("Results for version")).toBeInTheDocument();
		expect(services.getOnboardingStatistics).toHaveBeenCalledWith(
			"10-test",
			expect.objectContaining({ version_id: "version-1" }),
		);
		expect(
			screen.queryByRole("heading", { name: "Onboarding statistics" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByText("Completion and drop-off across published onboarding flows."),
		).not.toBeInTheDocument();
	});
});
