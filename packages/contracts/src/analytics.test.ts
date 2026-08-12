import { describe, expect, it } from "vitest";
import {
  AnalyticsContractError,
  parseAnalyticsEventV1,
  parseAnalyticsEventsV1,
  parseMarketingSignalV1,
  stableAnalyticsJson,
} from "./analytics";

const event = {
  schema_version: 1,
  event_id: "019b-event-1",
  event_name: "screen.viewed",
  occurred_at: "2026-08-12T10:30:00+02:00",
  source: "sdk",
  application_id: "app-1",
  app_instance_id: "instance-1",
  properties: { screen: "home" },
};

describe("analytics contracts", () => {
  it("normalizes single events and batches", () => {
    expect(parseAnalyticsEventV1(event)).toMatchObject({
      event_id: "019b-event-1",
      occurred_at: "2026-08-12T08:30:00.000Z",
    });
    expect(parseAnalyticsEventsV1({ events: [event] })).toHaveLength(1);
  });

  it("reserves system event names from SDK callers", () => {
    expect(() =>
      parseAnalyticsEventV1({
        ...event,
        event_name: "superboard.analytics.installation.created.v1",
      }),
    ).toThrowError(AnalyticsContractError);
    expect(
      parseAnalyticsEventV1(
        {
          ...event,
          source: "system",
          event_name: "superboard.analytics.installation.created.v1",
        },
        { allowReserved: true },
      ).event_name,
    ).toBe("superboard.analytics.installation.created.v1");
  });

  it("creates stable JSON independently of object key order", () => {
    expect(stableAnalyticsJson({ z: 1, a: { y: 2, x: 3 } })).toBe(
      stableAnalyticsJson({ a: { x: 3, y: 2 }, z: 1 }),
    );
  });

  it("validates the pseudonymous Analytics to Marketing signal", () => {
    expect(
      parseMarketingSignalV1({
        schema_version: 1,
        event_id: "event-1",
        event_name: "account.created",
        application_id: "app-1",
        subject_hash: "a".repeat(64),
        properties: { plan: "pro" },
        occurred_at: "2026-08-12T10:30:00Z",
      }),
    ).toMatchObject({
      subject_hash: "a".repeat(64),
      occurred_at: "2026-08-12T10:30:00.000Z",
    });
    expect(() =>
      parseMarketingSignalV1({
        schema_version: 1,
        event_id: "event-1",
        event_name: "account.created",
        application_id: "app-1",
        subject_hash: "raw-user-id",
        properties: {},
        occurred_at: "2026-08-12T10:30:00Z",
      }),
    ).toThrow(/subject_hash/u);
  });
});
