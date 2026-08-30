import { describe, it, expect } from "vitest";
import {
  emailSchema,
  nameSchema,
  passwordSchema,
  httpUrlSchema,
  bundleIdSchema,
  shaSchema,
} from "@/schemas/shared";
import { isSafePublicHttpsUrl, isUrlSchemeValid } from "@/lib/validation";

describe("emailSchema", () => {
  it("accepts valid emails", () => {
    expect(emailSchema.safeParse("user@example.com").success).toBe(true);
    expect(emailSchema.safeParse("name.last@domain.co").success).toBe(true);
    expect(emailSchema.safeParse("test+tag@gmail.com").success).toBe(true);
  });

  it("rejects invalid emails", () => {
    expect(emailSchema.safeParse("").success).toBe(false);
    expect(emailSchema.safeParse("notanemail").success).toBe(false);
    expect(emailSchema.safeParse("@domain.com").success).toBe(false);
    expect(emailSchema.safeParse("user@").success).toBe(false);
  });
});

describe("nameSchema", () => {
  it("accepts names with 3+ characters", () => {
    expect(nameSchema.safeParse("Bob").success).toBe(true);
    expect(nameSchema.safeParse("Alice").success).toBe(true);
  });

  it("rejects names shorter than 3 characters", () => {
    expect(nameSchema.safeParse("").success).toBe(false);
    expect(nameSchema.safeParse("A").success).toBe(false);
    expect(nameSchema.safeParse("AB").success).toBe(false);
  });
});

describe("passwordSchema", () => {
  it("accepts passwords with 8+ characters", () => {
    expect(passwordSchema.safeParse("12345678").success).toBe(true);
    expect(passwordSchema.safeParse("longpassword").success).toBe(true);
  });

  it("rejects passwords shorter than 8 characters", () => {
    expect(passwordSchema.safeParse("").success).toBe(false);
    expect(passwordSchema.safeParse("1234567").success).toBe(false);
  });
});

describe("isUrlSchemeValid", () => {
  it("accepts valid URL schemes", () => {
    expect(isUrlSchemeValid("https://example.com")).toBe(true);
    expect(isUrlSchemeValid("myapp://path")).toBe(true);
  });

  it("rejects invalid URL schemes", () => {
    expect(isUrlSchemeValid("")).toBe(false);
    expect(isUrlSchemeValid("example.com")).toBe(false);
    expect(isUrlSchemeValid("://missing")).toBe(false);
  });
});

describe("isSafePublicHttpsUrl", () => {
  it("accepts public HTTPS destinations", () => {
    expect(isSafePublicHttpsUrl("https://hooks.example.com/support")).toBe(
      true
    );
  });

  it("rejects private, credentialed and non-HTTPS destinations", () => {
    expect(isSafePublicHttpsUrl("http://hooks.example.com/support")).toBe(
      false
    );
    expect(isSafePublicHttpsUrl("https://127.0.0.1/support")).toBe(false);
    expect(
      isSafePublicHttpsUrl("https://user:secret@example.com/support")
    ).toBe(false);
    expect(
      isSafePublicHttpsUrl("https://hooks.example.com/support#secret")
    ).toBe(false);
  });
});

describe("bundleIdSchema", () => {
  it("accepts valid bundle IDs", () => {
    expect(bundleIdSchema.safeParse("com.example.app").success).toBe(true);
    expect(bundleIdSchema.safeParse("io.opengrow.test").success).toBe(true);
    expect(bundleIdSchema.safeParse("MyApp").success).toBe(true);
  });

  it("rejects invalid bundle IDs", () => {
    expect(bundleIdSchema.safeParse("").success).toBe(false);
    expect(bundleIdSchema.safeParse("123.app").success).toBe(false);
    expect(bundleIdSchema.safeParse(".com.example").success).toBe(false);
  });
});

describe("httpUrlSchema", () => {
  it("accepts valid URLs with protocol", () => {
    expect(httpUrlSchema.safeParse("https://example.com").success).toBe(true);
    expect(httpUrlSchema.safeParse("http://example.com").success).toBe(true);
  });

  it("accepts localhost URLs", () => {
    expect(httpUrlSchema.safeParse("http://localhost:3000").success).toBe(true);
    expect(httpUrlSchema.safeParse("https://localhost:8080").success).toBe(
      true
    );
  });

  it("rejects URLs without protocol", () => {
    expect(httpUrlSchema.safeParse("example.com").success).toBe(false);
  });

  it("rejects null and undefined", () => {
    expect(httpUrlSchema.safeParse(null).success).toBe(false);
    expect(httpUrlSchema.safeParse(undefined).success).toBe(false);
  });
});

describe("shaSchema", () => {
  it("accepts valid 64-char SHA strings", () => {
    const sha =
      "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";
    expect(shaSchema.safeParse(sha).success).toBe(true);
  });

  it("rejects strings without 64 alphanumeric chars", () => {
    expect(shaSchema.safeParse("tooshort").success).toBe(false);
    expect(shaSchema.safeParse("").success).toBe(false);
  });
});
