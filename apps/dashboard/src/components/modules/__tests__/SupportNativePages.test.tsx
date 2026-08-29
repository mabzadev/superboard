import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getOperations: vi.fn(),
  listDeadLetters: vi.fn(),
  replayDeadLetter: vi.fn(),
  discardDeadLetter: vi.fn(),
  listChannels: vi.fn(),
  listProviders: vi.fn(),
  listInboxes: vi.fn(),
  createProvider: vi.fn(),
  listNotifications: vi.fn(),
  getNotificationPreferences: vi.fn(),
  updateNotificationPreferences: vi.fn(),
  readAllNotifications: vi.fn(),
  readNotification: vi.fn(),
  snoozeNotification: vi.fn(),
  deleteNotification: vi.fn(),
}));

vi.mock("@/context/useProjectSelection", () => ({
  useProjectSelection: () => ({
    selectedProject: { id: "project-1", name: "Production" },
    selectedInstance: { role: "owner" },
  }),
}));
vi.mock("@/api/support/settingsService", () => ({
  getSupportSettings: services.getSettings,
  updateSupportSettings: services.updateSettings,
  getMessagingSettings: services.getSettings,
  updateMessagingSettings: services.updateSettings,
}));
vi.mock("@/api/support/operationsHealthService", () => ({
  getSupportOperationsHealth: services.getOperations,
  listSupportDeadLetters: services.listDeadLetters,
  replaySupportDeadLetter: services.replayDeadLetter,
  discardSupportDeadLetter: services.discardDeadLetter,
}));
vi.mock("@/api/support/channelsService", () => ({
  listSupportChannels: services.listChannels,
  listSupportProviders: services.listProviders,
  createSupportProvider: services.createProvider,
  deleteSupportProvider: vi.fn(),
  saveSupportProviderCredentials: vi.fn(),
  startSupportProviderOAuth: vi.fn(),
}));
vi.mock("@/api/support/workforceService", () => ({
  listSupportInboxes: services.listInboxes,
}));
vi.mock("@/api/support/operationsService", () => ({
  getSupportNotifications: services.listNotifications,
  getSupportNotificationPreferences: services.getNotificationPreferences,
  updateSupportNotificationPreferences: services.updateNotificationPreferences,
  markAllSupportNotificationsRead: services.readAllNotifications,
  markSupportNotificationRead: services.readNotification,
  snoozeSupportNotification: services.snoozeNotification,
  deleteSupportNotification: services.deleteNotification,
}));
vi.mock("@/lib/Notifications", () => ({
  showErrorNotification: vi.fn(),
  showSuccessNotification: vi.fn(),
}));

import SupportChannelsPage from "../SupportChannelsPage";
import SupportSettingsPage from "../SupportSettingsPage";

