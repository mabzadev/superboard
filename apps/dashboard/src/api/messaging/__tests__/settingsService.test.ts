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
  createMessagingConfiguration,
  deleteMessagingConfiguration,
  getMessagingSettings,
  revokeSupportWebhookSecret,
  rotateSupportWebhookSecret,
  updateMessagingConfiguration,
  updateMessagingSettings,
  type MessagingConfigurationEntity,
  type MessagingProjectSettings,
} from "../settingsService";

const settings: MessagingProjectSettings = {
  business_name: "SuperBoard Support",
  locale: "en",
  timezone: "Europe/Zurich",
  date_format: "yyyy-MM-dd",
  auto_resolve_minutes: 1440,
  attachment_max_bytes: 10_000_000,
  allowed_content_types: ["image/png"],
  features: { csat: true },
};

const entity: Pick<
  MessagingConfigurationEntity,
  "entity_type" | "name" | "enabled" | "position" | "configuration"
> = {
  entity_type: "webhook",
  name: "CRM webhook",
  enabled: true,
  position: 1,
  configuration: { url: "https://hooks.example.test/support" },
};

describe("Support configuration dashboard service contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const method of Object.values(api)) {
      method.mockResolvedValue({ data: { data: {} } });
    }
  });

  it("loads and updates project settings on the canonical route", async () => {
    await getMessagingSettings("10-test");
    await updateMessagingSettings("10-test", settings);

    expect(api.GET).toHaveBeenCalledWith(
      "/api/v1/support/projects/10-test/settings"
    );
    expect(api.PATCH).toHaveBeenCalledWith(
      "/api/v1/support/projects/10-test/settings",
      settings
    );
  });

  it("creates, edits, and removes configuration entities", async () => {
    await createMessagingConfiguration("10-test", entity);
    await updateMessagingConfiguration("10-test", "entity/1", entity);
    await deleteMessagingConfiguration("10-test", "entity/1");

    expect(api.POST).toHaveBeenCalledWith(
      "/api/v1/support/projects/10-test/settings/entities",
      entity,
      { retry: false }
    );
    expect(api.PATCH).toHaveBeenCalledWith(
      "/api/v1/support/projects/10-test/settings/entities/entity%2F1",
      entity,
      { retry: false }
    );
    expect(api.DELETE).toHaveBeenCalledWith(
      "/api/v1/support/projects/10-test/settings/entities/entity%2F1",
      { retry: false }
    );
  });

  it("rotates and revokes encrypted webhook secrets", async () => {
    await rotateSupportWebhookSecret(
      "10-test",
      "entity/1",
      "a-long-shared-secret"
    );
    await revokeSupportWebhookSecret("10-test", "entity/1");

    expect(api.PUT).toHaveBeenCalledWith(
      "/api/v1/support/projects/10-test/settings/entities/entity%2F1/secret",
      { secret: "a-long-shared-secret" },
      { retry: false }
    );
    expect(api.DELETE).toHaveBeenCalledWith(
      "/api/v1/support/projects/10-test/settings/entities/entity%2F1/secret",
      { retry: false }
    );
  });
});
