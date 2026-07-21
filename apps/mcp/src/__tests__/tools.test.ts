import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "../api-client.js";
import {
  statusEmpty,
  createdLink,
  minimalLink,
  archivedLink,
  searchLinksEmpty,
  createdCampaign,
  archivedCampaign,
  campaignListPage,
  campaignListEmpty,
  usageWithinLimits,
  usageExceededNoSubscription,
  statusWithUsageWarning,
  statusWithSubscription,
} from "./fixtures.js";

vi.mock("../api-client.js", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  },
  getStatus: vi.fn(),
  getUsage: vi.fn(),
  createProject: vi.fn(),
  createLink: vi.fn(),
  getLink: vi.fn(),
  updateLink: vi.fn(),
  searchLinks: vi.fn(),
  getAnalyticsOverview: vi.fn(),
  getLinkAnalytics: vi.fn(),
  getTopLinks: vi.fn(),
  configureRedirects: vi.fn(),
  configureSdk: vi.fn(),
  createCampaign: vi.fn(),
  searchCampaigns: vi.fn(),
  archiveLink: vi.fn(),
  archiveCampaign: vi.fn(),
}));

const api = await import("../api-client.js");
const {
  handleGetStatus,
  handleGetUsage,
  handleCreateProject,
  handleCreateLink,
  handleGetLink,
  handleUpdateLink,
  handleSearchLinks,
  handleGetAnalyticsOverview,
  handleGetLinkAnalytics,
  handleGetTopLinks,
  handleConfigureRedirects,
  handleConfigureSdk,
  handleArchiveLink,
  handleCreateCampaign,
  handleListCampaigns,
  handleArchiveCampaign,
} = await import("../tools/handlers.js");
const { runWithAuth } = await import("../server.js");
import type { ToolExtra } from "../server.js";

function fakeExtra(token?: string): ToolExtra {
  return {
    authInfo: token ? { token, clientId: "test", scopes: [] } : undefined,
    signal: new AbortController().signal,
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
  } as unknown as ToolExtra;
}

beforeEach(() => {
  vi.mocked(api.getStatus).mockReset();
  vi.mocked(api.getUsage).mockReset();
  vi.mocked(api.createProject).mockReset();
  vi.mocked(api.createLink).mockReset();
  vi.mocked(api.getLink).mockReset();
  vi.mocked(api.updateLink).mockReset();
  vi.mocked(api.searchLinks).mockReset();
  vi.mocked(api.getAnalyticsOverview).mockReset();
  vi.mocked(api.getLinkAnalytics).mockReset();
  vi.mocked(api.getTopLinks).mockReset();
  vi.mocked(api.configureRedirects).mockReset();
  vi.mocked(api.configureSdk).mockReset();
  vi.mocked(api.archiveLink).mockReset();
  vi.mocked(api.createCampaign).mockReset();
  vi.mocked(api.searchCampaigns).mockReset();
  vi.mocked(api.archiveCampaign).mockReset();
});

// --- Handlers propagate errors (no internal catch) ---

