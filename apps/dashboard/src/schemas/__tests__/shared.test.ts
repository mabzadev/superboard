import { describe, it, expect } from "vitest";
import {
  emailSchema,
  nameSchema,
  passwordSchema,
  httpUrlSchema,
  bundleIdSchema,
  shaSchema,
} from "../shared";

describe("emailSchema", () => {
  it("accepts valid emails", () => {
    expect(emailSchema.safeParse("user@example.com").success).toBe(true);
    expect(emailSchema.safeParse("name.last@domain.co").success).toBe(true);
    expect(emailSchema.safeParse("test+tag@gmail.com").success).toBe(true);
    expect(emailSchema.safeParse("a@b.io").success).toBe(true);
  });

  it("rejects invalid emails", () => {
    expect(emailSchema.safeParse("").success).toBe(false);
    expect(emailSchema.safeParse("notanemail").success).toBe(false);
    expect(emailSchema.safeParse("@domain.com").success).toBe(false);
    expect(emailSchema.safeParse("user@").success).toBe(false);
    expect(emailSchema.safeParse("user @example.com").success).toBe(false);
  });
});

describe("nameSchema", () => {
  it("accepts names with 3+ characters", () => {
    expect(nameSchema.safeParse("Joe").success).toBe(true);
    expect(nameSchema.safeParse("John Doe").success).toBe(true);
  });

  it("rejects names shorter than 3 characters", () => {
    expect(nameSchema.safeParse("AB").success).toBe(false);
    expect(nameSchema.safeParse("").success).toBe(false);
  });
});

describe("passwordSchema", () => {
  it("accepts passwords with 8+ characters", () => {
    expect(passwordSchema.safeParse("password").success).toBe(true);
    expect(passwordSchema.safeParse("12345678").success).toBe(true);
  });

  it("rejects passwords shorter than 8 characters", () => {
    expect(passwordSchema.safeParse("short").success).toBe(false);
    expect(passwordSchema.safeParse("").success).toBe(false);
  });
});

describe("httpUrlSchema", () => {
  it("accepts valid HTTP/HTTPS URLs", () => {
    expect(httpUrlSchema.safeParse("https://example.com").success).toBe(true);
    expect(httpUrlSchema.safeParse("http://example.com").success).toBe(true);
    expect(httpUrlSchema.safeParse("https://sub.domain.io/path").success).toBe(
      true
    );
  });

  it("accepts localhost URLs", () => {
    expect(httpUrlSchema.safeParse("http://localhost:3000").success).toBe(true);
  });

  it("rejects invalid URLs", () => {
    expect(httpUrlSchema.safeParse("").success).toBe(false);
    expect(httpUrlSchema.safeParse("not-a-url").success).toBe(false);
    expect(httpUrlSchema.safeParse("ftp://example.com").success).toBe(false);
  });
});

describe("bundleIdSchema", () => {
  it("accepts valid bundle IDs", () => {
    expect(bundleIdSchema.safeParse("com.example.app").success).toBe(true);
    expect(bundleIdSchema.safeParse("io.grovs.test").success).toBe(true);
    expect(bundleIdSchema.safeParse("MyApp").success).toBe(true);
  });

  it("rejects invalid bundle IDs", () => {
    expect(bundleIdSchema.safeParse("").success).toBe(false);
    expect(bundleIdSchema.safeParse("123.app").success).toBe(false);
    expect(bundleIdSchema.safeParse(".com.example").success).toBe(false);
  });
});

describe("shaSchema", () => {
  it("accepts valid 64-character hex SHA", () => {
    const validSha =
      "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";
    expect(shaSchema.safeParse(validSha).success).toBe(true);
  });

  it("accepts plain 64-character alphanumeric SHA", () => {
    const plainSha = "a".repeat(64);
    expect(shaSchema.safeParse(plainSha).success).toBe(true);
  });

  it("rejects SHA with wrong length", () => {
    expect(shaSchema.safeParse("abc").success).toBe(false);
    expect(shaSchema.safeParse("").success).toBe(false);
  });
});
