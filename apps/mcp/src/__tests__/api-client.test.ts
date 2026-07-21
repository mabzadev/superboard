import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ApiError,
  getStatus,
  createProject,
  createLink,
  getLink,
  updateLink,
  searchLinks,
  getAnalyticsOverview,
  getLinkAnalytics,
  getTopLinks,
  configureRedirects,
  configureSdk,
  createCampaign,
  searchCampaigns,
  archiveLink,
  archiveCampaign,
} from "../api-client.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown, status = 200, statusText = "OK") {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: () => Promise.resolve(data),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  process.env.GROVS_API_URL = "https://api.test.com";
});

afterEach(() => {
  delete process.env.GROVS_API_URL;
});

// --- request() core behavior ---

describe("request: success", () => {
  it("sends Bearer token and returns parsed JSON", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ user: "alice" }));

    const result = await getStatus("tok123");

    expect(result).toEqual({ user: "alice" });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.test.com/api/v1/mcp/status");
    expect(opts.headers.Authorization).toBe("Bearer tok123");
  });

  it("serializes body as JSON for POST requests", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 1 }));

    await createProject("tok", "My App");

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.body).toBe(JSON.stringify({ name: "My App" }));
  });

  it("omits body for GET requests", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));

    await getStatus("tok");

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.body).toBeUndefined();
  });
});

describe("request: API error responses", () => {
  it("uses error field from JSON body", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "Not found" }, 404, "Not Found"));

    try {
      await getStatus("tok");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).status).toBe(404);
      expect((err as InstanceType<typeof ApiError>).message).toBe("Not found");
    }
  });

  it("uses message field from JSON body", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ message: "Rate limited" }, 429, "Too Many Requests"),
    );

    try {
      await getStatus("tok");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).status).toBe(429);
      expect((err as InstanceType<typeof ApiError>).message).toBe("Rate limited");
    }
  });

  it("falls back to statusText when JSON body has no error/message", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 500, "Internal Server Error"));

    await expect(getStatus("tok")).rejects.toThrow("Internal Server Error");
  });
});

describe("request: non-JSON responses", () => {
  it("uses statusText for non-JSON error response (e.g. HTML 502)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      json: () => Promise.reject(new SyntaxError("Unexpected token")),
    });

    try {
      await getStatus("tok");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).status).toBe(502);
      expect((err as InstanceType<typeof ApiError>).message).toBe("Bad Gateway");
    }
  });

  it("throws descriptive error for non-JSON 200 response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.reject(new SyntaxError("Unexpected token")),
    });

    await expect(getStatus("tok")).rejects.toThrow("Invalid JSON response from server");
  });
});

describe("request: network errors", () => {
  it("wraps fetch failures as ApiError with status 0", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

    try {
      await getStatus("tok");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).status).toBe(0);
      expect((err as InstanceType<typeof ApiError>).message).toBe("Network error: fetch failed");
    }
  });

  it("detects timeout via DOMException TimeoutError", async () => {
    const timeoutError = new DOMException("signal timed out", "TimeoutError");
    mockFetch.mockRejectedValueOnce(timeoutError);

    await expect(getStatus("tok")).rejects.toThrow("Request timed out");
  });

  it("handles non-Error thrown values (e.g. string)", async () => {
    mockFetch.mockRejectedValueOnce("connection reset");

    try {
      await getStatus("tok");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).message).toBe(
        "Network error: connection reset",
      );
    }
  });

  it("passes AbortSignal.timeout to fetch", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));

    await getStatus("tok");

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });
});

// --- URL encoding (security-critical) ---

describe("URL encoding", () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue(jsonResponse({}));
  });

  it("encodes special chars in projectId query param", async () => {
    await createLink("tok", "a&b=c", { name: "test" });
    expect(mockFetch.mock.calls[0][0]).toContain("project_id=a%26b%3Dc");
  });

  it("encodes path segments in getLink", async () => {
    await getLink("tok", "proj1", "my/path&special");
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("by-path/my%2Fpath%26special");
    expect(url).toContain("project_id=proj1");
  });

  it("encodes projectId in updateLink", async () => {
    await updateLink("tok", "p&1", 42, { name: "updated" });
    expect(mockFetch.mock.calls[0][0]).toContain("project_id=p%261");
  });

  it("encodes across all endpoints that take projectId", async () => {
    const calls: Array<[string, () => Promise<unknown>]> = [
      ["searchLinks", () => searchLinks("tok", "p=1", {})],
      ["getAnalyticsOverview", () => getAnalyticsOverview("tok", "p&2", {})],
      ["getLinkAnalytics", () => getLinkAnalytics("tok", "p/3", { path: "/x" })],
      ["getTopLinks", () => getTopLinks("tok", "p 4", {})],
      ["configureRedirects", () => configureRedirects("tok", "p+5", {})],
      ["archiveLink", () => archiveLink("tok", "p%9", 1)],
      ["createCampaign", () => createCampaign("tok", "p&6", "Test")],
      ["searchCampaigns", () => searchCampaigns("tok", "p=7", {})],
      ["archiveCampaign", () => archiveCampaign("tok", "p/8", 1)],
    ];

    for (const [name, fn] of calls) {
      mockFetch.mockClear();
      await fn();
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url, `${name} should encode project_id`).not.toMatch(/project_id=p[&/+ =]/);
    }
  });

  it("encodes instanceId in configureSdk", async () => {
    await configureSdk("tok", "i&6", {});
    expect(mockFetch.mock.calls[0][0]).toContain("instance_id=i%266");
  });

  it("archiveLink sends DELETE with link ID in path", async () => {
    await archiveLink("tok", "proj1", 55);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(opts.method).toBe("DELETE");
    expect(url).toContain("/links/55?");
    expect(url).toContain("project_id=proj1");
  });

  it("archiveCampaign sends DELETE with campaign ID in path", async () => {
    await archiveCampaign("tok", "proj1", 42);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(opts.method).toBe("DELETE");
    expect(url).toContain("/campaigns/42?");
    expect(url).toContain("project_id=proj1");
  });

  it("createCampaign sends POST with name in body", async () => {
    await createCampaign("tok", "proj1", "My Campaign");
    const [url, opts] = mockFetch.mock.calls[0];
    expect(opts.method).toBe("POST");
    expect(url).toContain("/campaigns?project_id=proj1");
    expect(opts.body).toBe(JSON.stringify({ name: "My Campaign" }));
  });

  it("searchCampaigns sends POST with params in body", async () => {
    await searchCampaigns("tok", "proj1", { term: "sale", page: 2 });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(opts.method).toBe("POST");
    expect(url).toContain("/campaigns/search?project_id=proj1");
    expect(JSON.parse(opts.body as string)).toEqual({ term: "sale", page: 2 });
  });

  it("createLink passes campaign_id in body when provided", async () => {
    await createLink("tok", "proj1", { name: "CL", campaign_id: 7 });
    const opts = mockFetch.mock.calls[0][1];
    const body = JSON.parse(opts.body as string);
    expect(body.campaign_id).toBe(7);
  });

  it("updateLink passes campaign_id in body when provided", async () => {
    await updateLink("tok", "proj1", 99, { campaign_id: 7 });
    const opts = mockFetch.mock.calls[0][1];
    const body = JSON.parse(opts.body as string);
    expect(body.campaign_id).toBe(7);
  });
});
