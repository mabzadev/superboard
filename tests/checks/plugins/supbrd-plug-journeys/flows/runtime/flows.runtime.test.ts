import { env, SELF } from "cloudflare:test";
import { signProjectContext } from "@superboard/contracts/project-context";
import { describe, expect, it } from "vitest";

const secret = "flows-runtime-secret";
const projectRef = "10-test";

describe("Flows Worker runtime", () => {
  it("requires signed project context on administrative and legacy routes", async () => {
    expect(
      (await SELF.fetch(`https://flows.internal/internal/v1/projects/${projectRef}/project`)).status,
    ).toBe(401);
    expect(
      (await SELF.fetch("https://flows.internal/internal/v1/legacy/paywalls/paywalls")).status,
    ).toBe(401);
  });

  it("keeps legacy SDK resolution operational before Flows setup", async () => {
    await expect(
      (await request("GET", "/internal/v1/legacy/paywalls/health")).json(),
    ).resolves.toMatchObject({ ok: true, service: "paywalls", runtime: "flows" });
    await expect(
      (await request("GET", "/internal/v1/legacy/onboardings/health")).json(),
    ).resolves.toMatchObject({ ok: true, service: "onboardings", runtime: "flows" });
    await expect(
      (
        await request(
          "POST",
          "/internal/v1/legacy/paywalls/placements/resolve",
          { placement: "main", customer_id: "pre-setup-user" },
        )
      ).json(),
    ).resolves.toMatchObject({
      data: null,
      meta: { placement: "main", reason: "no_active_match" },
    });
    await expect(
      (
        await request(
          "POST",
          "/internal/v1/legacy/onboardings/placements/resolve",
          { placement: "first-run", anonymous_id: "pre-setup-user" },
        )
      ).json(),
    ).resolves.toEqual({ data: null });
  });

  it("creates an isolated project and workflow through native routes", async () => {
    const project = await responseData<{
      project_ref: string;
      default_environment: { id: string; sdk_key: string };
    }>(
      await request(
        "GET",
        `/internal/v1/projects/${projectRef}/project`,
      ),
    );
    expect(project.project_ref).toBe(projectRef);
    const components = await responseData<{
      items: Array<{
        key: string;
        component_type: string;
        current_version: number;
        exit_nodes: string[];
        schema: { template_type: string; properties: unknown[] };
      }>;
    }>(
      await request(
        "GET",
        `/internal/v1/projects/${projectRef}/components`,
      ),
    );
    expect(components.items).toHaveLength(10);
    expect(components.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "survey-popover",
          component_type: "BasicsV2SurveyPopover",
          current_version: 1,
          exit_nodes: ["submit", "close"],
          schema: expect.objectContaining({
            template_type: "survey-component",
            properties: expect.any(Array),
          }),
        }),
        expect.objectContaining({
          key: "tour-tooltip",
          component_type: "BasicsV2Tooltip",
          schema: expect.objectContaining({ template_type: "tour-component" }),
        }),
      ]),
    );
    const outsiderHeaders = await signedHeaders(
      "GET",
      "/internal/v1/projects/99-test/project",
      99,
    );
    expect(
      (
        await SELF.fetch(
          "https://flows.internal/internal/v1/projects/99-test/project",
          { headers: outsiderHeaders },
        )
      ).status,
    ).toBe(403);
    const workflowResponse = await request(
      "POST",
      `/internal/v1/projects/${projectRef}/workflows`,
      {
        identifier: "welcome",
        name: "Welcome",
        frequency: "once",
      },
    );
    expect(workflowResponse.status).toBe(201);
    await expect(workflowResponse.json()).resolves.toMatchObject({
      data: {
        identifier: "welcome",
        draft_revision: 1,
        graph: { schemaVersion: 1 },
      },
    });
  });

  it("replays project mutations and rejects reuse with another payload", async () => {
    const workflow = await responseData<{ id: string }>(
      await request(
        "POST",
        `/internal/v1/projects/${projectRef}/workflows`,
        {
          identifier: `idempotent-${crypto.randomUUID()}`,
          name: "Idempotent workflow",
          frequency: "once",
        },
      ),
    );
    const fullWorkflow = await responseData<{
      draft: { graph: unknown; revision: number };
    }>(
      await request(
        "GET",
        `/internal/v1/projects/${projectRef}/workflows/${workflow.id}`,
      ),
    );
    const path = `/internal/v1/projects/${projectRef}/workflows/${workflow.id}/draft`;
    const key = `save-draft-${crypto.randomUUID()}`;
    const payload = {
      graph: {
        schemaVersion: 1,
        blocks: [{
          id: "start",
          key: "start",
          type: "start",
          name: "Start",
          data: {},
          propertyMeta: [],
          exitNodes: ["default"],
          position: { x: 0, y: 0 },
        }],
        paths: [],
      },
      revision: fullWorkflow.draft.revision,
    };
    const first = await request("PUT", path, payload, key);
    expect(first.status).toBe(200);
    const firstBody = await first.text();

    const replay = await request("PUT", path, payload, key);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    expect(await replay.text()).toBe(firstBody);

    const conflict = await request(
      "PUT",
      path,
      { ...payload, revision: payload.revision + 1 },
      key,
    );
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: "idempotency_key_conflict" },
    });
  });

  it("resolves ordered runtime-compatible user hashes without exposing the key", async () => {
    const response = await request(
      "POST",
      `/internal/v1/projects/${projectRef}/cutover/user-hashes`,
      { user_ids: ["customer-2", "customer-1", "customer-2"] },
    );
    expect(response.status).toBe(200);
    const result = await responseData<{
      items: Array<{ user_id: string; user_id_hash: string }>;
    }>(response);
    expect(result.items.map((item) => item.user_id)).toEqual([
      "customer-2",
      "customer-1",
      "customer-2",
    ]);
    expect(result.items[0]!.user_id_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.items[0]!.user_id_hash).toBe(result.items[2]!.user_id_hash);
    expect(JSON.stringify(result)).not.toContain("flow-user-hash-key");
  });

  it("requires and rotates the environment SDK key on every native runtime route", async () => {
    const project = await responseData<{
      sdk_identifier: string;
      default_environment: { id: string; key: string };
    }>(
      await request(
        "GET",
        `/internal/v1/projects/${projectRef}/project`,
      ),
    );
    const body = {
      projectId: project.sdk_identifier,
      environment: project.default_environment.key,
      userId: "sdk-user",
    };
    const initial = await responseData<{ sdk_key: string }>(
      await request(
        "POST",
        `/internal/v1/projects/${projectRef}/environments/${project.default_environment.id}/rotate-key`,
        {},
      ),
    );

    expect((await publicSdkRequest(body)).status).toBe(401);
    expect(
      (
        await SELF.fetch("https://flows.internal/v2/sdk/blocks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            organizationId: project.sdk_identifier,
            environment: project.default_environment.key,
            userId: "legacy-tenant-field",
          }),
        })
      ).status,
    ).toBe(422);
    expect((await publicSdkRequest(body, "wrong-key")).status).toBe(401);
    expect(
      (await publicSdkRequest(body, initial.sdk_key)).status,
    ).toBe(200);
    expect(
      (
        await publicSdkRequest({
          ...body,
          projectId: `${project.sdk_identifier}.${initial.sdk_key}`,
        })
      ).status,
    ).toBe(200);

    const rotated = await responseData<{ sdk_key: string }>(
      await request(
        "POST",
        `/internal/v1/projects/${projectRef}/environments/${project.default_environment.id}/rotate-key`,
        {},
      ),
    );
    expect(
      (await publicSdkRequest(body, initial.sdk_key)).status,
    ).toBe(401);
    expect((await publicSdkRequest(body, rotated.sdk_key)).status).toBe(200);

    const websocketWithoutKey = await SELF.fetch(
      `https://flows.internal/ws/sdk/block-updates?projectId=${encodeURIComponent(project.sdk_identifier)}&environment=${project.default_environment.key}&userId=sdk-user`,
      { headers: { Upgrade: "websocket" } },
    );
    expect(websocketWithoutKey.status).toBe(401);
    const websocketWithKey = await SELF.fetch(
      `https://flows.internal/ws/sdk/block-updates?projectId=${encodeURIComponent(project.sdk_identifier)}&environment=${project.default_environment.key}&userId=sdk-user&sdkKey=${encodeURIComponent(rotated.sdk_key)}`,
      { headers: { Upgrade: "websocket" } },
    );
    expect(websocketWithKey.status).toBe(101);
    websocketWithKey.webSocket?.accept();
    websocketWithKey.webSocket?.close(1000, "test complete");
  });

  it("serves the old Paywalls contract from Flows", async () => {
    const paywall = await responseData<{ id: string }>(
      await request("POST", "/internal/v1/legacy/paywalls/paywalls", {
        identifier: "upgrade",
        display_name: "Upgrade",
      }),
    );
    expect(
      (
        await request("POST", "/internal/v1/legacy/paywalls/paywalls", {
          identifier: "upgrade",
          display_name: "Duplicate",
        })
      ).status,
    ).toBe(409);
    const version = await responseData<{ id: string }>(
      await request(
        "POST",
        `/internal/v1/legacy/paywalls/paywalls/${paywall.id}/versions`,
        {
          definition: {
            schema_version: 1,
            theme: { background: "#fff" },
            components: [
              { id: "title", type: "heading", props: { text: "Upgrade" } },
            ],
          },
        },
      ),
    );
    expect(
      (
        await request(
          "POST",
          `/internal/v1/legacy/paywalls/paywalls/${paywall.id}/versions/${version.id}/publish`,
          {},
        )
      ).status,
    ).toBe(200);
    const placement = await responseData<{ id: string }>(
      await request("POST", "/internal/v1/legacy/paywalls/placements", {
        key: "main",
        paywall_id: paywall.id,
        active_version_id: version.id,
        priority: 100,
        active: true,
        targeting: { platforms: ["ios"] },
      }),
    );
    expect(
      (
        await request(
          "PUT",
          `/internal/v1/legacy/paywalls/placements/${placement.id}`,
          {
            key: "main",
            paywall_id: paywall.id,
            active_version_id: version.id,
            priority: 100,
            active: true,
            targeting: { platforms: ["ios"] },
          },
        )
      ).status,
    ).toBe(200);
    const resolved = await request(
      "POST",
      "/internal/v1/legacy/paywalls/placements/resolve",
      { placement: "main", platform: "ios", customer_id: "customer-1" },
    );
    await expect(resolved.json()).resolves.toMatchObject({
      data: {
        placement_id: placement.id,
        paywall_id: paywall.id,
        version_id: version.id,
        definition: { components: [{ id: "title", type: "heading" }] },
      },
    });
    expect(
      (
        await request(
          "POST",
          `/internal/v1/legacy/paywalls/paywalls/${paywall.id}/versions/${version.id}/archive`,
          {},
        )
      ).status,
    ).toBe(409);
    const noMatch = await request(
      "POST",
      "/internal/v1/legacy/paywalls/placements/resolve",
      { placement: "main", platform: "android", customer_id: "customer-2" },
    );
    await expect(noMatch.json()).resolves.toMatchObject({
      data: null,
      meta: { placement: "main", reason: "no_active_match" },
    });

    const project = await responseData<{
      default_environment: { key: string };
    }>(await request("GET", `/internal/v1/projects/${projectRef}/project`));
    await expect(
      (
        await request(
          "POST",
          `/internal/v1/projects/${projectRef}/commerce/resolve`,
          {
            placement: "main",
            customer_id: "legacy-commerce-user",
            environment: project.default_environment.key,
            user_properties: { platform: "ios" },
          },
        )
      ).json(),
    ).resolves.toMatchObject({
      data: {
        id: paywall.id,
        configuration: {
          source: "flows",
          placement: "main",
          legacy_priority: 100,
        },
      },
    });
  });

  it("preserves the complete old Onboardings create, target and resolve contract", async () => {
    const onboarding = await responseData<{
      id: string;
      draft_version: { id: string; configuration: { screens: unknown[] } };
    }>(
      await request("POST", "/internal/v1/legacy/onboardings", {
        identifier: "first-run",
        display_name: "First run",
        configuration: {
          screens: [
            { id: "welcome", blocks: [{ id: "title", type: "heading", text: "Welcome" }] },
            { id: "finish", blocks: [{ id: "done", type: "button", action: "complete" }] },
          ],
          theme: { primary: "#635bff" },
        },
      }),
    );
    expect(onboarding.draft_version.configuration.screens).toHaveLength(2);
    expect(
      (
        await request(
          "POST",
          `/internal/v1/legacy/onboardings/${onboarding.id}/publish`,
          { version_id: onboarding.draft_version.id },
        )
      ).status,
    ).toBe(200);
    const placement = await responseData<{ id: string }>(
      await request("POST", "/internal/v1/legacy/onboardings/placements", {
        key: "first-run",
        onboarding_id: onboarding.id,
        active_version_id: onboarding.draft_version.id,
        priority: 100,
        active: true,
      }),
    );
    await responseData<{ id: string }>(
      await request("POST", "/internal/v1/legacy/onboardings/targeting-rules", {
        placement_id: placement.id,
        conditions: { platform: "iOS" },
        priority: 10,
        active: true,
      }),
    );
    await expect(
      (
        await request("POST", "/internal/v1/legacy/onboardings/placements/resolve", {
          placement: "first-run",
          platform: "android",
          anonymous_id: "android-1",
        })
      ).json(),
    ).resolves.toEqual({ data: null });
    await expect(
      (
        await request("POST", "/internal/v1/legacy/onboardings/placements/resolve", {
          placement: "first-run",
          platform: "IOS",
          anonymous_id: "ios-1",
        })
      ).json(),
    ).resolves.toMatchObject({
      data: {
        onboarding_id: onboarding.id,
        placement_id: placement.id,
        version_id: onboarding.draft_version.id,
        definition: { screens: [{ id: "welcome" }, { id: "finish" }] },
      },
    });
  });

  it("deduplicates legacy telemetry before asynchronous projection", async () => {
    const payload = {
      events: [
        {
          id: "legacy-event-stable-id",
          type: "view",
          placement: "main",
          platform: "ios",
          occurred_at: "2026-08-13T08:00:00Z",
        },
      ],
    };
    await expect(
      (
        await request("POST", "/internal/v1/legacy/paywalls/events", payload)
      ).json(),
    ).resolves.toMatchObject({ data: { accepted: 1, duplicates: 0 } });
    await expect(
      (
        await request("POST", "/internal/v1/legacy/paywalls/events", payload)
      ).json(),
    ).resolves.toMatchObject({ data: { accepted: 0, duplicates: 1 } });
    await expect(
      (
        await request("POST", "/internal/v1/legacy/onboardings/events", payload)
      ).json(),
    ).resolves.toMatchObject({ data: { accepted: 1, duplicates: 0 } });
  });

  it("serves the published commerce presentation to Products without claiming purchases", async () => {
    const project = await responseData<{
      default_environment: { id: string; key: string };
    }>(
      await request(
        "GET",
        `/internal/v1/projects/${projectRef}/project`,
      ),
    );
    const workflow = await responseData<{ id: string }>(
      await request(
        "POST",
        `/internal/v1/projects/${projectRef}/workflows`,
        {
          identifier: "upgrade-commerce",
          name: "Upgrade commerce",
          graph: {
            schemaVersion: 1,
            blocks: [
              {
                id: "commerce-start",
                key: "start",
                type: "start",
                name: "Start",
                data: {},
                propertyMeta: [],
                exitNodes: ["default"],
                position: { x: 0, y: 0 },
              },
              {
                id: "commerce-card",
                key: "commerce",
                type: "component",
                name: "Commerce",
                componentType: "superboard-commerce",
                componentLibraryName: "SuperBoard",
                data: {
                  placement: "main",
                  offeringIdentifier: "premium",
                  title: "Go premium",
                },
                propertyMeta: [],
                exitNodes: ["purchase", "restore", "close", "error"],
                position: { x: 300, y: 0 },
              },
            ],
            paths: [
              {
                id: "commerce-path",
                sourceBlockId: "commerce-start",
                sourceExitNode: "default",
                targetBlockId: "commerce-card",
              },
            ],
          },
        },
      ),
    );
    const version = await responseData<{ id: string }>(
      await request(
        "POST",
        `/internal/v1/projects/${projectRef}/workflows/${workflow.id}/publish`,
        { migration_strategy: "finish-current" },
      ),
    );
    await responseData(
      await request(
        "POST",
        `/internal/v1/projects/${projectRef}/workflows/${workflow.id}/releases`,
        {
          environment_id: project.default_environment.id,
          version_id: version.id,
        },
      ),
    );
    await expect(
      (
        await request(
          "POST",
          `/internal/v1/projects/${projectRef}/commerce/resolve`,
          {
            placement: "main",
            customer_id: "customer-commerce",
            offering_identifier: "premium",
            environment: project.default_environment.key,
            user_properties: { platform: "ios" },
          },
        )
      ).json(),
    ).resolves.toMatchObject({
      data: {
        id: workflow.id,
        version_id: version.id,
        configuration: {
          source: "flows",
          component_type: "superboard-commerce",
          placement: "main",
          offeringIdentifier: "premium",
        },
      },
    });
  });

  it("uses an imported traffic assignment identically in SDK and commerce", async () => {
    const project = await responseData<{
      sdk_identifier: string;
      default_environment: { id: string; key: string };
    }>(await request("GET", `/internal/v1/projects/${projectRef}/project`));
    const workflow = await responseData<{ id: string }>(
      await request("POST", `/internal/v1/projects/${projectRef}/workflows`, {
        identifier: `assigned-commerce-${crypto.randomUUID()}`,
        name: "Assigned commerce",
        graph: assignedCommerceGraph(),
      }),
    );
    const version = await responseData<{ id: string }>(
      await request(
        "POST",
        `/internal/v1/projects/${projectRef}/workflows/${workflow.id}/publish`,
        { migration_strategy: "finish-current" },
      ),
    );
    await responseData(await request(
      "POST",
      `/internal/v1/projects/${projectRef}/workflows/${workflow.id}/releases`,
      { environment_id: project.default_environment.id, version_id: version.id },
    ));
    const subjectId = `assigned-user-${crypto.randomUUID()}`;
    const hashes = await responseData<{
      items: Array<{ user_id_hash: string }>;
    }>(await request(
      "POST",
      `/internal/v1/projects/${projectRef}/cutover/user-hashes`,
      { user_ids: [subjectId] },
    ));
    await env.DB.prepare(
      `INSERT INTO flow_experiment_assignments
        (project_id, environment_id, workflow_id, split_block_id,
         user_id_hash, variant_key)
       VALUES (11, ?, ?, 'assigned-split', ?, 'variant-b')`,
    ).bind(
      project.default_environment.id,
      workflow.id,
      hashes.items[0]!.user_id_hash,
    ).run();
    const key = await responseData<{ sdk_key: string }>(await request(
      "POST",
      `/internal/v1/projects/${projectRef}/environments/${project.default_environment.id}/rotate-key`,
      {},
    ));
    const sdkResponse = await publicSdkRequest({
        projectId: project.sdk_identifier,
        environment: project.default_environment.key,
        userId: subjectId,
      }, key.sdk_key);
    expect(sdkResponse.status).toBe(200);
    const sdk = await sdkResponse.json() as {
      blocks: Array<{ id: string; data: { title?: string } }>;
    };
    expect(sdk.blocks.find((block) => block.id === "assigned-card-b")?.data.title)
      .toBe("Assigned B");
    const commerce = await responseData<{ configuration: { title: string } }>(
      await request("POST", `/internal/v1/projects/${projectRef}/commerce/resolve`, {
        placement: "assignment-placement",
        customer_id: subjectId,
        environment: project.default_environment.key,
      }),
    );
    expect(commerce.configuration.title).toBe("Assigned B");
  });

  it("reports every response beyond 10k and keeps statistics isolated by question type", async () => {
    const project = await responseData<{
      default_environment: { id: string };
    }>(await request("GET", `/internal/v1/projects/${projectRef}/project`));
    const surveyId = `large-survey-${crypto.randomUUID()}`;
    const workflow = await responseData<{ id: string }>(await request(
      "POST",
      `/internal/v1/projects/${projectRef}/workflows`,
      {
        identifier: `large-survey-${crypto.randomUUID()}`,
        name: "Large survey",
        graph: surveyStatisticsGraph(surveyId),
      },
    ));
    await responseData(await request(
      "POST",
      `/internal/v1/projects/${projectRef}/workflows/${workflow.id}/publish`,
      { migration_strategy: "finish-current" },
    ));
    const prefix = `bulk-survey-${crypto.randomUUID()}`;
    const occurredAt = new Date().toISOString();
    const digits = "(VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9))";
    await env.DB.prepare(
      `WITH d(n) AS ${digits}, numbers(n) AS (
         SELECT a.n + b.n * 10 + c.n * 100 + e.n * 1000 + f.n * 10000
         FROM d a CROSS JOIN d b CROSS JOIN d c CROSS JOIN d e CROSS JOIN d f
         ORDER BY 1 LIMIT 10001
       )
       INSERT INTO flow_analytics_events
        (event_id, project_id, project_ref, environment_id, user_id_hash,
         event_name, workflow_id, block_id, properties_json, occurred_at)
       SELECT ? || n, 11, ?, ?, ?, 'survey-submit', ?, ?, '{}', ?
       FROM numbers`,
    ).bind(
      prefix,
      projectRef,
      project.default_environment.id,
      "b".repeat(64),
      workflow.id,
      surveyId,
      occurredAt,
    ).run();
    await env.DB.prepare(
      `INSERT INTO flow_survey_responses
        (id, event_id, project_id, environment_id, user_id_hash, survey_id,
         workflow_id, block_id, block_state_id, url, response_json, submitted_at)
       SELECT 'response-' || event_id, event_id, project_id, environment_id,
         user_id_hash, ?, workflow_id, block_id, 'bulk-state', 'app://survey',
         '{"questions":[' ||
           '{"questionId":"rating","textResponse":"2"},' ||
           '{"questionId":"freeform","textResponse":"999"},' ||
           '{"questionId":"choice","optionIds":["same-option"]}' ||
         ']}', occurred_at
       FROM flow_analytics_events
       WHERE project_id = 11 AND event_id LIKE ?`,
    ).bind(surveyId, `${prefix}%`).run();

    const analytics = await responseData<{
      summary: { responses: number };
      responses: unknown[];
      responses_truncated: boolean;
      questions: Record<string, {
        type: string;
        numeric?: { count: number; average: number | null };
        distribution?: Record<string, number>;
      }>;
    }>(await request(
      "GET",
      `/internal/v1/projects/${projectRef}/surveys/${surveyId}/analytics`,
    ));
    expect(analytics.summary.responses).toBe(10_001);
    expect(analytics.responses).toHaveLength(10_000);
    expect(analytics.responses_truncated).toBe(true);
    expect(analytics.questions.rating).toMatchObject({
      type: "rating",
      numeric: { count: 10_001, average: 2 },
    });
    expect(analytics.questions.freeform).toEqual({
      type: "freeform",
      responses: 10_001,
    });
    expect(analytics.questions.choice?.distribution).toEqual({
      "same-option": 10_001,
    });
  });
});

