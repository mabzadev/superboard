import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({
  listIntegrations: vi.fn(),
  createIntegration: vi.fn(),
  updateIntegration: vi.fn(),
  saveCredentials: vi.fn(),
  startOAuth: vi.fn(),
  deleteIntegration: vi.fn(),
}));

const notifications = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@/context/useProjectSelection", () => ({
  useProjectSelection: () => ({
    selectedProject: { id: "project-1", name: "Production" },
    selectedInstance: { role: "owner" },
  }),
}));

vi.mock("@/api/support/integrationsService", () => ({
  listSupportIntegrations: services.listIntegrations,
  createSupportIntegration: services.createIntegration,
  updateSupportIntegration: services.updateIntegration,
  saveSupportIntegrationCredentials: services.saveCredentials,
  startSupportIntegrationOAuth: services.startOAuth,
  deleteSupportIntegration: services.deleteIntegration,
}));

vi.mock("@/lib/config", () => ({
  config: {
    apiUrl: "https://api.example.test",
    apiPath: "/api/v1",
  },
}));

vi.mock("@/lib/Notifications", () => ({
  showErrorNotification: notifications.error,
  showSuccessNotification: notifications.success,
}));

import SupportIntegrationsPage from "../SupportIntegrationsPage";

const page = (data: unknown[] = []) => ({
  data,
  pagination: { limit: 50, has_more: false, next_cursor: null },
});

const configuredWebhook = {
  id: "webhook-1",
  provider: "webhook",
  display_name: "Escalations",
  status: "configured",
  settings: {
    endpoint_url: "https://hooks.example.com/support",
    events: ["conversation.created", "message.created"],
  },
};

async function selectWebhook(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText("Integration"), "webhook");
}