describe("handlers propagate errors", () => {
  it("handleGetStatus throws on API failure", async () => {
    vi.mocked(api.getStatus).mockRejectedValueOnce(new ApiError(500, "Server down"));
    await expect(handleGetStatus("tok")).rejects.toThrow("Server down");
  });

  it("handleGetUsage throws on API failure", async () => {
    vi.mocked(api.getUsage).mockRejectedValueOnce(new ApiError(404, "Instance not found"));
    await expect(handleGetUsage("tok", "inst1")).rejects.toThrow("Instance not found");
  });

  it("handleCreateProject throws on failure", async () => {
    vi.mocked(api.createProject).mockRejectedValueOnce(new Error("Duplicate name"));
    await expect(handleCreateProject("tok", "App")).rejects.toThrow("Duplicate name");
  });

  it("handleCreateLink throws on failure", async () => {
    vi.mocked(api.createLink).mockRejectedValueOnce(new ApiError(422, "Invalid path"));
    await expect(handleCreateLink("tok", "p1", { name: "x" })).rejects.toThrow("Invalid path");
  });

  it("handleGetLink throws on failure", async () => {
    vi.mocked(api.getLink).mockRejectedValueOnce(new ApiError(404, "Not found"));
    await expect(handleGetLink("tok", "p1", "x")).rejects.toThrow("Not found");
  });

  it("handleUpdateLink throws on failure", async () => {
    vi.mocked(api.updateLink).mockRejectedValueOnce(new ApiError(403, "Forbidden"));
    await expect(handleUpdateLink("tok", "p1", 1, {})).rejects.toThrow("Forbidden");
  });

  it("handleSearchLinks throws on failure", async () => {
    vi.mocked(api.searchLinks).mockRejectedValueOnce(new Error("Timeout"));
    await expect(handleSearchLinks("tok", "p1", {})).rejects.toThrow("Timeout");
  });

  it("handleGetAnalyticsOverview throws on failure", async () => {
    vi.mocked(api.getAnalyticsOverview).mockRejectedValueOnce(new ApiError(401, "Unauthorized"));
    await expect(handleGetAnalyticsOverview("tok", "p1", {})).rejects.toThrow("Unauthorized");
  });

  it("handleGetLinkAnalytics throws on failure", async () => {
    vi.mocked(api.getLinkAnalytics).mockRejectedValueOnce(new Error("Bad request"));
    await expect(handleGetLinkAnalytics("tok", "p1", { path: "x" })).rejects.toThrow(
      "Bad request",
    );
  });

  it("handleGetTopLinks throws on failure", async () => {
    vi.mocked(api.getTopLinks).mockRejectedValueOnce(new ApiError(502, "Gateway error"));
    await expect(handleGetTopLinks("tok", "p1", {})).rejects.toThrow("Gateway error");
  });

  it("handleConfigureRedirects throws on failure", async () => {
    vi.mocked(api.configureRedirects).mockRejectedValueOnce(new Error("Invalid URL"));
    await expect(handleConfigureRedirects("tok", "p1", {})).rejects.toThrow("Invalid URL");
  });

  it("handleConfigureSdk throws on failure", async () => {
    vi.mocked(api.configureSdk).mockRejectedValueOnce(new Error("Invalid bundle ID"));
    await expect(handleConfigureSdk("tok", "i1", {})).rejects.toThrow("Invalid bundle ID");
  });

  it("handleArchiveLink throws on failure", async () => {
    vi.mocked(api.archiveLink).mockRejectedValueOnce(new ApiError(404, "Link not found"));
    await expect(handleArchiveLink("tok", "p1", 999)).rejects.toThrow("Link not found");
  });

  it("handleCreateCampaign throws on failure", async () => {
    vi.mocked(api.createCampaign).mockRejectedValueOnce(new ApiError(400, "Name required"));
    await expect(handleCreateCampaign("tok", "p1", "")).rejects.toThrow("Name required");
  });

  it("handleListCampaigns throws on failure", async () => {
    vi.mocked(api.searchCampaigns).mockRejectedValueOnce(new Error("Timeout"));
    await expect(handleListCampaigns("tok", "p1", {})).rejects.toThrow("Timeout");
  });

  it("handleArchiveCampaign throws on failure", async () => {
    vi.mocked(api.archiveCampaign).mockRejectedValueOnce(new ApiError(404, "Campaign not found"));
    await expect(handleArchiveCampaign("tok", "p1", 999)).rejects.toThrow("Campaign not found");
  });

});

// --- runWithAuth: single error boundary ---

describe("runWithAuth", () => {
  it("extracts token and passes to handler", async () => {
    const handler = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
    });

    await runWithAuth(fakeExtra("my-token"), handler);

    expect(handler).toHaveBeenCalledWith("my-token");
  });

  it("returns isError when token is missing", async () => {
    const handler = vi.fn();

    const result = await runWithAuth(fakeExtra(), handler);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Not authenticated");
    expect(handler).not.toHaveBeenCalled();
  });

  it("catches Error and returns isError", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("handler boom"));

    const result = await runWithAuth(fakeExtra("tok"), handler);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("handler boom");
  });

  it("catches non-Error thrown values", async () => {
    const handler = vi.fn().mockRejectedValue("raw string");

    const result = await runWithAuth(fakeExtra("tok"), handler);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("raw string");
  });
});

// --- Full path: runWithAuth + handler ---

