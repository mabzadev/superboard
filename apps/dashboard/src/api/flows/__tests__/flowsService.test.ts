import { beforeEach, describe, expect, it, vi } from "vitest";

const requests = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  GET: requests.get,
  POST: requests.post,
  PATCH: requests.patch,
  PUT: requests.put,
  DELETE: requests.delete,
}));
vi.mock("@/lib/config", () => ({ config: { apiPath: "/api/v1" } }));

import { flowsApi, type FlowGraph } from "../flowsService";

describe("Flows dashboard API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const request of Object.values(requests)) {
      request.mockResolvedValue({ data: { data: {} } });
    }
  });

  it("uses project-scoped routes exclusively", async () => {
    requests.get
      .mockResolvedValueOnce({
        data: {
          data: {
            project_ref: "project/dev",
            sdk_identifier: "project/dev",
            created_at: "2026-08-13T10:00:00.000Z",
          },
        },
      })
      .mockResolvedValueOnce({ data: { data: { items: [] } } });

    await flowsApi.getProject("project/dev");
    await flowsApi.listWorkflows("project/dev", {
      origin: "paywalls",
      status: "active",
    });

    expect(requests.get).toHaveBeenNthCalledWith(
      1,
      "/api/v1/flows/projects/project%2Fdev/project"
    );
    expect(requests.get).toHaveBeenNthCalledWith(
      2,
      "/api/v1/flows/projects/project%2Fdev/workflows?origin=paywalls&status=active"
    );
    expect(requests.get.mock.calls.flat().join(" ")).not.toMatch(
      /\/organizations?\//i
    );
  });

  it("saves graph drafts with optimistic revision control", async () => {
    const graph: FlowGraph = {
      schemaVersion: 1,
      blocks: [
        {
          id: "start",
          key: "start",
          type: "start",
          name: "Start",
          position: { x: 0, y: 0 },
          data: {},
          propertyMeta: [],
          exitNodes: ["default"],
        },
      ],
      paths: [],
    };
    requests.put.mockResolvedValueOnce({
      data: { data: { workflow_id: "flow-1", graph, revision: 8 } },
    });

    await expect(
      flowsApi.saveDraft("project-1", "flow-1", graph, 7)
    ).resolves.toMatchObject({ revision: 8 });
    expect(requests.put).toHaveBeenCalledWith(
      "/api/v1/flows/projects/project-1/workflows/flow-1/draft",
      { graph, revision: 7 }
    );
  });

  it("publishes immutable versions and activates them separately", async () => {
    requests.post
      .mockResolvedValueOnce({
        data: { data: { id: "version-2", version: 2 } },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            active: true,
            migration_execution_id: "migration-execution-1",
          },
        },
      });

    await flowsApi.publishWorkflow("project-1", "flow-1", {
      migration_strategy: "finish-current",
      changelog: "Ready",
    });
    await expect(
      flowsApi.activateRelease("project-1", "flow-1", {
        environment_id: "production",
        version_id: "version-2",
        active: true,
      })
    ).resolves.toMatchObject({
      active: true,
      migration_execution_id: "migration-execution-1",
    });

    expect(requests.post).toHaveBeenNthCalledWith(
      1,
      "/api/v1/flows/projects/project-1/workflows/flow-1/publish",
      { migration_strategy: "finish-current", changelog: "Ready" }
    );
    expect(requests.post).toHaveBeenNthCalledWith(
      2,
      "/api/v1/flows/projects/project-1/workflows/flow-1/releases",
      { environment_id: "production", version_id: "version-2", active: true }
    );
  });

  it("matches component and Launchpad administration routes", async () => {
    requests.get.mockResolvedValueOnce({
      data: { data: { libraries: [], items: [] } },
    });

    await expect(flowsApi.listComponents("project-1")).resolves.toEqual({
      libraries: [],
      components: [],
    });
    await flowsApi.updateComponentLibrary("project-1", "library/one", {
      name: "Basics V2",
      enabled: false,
    });
    await flowsApi.synchronizeComponent("project-1", "component/one");
    await flowsApi.updateLaunchpadGroup("project-1", "group/one", {
      paused: true,
    });

    expect(requests.patch).toHaveBeenNthCalledWith(
      1,
      "/api/v1/flows/projects/project-1/component-libraries/library%2Fone",
      { name: "Basics V2", enabled: false }
    );
    expect(requests.post).toHaveBeenCalledWith(
      "/api/v1/flows/projects/project-1/components/component%2Fone/sync"
    );
    expect(requests.patch).toHaveBeenNthCalledWith(
      2,
      "/api/v1/flows/projects/project-1/launchpad/groups/group%2Fone",
      { paused: true }
    );
  });

  it("uses project-scoped survey analytics, exports and translations", async () => {
    requests.get.mockResolvedValueOnce({
      data: {
        data: {
          survey_id: "survey/one",
          summary: { shown: 0, responses: 0, completion: 0 },
        },
      },
    });
    requests.post.mockResolvedValueOnce({
      data: {
        data: {
          id: "export-1",
          status: "completed",
          r2_key: "exports/survey.csv",
          row_count: 0,
        },
      },
    });
    const items = [
      {
        block_key: "welcome",
        property_key: "title",
        locale: "fr",
        value: "Bienvenue",
      },
    ];

    await flowsApi.surveyAnalytics("project-1", "survey/one");
    await flowsApi.exportSurveyCsv("project-1", "survey/one");
    await flowsApi.saveTranslations("project-1", "flow-1", items);

    expect(requests.get).toHaveBeenCalledWith(
      "/api/v1/flows/projects/project-1/surveys/survey%2Fone/analytics"
    );
    expect(requests.post).toHaveBeenCalledWith(
      "/api/v1/flows/projects/project-1/surveys/survey%2Fone/export"
    );
    expect(requests.put).toHaveBeenCalledWith(
      "/api/v1/flows/projects/project-1/workflows/flow-1/translations",
      { items }
    );
  });

  it("does not expose removed tenant or commercial administration methods", () => {
    expect(Object.keys(flowsApi).join(" ")).not.toMatch(
      /organization|member|invitation|billing/i
    );
  });
});