describe("Support native integrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    services.listIntegrations.mockResolvedValue(page());
    services.createIntegration.mockResolvedValue({
      data: {
        id: "webhook-new",
        provider: "webhook",
        display_name: "Incident webhook",
        status: "configuration_required",
      },
    });
    services.updateIntegration.mockResolvedValue({ data: configuredWebhook });
    services.saveCredentials.mockResolvedValue({
      data: {
        id: "webhook-new",
        status: "configured",
        credentials_configured: true,
      },
    });
    services.startOAuth.mockRejectedValue(new Error("Authorization unavailable"));
  });

  it("shows loading and collection errors as explicit native states", async () => {
    let rejectRequest: ((reason: Error) => void) | undefined;
    services.listIntegrations.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectRequest = reject;
        })
    );

    render(<SupportIntegrationsPage />);
    expect(screen.getByLabelText("Loading")).toBeInTheDocument();

    rejectRequest?.(new Error("Integrations unavailable"));
    expect(
      await screen.findByText("Integrations unavailable")
    ).toBeInTheDocument();
    expect(screen.getByText("No Support integrations")).toBeInTheDocument();
  });

  it("creates then configures an HTTPS webhook and clears its secret", async () => {
    const user = userEvent.setup();
    services.listIntegrations
      .mockResolvedValueOnce(page())
      .mockResolvedValue(page([{ ...configuredWebhook, id: "webhook-new" }]));
    render(<SupportIntegrationsPage />);
    await screen.findByText("No Support integrations");

    await selectWebhook(user);
    await user.type(screen.getByLabelText("Display name"), "Incident webhook");
    await user.type(
      screen.getByLabelText("Endpoint URL"),
      "https://hooks.example.com/incidents"
    );
    const signingSecret = screen.getByLabelText("Signing secret");
    await user.type(signingSecret, "s".repeat(32));
    await user.click(screen.getByRole("button", { name: "Add and configure" }));

    await waitFor(() =>
      expect(services.createIntegration).toHaveBeenCalledWith("project-1", {
        provider: "webhook",
        display_name: "Incident webhook",
        status: "configuration_required",
        settings: {
          endpoint_url: "https://hooks.example.com/incidents",
          events: [
            "conversation.created",
            "conversation.updated",
            "message.created",
            "conversation.csat_submitted",
          ],
        },
      })
    );
    expect(services.saveCredentials).toHaveBeenCalledWith(
      "project-1",
      "webhook-new",
      { signing_secret: "s".repeat(32) }
    );
    expect(signingSecret).toHaveValue("");
    expect(screen.queryByDisplayValue("s".repeat(32))).not.toBeInTheDocument();
    expect(notifications.success).toHaveBeenCalledWith(
      "Support integration configured"
    );
  });

  it("rejects unsafe webhook endpoints before creating an integration", async () => {
    const user = userEvent.setup();
    render(<SupportIntegrationsPage />);
    await screen.findByText("No Support integrations");

    await selectWebhook(user);
    await user.type(screen.getByLabelText("Display name"), "Internal hook");
    await user.type(
      screen.getByLabelText("Endpoint URL"),
      "https://127.0.0.1/webhook"
    );
    await user.type(screen.getByLabelText("Signing secret"), "x".repeat(32));

    expect(
      screen.getByText(/Use a public HTTPS URL without credentials/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add and configure" })
    ).toBeDisabled();
    expect(services.createIntegration).not.toHaveBeenCalled();
  });

  it("keeps a partially created webhook in configuration_required without retaining the failed secret", async () => {
    const user = userEvent.setup();
    services.saveCredentials.mockRejectedValueOnce(
      new Error("Credential vault unavailable")
    );
    services.listIntegrations.mockResolvedValueOnce(page()).mockResolvedValue(
      page([
        {
          ...configuredWebhook,
          id: "webhook-new",
          display_name: "Incident webhook",
          status: "configuration_required",
        },
      ])
    );
    render(<SupportIntegrationsPage />);
    await screen.findByText("No Support integrations");

    await selectWebhook(user);
    await user.type(screen.getByLabelText("Display name"), "Incident webhook");
    await user.type(
      screen.getByLabelText("Endpoint URL"),
      "https://hooks.example.com/incidents"
    );
    await user.type(screen.getByLabelText("Signing secret"), "f".repeat(32));
    await user.click(screen.getByRole("button", { name: "Add and configure" }));

    expect(
      await screen.findByText(
        /The integration was created, but its credentials were not saved/i
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Not configured")).toBeInTheDocument();
    expect(screen.getByLabelText("New signing secret")).toHaveValue("");
    expect(screen.queryByDisplayValue("f".repeat(32))).not.toBeInTheDocument();
    expect(services.updateIntegration).not.toHaveBeenCalled();
  });

  it("masks configured credentials and replaces them without reading a secret", async () => {
    const user = userEvent.setup();
    services.listIntegrations.mockResolvedValue(page([configuredWebhook]));
    render(<SupportIntegrationsPage />);

    await screen.findByText("Escalations");
    await user.click(
      screen.getByRole("button", { name: "Replace credentials" })
    );

    expect(
      screen.getByLabelText("Stored credentials are masked")
    ).toHaveTextContent("••••••••");
    const replacementSecret = screen.getByLabelText("New signing secret");
    expect(replacementSecret).toHaveValue("");
    await user.clear(screen.getByLabelText("Endpoint URL"));
    await user.type(
      screen.getByLabelText("Endpoint URL"),
      "https://hooks.example.com/replacement"
    );
    await user.type(replacementSecret, "r".repeat(32));
    await user.click(screen.getByRole("button", { name: "Save securely" }));

    await waitFor(() =>
      expect(services.updateIntegration).toHaveBeenCalledWith(
        "project-1",
        "webhook-1",
        {
          settings: {
            endpoint_url: "https://hooks.example.com/replacement",
            events: ["conversation.created", "message.created"],
          },
        }
      )
    );
    expect(services.saveCredentials).toHaveBeenCalledWith(
      "project-1",
      "webhook-1",
      { signing_secret: "r".repeat(32) }
    );
    expect(screen.queryByDisplayValue("r".repeat(32))).not.toBeInTheDocument();
  });

  it("enters a busy state while a webhook is being configured", async () => {
    const user = userEvent.setup();
    let resolveCredentials: ((value: unknown) => void) | undefined;
    services.listIntegrations.mockResolvedValue(page([configuredWebhook]));
    services.saveCredentials.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCredentials = resolve;
        })
    );
    render(<SupportIntegrationsPage />);

    await screen.findByText("Escalations");
    await user.click(
      screen.getByRole("button", { name: "Replace credentials" })
    );
    await user.type(
      screen.getByLabelText("New signing secret"),
      "z".repeat(32)
    );
    await user.click(screen.getByRole("button", { name: "Save securely" }));

    const savingButton = await screen.findByRole("button", { name: "Saving…" });
    expect(savingButton).toBeDisabled();
    expect(savingButton).toHaveAttribute("aria-busy", "true");

    resolveCredentials?.({
      data: {
        id: "webhook-1",
        status: "configured",
        credentials_configured: true,
      },
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Saving…" })
      ).not.toBeInTheDocument()
    );
  });

  it("does not expose secret values in the rendered configured card", async () => {
    services.listIntegrations.mockResolvedValue(
      page([
        {
          ...configuredWebhook,
          settings: {
            endpoint_url: "https://hooks.example.com/support",
            events: ["message.created"],
          },
        },
      ])
    );
    const { container } = render(<SupportIntegrationsPage />);
    const card = await screen.findByText("Escalations");
    expect(
      within(card.closest("div") || container).queryByText(/secret/i)
    ).toBeNull();
    expect(container.textContent).not.toContain("signing_secret");
  });

  it("persists the native Slack action settings before starting authorization", async () => {
    const user = userEvent.setup();
    services.createIntegration.mockResolvedValueOnce({
      data: {
        id: "slack-new",
        provider: "slack",
        display_name: "Support alerts",
        status: "configuration_required",
      },
    });
    render(<SupportIntegrationsPage />);
    await screen.findByText("No Support integrations");

    await user.selectOptions(screen.getByLabelText("Integration"), "slack");
    await user.type(screen.getByLabelText("Display name"), "Support alerts");
    await user.type(screen.getByLabelText("Channel ID"), "C123ABC456");
    await user.type(screen.getByLabelText("Client ID"), "slack-client");
    await user.type(screen.getByLabelText("Client secret"), "slack-secret");
    await user.type(screen.getByLabelText("Signing secret"), "signing-secret");
    await user.click(screen.getByRole("button", { name: "Add and configure" }));

    await waitFor(() => expect(services.createIntegration).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        provider: "slack",
        settings: {
          channel_id: "C123ABC456",
          workflow_action: "post_message",
          allowed_actions: ["post_message"],
        },
      })
    ));
    expect(services.saveCredentials).toHaveBeenCalledWith(
      "project-1",
      "slack-new",
      {
        client_id: "slack-client",
        client_secret: "slack-secret",
        signing_secret: "signing-secret",
      }
    );
    await waitFor(() => expect(services.startOAuth).toHaveBeenCalledWith(
      "project-1",
      "slack-new",
      {
        callback_uri: "https://api.example.test/api/v1/support/providers/slack/oauth/callback",
        return_uri: expect.stringMatching(/^http:\/\/localhost:\d+\/support\/integrations\?integration=slack-new$/u),
      }
    ));
    expect(screen.queryByDisplayValue("slack-secret")).not.toBeInTheDocument();
  });
});
