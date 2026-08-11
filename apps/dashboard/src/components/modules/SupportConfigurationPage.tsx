"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Save, Settings2, Trash2 } from "lucide-react";
import {
  createMessagingConfiguration,
  deleteMessagingConfiguration,
  getMessagingSettings,
  updateMessagingConfiguration,
  updateMessagingSettings,
  rotateSupportWebhookSecret,
  revokeSupportWebhookSecret,
  type MessagingConfigurationEntity,
  type MessagingFieldDefinition,
  type MessagingProjectSettings,
  type MessagingSettingsBootstrap,
} from "@/api/messaging/settingsService";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useProjectSelection } from "@/context/useProjectSelection";
import {
  showErrorNotification,
  showSuccessNotification,
} from "@/lib/Notifications";

type DraftValue = string | boolean;

const defaultSettings: MessagingProjectSettings = {
  business_name: "",
  locale: "en",
  timezone: "UTC",
  date_format: "YYYY-MM-DD",
  auto_resolve_minutes: null,
  attachment_max_bytes: 10 * 1024 * 1024,
  allowed_content_types: [],
  features: {},
};

export default function SupportConfigurationPage() {
  const { selectedProject } = useProjectSelection();
  const projectId = selectedProject?.id;
  const [bootstrap, setBootstrap] = useState<MessagingSettingsBootstrap | null>(
    null
  );
  const [settings, setSettings] =
    useState<MessagingProjectSettings>(defaultSettings);
  const [selectedType, setSelectedType] = useState("inbox");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [position, setPosition] = useState("0");
  const [values, setValues] = useState<Record<string, DraftValue>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [allowedTypes, setAllowedTypes] = useState("");
  const [features, setFeatures] = useState("{}");
  const [webhookSecret, setWebhookSecret] = useState("");

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const result = await getMessagingSettings(projectId);
      setBootstrap(result.data);
      setSettings(result.data.settings);
      setAllowedTypes(result.data.settings.allowed_content_types.join("\n"));
      setFeatures(JSON.stringify(result.data.settings.features, null, 2));
      const firstType = Object.keys(result.data.catalog)[0];
      setSelectedType((current) =>
        current in result.data.catalog ? current : firstType || "inbox"
      );
    } catch (error) {
      showErrorNotification(message(error, "Unable to load Support settings"));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const definition = bootstrap?.catalog[selectedType];
  const entities = useMemo(
    () =>
      bootstrap?.entities.filter(
        (entity) => entity.entity_type === selectedType
      ) || [],
    [bootstrap?.entities, selectedType]
  );

  const startNew = useCallback(
    (type = selectedType) => {
      setSelectedType(type);
      setSelectedId(null);
      setName("");
      setEnabled(true);
      setPosition("0");
      const fields = bootstrap?.catalog[type]?.fields || [];
      setValues(
        Object.fromEntries(
          fields
            .filter((field) => field.type === "boolean")
            .map((field) => [field.key, false])
        )
      );
      setWebhookSecret("");
    },
    [bootstrap?.catalog, selectedType]
  );

  const edit = (entity: MessagingConfigurationEntity) => {
    setSelectedType(entity.entity_type);
    setSelectedId(entity.id);
    setName(entity.name);
    setEnabled(entity.enabled);
    setPosition(String(entity.position));
    const fields = bootstrap?.catalog[entity.entity_type]?.fields || [];
    setValues(
      Object.fromEntries(
        fields.map((field) => [
          field.key,
          displayValue(field, entity.configuration[field.key]),
        ])
      )
    );
    setWebhookSecret("");
  };

  const saveProject = async () => {
    if (!projectId) return;
    setSaving(true);
    try {
      const parsedFeatures = parseObject(features, "Feature flags");
      if (
        Object.values(parsedFeatures).some(
          (value) => typeof value !== "boolean"
        )
      ) {
        throw new Error("Every feature flag must be true or false");
      }
      await updateMessagingSettings(projectId, {
        ...settings,
        auto_resolve_minutes:
          settings.auto_resolve_minutes === null
            ? null
            : Number(settings.auto_resolve_minutes),
        attachment_max_bytes: Number(settings.attachment_max_bytes),
        allowed_content_types: lines(allowedTypes),
        features: parsedFeatures as Record<string, boolean>,
      });
      showSuccessNotification("Support settings saved");
      await load();
    } catch (error) {
      showErrorNotification(message(error, "Unable to save Support settings"));
    } finally {
      setSaving(false);
    }
  };

  const saveEntity = async () => {
    if (!projectId || !definition) return;
    setSaving(true);
    try {
      const configuration = Object.fromEntries(
        definition.fields.flatMap((field) => {
          const parsed = submitValue(field, values[field.key]);
          return parsed === undefined ? [] : [[field.key, parsed]];
        })
      );
      const payload = {
        entity_type: selectedType,
        name: name.trim(),
        enabled,
        position: Number(position || 0),
        configuration,
      };
      if (selectedId)
        await updateMessagingConfiguration(projectId, selectedId, payload);
      else await createMessagingConfiguration(projectId, payload);
      showSuccessNotification(`${definition.label} saved`);
      await load();
      startNew(selectedType);
    } catch (error) {
      showErrorNotification(
        message(error, `Unable to save ${definition.label.toLowerCase()}`)
      );
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!projectId || !selectedId || !definition) return;
    if (
      !window.confirm(
        `Delete this ${definition.label.toLowerCase()}? This action is audited.`
      )
    )
      return;
    setSaving(true);
    try {
      await deleteMessagingConfiguration(projectId, selectedId);
      showSuccessNotification(`${definition.label} deleted`);
      await load();
      startNew(selectedType);
    } catch (error) {
      showErrorNotification(
        message(error, `Unable to delete ${definition.label.toLowerCase()}`)
      );
    } finally {
      setSaving(false);
    }
  };

  const rotateWebhookSecret = async () => {
    if (!projectId || !selectedId || webhookSecret.length < 16) return;
    setSaving(true);
    try {
      await rotateSupportWebhookSecret(projectId, selectedId, webhookSecret);
      setWebhookSecret("");
      showSuccessNotification("Webhook signing secret rotated");
      await load();
    } catch (error) {
      showErrorNotification(
        message(error, "Unable to rotate the webhook signing secret")
      );
    } finally {
      setSaving(false);
    }
  };

  const revokeWebhookSecret = async () => {
    if (
      !projectId ||
      !selectedId ||
      !window.confirm("Revoke this webhook signing secret?")
    )
      return;
    setSaving(true);
    try {
      await revokeSupportWebhookSecret(projectId, selectedId);
      setWebhookSecret("");
      showSuccessNotification("Webhook signing secret revoked");
      await load();
    } catch (error) {
      showErrorNotification(
        message(error, "Unable to revoke the webhook signing secret")
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-full">
      <div className="space-y-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Support configuration</h1>
            <p className="text-sm text-muted-foreground">
              Manage the complete support configuration used by the Inbox and
              FlutterFlow Support library.
            </p>
          </div>
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
        <Alert>
          <Settings2 />
          <AlertTitle>One dashboard, isolated runtime</AlertTitle>
          <AlertDescription>
            Support configuration is stored in the dedicated Support database.
            Agent identities reference the existing authentication gateway, and
            no setting can modify purchase entitlements.
          </AlertDescription>
        </Alert>

        <Card className="space-y-5 p-5">
          <div>
            <h2 className="text-lg font-semibold">Project defaults</h2>
            <p className="text-sm text-muted-foreground">
              Locale, retention behavior, attachment policy, and feature
              switches.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <ProjectField
              label="Business name"
              value={settings.business_name}
              onChange={(value) =>
                setSettings({ ...settings, business_name: value })
              }
            />
            <ProjectField
              label="Locale"
              value={settings.locale}
              onChange={(value) => setSettings({ ...settings, locale: value })}
            />
            <ProjectField
              label="Timezone"
              value={settings.timezone}
              onChange={(value) =>
                setSettings({ ...settings, timezone: value })
              }
            />
            <ProjectField
              label="Date format"
              value={settings.date_format}
              onChange={(value) =>
                setSettings({ ...settings, date_format: value })
              }
            />
            <ProjectField
              label="Auto-resolve after minutes"
              type="number"
              value={
                settings.auto_resolve_minutes == null
                  ? ""
                  : String(settings.auto_resolve_minutes)
              }
              onChange={(value) =>
                setSettings({
                  ...settings,
                  auto_resolve_minutes: value === "" ? null : Number(value),
                })
              }
            />
            <ProjectField
              label="Attachment limit in bytes"
              type="number"
              value={String(settings.attachment_max_bytes)}
              onChange={(value) =>
                setSettings({
                  ...settings,
                  attachment_max_bytes: Number(value),
                })
              }
            />
            <TextAreaField
              label="Allowed content types"
              value={allowedTypes}
              help="One MIME type per line. Leave empty to use the server-safe defaults."
              onChange={setAllowedTypes}
            />
            <TextAreaField
              label="Feature flags (JSON)"
              value={features}
              help="Boolean flags only."
              onChange={setFeatures}
            />
          </div>
          <div className="flex justify-end">
            <Button
              disabled={saving || loading}
              onClick={() => void saveProject()}
            >
              <Save className="mr-2 h-4 w-4" />
              Save project defaults
            </Button>
          </div>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[280px_360px_1fr]">
          <Card className="h-fit overflow-hidden">
            <div className="border-b p-4">
              <h2 className="font-semibold">Configuration areas</h2>
              <p className="text-xs text-muted-foreground">
                Defined by the Support API catalog.
              </p>
            </div>
            <div className="max-h-[720px] overflow-auto p-2">
              {Object.entries(bootstrap?.catalog || {}).map(([type, item]) => {
                const count =
                  bootstrap?.entities.filter(
                    (entity) => entity.entity_type === type
                  ).length || 0;
                return (
                  <button
                    key={type}
                    type="button"
                    className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted ${selectedType === type ? "bg-muted font-medium" : ""}`}
                    onClick={() => startNew(type)}
                  >
                    <span>{item.label}</span>
                    <Badge variant="outline">{count}</Badge>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card className="h-fit overflow-hidden">
            <div className="flex items-start justify-between gap-3 border-b p-4">
              <div>
                <h2 className="font-semibold">
                  {definition?.label || "Configuration"}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {definition?.description}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => startNew()}>
                <Plus className="mr-1 h-4 w-4" />
                New
              </Button>
            </div>
            <div className="max-h-[660px] overflow-auto">
              {entities.map((entity) => (
                <button
                  key={entity.id}
                  type="button"
                  onClick={() => edit(entity)}
                  className={`w-full border-b p-4 text-left hover:bg-muted ${selectedId === entity.id ? "bg-muted" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{entity.name}</span>
                    <Badge variant={entity.enabled ? "secondary" : "outline"}>
                      {entity.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    Updated by {entity.updated_by}
                  </div>
                </button>
              ))}
              {!entities.length && (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No {definition?.label.toLowerCase() || "configuration"} has
                  been created.
                </div>
              )}
            </div>
          </Card>

          <Card className="h-fit space-y-5 p-5">
            <div>
              <h2 className="text-lg font-semibold">
                {selectedId
                  ? `Edit ${definition?.label || "configuration"}`
                  : `New ${definition?.label || "configuration"}`}
              </h2>
              <p className="text-sm text-muted-foreground">
                Fields and accepted values are validated by the Support Worker.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <ProjectField label="Name" value={name} onChange={setName} />
              <ProjectField
                label="Position"
                type="number"
                value={position}
                onChange={setPosition}
              />
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <Label htmlFor="configuration-enabled">Enabled</Label>
                <Switch
                  id="configuration-enabled"
                  checked={enabled}
                  onCheckedChange={setEnabled}
                />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {definition?.fields.map((field) => (
                <ConfigurationField
                  key={field.key}
                  field={field}
                  value={values[field.key]}
                  onChange={(value) =>
                    setValues((current) => ({ ...current, [field.key]: value }))
                  }
                />
              ))}
            </div>
            {selectedType === "webhook" && selectedId && (
              <div className="space-y-3 rounded-md border p-4">
                <div>
                  <h3 className="font-medium">Signing secret</h3>
                  <p className="text-xs text-muted-foreground">
                    Secrets are encrypted by the Support Worker, never returned,
                    and every rotation is audited. Current status:{" "}
                    {entities.find((entity) => entity.id === selectedId)
                      ?.secret_configured
                      ? "configured"
                      : "not configured"}
                    .
                  </p>
                </div>
                <Input
                  type="password"
                  autoComplete="new-password"
                  minLength={16}
                  placeholder="New signing secret (minimum 16 characters)"
                  value={webhookSecret}
                  onChange={(event) => setWebhookSecret(event.target.value)}
                />
                <div className="flex justify-between gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      saving ||
                      !entities.find((entity) => entity.id === selectedId)
                        ?.secret_configured
                    }
                    onClick={() => void revokeWebhookSecret()}
                  >
                    Revoke secret
                  </Button>
                  <Button
                    type="button"
                    disabled={saving || webhookSecret.length < 16}
                    onClick={() => void rotateWebhookSecret()}
                  >
                    {entities.find((entity) => entity.id === selectedId)
                      ?.secret_configured
                      ? "Rotate secret"
                      : "Configure secret"}
                  </Button>
                </div>
              </div>
            )}
            <div className="flex flex-wrap justify-between gap-2">
              <Button
                variant="destructive"
                disabled={!selectedId || saving}
                onClick={() => void remove()}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
              <Button
                disabled={!name.trim() || saving || loading}
                onClick={() => void saveEntity()}
              >
                <Save className="mr-2 h-4 w-4" />
                Save {definition?.label.toLowerCase() || "configuration"}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ConfigurationField({
  field,
  value,
  onChange,
}: {
  field: MessagingFieldDefinition;
  value?: DraftValue;
  onChange: (value: DraftValue) => void;
}) {
  const id = `configuration-${field.key}`;
  if (field.type === "boolean")
    return (
      <div className="flex items-center justify-between rounded-md border px-3 py-2">
        <div>
          <Label htmlFor={id}>{field.label}</Label>
          {field.help && (
            <p className="text-xs text-muted-foreground">{field.help}</p>
          )}
        </div>
        <Switch id={id} checked={value === true} onCheckedChange={onChange} />
      </div>
    );
  if (field.type === "select")
    return (
      <div className="space-y-2">
        <Label htmlFor={id}>
          {field.label}
          {field.required ? " *" : ""}
        </Label>
        <select
          id={id}
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          value={String(value || "")}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Select…</option>
          {field.options?.map((option) => (
            <option key={option} value={option}>
              {humanize(option)}
            </option>
          ))}
        </select>
      </div>
    );
  if (["textarea", "string_list", "json"].includes(field.type))
    return (
      <TextAreaField
        label={`${field.label}${field.required ? " *" : ""}`}
        value={String(value || "")}
        help={
          field.help ||
          (field.type === "string_list"
            ? "One value per line."
            : field.type === "json"
              ? "Valid JSON is required."
              : undefined)
        }
        onChange={onChange}
      />
    );
  return (
    <ProjectField
      label={`${field.label}${field.required ? " *" : ""}`}
      type={field.type === "number" ? "number" : "text"}
      value={String(value || "")}
      help={field.help}
      onChange={onChange}
    />
  );
}

function ProjectField({
  label,
  value,
  onChange,
  type = "text",
  help,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  help?: string;
}) {
  const id = `field-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  help,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  help?: string;
}) {
  const id = `field-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <textarea
        id={id}
        className="min-h-24 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

function displayValue(
  field: MessagingFieldDefinition,
  value: unknown
): DraftValue {
  if (field.type === "boolean") return value === true;
  if (field.type === "json")
    return value == null ? "" : JSON.stringify(value, null, 2);
  if (field.type === "string_list")
    return Array.isArray(value) ? value.map(String).join("\n") : "";
  return value == null ? "" : String(value);
}

function submitValue(
  field: MessagingFieldDefinition,
  value: DraftValue | undefined
): unknown {
  if (field.type === "boolean") return value === true;
  const text = String(value || "").trim();
  if (!text) return undefined;
  if (field.type === "number") return Number(text);
  if (field.type === "string_list") return lines(text);
  if (field.type === "json") return JSON.parse(text) as unknown;
  return text;
}

function lines(value: string) {
  return [
    ...new Set(
      value
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ];
}
function parseObject(value: string, label: string) {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error(`${label} must be a JSON object`);
  return parsed as Record<string, unknown>;
}
function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}
function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
