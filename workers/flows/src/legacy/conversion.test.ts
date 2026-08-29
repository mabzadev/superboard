import { describe, expect, it } from "vitest";
import {
  legacyEventName,
  onboardingDefinitionToGraph,
  paywallDefinitionToGraph,
} from "./conversion";

describe("legacy Flows conversion", () => {
  it("keeps commerce execution under Products authority", () => {
    const graph = paywallDefinitionToGraph("workflow", {
      theme: { accent: "violet" },
      components: [{ id: "cta", type: "button", props: { text: "Buy" } }],
    });
    expect(graph.blocks[1]).toMatchObject({
      type: "component",
      componentType: "superboard-commerce",
      data: { authority: "products", purchase_events_are_verified: true },
    });
  });

  it("forces migrated marketing consent to explicit optional opt-in", () => {
    const graph = onboardingDefinitionToGraph("workflow", {
      screens: [
        {
          id: "welcome",
          blocks: [
            {
              type: "marketing_consent",
              props: { default: true, required: true, list_ids: ["news"] },
            },
          ],
        },
      ],
    });
    expect(graph.blocks[1]?.data).toMatchObject({
      screens: [
        {
          blocks: [
            {
              props: {
                default: false,
                required: false,
                explicit_action_required: true,
                destination: "marketing",
              },
            },
          ],
        },
      ],
    });
  });

  it("never normalizes purchase/install as authority metrics", () => {
    expect(legacyEventName("paywalls", "purchase")).toBe("transition");
    expect(legacyEventName("onboardings", "impression")).toBe("block-activated");
  });
});
