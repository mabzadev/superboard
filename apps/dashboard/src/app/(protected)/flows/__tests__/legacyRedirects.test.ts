import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ redirect }));

import OnboardingsPage from "../../onboardings/page";
import OnboardingStatisticsPage from "../../onboardings/statistics/page";
import PaywallsPage from "../../paywalls/page";
import PaywallStatisticsPage from "../../paywalls/statistics/page";

describe("legacy experience redirects", () => {
  beforeEach(() => redirect.mockClear());

  it.each([
    [PaywallsPage, "/flows/workflows?origin=paywalls"],
    [PaywallStatisticsPage, "/flows/workflows?origin=paywalls&view=analytics"],
    [OnboardingsPage, "/flows/workflows?origin=onboardings"],
    [
      OnboardingStatisticsPage,
      "/flows/workflows?origin=onboardings&view=analytics",
    ],
  ])("redirects the retired route to Flows", (page, destination) => {
    page();
    expect(redirect).toHaveBeenCalledWith(destination);
  });
});