function surveyStatisticsGraph(surveyId: string) {
  return {
    schemaVersion: 1,
    blocks: [
      {
        id: `${surveyId}-start`, key: `${surveyId}-start`, type: "start",
        name: "Start", data: {}, propertyMeta: [], exitNodes: ["default"],
        position: { x: 0, y: 0 },
      },
      {
        id: surveyId, key: surveyId, type: "survey", name: "Survey",
        data: {}, propertyMeta: [], exitNodes: ["submit"],
        position: { x: 300, y: 0 },
        surveyQuestions: [
          {
            id: "rating", type: "rating", title: "Rating", optional: false,
            minValue: 1, maxValue: 5, displayType: "number",
          },
          { id: "freeform", type: "freeform", title: "Text", optional: false },
          {
            id: "choice", type: "single-choice", title: "Choice", optional: false,
            options: [{ id: "same-option", label: "Same" }],
          },
        ],
      },
    ],
    paths: [{
      id: `${surveyId}-path`, sourceBlockId: `${surveyId}-start`,
      sourceExitNode: "default", targetBlockId: surveyId,
    }],
  };
}

function assignedCommerceGraph() {
  return {
    schemaVersion: 1,
    blocks: [
      {
        id: "assigned-start", key: "assigned-start", type: "start",
        name: "Start", data: {}, propertyMeta: [], exitNodes: ["default"],
        position: { x: 0, y: 0 },
      },
      {
        id: "assigned-split", key: "assigned-split", type: "traffic-split",
        name: "Split",
        data: { variants: [{ key: "variant-a", weight: 50 }, { key: "variant-b", weight: 50 }] },
        propertyMeta: [], exitNodes: ["variant-a", "variant-b"],
        position: { x: 150, y: 0 },
      },
      ...["a", "b"].map((variant, index) => ({
        id: `assigned-card-${variant}`,
        key: `assigned-card-${variant}`,
        type: "component" as const,
        name: `Assigned ${variant.toUpperCase()}`,
        componentType: "superboard-commerce",
        componentLibraryName: "SuperBoard",
        data: { placement: "assignment-placement", title: `Assigned ${variant.toUpperCase()}` },
        propertyMeta: [],
        exitNodes: ["purchase", "restore", "close", "error"],
        position: { x: 320, y: index * 120 },
      })),
    ],
    paths: [
      { id: "assigned-start-split", sourceBlockId: "assigned-start", sourceExitNode: "default", targetBlockId: "assigned-split" },
      { id: "assigned-split-a", sourceBlockId: "assigned-split", sourceExitNode: "variant-a", targetBlockId: "assigned-card-a" },
      { id: "assigned-split-b", sourceBlockId: "assigned-split", sourceExitNode: "variant-b", targetBlockId: "assigned-card-b" },
    ],
  };
}

