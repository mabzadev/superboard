import { describe, it, expect } from "vitest";
import { redirectRulesSchema } from "../redirect";

describe("redirectRulesSchema", () => {
  const validConfig = {
    defaultUrl: "https://example.com",
    android: {
      enabled: true,
      appStore: true,
      customUrl: "",
      showPreview: false,
    },
    ios: {
      enabled: true,
      appStore: true,
      customUrl: "",
      showPreview: false,
    },
    desktop: {
      generatedPage: true,
      customUrl: "",
    },
  };

  it("accepts valid redirect config", () => {
    expect(redirectRulesSchema.safeParse(validConfig).success).toBe(true);
  });

  it("accepts config with custom URLs", () => {
    const result = redirectRulesSchema.safeParse({
      ...validConfig,
      android: {
        ...validConfig.android,
        appStore: false,
        customUrl: "https://custom.com",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts config with all platforms disabled", () => {
    const result = redirectRulesSchema.safeParse({
      defaultUrl: "",
      android: {
        enabled: false,
        appStore: false,
        customUrl: "",
        showPreview: false,
      },
      ios: {
        enabled: false,
        appStore: true,
        customUrl: "",
        showPreview: false,
      },
      desktop: { generatedPage: true, customUrl: "" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing android field", () => {
    const { android: _android, ...partial } = validConfig;
    expect(redirectRulesSchema.safeParse(partial).success).toBe(false);
  });

  it("rejects missing ios field", () => {
    const { ios: _ios, ...partial } = validConfig;
    expect(redirectRulesSchema.safeParse(partial).success).toBe(false);
  });

  it("rejects missing desktop field", () => {
    const { desktop: _desktop, ...partial } = validConfig;
    expect(redirectRulesSchema.safeParse(partial).success).toBe(false);
  });
});