describe("runWithAuth + handler integration", () => {
  it("success: returns formatted text", async () => {
    vi.mocked(api.getStatus).mockResolvedValueOnce(statusEmpty);

    const result = await runWithAuth(fakeExtra("tok"), (token) => handleGetStatus(token));

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Bob");
    expect(result.content[0].text).toContain("bob@test.com");
  });

  it("API error: returns isError with message", async () => {
    vi.mocked(api.getStatus).mockRejectedValueOnce(new ApiError(500, "Server down"));

    const result = await runWithAuth(fakeExtra("tok"), (token) => handleGetStatus(token));

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Server down");
  });

  it("auth error: returns isError without calling handler", async () => {
    const result = await runWithAuth(fakeExtra(), (token) => handleGetStatus(token));

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Not authenticated");
    expect(vi.mocked(api.getStatus)).not.toHaveBeenCalled();
  });
});

// --- format() primitive guard ---

const { format } = await import("../tools/handlers.js");

describe("format()", () => {
  it("stringifies null without calling formatter", () => {
    expect(format(null, () => "never called")).toBe("null");
  });

  it("stringifies undefined without calling formatter", () => {
    expect(format(undefined, () => "never called")).toBe("undefined");
  });

  it("stringifies primitives without calling formatter", () => {
    expect(format("hello", () => "never called")).toBe('"hello"');
    expect(format(42, () => "never called")).toBe("42");
    expect(format(true, () => "never called")).toBe("true");
  });

  it("passes objects to the formatter", () => {
    const result = format({ key: "val" }, (d) => `formatted:${d.key}`);
    expect(result).toBe("formatted:val");
  });

  it("appends _warning when present in response", () => {
    const result = format(
      { key: "val", _warning: "Quota exceeded" },
      (d) => `formatted:${d.key}`,
    );
    expect(result).toBe("formatted:val\n\nQuota exceeded");
  });

  it("does not append warning when _warning is absent", () => {
    const result = format({ key: "val" }, (d) => `formatted:${d.key}`);
    expect(result).toBe("formatted:val");
    expect(result).not.toContain("warning");
  });
});

// --- Handler success paths ---