async function request(
  method: string,
  path: string,
  body?: unknown,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<Response> {
  const headers = await signedHeaders(method, path);
  if (body !== undefined) headers.set("content-type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) {
    headers.set("idempotency-key", idempotencyKey);
  }
  return SELF.fetch(`https://flows.internal${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function publicSdkRequest(
  body: { projectId: string; environment: string; userId: string },
  sdkKey?: string,
): Promise<Response> {
  return SELF.fetch("https://flows.internal/v2/sdk/blocks", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(sdkKey
        ? { "x-superboard-flows-sdk-key": sdkKey }
        : {}),
    },
    body: JSON.stringify(body),
  });
}

async function signedHeaders(
  method: string,
  pathname: string,
  actorId = 2,
): Promise<Headers> {
  const issuedAt = Math.floor(Date.now() / 1_000);
  const requestId = crypto.randomUUID();
  const context = {
    module: "flows" as const,
    method,
    pathname,
    projectId: 11,
    projectRef,
    instanceId: 10,
    environment: "test" as const,
    actorId,
    role: "owner",
    requestId,
    issuedAt,
  };
  return new Headers({
    "x-internal-token": secret,
    "x-project-id": "11",
    "x-project-ref": projectRef,
    "x-instance-id": "10",
    "x-environment": "test",
    "x-actor-id": String(actorId),
    "x-role": "owner",
    "x-request-id": requestId,
    "x-context-issued-at": String(issuedAt),
    "x-context-version": "1",
    "x-context-signature": await signProjectContext(context, secret),
  });
}

async function responseData<T>(response: Response): Promise<T> {
  expect(response.status).toBeLessThan(300);
  return ((await response.json()) as { data: T }).data;
}
