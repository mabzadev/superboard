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
  createMessagingCompany,
  createMessagingContact,
  createMessagingContactNote,
  executeMessagingMacro,
  getMessagingCsat,
  getMessagingCompanies,
  getMessagingContact,
  getMessagingContactNotes,
  getMessagingContacts,
  getMessagingDraft,
  getMessagingNotifications,
  getSupportAudit,
  getSupportQuality,
  markMessagingNotificationRead,
  saveMessagingDraft,
  updateMessagingContact,
} from "../operationsService";

describe("Support contacts dashboard service contracts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads contacts, contact history, notes, and companies from canonical Support routes", async () => {
    api.GET.mockResolvedValueOnce({ data: { data: [] } })
      .mockResolvedValueOnce({
        data: { data: { id: "contact-1", conversations: [] } },
      })
      .mockResolvedValueOnce({ data: { data: [] } })
      .mockResolvedValueOnce({ data: { data: [] } });

    await getMessagingContacts("10-test", "alice+pro");
    await getMessagingContact("10-test", "contact/1");
    await getMessagingContactNotes("10-test", "contact/1");
    await getMessagingCompanies("10-test");

    expect(api.GET).toHaveBeenNthCalledWith(
      1,
      "/api/v1/support/projects/10-test/contacts?q=alice%2Bpro"
    );
    expect(api.GET).toHaveBeenNthCalledWith(
      2,
      "/api/v1/support/projects/10-test/contacts/contact%2F1"
    );
    expect(api.GET).toHaveBeenNthCalledWith(
      3,
      "/api/v1/support/projects/10-test/contacts/contact%2F1/notes"
    );
    expect(api.GET).toHaveBeenNthCalledWith(
      4,
      "/api/v1/support/projects/10-test/companies"
    );
  });

  it("creates and updates real Support resources with retry disabled", async () => {
    api.POST.mockResolvedValue({ data: { data: { id: "created" } } });
    api.PATCH.mockResolvedValue({ data: { data: { id: "contact-1" } } });

    await createMessagingContact("10-test", { external_user_id: "customer-1" });
    await updateMessagingContact("10-test", "contact/1", { name: "Alice" });
    await createMessagingContactNote(
      "10-test",
      "contact/1",
      "Priority customer"
    );
    await createMessagingCompany("10-test", {
      name: "Acme",
      domain: "acme.test",
    });

    expect(api.POST).toHaveBeenNthCalledWith(
      1,
      "/api/v1/support/projects/10-test/contacts",
      { external_user_id: "customer-1" },
      { retry: false }
    );
    expect(api.PATCH).toHaveBeenCalledWith(
      "/api/v1/support/projects/10-test/contacts/contact%2F1",
      { name: "Alice" },
      { retry: false }
    );
    expect(api.POST).toHaveBeenNthCalledWith(
      2,
      "/api/v1/support/projects/10-test/contacts/contact%2F1/notes",
      { content: "Priority customer" },
      { retry: false }
    );
    expect(api.POST).toHaveBeenNthCalledWith(
      3,
      "/api/v1/support/projects/10-test/companies",
      { name: "Acme", domain: "acme.test" },
      { retry: false }
    );
  });

  it("loads quality, audit, CSAT, notifications, and conversation drafts", async () => {
    api.GET.mockResolvedValue({ data: { data: [] } });

    await getSupportQuality("10-test");
    await getSupportAudit("10-test");
    await getMessagingCsat("10-test");
    await getMessagingNotifications("10-test", true);
    await getMessagingDraft("10-test", "conversation/1");

    expect(api.GET).toHaveBeenNthCalledWith(
      1,
      "/api/v1/support/projects/10-test/quality"
    );
    expect(api.GET).toHaveBeenNthCalledWith(
      2,
      "/api/v1/support/projects/10-test/audit"
    );
    expect(api.GET).toHaveBeenNthCalledWith(
      3,
      "/api/v1/support/projects/10-test/csat"
    );
    expect(api.GET).toHaveBeenNthCalledWith(
      4,
      "/api/v1/support/projects/10-test/notifications?unread=true"
    );
    expect(api.GET).toHaveBeenNthCalledWith(
      5,
      "/api/v1/support/projects/10-test/conversations/conversation%2F1/draft"
    );
  });

  it("connects draft autosave, macro execution, and notification acknowledgement", async () => {
    api.PUT.mockResolvedValue({ data: { data: {} } });
    api.POST.mockResolvedValue({ data: { data: {} } });
    api.PATCH.mockResolvedValue({ data: { data: {} } });

    await saveMessagingDraft("10-test", "conversation/1", "Draft reply", [
      { key: "file-1" },
    ]);
    await executeMessagingMacro("10-test", "conversation/1", "macro/1");
    await markMessagingNotificationRead("10-test", "notification/1");

    expect(api.PUT).toHaveBeenCalledWith(
      "/api/v1/support/projects/10-test/conversations/conversation%2F1/draft",
      { content: "Draft reply", attachments: [{ key: "file-1" }] }
    );
    expect(api.POST).toHaveBeenCalledWith(
      "/api/v1/support/projects/10-test/conversations/conversation%2F1/macros/macro%2F1/execute",
      {},
      { retry: false }
    );
    expect(api.PATCH).toHaveBeenCalledWith(
      "/api/v1/support/projects/10-test/notifications/notification%2F1/read",
      {}
    );
  });
});
