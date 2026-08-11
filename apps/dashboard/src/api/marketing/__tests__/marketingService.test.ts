import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  GET: vi.fn(),
  POST: vi.fn(),
  PUT: vi.fn(),
  PATCH: vi.fn(),
  DELETE: vi.fn(),
}));

vi.mock("@/lib/api", () => api);
vi.mock("@/lib/config", () => ({ config: { apiPath: "/api/v1" } }));

import {
  addSubscriberToList,
  downloadMarketingMedia,
  getEmailSubscriber,
  getEmailSubscriberExport,
  getEmailSubscribers,
  removeSubscriberFromList,
  updateEmailCampaign,
  updateEmailSubscriber,
  updateEmailTemplate,
  updateSubscriberList,
  updateSubscriberSegment,
} from "../marketingService";

describe("Marketing dashboard service contracts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("unwraps subscriber list, detail, and privacy export responses", async () => {
    api.GET.mockResolvedValueOnce({
      data: { data: [{ id: "subscriber-1", email: "a@example.com" }] },
    })
      .mockResolvedValueOnce({
        data: { data: { id: "subscriber-1", email: "a@example.com" } },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            subscriber: { id: "subscriber-1" },
            memberships: [],
            deliveries: [],
            events: [],
          },
        },
      });

    await expect(getEmailSubscribers("10-test", "a+b")).resolves.toEqual([
      { id: "subscriber-1", email: "a@example.com" },
    ]);
    await expect(
      getEmailSubscriber("10-test", "subscriber-1")
    ).resolves.toMatchObject({ id: "subscriber-1" });
    await expect(
      getEmailSubscriberExport("10-test", "subscriber-1")
    ).resolves.toMatchObject({ subscriber: { id: "subscriber-1" } });

    expect(api.GET).toHaveBeenNthCalledWith(
      1,
      "/api/v1/marketing/projects/10-test/email/subscribers?q=a%2Bb"
    );
    expect(api.GET).toHaveBeenNthCalledWith(
      2,
      "/api/v1/marketing/projects/10-test/email/subscribers/subscriber-1"
    );
    expect(api.GET).toHaveBeenNthCalledWith(
      3,
      "/api/v1/marketing/projects/10-test/email/subscribers/subscriber-1/export"
    );
  });

  it("maps every editable audience resource to its Worker PATCH/PUT contract", async () => {
    api.PATCH.mockResolvedValue({ data: { data: { id: "resource-1" } } });
    api.PUT.mockResolvedValue({ data: { data: { subscribed: true } } });
    api.DELETE.mockResolvedValue({ data: { data: { subscribed: false } } });

    await updateEmailSubscriber("10-test", "subscriber-1", { name: "Updated" });
    await updateSubscriberList("10-test", "list-1", { name: "Customers" });
    await updateSubscriberSegment("10-test", "segment-1", { name: "Pro" });
    await addSubscriberToList("10-test", "list-1", "subscriber-1");
    await removeSubscriberFromList("10-test", "list-1", "subscriber-1");

    expect(api.PATCH).toHaveBeenNthCalledWith(
      1,
      "/api/v1/marketing/projects/10-test/email/subscribers/subscriber-1",
      { name: "Updated" }
    );
    expect(api.PATCH).toHaveBeenNthCalledWith(
      2,
      "/api/v1/marketing/projects/10-test/lists/list-1",
      { name: "Customers" }
    );
    expect(api.PATCH).toHaveBeenNthCalledWith(
      3,
      "/api/v1/marketing/projects/10-test/segments/segment-1",
      { name: "Pro" }
    );
    expect(api.PUT).toHaveBeenCalledWith(
      "/api/v1/marketing/projects/10-test/lists/list-1/subscribers/subscriber-1",
      {}
    );
    expect(api.DELETE).toHaveBeenCalledWith(
      "/api/v1/marketing/projects/10-test/lists/list-1/subscribers/subscriber-1"
    );
  });

  it("maps template, campaign, and media operations without legacy rewrites", async () => {
    api.PATCH.mockResolvedValue({ data: { data: { id: "resource-1" } } });
    const blob = new Blob(["media"], { type: "image/png" });
    api.GET.mockResolvedValue({ data: blob });

    await updateEmailTemplate("10-test", "template-1", { subject: "Hello" });
    await updateEmailCampaign("10-test", "campaign-1", {
      tracking_enabled: false,
    });
    await expect(downloadMarketingMedia("10-test", "media-1")).resolves.toBe(
      blob
    );

    expect(api.PATCH).toHaveBeenNthCalledWith(
      1,
      "/api/v1/marketing/projects/10-test/templates/template-1",
      { subject: "Hello" }
    );
    expect(api.PATCH).toHaveBeenNthCalledWith(
      2,
      "/api/v1/marketing/projects/10-test/campaigns/campaign-1",
      { tracking_enabled: false }
    );
    expect(api.GET).toHaveBeenCalledWith(
      "/api/v1/marketing/projects/10-test/media/media-1",
      { responseType: "blob" }
    );
  });
});