describe("handler success", () => {
  it("handleGetStatus returns formatted text", async () => {
    vi.mocked(api.getStatus).mockResolvedValueOnce(statusEmpty);

    const result = await handleGetStatus("tok");

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Account Overview");
    expect(result.content[0].text).toContain("Bob");
  });

  it("handleCreateLink passes all fields to API", async () => {
    vi.mocked(api.createLink).mockResolvedValueOnce(minimalLink);

    await handleCreateLink("tok", "p1", {
      name: "Sale Link",
      path: "summer-sale",
      title: "Summer Sale",
      tags: ["promo"],
      data: { screen: "sale" },
    });

    expect(vi.mocked(api.createLink)).toHaveBeenCalledWith("tok", "p1", {
      name: "Sale Link",
      path: "summer-sale",
      title: "Summer Sale",
      tags: ["promo"],
      data: { screen: "sale" },
    });
  });

  it("handleSearchLinks passes pagination params", async () => {
    vi.mocked(api.searchLinks).mockResolvedValueOnce(searchLinksEmpty);

    await handleSearchLinks("tok", "p1", {
      page: 2,
      limit: 10,
      search: "sale",
      sort_by: "created_at",
      sort_order: "desc",
    });

    expect(vi.mocked(api.searchLinks)).toHaveBeenCalledWith("tok", "p1", {
      page: 2,
      limit: 10,
      search: "sale",
      sort_by: "created_at",
      sort_order: "desc",
    });
  });

  it("handleCreateCampaign formats create response", async () => {
    vi.mocked(api.createCampaign).mockResolvedValueOnce(createdCampaign);

    const result = await handleCreateCampaign("tok", "p1", "Summer Sale");
    const text = result.content[0].text;

    expect(result.isError).toBeUndefined();
    expect(text).toContain("Campaign Created");
    expect(text).toContain("Summer Sale");
    expect(text).toContain("42");
    expect(text).toContain("Archived: No");
    expect(text).toContain("Mar 1, 2026");
    expect(text).toContain("campaign_id 42");
    expect(vi.mocked(api.createCampaign)).toHaveBeenCalledWith("tok", "p1", "Summer Sale");
  });

  it("handleListCampaigns formats paginated list", async () => {
    vi.mocked(api.searchCampaigns).mockResolvedValueOnce(campaignListPage);

    const result = await handleListCampaigns("tok", "p1", { page: 2, per_page: 10 });
    const text = result.content[0].text;

    expect(result.isError).toBeUndefined();
    expect(text).toContain("25 total");
    expect(text).toContain("page 2/3");
    expect(text).toContain("Campaign A");
    expect(text).toContain("1500");
    expect(text).toContain("$2500.00");
    expect(text).toContain("Empty Campaign");
    expect(text).toContain("$0.00");
    expect(vi.mocked(api.searchCampaigns)).toHaveBeenCalledWith("tok", "p1", { page: 2, per_page: 10 });
  });

  it("handleListCampaigns shows empty state", async () => {
    vi.mocked(api.searchCampaigns).mockResolvedValueOnce(campaignListEmpty);

    const result = await handleListCampaigns("tok", "p1", {});
    const text = result.content[0].text;

    expect(text).toContain("0 total");
    expect(text).toContain("No campaigns found");
    expect(text).not.toContain("| # |");
  });

  it("handleArchiveLink formats archived link", async () => {
    vi.mocked(api.archiveLink).mockResolvedValueOnce(archivedLink);

    const result = await handleArchiveLink("tok", "p1", 55);
    const text = result.content[0].text;

    expect(result.isError).toBeUndefined();
    expect(text).toContain("Link Archived");
    expect(text).toContain("Old Promo");
    expect(text).toContain("old-promo");
    expect(text).toContain("55");
    expect(vi.mocked(api.archiveLink)).toHaveBeenCalledWith("tok", "p1", 55);
  });

  it("handleArchiveCampaign formats archived campaign", async () => {
    vi.mocked(api.archiveCampaign).mockResolvedValueOnce(archivedCampaign);

    const result = await handleArchiveCampaign("tok", "p1", 7);
    const text = result.content[0].text;

    expect(result.isError).toBeUndefined();
    expect(text).toContain("Campaign Archived");
    expect(text).toContain("Old Campaign");
    expect(text).toContain("7");
    expect(text).toContain("Archived: Yes");
    expect(text).toContain("Jan 15, 2026");
    expect(vi.mocked(api.archiveCampaign)).toHaveBeenCalledWith("tok", "p1", 7);
  });

  it("handleCreateLink passes campaign_id through to API", async () => {
    vi.mocked(api.createLink).mockResolvedValueOnce(minimalLink);

    await handleCreateLink("tok", "p1", {
      name: "Campaign Link",
      path: "cl",
      campaign_id: 42,
    });

    expect(vi.mocked(api.createLink)).toHaveBeenCalledWith("tok", "p1", expect.objectContaining({
      campaign_id: 42,
    }));
  });

  it("handleUpdateLink passes campaign_id through to API", async () => {
    vi.mocked(api.updateLink).mockResolvedValueOnce(minimalLink);

    await handleUpdateLink("tok", "p1", 1, { campaign_id: 42 });

    expect(vi.mocked(api.updateLink)).toHaveBeenCalledWith("tok", "p1", 1, expect.objectContaining({
      campaign_id: 42,
    }));
  });

  it("handleGetUsage renders usage within limits", async () => {
    vi.mocked(api.getUsage).mockResolvedValueOnce(usageWithinLimits);

    const result = await handleGetUsage("tok", "inst1");
    const text = result.content[0].text;

    expect(result.isError).toBeUndefined();
    expect(text).toContain("5000 / 10000");
    expect(text).toContain("Quota exceeded: No");
    expect(text).not.toContain("WARNING");
    expect(vi.mocked(api.getUsage)).toHaveBeenCalledWith("tok", "inst1");
  });

  it("handleGetUsage shows warning when exceeded without subscription", async () => {
    vi.mocked(api.getUsage).mockResolvedValueOnce(usageExceededNoSubscription);

    const result = await handleGetUsage("tok", "inst1");
    const text = result.content[0].text;

    expect(text).toContain("12000 / 10000");
    expect(text).toContain("WARNING: Usage exceeded");
    expect(text).toContain("Subscribe to a paid plan");
  });
});

