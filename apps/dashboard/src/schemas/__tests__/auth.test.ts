import { describe, it, expect } from "vitest";
import {
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  newPasswordSchema,
} from "../auth";

describe("loginSchema", () => {
  it("accepts valid login", () => {
    const result = loginSchema.safeParse({
      email: "user@example.com",
      password: "password123",
    });
    expect(result.success).toBe(true);
  });

  it("accepts login with optional OTP", () => {
    const result = loginSchema.safeParse({
      email: "user@example.com",
      password: "password123",
      otp: "123456",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing email", () => {
    const result = loginSchema.safeParse({
      email: "",
      password: "password123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const result = loginSchema.safeParse({
      email: "notvalid",
      password: "password123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects short password", () => {
    const result = loginSchema.safeParse({
      email: "user@example.com",
      password: "ab",
    });
    expect(result.success).toBe(false);
  });
});

describe("registerSchema", () => {
  const validRegister = {
    name: "John Doe",
    email: "john@example.com",
    password: "password123",
    password_confirm: "password123",
  };

  it("accepts valid registration", () => {
    expect(registerSchema.safeParse(validRegister).success).toBe(true);
  });

  it("rejects password mismatch", () => {
    const result = registerSchema.safeParse({
      ...validRegister,
      password_confirm: "different",
    });
    expect(result.success).toBe(false);
  });

  it("rejects short name", () => {
    const result = registerSchema.safeParse({
      ...validRegister,
      name: "AB",
    });
    expect(result.success).toBe(false);
  });

  it("rejects short password", () => {
    const result = registerSchema.safeParse({
      ...validRegister,
      password: "short",
      password_confirm: "short",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const result = registerSchema.safeParse({
      ...validRegister,
      email: "bad-email",
    });
    expect(result.success).toBe(false);
  });
});

describe("resetPasswordSchema", () => {
  it("accepts valid email", () => {
    expect(
      resetPasswordSchema.safeParse({ email: "user@example.com" }).success
    ).toBe(true);
  });

  it("rejects invalid email", () => {
    expect(resetPasswordSchema.safeParse({ email: "bad" }).success).toBe(false);
  });

  it("rejects empty email", () => {
    expect(resetPasswordSchema.safeParse({ email: "" }).success).toBe(false);
  });
});

describe("newPasswordSchema", () => {
  it("accepts matching passwords", () => {
    const result = newPasswordSchema.safeParse({
      password: "newpassword",
      password_confirm: "newpassword",
    });
    expect(result.success).toBe(true);
  });

  it("rejects mismatched passwords", () => {
    const result = newPasswordSchema.safeParse({
      password: "newpassword",
      password_confirm: "different",
    });
    expect(result.success).toBe(false);
  });

  it("rejects short password", () => {
    const result = newPasswordSchema.safeParse({
      password: "short",
      password_confirm: "short",
    });
    expect(result.success).toBe(false);
  });
});
