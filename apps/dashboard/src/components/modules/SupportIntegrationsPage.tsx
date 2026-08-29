"use client";

import { useEffect, useState } from "react";
import { Blocks, KeyRound, Link2, Plus, Trash2 } from "lucide-react";
import {
  createSupportIntegration,
  deleteSupportIntegration,
  listSupportIntegrations,
  saveSupportIntegrationCredentials,
  startSupportIntegrationOAuth,
  updateSupportIntegration,
  type SupportIntegration,
} from "@/api/support/integrationsService";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useProjectSelection } from "@/context/useProjectSelection";
import { config } from "@/lib/config";
import {
  showErrorNotification,
  showSuccessNotification,
} from "@/lib/Notifications";
import { isSafePublicHttpsUrl } from "@/lib/validation";
import { EmptyProject, ModulePage, moduleErrorMessage } from "./ModulePage";
import {
  AccessNotice,
  SupportEmpty,
  SupportError,
  SupportLoadMore,
  SupportLoading,
  SupportSearchToolbar,
  SupportStatus,
  useSupportCollection,
} from "@/components/support/SupportUi";

type IntegrationProvider =
  | "slack"
  | "linear"
  | "notion"
  | "shopify"
  | "dyte"
  | "api"
  | "webhook";

type CredentialField = {
  key: string;
  label: string;
  minLength?: number;
  maxLength?: number;
};

type IntegrationDefinition = {
  label: string;
  field: string;
  key: string;
  placeholder?: string;
  acceptedAliases?: string[];
  workflowAction?: string;
  additionalSettings?: Array<{
    key: string;
    label: string;
    placeholder?: string;
    required?: boolean;
  }>;
  credentialFields: CredentialField[];
};

const integrations: Record<IntegrationProvider, IntegrationDefinition> = {
  slack: {
    label: "Slack",
    field: "Channel ID",
    key: "channel_id",
    acceptedAliases: ["workspace_id"],
    workflowAction: "post_message",
    additionalSettings: [
      {
        key: "message_template",
        label: "Message template",
        placeholder: "New Support conversation {{conversation.display_id}}",
      },
      {
        key: "thread_reference",
        label: "Thread reference",
        placeholder: "1712345678.123456",
      },
    ],
    credentialFields: [
      { key: "client_id", label: "Client ID" },
      { key: "client_secret", label: "Client secret" },
      { key: "signing_secret", label: "Signing secret" },
    ],
  },
  linear: {
    label: "Linear",
    field: "Team ID",
    key: "team_id",
    workflowAction: "create_issue",
    additionalSettings: [
      { key: "title_template", label: "Title template" },
      { key: "description_template", label: "Description template" },
    ],
    credentialFields: [
      { key: "client_id", label: "Client ID" },
      { key: "client_secret", label: "Client secret" },
    ],
  },
  notion: {
    label: "Notion",
    field: "Page ID",
    key: "page_id",
    acceptedAliases: ["workspace_id"],
    workflowAction: "update_page_title",
    additionalSettings: [
      { key: "title_template", label: "Title template" },
    ],
    credentialFields: [
      { key: "client_id", label: "Client ID" },
      { key: "client_secret", label: "Client secret" },
    ],
  },
  shopify: {
    label: "Shopify",
    field: "Shop domain",
    key: "shop_domain",
    acceptedAliases: ["store_domain"],
    placeholder: "example.myshopify.com",
    workflowAction: "add_tags",
    additionalSettings: [
      {
        key: "resource_id",
        label: "Customer or order resource ID",
        placeholder: "gid://shopify/Customer/123456789",
        required: true,
      },
      {
        key: "tags",
        label: "Tags (comma separated)",
        placeholder: "support, priority",
        required: true,
      },
    ],
    credentialFields: [
      { key: "client_id", label: "Client ID" },
      { key: "client_secret", label: "Client secret" },
    ],
  },
  dyte: {
    label: "Dyte",
    field: "Meeting preset",
    key: "meeting_preset",
    credentialFields: [
      { key: "organization_id", label: "Organization ID" },
      { key: "api_key", label: "API key" },
    ],
  },
  api: {
    label: "Dashboard app",
    field: "App URL",
    key: "app_url",
    placeholder: "https://app.example.com/support",
    credentialFields: [],
  },
  webhook: {
    label: "Custom webhook",
    field: "Endpoint URL",
    key: "endpoint_url",
    placeholder: "https://hooks.example.com/support",
    credentialFields: [
      {
        key: "signing_secret",
        label: "Signing secret",
        minLength: 32,
        maxLength: 512,
      },
    ],
  },
};

