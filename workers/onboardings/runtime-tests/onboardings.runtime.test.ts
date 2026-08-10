import { env } from "cloudflare:workers";
import { SELF } from "cloudflare:test";
import { signProjectContext } from "@opengrow/contracts";
import { describe, expect, it } from "vitest";
const secret = "onboarding-runtime-secret";
describe("Onboardings Worker with D1", () => {
  it("creates, publishes, targets, resolves and measures an onboarding", async () => {
    const created = await data<{ id: string; draft_version: { id: string } }>(
      await mutate(
        "POST",
        "/internal/v1",
        {
          identifier: "first-run",
          display_name: "First run",
          configuration: {
            screens: [
              {
                id: "welcome",
                blocks: [{ id: "title", type: "heading", text: "Welcome" }],
              },
              {
                id: "finish",
                blocks: [
                  {
                    id: "done",
                    type: "button",
                    text: "Continue",
                    action: "complete",
                  },
                ],
              },
            ],
            theme: { primary: "#635bff" },
          },
        },
        "create",
      ),
    );
    expect(
      (
        await mutate(
          "PUT",
          `/internal/v1/${created.id}`,
          { display_name: "First run updated", description: "Welcome flow" },
          "update-onboarding",
        )
      ).status,
    ).toBe(200);
    await mutate(
      "POST",
      `/internal/v1/${created.id}/publish`,
      { version_id: created.draft_version.id },
      "publish",
    );
    const placement = await data<{ id: string }>(
      await mutate(
        "POST",
        "/internal/v1/placements",
        {
          key: "first-run",
          name: "First run",
          onboarding_id: created.id,
          active_version_id: created.draft_version.id,
          priority: 100,
          active: true,
        },
        "placement",
      ),
    );
    expect(
      (
        await mutate(
          "PUT",
          `/internal/v1/placements/${placement.id}`,
          {
            key: "first-run",
            name: "First run placement",
            onboarding_id: created.id,
            active_version_id: created.draft_version.id,
            priority: 200,
            active: true,
          },
          "update-placement",
        )
      ).status,
    ).toBe(200);
    const rule = await data<{ id: string }>(
      await mutate(
        "POST",
        "/internal/v1/targeting-rules",
        {
          placement_id: placement.id,
          name: "iOS",
          priority: 10,
          conditions: { platform: "ios" },
          active: true,
        },
        "target",
      ),
    );
    const experience = await data<{ id: string }>(
      await mutate(
        "POST",
        "/internal/v1/experiences",
        {
          placement_id: placement.id,
          name: "Welcome copy",
          status: "running",
          traffic_percentage: 10000,
          variants: [
            { name: "A", weight: 5000, version_id: created.draft_version.id },
            { name: "B", weight: 5000, version_id: created.draft_version.id },
          ],
        },
        "experiment",
      ),
    );
    const rejected = await request("POST", "/internal/v1/resolve", {
      placement: "first-run",
      platform: "android",
      anonymous_id: "android-1",
    });
    await expect(rejected.json()).resolves.toEqual({ data: null });
    const resolved = await request("POST", "/internal/v1/resolve", {
      placement: "first-run",
      platform: "ios",
      anonymous_id: "ios-1",
    });
    const resolution = await data<{
      version_id: string;
      variant_id: string;
      definition: { screens: unknown[] };
    }>(resolved);
    expect(resolution.version_id).toBe(created.draft_version.id);
    expect(resolution.variant_id).toBeTruthy();
    expect(resolution.definition.screens).toHaveLength(2);
    const events = await mutate(
      "POST",
      "/internal/v1/events",
      {
        events: [
          {
            id: "onboarding-event-1",
            type: "impression",
            placement: "first-run",
            platform: "ios",
            version_id: resolution.version_id,
            variant_id: resolution.variant_id,
            occurred_at: "2026-08-07T12:00:00Z",
          },
          {
            id: "onboarding-event-2",
            type: "step_view",
            placement: "first-run",
            platform: "ios",
            version_id: resolution.version_id,
            variant_id: resolution.variant_id,
            step_id: "welcome",
            occurred_at: "2026-08-07T12:00:01Z",
          },
          {
            id: "onboarding-event-3",
            type: "complete",
            placement: "first-run",
            platform: "ios",
            version_id: resolution.version_id,
            variant_id: resolution.variant_id,
            occurred_at: "2026-08-07T12:01:00Z",
          },
        ],
      },
      "events",
    );
    expect(events.status).toBe(202);
    const replay = await mutate(
      "POST",
      "/internal/v1/events",
      {
        events: [
          {
            id: "ignored",
            type: "complete",
            placement: "first-run",
            platform: "ios",
            occurred_at: "2026-08-07T12:02:00Z",
          },
        ],
      },
      "events",
    );
    expect(replay.headers.get("x-idempotent-replay")).toBe("true");
    const stats = await request(
      "GET",
      `/internal/v1/statistics?from=2026-08-07&to=2026-08-07&platform=ios&placement_id=${placement.id}&timezone=Europe%2FZurich&interval=hour`,
    );
    await expect(stats.json()).resolves.toMatchObject({
      data: {
        totals: { impression: 1, step_view: 1, complete: 1 },
        completion_rate: 1,
        drop_off_rate: 0,
        funnel: [{ step: "welcome", count: 1 }],
        series: expect.arrayContaining([
          expect.objectContaining({
            date: "2026-08-07T14:00",
            event_type: "complete",
            placement: "first-run",
            count: 1,
          }),
        ]),
      },
    });
    const invalidTimezone = await request(
      "GET",
      "/internal/v1/statistics?timezone=Mars%2FOlympus",
    );
    expect(invalidTimezone.status).toBe(422);
    await expect(invalidTimezone.json()).resolves.toMatchObject({
      error: { code: "timezone_invalid" },
    });
    expect(
      (
        await mutate(
          "POST",
          `/internal/v1/experiences/${experience.id}/status`,
          { status: "completed" },
          "complete-experiment",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await mutate(
          "DELETE",
          `/internal/v1/targeting-rules/${rule.id}`,
          undefined,
          "delete-rule",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await mutate(
          "DELETE",
          `/internal/v1/placements/${placement.id}`,
          undefined,
          "delete-placement",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await mutate(
          "DELETE",
          `/internal/v1/${created.id}`,
          undefined,
          "delete-onboarding",
        )
      ).status,
    ).toBe(200);
    await expect(
      (await request("GET", "/internal/v1")).json(),
    ).resolves.toEqual({
      data: [],
    });
    const audit = await env.DB.prepare(
      "SELECT COUNT(*) count FROM audit_events WHERE project_id='11'",
    ).first<{ count: number }>();
    expect(Number(audit?.count)).toBeGreaterThanOrEqual(6);
  });
  it("isolates projects", async () => {
    const list = await request("GET", "/internal/v1", undefined, 12);
    await expect(list.json()).resolves.toEqual({ data: [] });
  });
});
async function mutate(
  method: string,
  path: string,
  body: unknown,
  key: string,
  projectId = 11,
) {
  return request(method, path, body, projectId, key);
}
async function request(
  method: string,
  path: string,
  body?: unknown,
  projectId = 11,
  key?: string,
) {
  const pathname = new URL(path, "https://onboarding.internal").pathname;
  const issuedAt = Math.floor(Date.now() / 1000);
  const requestId = crypto.randomUUID();
  const context = {
    module: "onboardings" as const,
    method,
    pathname,
    projectId,
    projectRef: "10-test",
    instanceId: 10,
    environment: "test" as const,
    actorId: 2,
    role: "owner",
    requestId,
    issuedAt,
  };
  const headers = new Headers({
    "x-internal-token": secret,
    "x-project-id": String(projectId),
    "x-project-ref": "10-test",
    "x-instance-id": "10",
    "x-environment": "test",
    "x-actor-id": "2",
    "x-role": "owner",
    "x-request-id": requestId,
    "x-context-issued-at": String(issuedAt),
    "x-context-version": "1",
    "x-context-signature": await signProjectContext(context, secret),
  });
  if (body !== undefined) headers.set("content-type", "application/json");
  if (key) headers.set("idempotency-key", key);
  return SELF.fetch(`https://onboarding.internal${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function data<T>(response: Response): Promise<T> {
  return ((await response.json()) as { data: T }).data;
}
