import { describe, expect, it } from "vitest";
import {
  createExperienceDocument,
  fromOnboardingDefinition,
  fromPaywallDefinition,
  toOnboardingDefinition,
  toPaywallDefinition,
  validateExperienceDocument,
} from "../model";

describe("experience editor model", () => {
  it("creates a valid editable document", () => {
    const document = createExperienceDocument();
    expect(document.screens).toHaveLength(1);
    expect(document.screens[0]?.blocks.map(({ type }) => type)).toEqual([
      "heading",
      "text",
      "button",
    ]);
    expect(validateExperienceDocument(document)).toEqual([]);
  });

  it("reports duplicate ids, empty text and stale transitions", () => {
    const document = createExperienceDocument();
    const first = document.screens[0]!;
    document.screens.push({
      ...structuredClone(first),
      name: "",
      next_screen_id: "deleted_screen",
    });
    first.blocks[0]!.props.text = "";
    const messages = validateExperienceDocument(document).map(
      ({ message }) => message
    );
    expect(messages).toContain("Every screen needs a unique identifier.");
    expect(messages).toContain("Every screen needs a name.");
    expect(messages).toContain("heading text cannot be empty.");
    expect(messages).toContain("The next screen no longer exists.");
  });

  it("converts paywalls without leaking onboarding-only benefits", () => {
    const document = createExperienceDocument();
    document.screens[0]!.blocks.push({
      id: "benefits_1",
      type: "benefits",
      props: { items: ["Fast"] },
    });
    const paywall = toPaywallDefinition(document);
    expect(paywall.components.map(({ type }) => String(type))).not.toContain(
      "benefits"
    );
    expect(fromPaywallDefinition(paywall).screens[0]?.blocks).toEqual(
      paywall.components
    );
  });

  it("round-trips screens, navigation and themes for onboarding", () => {
    const document = createExperienceDocument();
    document.theme.accent_color = "#ff0066";
    document.screens.push({
      id: "success",
      name: "Success",
      blocks: [{ id: "done", type: "heading", props: { text: "Done" } }],
    });
    document.screens[0]!.next_screen_id = "success";
    const wire = toOnboardingDefinition(document);
    expect(fromOnboardingDefinition(wire)).toEqual(document);
  });
});