describe("native Support Grow pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    services.getSettings.mockResolvedValue({
      data: {
        settings: {
          business_name: "VocoStar Care",
          locale: "en",
          timezone: "Europe/Zurich",
          date_format: "YYYY-MM-DD",
          auto_resolve_minutes: 120,
          attachment_max_bytes: 10 * 1024 * 1024,
          allowed_content_types: ["image/png"],
          features: { realtime: true, captain: true },
        },
      },
    });
    services.getOperations.mockResolvedValue({
      data: {
        queues: [{ queue_name: "events", status: "queued", count: 2 }],
        dead_letters: [],
        providers: [{ provider: "telegram", status: "processed", count: 4 }],
        knowledge: [{ status: "indexed", count: 6 }],
        imports: [],
        exports: [],
      },
    });
    services.listDeadLetters.mockResolvedValue({
      data: [],
      pagination: { limit: 50, has_more: false, next_cursor: null },
    });
    services.listChannels.mockResolvedValue({ data: [] });
    services.listProviders.mockResolvedValue({
      data: [
        {
          id: "provider-1",
          provider: "telegram",
          display_name: "Customer Telegram",
          status: "configuration_required",
        },
      ],
      pagination: { limit: 50, has_more: false, next_cursor: null },
    });
    services.listInboxes.mockResolvedValue({
      data: [
        {
          id: "inbox-1",
          name: "Web support",
          identifier: "web-support",
          channel_type: "widget",
          status: "active",
          auto_assignment: true,
          allow_reopen: true,
          csat_enabled: true,
          created_at: "2026-08-13T00:00:00.000Z",
          updated_at: "2026-08-13T00:00:00.000Z",
        },
      ],
      pagination: { limit: 50, has_more: false, next_cursor: null },
    });
    services.createProvider.mockResolvedValue({
      data: {
        id: "provider-created",
        inbox_id: "inbox-1",
        provider: "widget",
        display_name: "Customer care",
        status: "configuration_required",
      },
    });
    services.listNotifications.mockResolvedValue({ data: [] });
    services.getNotificationPreferences.mockResolvedValue({
      data: {
        email_enabled: true,
        push_enabled: true,
        browser_enabled: true,
        in_app_enabled: true,
        audio_enabled: true,
        muted_event_types: [],
      },
    });
    services.updateNotificationPreferences.mockResolvedValue({
      data: {
        email_enabled: true,
        push_enabled: true,
        browser_enabled: true,
        in_app_enabled: true,
        audio_enabled: true,
        muted_event_types: [],
      },
    });
  });

  it("renders typed project settings and live operations without migration language", async () => {
    const user = userEvent.setup();
    const { container } = render(<SupportSettingsPage />);

    expect(
      await screen.findByDisplayValue("VocoStar Care")
    ).toBeInTheDocument();
    expect(screen.getByText("Support capabilities")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Operations" }));
    await waitFor(() =>
      expect(screen.getByText("Queued jobs")).toBeInTheDocument()
    );
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/coming soon|migration|legacy/i);
  });

  it("presents an unconfigured provider as a normal SuperBoard state and masks credentials", async () => {
    const user = userEvent.setup();
    const { container } = render(<SupportChannelsPage />);
    await user.click(screen.getByRole("tab", { name: "Connections" }));

    expect(await screen.findByText("Customer Telegram")).toBeInTheDocument();
    expect(screen.getByText("Not configured")).toBeInTheDocument();
    expect(container.textContent).not.toContain("client_secret");
    expect(container.textContent).not.toMatch(/coming soon|migration|legacy/i);
  });

  it("attaches every new channel connection to a compatible active inbox", async () => {
    const user = userEvent.setup();
    render(<SupportChannelsPage />);
    await user.click(screen.getByRole("tab", { name: "Connections" }));
    await screen.findByRole("option", { name: "Web support" });
    await user.type(screen.getByPlaceholderText("Customer care"), "Customer care");
    await user.selectOptions(screen.getByLabelText("Inbox"), "inbox-1");
    await user.click(screen.getByRole("button", { name: /add/i }));

    await waitFor(() =>
      expect(services.createProvider).toHaveBeenCalledWith("project-1", {
        provider: "widget",
        display_name: "Customer care",
        inbox_id: "inbox-1",
        status: "configuration_required",
        settings: {},
      })
    );
  });

  it("exposes native notification preferences and read-all controls", async () => {
    services.listNotifications.mockResolvedValue({
      data: [
        {
          id: "notification-1",
          notification_type: "assignment.updated",
          title: "Conversation assigned",
          body: "A priority conversation was assigned to you.",
          read_at: null,
          created_at: "2026-08-13T12:00:00.000Z",
        },
      ],
    });
    services.readAllNotifications.mockResolvedValue({ data: { updated: 1 } });
    const user = userEvent.setup();
    render(<SupportSettingsPage />);

    await user.click(screen.getByRole("tab", { name: "Notifications" }));
    expect(await screen.findByText("Conversation assigned")).toBeInTheDocument();
    expect(screen.getByLabelText("Mobile push")).toBeChecked();
    await user.click(screen.getByRole("button", { name: /read all/i }));
    await waitFor(() =>
      expect(services.readAllNotifications).toHaveBeenCalledWith("project-1")
    );
  });
});
