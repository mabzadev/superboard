import { describe, expect, it } from "vitest";
import type { FlowEditorBlock } from "@superboard/contracts/flows";
import {
  selectLegacyExperimentVariant,
  stableBucket,
} from "./legacy-experiments";

describe("legacy experiment assignments", () => {
  it("preserves holdout at 0% and assigns a variant at 100%", async () => {
    await expect(selectLegacyExperimentVariant(block("paywalls", 0), "customer"))
      .resolves.toBe("holdout");
    await expect(selectLegacyExperimentVariant(block("paywalls", 10_000), "customer"))
      .resolves.toMatch(/^variant-/u);
    await expect(selectLegacyExperimentVariant(block("onboardings", 0), "customer"))
      .resolves.toBe("holdout");
    await expect(selectLegacyExperimentVariant(block("onboardings", 10_000), "customer"))
      .resolves.toMatch(/^variant-/u);
  });

  it("uses the removed Onboardings FNV subject bucket for traffic and variant cursor", async () => {
    const subject = Array.from({ length: 10_000 }, (_, index) => `subject-${index}`)
      .find((candidate) => stableBucket(candidate, 10_000) < 1_234)!;
    const selected = await selectLegacyExperimentVariant(
      block("onboardings", 1_234),
      subject,
    );
    const expected = stableBucket(subject, 10_000) % 100 < 40
      ? "variant-a"
      : "variant-b";
    expect(selected).toBe(expected);
  });
});

function block(
  source: "paywalls" | "onboardings",
  trafficBasisPoints: number,
): FlowEditorBlock {
  return {
    id: "workflow:placement:placement-1:experiment:experiment-1:split",
    key: "split",
    type: "traffic-split",
    name: "Split",
    data: {
      variants: [
        { key: "variant-a", weight: 40 },
        { key: "variant-b", weight: 60 },
      ],
      legacy_source: source,
      legacy_project_id: 11,
      legacy_placement_id: "placement-1",
      legacy_experience_id: "experiment-1",
      traffic_basis_points: trafficBasisPoints,
    },
    propertyMeta: [],
    exitNodes: ["variant-a", "variant-b", "holdout"],
    position: { x: 0, y: 0 },
  };
}
