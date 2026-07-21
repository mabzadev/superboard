import { describe, it, expect } from "vitest";
import { messageSchema } from "../message";

describe("messageSchema", () => {
  const validMessage = {
    title: "Welcome",
    subtitle: "Check out our new feature",
    selectedPlatforms: ["ios"],
    deliverTo: "existing_users",
    autoDisplay: false,
    deliverPushNotification: false,
  };

  it("accepts valid message", () => {
    expect(messageSchema.safeParse(validMessage).success).toBe(true);
  });

  it("accepts message with multiple platforms", () => {
    const result = messageSchema.safeParse({
      ...validMessage,
      selectedPlatforms: ["ios", "android", "web"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty title", () => {
    const result = messageSchema.safeParse({ ...validMessage, title: "" });
    expect(result.success).toBe(false);
  });

  it("rejects empty subtitle", () => {
    const result = messageSchema.safeParse({ ...validMessage, subtitle: "" });
    expect(result.success).toBe(false);
  });

  it("rejects empty platforms array", () => {
    const result = messageSchema.safeParse({
      ...validMessage,
      selectedPlatforms: [],
    });
    expect(result.success).toBe(false);
  });

  it("accepts autoDisplay true", () => {
    const result = messageSchema.safeParse({
      ...validMessage,
      autoDisplay: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts deliverPushNotification true", () => {
    const result = messageSchema.safeParse({
      ...validMessage,
      deliverPushNotification: true,
    });
    expect(result.success).toBe(true);
  });
});
