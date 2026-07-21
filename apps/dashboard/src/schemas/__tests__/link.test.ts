import { describe, it, expect } from "vitest";
import { createLinkSchema } from "../link";

describe("createLinkSchema", () => {
  const validLink = {
    section: "details",
    name: "Test Link",
    path: "test-link",
    linkType: "default",
    socialMediaTitle: "",
    socialMediaSubTitle: "",
    socialMediaCardType: "summary",
    imageType: "link",
    imageFile: undefined,
    imageLink: "",
    imagePreview: null,
    keyValuePair: [],
    tagList: [],
    iOSRedirectURL: null,
    androidRedirectURL: null,
    desktopRedirectURL: null,
    iOSRedirectType: "default",
    androidRedirectType: "default",
    desktopRedirectType: "default",
    showPreviewAndroid: null,
    showPreviewIOS: null,
    utmCampaign: "",
    utmMedium: "",
    utmSource: "",
    pathAvailable: true,
  };

  it("accepts valid link", () => {
    expect(createLinkSchema.safeParse(validLink).success).toBe(true);
  });

  it("accepts link with key-value pairs", () => {
    const result = createLinkSchema.safeParse({
      ...validLink,
      keyValuePair: [
        { key: "utm_source", value: "google" },
        { key: "ref", value: "abc" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts link with redirect URLs", () => {
    const result = createLinkSchema.safeParse({
      ...validLink,
      iOSRedirectURL: {
        url: "https://apps.apple.com/app/123",
        open_app_if_installed: true,
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts link with null redirect URLs", () => {
    const result = createLinkSchema.safeParse({
      ...validLink,
      iOSRedirectURL: null,
      androidRedirectURL: null,
      desktopRedirectURL: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts link with tags", () => {
    const result = createLinkSchema.safeParse({
      ...validLink,
      tagList: ["promo", "summer"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid key-value pair structure", () => {
    const result = createLinkSchema.safeParse({
      ...validLink,
      keyValuePair: [{ wrong: "structure" }],
    });
    expect(result.success).toBe(false);
  });
});