const webhookEventOptions = [
  { value: "conversation.created", label: "Conversation created" },
  { value: "conversation.updated", label: "Conversation updated" },
  { value: "message.created", label: "Message created" },
  { value: "conversation.csat_submitted", label: "CSAT submitted" },
  { value: "*", label: "All current and future events" },
] as const;

const defaultWebhookEvents = webhookEventOptions
  .filter((event) => event.value !== "*")
  .map((event) => event.value);
const webhookEventValues = new Set<string>(
  webhookEventOptions.map((event) => event.value)
);

const oauthProviders = new Set<IntegrationProvider>([
  "slack",
  "linear",
  "notion",
  "shopify",
]);

function isIntegrationProvider(value: string): value is IntegrationProvider {
  return value in integrations;
}

function credentialValuesAreValid(
  fields: CredentialField[],
  values: Record<string, string>
) {
  return fields.every((field) => {
    const value = values[field.key] || "";
    return (
      value.trim().length > 0 &&
      value.length >= (field.minLength ?? 1) &&
      value.length <= (field.maxLength ?? 4_096)
    );
  });
}

function integrationTarget(
  integration: SupportIntegration,
  definition: IntegrationDefinition
) {
  const settings = integration.settings || {};
  for (const key of [definition.key, ...(definition.acceptedAliases || [])]) {
    if (typeof settings[key] === "string") return settings[key] as string;
  }
  return "";
}

function integrationAdditionalSettings(
  integration: SupportIntegration,
  definition: IntegrationDefinition
) {
  const settings = integration.settings || {};
  return Object.fromEntries(
    (definition.additionalSettings || []).map((field) => {
      const value = settings[field.key];
      return [
        field.key,
        Array.isArray(value)
          ? value.filter((item) => typeof item === "string").join(", ")
          : typeof value === "string"
            ? value
            : "",
      ];
    })
  );
}

function integrationSettings(
  provider: IntegrationProvider,
  definition: IntegrationDefinition,
  target: string,
  additional: Record<string, string>,
  events: string[]
) {
  const settings: Record<string, unknown> = {
    [definition.key]: target.trim(),
    ...(provider === "webhook" ? { events: [...events] } : {}),
  };
  if (definition.workflowAction) {
    settings.workflow_action = definition.workflowAction;
    settings.allowed_actions = [definition.workflowAction];
  }
  for (const field of definition.additionalSettings || []) {
    const value = (additional[field.key] || "").trim();
    if (!value) continue;
    settings[field.key] = field.key === "tags"
      ? value.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 20)
      : value;
  }
  return settings;
}

function settingsAreValid(
  provider: IntegrationProvider,
  definition: IntegrationDefinition,
  target: string,
  additional: Record<string, string>
) {
  const value = target.trim();
  if (!value) return false;
  if (provider === "webhook" && !isSafePublicHttpsUrl(value)) return false;
  if (provider === "slack" && !/^[CDG][A-Z0-9]{2,31}$/u.test(value)) return false;
  if (["linear", "notion"].includes(provider) &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    return false;
  }
  if (provider === "shopify" && !/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/u.test(value)) return false;
  for (const field of definition.additionalSettings || []) {
    const setting = (additional[field.key] || "").trim();
    if (field.required && !setting) return false;
    if (field.key === "resource_id" && setting &&
      !/^gid:\/\/shopify\/(?:Order|DraftOrder|Customer|Product|Article|DiscountNode)\/[A-Za-z0-9_-]{1,128}$/u.test(setting)) return false;
    if (field.key === "tags" && setting && !setting.split(",").some((tag) => tag.trim())) return false;
    if (field.key === "thread_reference" && setting && !/^\d{1,20}\.\d{1,20}$/u.test(setting)) return false;
  }
  return true;
}

