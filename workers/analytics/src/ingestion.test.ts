import { describe, expect, it } from "vitest";
import { pseudonymizeEvent } from "./crypto";
import { isAnalyticsQueueMessage } from "./ingestion";

describe("analytics ingestion primitives", () => {
  it("recognizes only versioned projection messages", () => {
    expect(
      isAnalyticsQueueMessage({
        schema_version: 1,
        type: "analytics.event.project",
        project_id: "12",
        event_id: "event-1",
      }),
    ).toBe(true);
    expect(
      isAnalyticsQueueMessage({
        schema_version: 2,
        type: "analytics.event.project",
        project_id: "12",
        event_id: "event-1",
      }),
    ).toBe(false);
  });

  it("pseudonymizes every supplied identity before persistence", async () => {
    const stored = await pseudonymizeEvent(
      {
        ANALYTICS_ID_HASH_KEY: "active-key",
        ANALYTICS_ID_HASH_KEY_PREVIOUS: "previous-key",
      } as Env,
      "12",
      {
        schema_version: 1,
        event_id: "event-1",
        event_name: "screen.viewed",
        occurred_at: "2026-08-12T10:00:00.000Z",
        source: "sdk",
        application_id: "app-1",
        app_instance_id: "private-instance",
        anonymous_id: "private-anonymous",
        user_id: "private-user",
        session_id: "private-session",
        properties: {},
      },
    );
    expect(JSON.stringify(stored)).not.toMatch(/private-(instance|anonymous|user|session)/);
    expect(stored.event.app_instance_id).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.identity_hashes.app_instance).toHaveLength(2);
  });
});
