import { describe, expect, it } from "vitest";
import {
  automaticCaptainTaskId,
  canAutomaticallyDeliverCaptainResult,
  isAutomaticCaptainTrigger,
  type AutomaticCaptainAuthorization,
} from "./captain";

const authorized: AutomaticCaptainAuthorization = {
  active: 1,
  automatic_enabled: 1,
  response_mode: "automatic",
  conversation_status: "open",
  completed_handoffs: 0,
  outbound_endpoints: 1,
};

describe("automatic Captain decisions", () => {
  it("derives one stable task identity from the project-isolated source message", async () => {
    const first = await automaticCaptainTaskId(12, "conversation-1", "assistant-1", "message-1");
    const replay = await automaticCaptainTaskId(12, "conversation-1", "assistant-1", "message-1");
    const otherProject = await automaticCaptainTaskId(13, "conversation-1", "assistant-1", "message-1");

    expect(replay).toBe(first);
    expect(otherProject).not.toBe(first);
    expect(first).toMatch(/^captain-auto:[a-f0-9]{64}$/u);
  });

  it("recognizes only bounded, explicitly automatic message triggers", () => {
    expect(isAutomaticCaptainTrigger({
      automatic_trigger: true,
      source_message_id: "message-1",
    })).toBe(true);
    expect(isAutomaticCaptainTrigger({ source_message_id: "message-1" })).toBe(false);
    expect(isAutomaticCaptainTrigger({
      automatic_trigger: true,
      source_message_id: "x".repeat(256),
    })).toBe(false);
  });

  it.each([
    ["inactive assistant", { active: 0 }],
    ["link not enabled", { automatic_enabled: 0 }],
    ["suggestion mode", { response_mode: "suggestion" }],
    ["closed conversation", { conversation_status: "closed" }],
    ["completed human handoff", { completed_handoffs: 1 }],
  ])("fails closed for %s", (_name, override) => {
    expect(canAutomaticallyDeliverCaptainResult({ ...authorized, ...override })).toBe(false);
  });

  it("allows delivery only when every explicit authorization remains active", () => {
    expect(canAutomaticallyDeliverCaptainResult(authorized)).toBe(true);
    expect(canAutomaticallyDeliverCaptainResult(null)).toBe(false);
  });
});