function integrationEvents(integration: SupportIntegration) {
  const events = integration.settings?.events;
  if (!Array.isArray(events)) return [...defaultWebhookEvents];
  const supported = events.filter(
    (event): event is string =>
      typeof event === "string" && webhookEventValues.has(event)
  );
  return supported.length > 0 ? supported : [...defaultWebhookEvents];
}

function toggleWebhookEvent(
  current: string[],
  value: string,
  checked: boolean
) {
  if (value === "*") return checked ? ["*"] : [];
  const withoutWildcard = current.filter((event) => event !== "*");
  if (!checked) return withoutWildcard.filter((event) => event !== value);
  return withoutWildcard.includes(value)
    ? withoutWildcard
    : [...withoutWildcard, value];
}

async function beginAuthorization(
  projectRef: string,
  integrationId: string,
  provider: IntegrationProvider
) {
  const callback = new URL(
    `${config.apiPath}/support/providers/${encodeURIComponent(provider)}/oauth/callback`,
    config.apiUrl
  );
  const returnUrl = new URL("/support/integrations", window.location.origin);
  returnUrl.searchParams.set("integration", integrationId);
  const result = await startSupportIntegrationOAuth(projectRef, integrationId, {
    callback_uri: callback.toString(),
    return_uri: returnUrl.toString(),
  });
  return result.data.authorization_url;
}

