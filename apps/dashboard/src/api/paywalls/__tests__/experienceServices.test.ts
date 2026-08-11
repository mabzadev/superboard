import { beforeEach, describe, expect, it, vi } from "vitest";

const requestMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  GET: requestMocks.get,
  POST: requestMocks.post,
  PUT: requestMocks.put,
  DELETE: requestMocks.delete,
}));

vi.mock("@/lib/config", () => ({ config: { apiPath: "/api/v1" } }));

import {
  archivePaywall,
  archivePaywallExperience,
  archivePaywallVersion,
  createPaywallVersion,
  deletePaywallPlacement,
  getPaywalls,
  savePaywallPlacement,
  updatePaywall,
} from "../paywallsService";
import {
  deleteOnboarding,
  deleteOnboardingPlacement,
  deleteOnboardingTargetingRule,
  getOnboardingStatistics,
  saveOnboardingPlacement,
  updateOnboarding,
} from "../../onboardings/onboardingsService";

describe("canonical experience services", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const request of Object.values(requestMocks)) {
      request.mockResolvedValue({ data: { data: [] } });
    }
  });

  it("uses the canonical project-ref route for paywalls", async () => {
    await getPaywalls("10-test");
    expect(requestMocks.get).toHaveBeenCalledWith(
      "/api/v1/paywalls/projects/10-test"
    );
  });

  it("sends a versioned visual definition to the paywalls contract", async () => {
    const definition = {
      schema_version: 1 as const,
      theme: {
        accent_color: "#000000",
        background_color: "#ffffff",
        text_color: "#111111",
        font_family: "Inter",
        corner_radius: 12,
      },
      components: [
        { id: "heading", type: "heading" as const, props: { text: "Hello" } },
      ],
      metadata: {},
    };
    await createPaywallVersion("10-prod", "paywall-1", definition, "Review");
    expect(requestMocks.post).toHaveBeenCalledWith(
      "/api/v1/paywalls/projects/10-prod/paywalls/paywall-1/versions",
      { definition, changelog: "Review" }
    );
  });

  it("updates placements without dropping targeting or experiment context", async () => {
    const placement = {
      key: "default",
      paywall_id: "paywall-1",
      active_version_id: "version-1",
      experience_id: "experiment-1",
      targeting: {
        platforms: ["ios"],
        locales: ["fr-FR"],
        countries: ["CH"],
        attributes: { plan: "free" },
      },
      priority: 100,
      active: true,
    };
    await savePaywallPlacement("10-test", placement, "placement-1");
    expect(requestMocks.put).toHaveBeenCalledWith(
      "/api/v1/paywalls/projects/10-test/placements/placement-1",
      placement
    );
  });

  it("passes every statistics dimension to onboardings", async () => {
    await getOnboardingStatistics("10-test", {
      from: "2026-08-01",
      to: "2026-08-07",
      timezone: "Europe/Zurich",
      platform: "ios",
      placement_id: "launch",
      version_id: "version-1",
      experience_id: "experience-1",
      variant_id: "variant-a",
    });
    const path = requestMocks.get.mock.calls[0]?.[0] as string;
    expect(path).toContain("/api/v1/onboardings/projects/10-test/statistics?");
    expect(path).toContain("timezone=Europe%2FZurich");
    expect(path).toContain("variant_id=variant-a");
  });

  it("creates onboarding placements on their canonical resource", async () => {
    const placement = {
      key: "app_launch",
      name: "App launch",
      onboarding_id: "onboarding-1",
      active_version_id: null,
      priority: 100,
      active: true,
    };
    await saveOnboardingPlacement("10-test", placement);
    expect(requestMocks.post).toHaveBeenCalledWith(
      "/api/v1/onboardings/projects/10-test/placements",
      placement
    );
  });

  it("exposes the paywall lifecycle operations supported by the Worker", async () => {
    await updatePaywall("10-test", "paywall-1", {
      identifier: "premium",
      display_name: "Premium",
      description: "Upgrade",
    });
    await archivePaywallVersion("10-test", "paywall-1", "version-1");
    await deletePaywallPlacement("10-test", "placement-1");
    await archivePaywallExperience("10-test", "experience-1");
    await archivePaywall("10-test", "paywall-1");
    expect(requestMocks.post).toHaveBeenCalledWith(
      "/api/v1/paywalls/projects/10-test/paywalls/paywall-1/versions/version-1/archive",
      {}
    );
    expect(requestMocks.put).toHaveBeenCalledWith(
      "/api/v1/paywalls/projects/10-test/paywalls/paywall-1",
      {
        identifier: "premium",
        display_name: "Premium",
        description: "Upgrade",
      }
    );
    expect(requestMocks.delete.mock.calls.map(([path]) => path)).toEqual([
      "/api/v1/paywalls/projects/10-test/placements/placement-1",
      "/api/v1/paywalls/projects/10-test/experiences/experience-1",
      "/api/v1/paywalls/projects/10-test/paywalls/paywall-1",
    ]);
  });

  it("exposes onboarding metadata and delivery deletion operations", async () => {
    await updateOnboarding("10-test", "onboarding-1", {
      display_name: "Welcome",
      description: "First run",
    });
    await deleteOnboardingPlacement("10-test", "placement-1");
    await deleteOnboardingTargetingRule("10-test", "rule-1");
    await deleteOnboarding("10-test", "onboarding-1");
    expect(requestMocks.put).toHaveBeenCalledWith(
      "/api/v1/onboardings/projects/10-test/onboarding-1",
      { display_name: "Welcome", description: "First run" }
    );
    expect(requestMocks.delete.mock.calls.map(([path]) => path)).toEqual([
      "/api/v1/onboardings/projects/10-test/placements/placement-1",
      "/api/v1/onboardings/projects/10-test/targeting-rules/rule-1",
      "/api/v1/onboardings/projects/10-test/onboarding-1",
    ]);
  });
});
