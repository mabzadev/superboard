import { describe, it, expect } from "vitest";
import { createProjectSchema, createCampaignSchema } from "../project";

describe("createProjectSchema", () => {
  it("accepts valid project with name only", () => {
    const result = createProjectSchema.safeParse({ name: "My Project" });
    expect(result.success).toBe(true);
  });

  it("accepts project with members", () => {
    const result = createProjectSchema.safeParse({
      name: "My Project",
      members: [{ email: "user@example.com", role: "admin" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects name shorter than 3 characters", () => {
    const result = createProjectSchema.safeParse({ name: "AB" });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = createProjectSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects member with invalid email", () => {
    const result = createProjectSchema.safeParse({
      name: "My Project",
      members: [{ email: "bad", role: "admin" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("createCampaignSchema", () => {
  it("accepts valid campaign name", () => {
    expect(
      createCampaignSchema.safeParse({ name: "Summer Sale" }).success
    ).toBe(true);
  });

  it("rejects name shorter than 3 characters", () => {
    expect(createCampaignSchema.safeParse({ name: "AB" }).success).toBe(false);
  });

  it("rejects empty name", () => {
    expect(createCampaignSchema.safeParse({ name: "" }).success).toBe(false);
  });
});