function WebhookEvents({
  idPrefix,
  selected,
  onChange,
  disabled = false,
}: {
  idPrefix: string;
  selected: string[];
  onChange: (events: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Events</legend>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {webhookEventOptions.map((event) => {
          const id = `${idPrefix}-${event.value.replaceAll(".", "-").replace("*", "all")}`;
          return (
            <div className="flex items-center gap-2" key={event.value}>
              <Checkbox
                checked={selected.includes(event.value)}
                disabled={disabled}
                id={id}
                onCheckedChange={(checked) =>
                  onChange(
                    toggleWebhookEvent(selected, event.value, checked === true)
                  )
                }
              />
              <Label className="font-normal" htmlFor={id}>
                {event.label}
              </Label>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        “All current and future events” also subscribes this endpoint to event
        types added later.
      </p>
    </fieldset>
  );
}

export default function SupportIntegrationsPage() {
  const { selectedProject, selectedInstance } = useProjectSelection();
  const projectRef = selectedProject?.id;
  const canManageCredentials = new Set(["owner", "admin"]).has(
    selectedInstance?.role || "member"
  );
  const resources = useSupportCollection(projectRef, listSupportIntegrations);
  const [provider, setProvider] = useState<IntegrationProvider>("slack");
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [webhookEvents, setWebhookEvents] = useState<string[]>([
    ...defaultWebhookEvents,
  ]);
  const [additionalSettings, setAdditionalSettings] = useState<
    Record<string, string>
  >({});
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedIntegration, setSelectedIntegration] =
    useState<SupportIntegration | null>(null);
  const [configurationTarget, setConfigurationTarget] = useState("");
  const [configurationEvents, setConfigurationEvents] = useState<string[]>([]);
  const [configurationAdditionalSettings, setConfigurationAdditionalSettings] =
    useState<Record<string, string>>({});
  const [configurationCredentials, setConfigurationCredentials] = useState<
    Record<string, string>
  >({});
  const [configuring, setConfiguring] = useState(false);
  const [configurationError, setConfigurationError] = useState<string | null>(
    null
  );
  const definition = integrations[provider];
  const targetIsValid = settingsAreValid(
    provider,
    definition,
    target,
    additionalSettings
  );
  const eventsAreValid = provider !== "webhook" || webhookEvents.length > 0;
  const credentialsAreValid = credentialValuesAreValid(
    definition.credentialFields,
    credentials
  );
  const needsCredentialAccess = definition.credentialFields.length > 0;
  const canCreate =
    Boolean(name.trim()) &&
    targetIsValid &&
    eventsAreValid &&
    credentialsAreValid &&
    (!needsCredentialAccess || canManageCredentials);

  useEffect(() => {
    const current = new URL(window.location.href);
    const result = current.searchParams.get("support_result");
    if (!result) return;
    if (result === "success") {
      showSuccessNotification("Support integration authorized");
    } else {
      showErrorNotification("Support integration authorization was not completed");
    }
    current.searchParams.delete("support_result");
    current.searchParams.delete("support_code");
    current.searchParams.delete("integration");
    window.history.replaceState({}, "", `${current.pathname}${current.search}${current.hash}`);
  }, []);

  const clearCreateForm = () => {
    setName("");
    setTarget("");
    setWebhookEvents([...defaultWebhookEvents]);
    setAdditionalSettings({});
    setCredentials({});
  };

  const closeConfiguration = () => {
    setSelectedIntegration(null);
    setConfigurationTarget("");
    setConfigurationEvents([]);
    setConfigurationAdditionalSettings({});
    setConfigurationCredentials({});
    setConfigurationError(null);
  };

  const openConfiguration = (integration: SupportIntegration) => {
    if (!isIntegrationProvider(integration.provider)) return;
    const integrationDefinition = integrations[integration.provider];
    setSelectedIntegration(integration);
    setConfigurationTarget(
      integrationTarget(integration, integrationDefinition)
    );
    setConfigurationEvents(
      integration.provider === "webhook" ? integrationEvents(integration) : []
    );
    setConfigurationAdditionalSettings(
      integrationAdditionalSettings(integration, integrationDefinition)
    );
    setConfigurationCredentials({});
    setConfigurationError(null);
  };

  const create = async () => {
    if (!projectRef || !canCreate) return;
    const submittedTarget = target.trim();
    const submittedEvents = [...webhookEvents];
    const submittedCredentials = { ...credentials };
    const submittedAdditionalSettings = { ...additionalSettings };
    const settings = integrationSettings(
      provider,
      definition,
      submittedTarget,
      submittedAdditionalSettings,
      submittedEvents
    );
    setSaving(true);
    setFormError(null);
    try {
      const result = await createSupportIntegration(projectRef, {
        provider,
        display_name: name.trim(),
        status: "configuration_required",
        settings,
      });
      if (definition.credentialFields.length > 0) {
        try {
          await saveSupportIntegrationCredentials(
            projectRef,
            result.data.id,
            submittedCredentials
          );
        } catch (cause) {
          const detail = moduleErrorMessage(cause);
          setSelectedIntegration({
            ...result.data,
            status: "configuration_required",
            settings,
          });
          setConfigurationTarget(submittedTarget);
          setConfigurationEvents(provider === "webhook" ? submittedEvents : []);
          setConfigurationAdditionalSettings(submittedAdditionalSettings);
          setConfigurationCredentials({});
          setConfigurationError(
            `The integration was created, but its credentials were not saved. ${detail}`
          );
          await resources.reload();
          showErrorNotification(detail);
          return;
        }
      }
      if (oauthProviders.has(provider)) {
        try {
          const authorization = await beginAuthorization(
            projectRef,
            result.data.id,
            provider
          );
          clearCreateForm();
          showSuccessNotification("Continue to authorize the Support integration");
          window.location.assign(authorization);
          return;
        } catch (cause) {
          const detail = moduleErrorMessage(cause);
          setFormError(
            `The integration client was saved, but authorization could not start. ${detail}`
          );
          await resources.reload();
          showErrorNotification(detail);
          return;
        }
      }
      clearCreateForm();
      await resources.reload();
      showSuccessNotification("Support integration configured");
    } catch (cause) {
      const detail = moduleErrorMessage(cause);
      setFormError(detail);
      showErrorNotification(detail);
    } finally {
      // Credentials are write-only and must not outlive a submission attempt.
      setCredentials({});
      setSaving(false);
    }
  };

  const saveConfiguration = async () => {
    if (
      !projectRef ||
      !selectedIntegration ||
      !isIntegrationProvider(selectedIntegration.provider)
    )
      return;
    const selectedDefinition = integrations[selectedIntegration.provider];
    const validTarget = settingsAreValid(
      selectedIntegration.provider,
      selectedDefinition,
      configurationTarget,
      configurationAdditionalSettings
    );
    const validEvents =
      selectedIntegration.provider !== "webhook" ||
      configurationEvents.length > 0;
    if (
      !validTarget ||
      !validEvents ||
      !credentialValuesAreValid(
        selectedDefinition.credentialFields,
        configurationCredentials
      )
    )
      return;
    const settings = integrationSettings(
      selectedIntegration.provider,
      selectedDefinition,
      configurationTarget,
      configurationAdditionalSettings,
      configurationEvents
    );
    const submittedCredentials = { ...configurationCredentials };
    setConfiguring(true);
    setConfigurationError(null);
    try {
      await updateSupportIntegration(projectRef, selectedIntegration.id, {
        settings,
      });
      await saveSupportIntegrationCredentials(
        projectRef,
        selectedIntegration.id,
        submittedCredentials
      );
      if (oauthProviders.has(selectedIntegration.provider)) {
        const authorization = await beginAuthorization(
          projectRef,
          selectedIntegration.id,
          selectedIntegration.provider
        );
        closeConfiguration();
        showSuccessNotification("Continue to authorize the Support integration");
        window.location.assign(authorization);
        return;
      }
      closeConfiguration();
      await resources.reload();
      showSuccessNotification("Integration credentials saved securely");
    } catch (cause) {
      const detail = moduleErrorMessage(cause);
      setConfigurationError(detail);
      showErrorNotification(detail);
    } finally {
      // Never retain a submitted secret, including after a failed request.
      setConfigurationCredentials({});
      setConfiguring(false);
    }
  };

  const remove = async (integration: SupportIntegration) => {
    if (!projectRef || !window.confirm(`Delete ${integration.display_name}?`))
      return;
    try {
      await deleteSupportIntegration(projectRef, integration.id);
      if (selectedIntegration?.id === integration.id) closeConfiguration();
      await resources.reload();
      showSuccessNotification("Support integration deleted");
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    }
  };

  const authorizeExisting = async (integration: SupportIntegration) => {
    if (
      !projectRef ||
      !canManageCredentials ||
      !isIntegrationProvider(integration.provider) ||
      !oauthProviders.has(integration.provider)
    )
      return;
    setSaving(true);
    try {
      const authorization = await beginAuthorization(
        projectRef,
        integration.id,
        integration.provider
      );
      showSuccessNotification("Continue to authorize the Support integration");
      window.location.assign(authorization);
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
      setSaving(false);
    }
  };

  const selectedProvider =
    selectedIntegration && isIntegrationProvider(selectedIntegration.provider)
      ? selectedIntegration.provider
      : null;
  const selectedDefinition = selectedProvider
    ? integrations[selectedProvider]
    : null;
  const configurationTargetIsValid =
    selectedProvider && selectedDefinition
      ? settingsAreValid(
          selectedProvider,
          selectedDefinition,
          configurationTarget,
          configurationAdditionalSettings
        )
      : false;
  const configurationEventsAreValid =
    selectedProvider !== "webhook" || configurationEvents.length > 0;
  const configurationCredentialsAreValid = selectedDefinition
    ? credentialValuesAreValid(
        selectedDefinition.credentialFields,
        configurationCredentials
      )
    : false;

  return (
    <ModulePage
      title="Integrations"
      description="Connect Support workflows to your team tools and customer context."
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="space-y-4">
          <SupportSearchToolbar
            query={resources.query}
            setQuery={resources.setQuery}
            onSearch={resources.search}
            onRefresh={resources.reload}
            loading={resources.loading}
          />
          <SupportError message={resources.error} />
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Blocks /> Add an integration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <SupportError message={formError} />
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="support-integration-provider">
                    Integration
                  </Label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    id="support-integration-provider"
                    value={provider}
                    onChange={(event) => {
                      setProvider(event.target.value as IntegrationProvider);
                      setTarget("");
                      setWebhookEvents([...defaultWebhookEvents]);
                      setAdditionalSettings({});
                      setCredentials({});
                      setFormError(null);
                    }}
                  >
                    {Object.entries(integrations).map(([value, item]) => (
                      <option key={value} value={value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="support-integration-name">Display name</Label>
                  <Input
                    id="support-integration-name"
                    placeholder={`${definition.label} for Support`}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="support-integration-target">
                    {definition.field}
                  </Label>
                  <Input
                    aria-invalid={
                      provider === "webhook" &&
                      Boolean(target) &&
                      !targetIsValid
                    }
                    id="support-integration-target"
                    placeholder={definition.placeholder}
                    type={
                      provider === "webhook" || provider === "api"
                        ? "url"
                        : "text"
                    }
                    value={target}
                    onChange={(event) => setTarget(event.target.value)}
                  />
                  {provider === "webhook" && target && !targetIsValid ? (
                    <p className="text-xs text-destructive" role="alert">
                      Use a public HTTPS URL without credentials, fragments, or
                      private-network addresses.
                    </p>
                  ) : null}
                </div>
                {(definition.additionalSettings || []).map((field) => (
                  <div className="space-y-2" key={field.key}>
                    <Label htmlFor={`support-integration-${field.key}`}>
                      {field.label}
                    </Label>
                    <Input
                      id={`support-integration-${field.key}`}
                      placeholder={field.placeholder}
                      value={additionalSettings[field.key] || ""}
                      onChange={(event) =>
                        setAdditionalSettings((current) => ({
                          ...current,
                          [field.key]: event.target.value,
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
              {provider === "webhook" ? (
                <WebhookEvents
                  idPrefix="new-support-webhook-event"
                  onChange={setWebhookEvents}
                  selected={webhookEvents}
                />
              ) : null}
              {needsCredentialAccess && canManageCredentials ? (
                <div className="space-y-3 rounded-lg border p-4">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <KeyRound className="size-4" /> Secure credentials
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Values are sent only to the write-only credential
                      endpoint, encrypted per project, and cleared from this
                      form after every submission attempt.
                    </p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {definition.credentialFields.map((field) => (
                      <div className="space-y-2" key={field.key}>
                        <Label htmlFor={`new-integration-${field.key}`}>
                          {field.label}
                        </Label>
                        <Input
                          autoComplete="new-password"
                          id={`new-integration-${field.key}`}
                          maxLength={field.maxLength}
                          minLength={field.minLength}
                          spellCheck={false}
                          type="password"
                          value={credentials[field.key] || ""}
                          onChange={(event) =>
                            setCredentials((current) => ({
                              ...current,
                              [field.key]: event.target.value,
                            }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : needsCredentialAccess ? (
                <AccessNotice>
                  Only project owners and administrators can create or replace
                  integration credentials. Existing secrets are never loaded
                  into this page.
                </AccessNotice>
              ) : null}
              <div className="flex justify-end">
                <Button
                  aria-busy={saving}
                  disabled={saving || !canCreate}
                  onClick={() => void create()}
                >
                  <Plus /> {saving ? "Creating…" : "Add and configure"}
                </Button>
              </div>
            </CardContent>
          </Card>
          {resources.loading ? (
            <SupportLoading />
          ) : resources.items.length === 0 ? (
            <SupportEmpty
              title="No Support integrations"
              description="Add a team tool, commerce context, meeting service or custom webhook."
            />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {resources.items.map((item) => {
                const itemProvider = isIntegrationProvider(item.provider)
                  ? item.provider
                  : null;
                const itemDefinition = itemProvider
                  ? integrations[itemProvider]
                  : null;
                const canConfigure =
                  canManageCredentials &&
                  Boolean(itemDefinition?.credentialFields.length);
                return (
                  <Card key={item.id}>
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div>
                        <p className="font-medium">{item.display_name}</p>
                        <p className="text-sm text-muted-foreground">
                          {itemDefinition?.label || item.provider}
                        </p>
                        {item.status === "configuration_required" ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Save all required credentials before this
                            integration can process Support events.
                          </p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <SupportStatus value={item.status} />
                        {canManageCredentials &&
                        itemProvider &&
                        oauthProviders.has(itemProvider) ? (
                          <Button
                            disabled={saving || configuring}
                            variant="outline"
                            onClick={() => void authorizeExisting(item)}
                          >
                            <Link2 /> Authorize
                          </Button>
                        ) : null}
                        {canConfigure ? (
                          <Button
                            disabled={saving || configuring}
                            variant="outline"
                            onClick={() => openConfiguration(item)}
                          >
                            <KeyRound />
                            {item.status === "configuration_required"
                              ? "Configure"
                              : "Replace credentials"}
                          </Button>
                        ) : null}
                        <Button
                          aria-label={`Delete ${item.display_name}`}
                          disabled={saving || configuring}
                          size="icon"
                          variant="ghost"
                          onClick={() => void remove(item)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
          <SupportLoadMore
            visible={resources.hasMore}
            loading={resources.loadingMore}
            onClick={resources.loadMore}
          />
          {selectedIntegration && selectedDefinition && selectedProvider ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Secure configuration for {selectedIntegration.display_name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <SupportError message={configurationError} />
                <p className="text-sm text-muted-foreground">
                  Stored credentials are write-only. They are never returned by
                  the API or loaded into this page; saving replaces the complete
                  credential set.
                </p>
                {selectedIntegration.status !== "configuration_required" ? (
                  <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                    <span>Stored credentials</span>
                    <span
                      aria-label="Stored credentials are masked"
                      className="font-mono"
                    >
                      ••••••••
                    </span>
                  </div>
                ) : null}
                <div className="space-y-2">
                  <Label htmlFor="configured-integration-target">
                    {selectedDefinition.field}
                  </Label>
                  <Input
                    aria-invalid={
                      selectedProvider === "webhook" &&
                      Boolean(configurationTarget) &&
                      !configurationTargetIsValid
                    }
                    id="configured-integration-target"
                    placeholder={selectedDefinition.placeholder}
                    type={
                      selectedProvider === "webhook" ||
                      selectedProvider === "api"
                        ? "url"
                        : "text"
                    }
                    value={configurationTarget}
                    onChange={(event) =>
                      setConfigurationTarget(event.target.value)
                    }
                  />
                  {selectedProvider === "webhook" &&
                  configurationTarget &&
                  !configurationTargetIsValid ? (
                    <p className="text-xs text-destructive" role="alert">
                      Use a public HTTPS URL without credentials, fragments, or
                      private-network addresses.
                    </p>
                  ) : null}
                </div>
                {(selectedDefinition.additionalSettings || []).map((field) => (
                  <div className="space-y-2" key={field.key}>
                    <Label htmlFor={`configured-integration-${field.key}`}>
                      {field.label}
                    </Label>
                    <Input
                      disabled={configuring}
                      id={`configured-integration-${field.key}`}
                      placeholder={field.placeholder}
                      value={configurationAdditionalSettings[field.key] || ""}
                      onChange={(event) =>
                        setConfigurationAdditionalSettings((current) => ({
                          ...current,
                          [field.key]: event.target.value,
                        }))
                      }
                    />
                  </div>
                ))}
                {selectedProvider === "webhook" ? (
                  <WebhookEvents
                    disabled={configuring}
                    idPrefix="configured-support-webhook-event"
                    onChange={setConfigurationEvents}
                    selected={configurationEvents}
                  />
                ) : null}
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {selectedDefinition.credentialFields.map((field) => (
                    <div className="space-y-2" key={field.key}>
                      <Label htmlFor={`configured-integration-${field.key}`}>
                        New {field.label.toLowerCase()}
                      </Label>
                      <Input
                        autoComplete="new-password"
                        disabled={configuring}
                        id={`configured-integration-${field.key}`}
                        maxLength={field.maxLength}
                        minLength={field.minLength}
                        spellCheck={false}
                        type="password"
                        value={configurationCredentials[field.key] || ""}
                        onChange={(event) =>
                          setConfigurationCredentials((current) => ({
                            ...current,
                            [field.key]: event.target.value,
                          }))
                        }
                      />
                    </div>
                  ))}
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    disabled={configuring}
                    variant="outline"
                    onClick={closeConfiguration}
                  >
                    Cancel
                  </Button>
                  <Button
                    aria-busy={configuring}
                    disabled={
                      configuring ||
                      !configurationTargetIsValid ||
                      !configurationEventsAreValid ||
                      !configurationCredentialsAreValid
                    }
                    onClick={() => void saveConfiguration()}
                  >
                    {configuring ? "Saving…" : "Save securely"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </ModulePage>
  );
}
