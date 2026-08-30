import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  DELETE: vi.fn(),
  GET: vi.fn(),
  PATCH: vi.fn(),
  POST: vi.fn(),
  PUT: vi.fn(),
}));

vi.mock("@/lib/api", () => api);
vi.mock("@/lib/config", () => ({ config: { apiPath: "/api/v1" } }));

import {
  createSupportResource,
  deleteSupportResource,
  listSupportResource,
  updateSupportResource,
} from "../nativeClient";
import {
  getSupportProviderCredentialStatus,
  listSupportChannels,
  saveSupportProviderCredentials,
} from "../channelsService";
import {
  createSupportAssistantTask,
  supportAssistantTools,
} from "../captainService";
import { publishSupportArticle } from "../helpCenterService";
import { runSupportCampaignAction } from "../proactiveService";
import { exportSupportReports, getSupportReports } from "../reportsService";
import { getSupportOperationsHealth } from "../operationsHealthService";
import {
  saveSupportIntegrationCredentials,
  startSupportIntegrationOAuth,
} from "../integrationsService";

describe("native Support dashboard clients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const method of Object.values(api)) {
      method.mockResolvedValue({
        data: {
          data: {},
          pagination: { limit: 50, has_more: false, next_cursor: null },
        },
      });
    }
  });

  it("uses encoded project references, bounded cursor pagination and search", async () => {
    await listSupportResource("project/one", "workforce/teams", {
      cursor: "cursor/value",
      limit: 500,
      q: " priority customers ",
    });

    expect(api.GET).toHaveBeenCalledWith(
      "/api/v1/support/projects/project%2Fone/workforce/teams?cursor=cursor%2Fvalue&q=priority+customers&limit=100"
    );
  });

  it("connects create, update and delete to native resources with replay-safe mutations", async () => {
    await createSupportResource("project-1", "automations", { name: "VIP" });
    await updateSupportResource("project-1", "automations", "rule/1", {
      active: false,
    });
    await deleteSupportResource("project-1", "automations", "rule/1");

    expect(api.POST).toHaveBeenCalledWith(
      "/api/v1/support/projects/project-1/automations",
      { name: "VIP" },
      { retry: false }
    );
    expect(api.PATCH).toHaveBeenCalledWith(
      "/api/v1/support/projects/project-1/automations/rule%2F1",
      { active: false },
      { retry: false }
    );
    expect(api.DELETE).toHaveBeenCalledWith(
      "/api/v1/support/projects/project-1/automations/rule%2F1",
      { retry: false }
    );
  });

  it("keeps provider secrets write-only while exposing configuration state", async () => {
    await listSupportChannels("project-1");
    await saveSupportProviderCredentials("project-1", "provider/1", {
      client_id: "client",
      client_secret: "secret",
    });
    await getSupportProviderCredentialStatus("project-1", "provider/1");

    expect(api.GET).toHaveBeenNthCalledWith(
      1,
      "/api/v1/support/projects/project-1/channels"
    );
    expect(api.PUT).toHaveBeenCalledWith(
      "/api/v1/support/projects/project-1/providers/provider%2F1/credentials",
      { credentials: { client_id: "client", client_secret: "secret" } },
      { retry: false }
    );
    expect(api.GET).toHaveBeenNthCalledWith(
      2,
      "/api/v1/support/projects/project-1/providers/provider%2F1/credentials"
    );
  });

  it("writes integration credentials without adding a secret read contract", async () => {
    await saveSupportIntegrationCredentials("project-1", "integration/1", {
      signing_secret: "a-write-only-signing-secret",
    });

    expect(api.PUT).toHaveBeenCalledWith(
      "/api/v1/support/projects/project-1/integrations/integration%2F1/credentials",
      { credentials: { signing_secret: "a-write-only-signing-secret" } },
      { retry: false }
    );
    expect(api.GET).not.toHaveBeenCalled();
  });

  it("starts integration authorization through the native Support project route", async () => {
    await startSupportIntegrationOAuth("project-1", "integration/1", {
      callback_uri: "https://api.example.test/api/v1/support/providers/slack/oauth/callback",
      return_uri: "https://dashboard.example.test/support/integrations",
    });

    expect(api.POST).toHaveBeenCalledWith(
      "/api/v1/support/projects/project-1/integrations/integration%2F1/oauth",
      {
        callback_uri: "https://api.example.test/api/v1/support/providers/slack/oauth/callback",
        return_uri: "https://dashboard.example.test/support/integrations",
      },
      { retry: false }
    );
  });

  it("connects proactive, Help Center and Captain actions to their native endpoints", async () => {
    await runSupportCampaignAction(
      "project-1",
      "campaign/1",
      "schedule",
      "2026-08-14T10:00:00.000Z"
    );
    await publishSupportArticle("project-1", "article/1");
    await createSupportAssistantTask("project-1", {
      task_type: "summarize",
      conversation_id: "conversation-1",
    });
    await supportAssistantTools.create("project-1", {
      assistant_id: "assistant-1",
      name: "Orders",
    });

    expect(api.POST).toHaveBeenNthCalledWith(
      1,
      "/api/v1/support/projects/project-1/proactive-support/campaigns/campaign%2F1/schedule",
      { scheduled_at: "2026-08-14T10:00:00.000Z" },
      { retry: false }
    );
    expect(api.POST).toHaveBeenNthCalledWith(
      2,
      "/api/v1/support/projects/project-1/help-center/articles/article%2F1/publish",
      {},
      { retry: false }
    );
    expect(api.POST).toHaveBeenNthCalledWith(
      3,
      "/api/v1/support/projects/project-1/captain/tasks",
      { task_type: "summarize", conversation_id: "conversation-1" },
      { retry: false }
    );
    expect(api.POST).toHaveBeenNthCalledWith(
      4,
      "/api/v1/support/projects/project-1/captain/tools",
      { assistant_id: "assistant-1", name: "Orders" },
      { retry: false }
    );
  });

  it("connects filtered reports, exports and operations diagnostics", async () => {
    await getSupportReports("project-1", {
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-31T23:59:59.000Z",
    });
    await exportSupportReports("project-1", { from: "2026-08-01" });
    await getSupportOperationsHealth("project-1");

    expect(api.GET).toHaveBeenNthCalledWith(
      1,
      "/api/v1/support/projects/project-1/reports?from=2026-08-01T00%3A00%3A00.000Z&to=2026-08-31T23%3A59%3A59.000Z"
    );
    expect(api.POST).toHaveBeenCalledWith(
      "/api/v1/support/projects/project-1/reports/exports",
      { filters: { from: "2026-08-01" } },
      { retry: false }
    );
    expect(api.GET).toHaveBeenNthCalledWith(
      2,
      "/api/v1/support/projects/project-1/settings/operations"
    );
  });
});
