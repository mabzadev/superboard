import { describe, it, expect } from "vitest";
import { addMemberSchema } from "../member";

describe("addMemberSchema", () => {
  it("accepts valid member", () => {
    const result = addMemberSchema.safeParse({
      email: "user@example.com",
      role: "admin",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const result = addMemberSchema.safeParse({
      email: "bad-email",
      role: "admin",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty email", () => {
    const result = addMemberSchema.safeParse({ email: "", role: "admin" });
    expect(result.success).toBe(false);
  });

  it("rejects empty role", () => {
    const result = addMemberSchema.safeParse({
      email: "user@example.com",
      role: "",
    });
    expect(result.success).toBe(false);
  });
});
