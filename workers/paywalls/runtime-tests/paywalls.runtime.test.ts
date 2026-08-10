import { env } from "cloudflare:workers";
import { SELF } from "cloudflare:test";
import { signProjectContext } from "@opengrow/contracts/project-context";
import { describe, expect, it } from "vitest";

const secret = "paywalls-runtime-secret";

describe("Paywalls Worker with D1", () => {
  it("requires an authentic, fresh gateway context", async () => {
    expect(
      (await SELF.fetch("https://paywalls.internal/internal/v1")).status,
    ).toBe(401);
    const headers = await signedHeaders("GET", "/internal/v1");
    headers.set("x-role", "member");
    const response = await SELF.fetch("https://paywalls.internal/internal/v1", {
      headers,
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "project_context_signature_invalid" },
    });
    const sdkHeaders = await signedHeaders(
      "POST",
      "/internal/v1/resolve",
      11,
      0,
      "sdk",
    );
    sdkHeaders.set("content-type", "application/json");
    const sdk = await SELF.fetch(
      "https://paywalls.internal/internal/v1/resolve",
      { method: "POST", headers: sdkHeaders, body: '{"placement":"main"}' },
    );
    expect(sdk.status).toBe(200);
  });

  it("creates, versions, publishes, targets and resolves a paywall", async () => {
    const paywallResponse = await mutate(
      "POST",
      "/internal/v1/paywalls",
      {
        identifier: "upgrade",
        display_name: "Upgrade",
        description: "Main upgrade paywall",
      },
      "create-paywall",
    );
    const paywall = await data<{ id: string }>(paywallResponse);
    expect(paywallResponse.status).toBe(201);
    const replay = await mutate(
      "POST",
      "/internal/v1/paywalls",
      {
        identifier: "upgrade",
        display_name: "Upgrade",
        description: "Main upgrade paywall",
      },
      "create-paywall",
    );
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    expect((await data<{ id: string }>(replay)).id).toBe(paywall.id);
    const duplicateIdentifier = await mutate(
      "POST",
      "/internal/v1/paywalls",
      { identifier: "upgrade", display_name: "Duplicate upgrade" },
      "duplicate-paywall-identifier",
    );
    expect(duplicateIdentifier.status).toBe(409);

    const versionResponse = await mutate(
      "POST",
      `/internal/v1/paywalls/${paywall.id}/versions`,
      {
        changelog: "Initial design",
        definition: {
          schema_version: 1,
          theme: { background: "#ffffff" },
          components: [
            { id: "title", type: "heading", props: { text: "Go Pro" } },
            { id: "buy", type: "button", props: { package_id: "monthly" } },
          ],
        },
      },
      "create-version",
    );
    const version = await data<{ id: string; version: number }>(
      versionResponse,
    );
    expect(version.version).toBe(1);
    const publish = await mutate(
      "POST",
      `/internal/v1/paywalls/${paywall.id}/versions/${version.id}/publish`,
      {},
      "publish-version",
    );
    expect(publish.status).toBe(200);

    const placementResponse = await mutate(
      "POST",
      "/internal/v1/placements",
      {
        key: "main",
        paywall_id: paywall.id,
        active_version_id: version.id,
        priority: 100,
        active: true,
        targeting: {
          platforms: ["ios"],
          countries: ["CH"],
          attributes: { plan: "free" },
        },
      },
      "create-placement",
    );
    const placement = await data<{ id: string }>(placementResponse);

    const resolved = await request("POST", "/internal/v1/resolve", {
      placement: "main",
      platform: "ios",
      country: "ch",
      customer_id: "customer-1",
      attributes: { plan: "free" },
    });
    expect(resolved.status).toBe(200);
    await expect(resolved.json()).resolves.toMatchObject({
      data: {
        placement_id: placement.id,
        paywall_id: paywall.id,
        version_id: version.id,
        definition: {
          components: [
            { id: "title", type: "heading" },
            { id: "buy", type: "button" },
          ],
        },
      },
    });
    const rejected = await request("POST", "/internal/v1/resolve", {
      placement: "main",
      platform: "android",
      country: "CH",
      attributes: { plan: "free" },
    });
    await expect(rejected.json()).resolves.toMatchObject({
      data: null,
      meta: { reason: "no_active_match" },
    });

    const foreign = await request(
      "GET",
      `/internal/v1/paywalls/${paywall.id}`,
      undefined,
      12,
    );
    expect(foreign.status).toBe(404);
  });

  it("resolves a deterministic running experiment variant", async () => {
    const paywall = (await list())[0];
    const secondVersionResponse = await mutate(
      "POST",
      `/internal/v1/paywalls/${paywall.id}/versions`,
      {
        definition: {
          schema_version: 1,
          components: [
            { id: "title-b", type: "heading", props: { text: "Variant B" } },
          ],
        },
      },
      "create-version-b",
    );
    const second = await data<{ id: string }>(secondVersionResponse);
    await mutate(
      "POST",
      `/internal/v1/paywalls/${paywall.id}/versions/${second.id}/publish`,
      {},
      "publish-version-b",
    );
    const versions = await request(
      "GET",
      `/internal/v1/paywalls/${paywall.id}/versions`,
    );
    const versionRows =
      await data<Array<{ id: string; status: string }>>(versions);
    const first = versionRows.find((row) => row.id !== second.id)!;
    expect(first.status).toBe("published");

    const experienceResponse = await mutate(
      "POST",
      "/internal/v1/experiences",
      {
        paywall_id: paywall.id,
        name: "Headline test",
        status: "running",
        traffic_percent: 100,
        variants: [
          { key: "a", version_id: first.id, weight: 50 },
          { key: "b", version_id: second.id, weight: 50 },
        ],
      },
      "create-experience",
    );
    const experience = await data<{ id: string }>(experienceResponse);
    const archiveInUse = await mutate(
      "POST",
      `/internal/v1/paywalls/${paywall.id}/versions/${first.id}/archive`,
      {},
      "archive-in-use-version",
    );
    expect(archiveInUse.status).toBe(409);
    const placements = await request("GET", "/internal/v1/placements");
    const placement = (
      await data<Array<{ id: string; key: string; active_version_id: string }>>(
        placements,
      )
    )[0];
    await mutate(
      "PUT",
      `/internal/v1/placements/${placement.id}`,
      {
        key: placement.key,
        paywall_id: paywall.id,
        active_version_id: second.id,
        experience_id: experience.id,
        priority: 100,
        active: true,
        targeting: {},
      },
      "activate-experience",
    );

    const firstResolve = await request("POST", "/internal/v1/resolve", {
      placement: "main",
      subject_id: "stable-subject",
    });
    const secondResolve = await request("POST", "/internal/v1/resolve", {
      placement: "main",
      subject_id: "stable-subject",
    });
    const a = await data<{ variant_id: string; experience_id: string }>(
      firstResolve,
    );
    const b = await data<{ variant_id: string }>(secondResolve);
    expect(a.experience_id).toBe(experience.id);
    expect(b.variant_id).toBe(a.variant_id);
  });

  it("deduplicates telemetry and returns filtered timezone-aware statistics", async () => {
    const paywall = (await list())[0];
    const placements = await data<Array<{ id: string; key: string }>>(
      await request("GET", "/internal/v1/placements"),
    );
    const resolved = await data<{
      version_id: string;
      experience_id: string;
      variant_id: string;
    }>(
      await request("POST", "/internal/v1/resolve", {
        placement: "main",
        subject_id: "stats-subject",
        platform: "ios",
      }),
    );
    const events = {
      events: [
        {
          id: "event-view",
          type: "view",
          placement: "main",
          occurred_at: "2026-08-01T22:30:00Z",
          paywall_id: paywall.id,
          version_id: resolved.version_id,
          experience_id: resolved.experience_id,
          variant_id: resolved.variant_id,
          platform: "ios",
        },
        {
          id: "event-purchase",
          type: "purchase",
          placement: "main",
          occurred_at: "2026-08-01T22:35:00Z",
          paywall_id: paywall.id,
          version_id: resolved.version_id,
          experience_id: resolved.experience_id,
          variant_id: resolved.variant_id,
          platform: "ios",
          revenue_micros: 9990000,
          currency: "CHF",
        },
      ],
    };
    const accepted = await mutate(
      "POST",
      "/internal/v1/events",
      events,
      "events-batch",
    );
    expect(accepted.status).toBe(202);
    await expect(accepted.json()).resolves.toMatchObject({
      data: { accepted: 2, duplicates: 0 },
    });
    const replay = await mutate(
      "POST",
      "/internal/v1/events",
      events,
      "events-batch",
    );
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    const duplicateIds = await mutate(
      "POST",
      "/internal/v1/events",
      events,
      "events-batch-new-key",
    );
    await expect(duplicateIds.json()).resolves.toMatchObject({
      data: { accepted: 0, duplicates: 2 },
    });

    const stats = await request(
      "GET",
      `/internal/v1/statistics?from=2026-08-01&to=2026-08-02&timezone=Europe%2FZurich&interval=day&platform=ios&placement_id=${placements[0].id}`,
    );
    await expect(stats.json()).resolves.toMatchObject({
      data: {
        totals: {
          view: 1,
          purchase: 1,
          revenue_micros: 9990000,
          conversion_rate: 1,
        },
        series: expect.arrayContaining([
          expect.objectContaining({
            bucket: "2026-08-02",
            event_type: "purchase",
            count: 1,
            revenue_micros: 9990000,
          }),
        ]),
      },
    });

    const audit = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM audit_events WHERE project_id='11' AND actor_id='2' AND request_id IS NOT NULL`,
    ).first<{ count: number }>();
    expect(audit?.count).toBeGreaterThanOrEqual(8);
  });

  it("updates and archives paywall delivery resources", async () => {
    const paywall = await data<{ id: string }>(
      await mutate(
        "POST",
        "/internal/v1/paywalls",
        { identifier: "secondary", display_name: "Secondary" },
        "secondary-paywall",
      ),
    );
    expect(
      (
        await mutate(
          "PUT",
          `/internal/v1/paywalls/${paywall.id}`,
          {
            identifier: "secondary",
            display_name: "Secondary updated",
            description: "Lifecycle test",
          },
          "secondary-update",
        )
      ).status,
    ).toBe(200);
    const version = await data<{ id: string }>(
      await mutate(
        "POST",
        `/internal/v1/paywalls/${paywall.id}/versions`,
        {
          definition: {
            schema_version: 1,
            components: [
              { id: "title", type: "heading", props: { text: "Secondary" } },
            ],
          },
        },
        "secondary-version",
      ),
    );
    await mutate(
      "POST",
      `/internal/v1/paywalls/${paywall.id}/versions/${version.id}/publish`,
      {},
      "secondary-publish",
    );
    const placement = await data<{ id: string }>(
      await mutate(
        "POST",
        "/internal/v1/placements",
        {
          key: "secondary",
          paywall_id: paywall.id,
          active_version_id: version.id,
          priority: 10,
          active: true,
          targeting: {},
        },
        "secondary-placement",
      ),
    );
    const experience = await data<{ id: string }>(
      await mutate(
        "POST",
        "/internal/v1/experiences",
        {
          paywall_id: paywall.id,
          name: "Secondary test",
          status: "draft",
          traffic_percent: 100,
          variants: [
            { key: "control", version_id: version.id, weight: 50 },
            { key: "variant", version_id: version.id, weight: 50 },
          ],
        },
        "secondary-experience",
      ),
    );
    expect(
      (
        await mutate(
          "PUT",
          `/internal/v1/placements/${placement.id}`,
          {
            key: "secondary",
            paywall_id: paywall.id,
            active_version_id: version.id,
            experience_id: experience.id,
            priority: 20,
            active: true,
            targeting: { platforms: ["ios"] },
          },
          "secondary-placement-update",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await mutate(
          "DELETE",
          `/internal/v1/experiences/${experience.id}`,
          undefined,
          "secondary-experience-archive",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await mutate(
          "DELETE",
          `/internal/v1/placements/${placement.id}`,
          undefined,
          "secondary-placement-delete",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await mutate(
          "POST",
          `/internal/v1/paywalls/${paywall.id}/versions/${version.id}/archive`,
          {},
          "secondary-version-archive",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await mutate(
          "DELETE",
          `/internal/v1/paywalls/${paywall.id}`,
          undefined,
          "secondary-paywall-archive",
        )
      ).status,
    ).toBe(200);
    expect((await list()).some(({ id }) => id === paywall.id)).toBe(false);
  });
});

async function list(): Promise<Array<{ id: string }>> {
  return data(await request("GET", "/internal/v1/paywalls"));
}
async function mutate(
  method: string,
  path: string,
  body: unknown,
  key: string,
  projectId = 11,
): Promise<Response> {
  return request(method, path, body, projectId, key);
}
async function request(
  method: string,
  path: string,
  body?: unknown,
  projectId = 11,
  key?: string,
): Promise<Response> {
  const pathname = new URL(path, "https://paywalls.internal").pathname;
  const headers = await signedHeaders(method, pathname, projectId);
  if (body !== undefined) headers.set("content-type", "application/json");
  if (key) headers.set("idempotency-key", key);
  return SELF.fetch(`https://paywalls.internal${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function signedHeaders(
  method: string,
  pathname: string,
  projectId = 11,
  actorId = 2,
  role = "owner",
): Promise<Headers> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const requestId = crypto.randomUUID();
  const context = {
    module: "paywalls" as const,
    method,
    pathname,
    projectId,
    projectRef: "10-test",
    instanceId: 10,
    environment: "test" as const,
    actorId,
    role,
    requestId,
    issuedAt,
  };
  return new Headers({
    "x-internal-token": secret,
    "x-project-id": String(projectId),
    "x-project-ref": context.projectRef,
    "x-instance-id": "10",
    "x-environment": "test",
    "x-actor-id": String(actorId),
    "x-role": role,
    "x-request-id": requestId,
    "x-context-issued-at": String(issuedAt),
    "x-context-version": "1",
    "x-context-signature": await signProjectContext(context, secret),
  });
}
async function data<T>(response: Response): Promise<T> {
  return ((await response.json()) as { data: T }).data;
}