// --- End-to-end: usage warnings surface through handleGetStatus ---

describe("usage warnings in get_status", () => {
  it("surfaces usage warning when quota exceeded and no subscription", async () => {
    vi.mocked(api.getStatus).mockResolvedValueOnce(statusWithUsageWarning);

    const result = await handleGetStatus("tok");
    const text = result.content[0].text;

    expect(result.isError).toBeUndefined();
    expect(text).toContain("WARNING: Usage exceeded (12000/10000 MAU)");
    expect(text).toContain("deep links are not working");
    expect(text).toContain("Subscribe to a paid plan");
  });

  it("no usage warning when subscription is active", async () => {
    vi.mocked(api.getStatus).mockResolvedValueOnce(statusWithSubscription);

    const result = await handleGetStatus("tok");
    const text = result.content[0].text;

    expect(result.isError).toBeUndefined();
    expect(text).not.toContain("WARNING");
  });

  it("no usage warning when status has no usage data", async () => {
    vi.mocked(api.getStatus).mockResolvedValueOnce(statusEmpty);

    const result = await handleGetStatus("tok");
    const text = result.content[0].text;

    expect(text).not.toContain("WARNING");
  });
});

// --- Wrong API shape: expectKey warnings surface through handlers ---

describe("unexpected API response shapes", () => {
  it("handleCreateLink warns when API returns no link key", async () => {
    // API changed shape: returns {data: {link: ...}} instead of {link: ...}
    vi.mocked(api.createLink).mockResolvedValueOnce({ data: { link: { id: 1 } } });

    const result = await handleCreateLink("tok", "p1", { name: "x" });
    const text = result.content[0].text;

    expect(text).toContain("⚠ Unexpected API response");
    expect(text).toContain('"link"');
  });

  it("handleArchiveLink warns when API returns empty object", async () => {
    // API returns {success: true} instead of {link: ...}
    vi.mocked(api.archiveLink).mockResolvedValueOnce({ success: true });

    const result = await handleArchiveLink("tok", "p1", 55);
    const text = result.content[0].text;

    expect(text).toContain("⚠ Unexpected API response");
  });

  it("handleArchiveCampaign warns when API returns no campaign key", async () => {
    vi.mocked(api.archiveCampaign).mockResolvedValueOnce({ success: true });

    const result = await handleArchiveCampaign("tok", "p1", 7);
    const text = result.content[0].text;

    expect(text).toContain("⚠ Unexpected API response");
    expect(text).toContain('"campaign"');
  });

  it("handleListCampaigns warns when campaigns is wrong type", async () => {
    vi.mocked(api.searchCampaigns).mockResolvedValueOnce({ campaigns: "not-an-array", meta: {} });

    const result = await handleListCampaigns("tok", "p1", {});
    const text = result.content[0].text;

    expect(text).toContain("⚠ Unexpected API response");
    expect(text).toContain("expected array");
  });

  it("handleGetUsage warns when usage key is missing", async () => {
    vi.mocked(api.getUsage).mockResolvedValueOnce({ data: {} });

    const result = await handleGetUsage("tok", "inst1");
    const text = result.content[0].text;

    expect(text).toContain("⚠ Unexpected API response");
    expect(text).toContain('"usage"');
  });

  it("handleGetUsage warns when usage is wrong type", async () => {
    vi.mocked(api.getUsage).mockResolvedValueOnce({ usage: "string-not-object" });

    const result = await handleGetUsage("tok", "inst1");
    const text = result.content[0].text;

    expect(text).toContain("⚠ Unexpected API response");
    expect(text).toContain("expected object");
  });

  it("handleGetStatus warns when user key is missing", async () => {
    vi.mocked(api.getStatus).mockResolvedValueOnce({ instances: [] });

    const result = await handleGetStatus("tok");
    const text = result.content[0].text;

    expect(text).toContain("⚠ Unexpected API response");
    expect(text).toContain('"user"');
  });

  it("no warning when shape is correct", async () => {
    vi.mocked(api.createLink).mockResolvedValueOnce(createdLink);

    const result = await handleCreateLink("tok", "p1", { name: "x" });
    const text = result.content[0].text;

    expect(text).not.toContain("⚠");
  });
});
