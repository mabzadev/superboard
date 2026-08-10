import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const marketing = vi.hoisted(() => ({
  getEmailCampaigns: vi.fn(),
  getEmailTemplates: vi.fn(),
  getMarketingMedia: vi.fn(),
  getSubscriberLists: vi.fn(),
  getSubscriberSegments: vi.fn(),
  getSmtpSettings: vi.fn(),
  scheduleEmailCampaign: vi.fn(),
  testEmailCampaign: vi.fn(),
}));

vi.mock("@/api/marketing/marketingService", () => marketing);
vi.mock("@/lib/config", () => ({
  config: {
    apiPath: "/api/v1",
    apiUrl: "https://api.example.test",
    clientId: "dashboard-test",
  },
}));
vi.mock("@/context/useProjectSelection", () => ({
  useProjectSelection: () => ({
    selectedProject: { id: "10-test", name: "Test" },
  }),
}));
vi.mock("@/lib/Notifications", () => ({
  showErrorNotification: vi.fn(),
  showSuccessNotification: vi.fn(),
}));
vi.mock("@/components/layout/app-header", () => ({
  default: () => <header>Marketing</header>,
}));

import { MarketingListPage } from "../MarketingPages";

describe("Marketing campaign operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    marketing.getEmailCampaigns.mockResolvedValue([
      {
        id: "campaign-1",
        name: "Welcome",
        subject: "Welcome aboard",
        status: "draft",
        tracking_enabled: true,
      },
      {
        id: "campaign-2",
        name: "Newsletter",
        subject: "August news",
        status: "draft",
        tracking_enabled: true,
      },
    ]);
    marketing.getEmailTemplates.mockResolvedValue([]);
    marketing.getMarketingMedia.mockResolvedValue([]);
    marketing.getSubscriberLists.mockResolvedValue([]);
    marketing.getSubscriberSegments.mockResolvedValue([]);
    marketing.getSmtpSettings.mockResolvedValue({
      configured: false,
      profiles: [],
    });
    marketing.scheduleEmailCampaign.mockResolvedValue({});
    marketing.testEmailCampaign.mockResolvedValue({ ok: true });
  });

  it("keeps scheduling and test-recipient input isolated per campaign", async () => {
    render(<MarketingListPage kind="campaigns" />);

    await screen.findByText("Welcome aboard");

    const welcomeSchedule = screen.getByLabelText("Schedule Welcome");
    const newsletterSchedule = screen.getByLabelText("Schedule Newsletter");
    fireEvent.change(welcomeSchedule, {
      target: { value: "2026-08-10T10:00" },
    });

    expect(welcomeSchedule).toHaveValue("2026-08-10T10:00");
    expect(newsletterSchedule).toHaveValue("");

    const welcomeRecipient = screen.getByLabelText(
      "Test recipient for Welcome"
    );
    const newsletterRecipient = screen.getByLabelText(
      "Test recipient for Newsletter"
    );
    fireEvent.change(welcomeRecipient, {
      target: { value: "qa@example.test" },
    });

    expect(welcomeRecipient).toHaveValue("qa@example.test");
    expect(newsletterRecipient).toHaveValue("");

    const testButtons = screen.getAllByRole("button", { name: "Test" });
    fireEvent.click(testButtons[0]!);

    await waitFor(() =>
      expect(marketing.testEmailCampaign).toHaveBeenCalledWith(
        "10-test",
        "campaign-1",
        "qa@example.test"
      )
    );
  });
});
