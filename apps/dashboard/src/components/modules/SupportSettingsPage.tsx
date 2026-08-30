"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Bell,
  CheckCheck,
  Clock3,
  DatabaseZap,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import {
  discardSupportDeadLetter,
  getSupportOperationsHealth,
  listSupportDeadLetters,
  replaySupportDeadLetter,
  type SupportDeadLetter,
  type SupportOperationsHealth,
} from "@/api/support/operationsHealthService";
import {
  getSupportSettings,
  updateSupportSettings,
  type SupportProjectSettings,
} from "@/api/support/settingsService";
import {
  deleteSupportNotification,
  getSupportNotifications,
  getSupportNotificationPreferences,
  markAllSupportNotificationsRead,
  markSupportNotificationRead,
  snoozeSupportNotification,
  updateSupportNotificationPreferences,
  type SupportNotification,
  type SupportNotificationPreferences,
} from "@/api/support/operationsService";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProjectSelection } from "@/context/useProjectSelection";
import {
  showErrorNotification,
  showSuccessNotification,
} from "@/lib/Notifications";
import { EmptyProject, ModulePage, moduleErrorMessage } from "./ModulePage";
import {
  AccessNotice,
  SupportEmpty,
  SupportMetric,
  SupportStatus,
} from "@/components/support/SupportUi";

const contentTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/plain",
];
const featureLabels: Record<string, string> = {
  realtime: "Real-time updates",
  csat: "Customer satisfaction",
  proactive_support: "Proactive Support",
  help_center: "Help Center",
  captain: "Captain",
};
const defaults: SupportProjectSettings = {
  business_name: "",
  locale: "en",
  timezone: "UTC",
  date_format: "YYYY-MM-DD",
  auto_resolve_minutes: null,
  attachment_max_bytes: 10 * 1024 * 1024,
  allowed_content_types: [],
  features: {},
};
const notificationDefaults: SupportNotificationPreferences = {
  email_enabled: true,
  push_enabled: true,
  browser_enabled: true,
  in_app_enabled: true,
  audio_enabled: true,
  muted_event_types: [],
};

export default function SupportSettingsPage() {
  const { selectedProject, selectedInstance } = useProjectSelection();
  const projectRef = selectedProject?.id;
  const administrator = new Set(["owner", "admin"]).has(
    selectedInstance?.role || "member"
  );
  const [settings, setSettings] = useState(defaults);
  const [operations, setOperations] = useState<SupportOperationsHealth | null>(
    null
  );
  const [deadLetters, setDeadLetters] = useState<SupportDeadLetter[]>([]);
  const [notifications, setNotifications] = useState<SupportNotification[]>(
    []
  );
  const [notificationPreferences, setNotificationPreferences] = useState(
    notificationDefaults
  );
  const [mutedEvents, setMutedEvents] = useState("");
  const [notificationError, setNotificationError] = useState<string | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    if (!projectRef) return;
    setLoading(true);
    try {
      setSettings((await getSupportSettings(projectRef)).data.settings);
      setError(null);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [projectRef]);
  const loadOperations = useCallback(async () => {
    if (!projectRef || !administrator) return;
    try {
      const [health, letters] = await Promise.all([
        getSupportOperationsHealth(projectRef),
        listSupportDeadLetters(projectRef),
      ]);
      setOperations(health.data);
      setDeadLetters(letters.data);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    }
  }, [administrator, projectRef]);
  const loadNotifications = useCallback(async () => {
    if (!projectRef) return;
    try {
      const [items, preferences] = await Promise.all([
        getSupportNotifications(projectRef),
        getSupportNotificationPreferences(projectRef),
      ]);
      setNotifications(items.data);
      setNotificationPreferences(preferences.data);
      setMutedEvents(preferences.data.muted_event_types.join(", "));
      setNotificationError(null);
    } catch (cause) {
      setNotificationError(moduleErrorMessage(cause));
    }
  }, [projectRef]);
  useEffect(() => void loadSettings(), [loadSettings]);
  useEffect(() => void loadOperations(), [loadOperations]);
  useEffect(() => void loadNotifications(), [loadNotifications]);

  const save = async () => {
    if (!projectRef) return;
    setLoading(true);
    try {
      await updateSupportSettings(projectRef, settings);
      showSuccessNotification("Support settings saved");
      await loadSettings();
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  };

  const toggleContentType = (contentType: string, enabled: boolean) =>
    setSettings((current) => ({
      ...current,
      allowed_content_types: enabled
        ? [...new Set([...current.allowed_content_types, contentType])]
        : current.allowed_content_types.filter((item) => item !== contentType),
    }));

  const resolveDeadLetter = async (
    item: SupportDeadLetter,
    action: "replay" | "discard"
  ) => {
    if (!projectRef) return;
    try {
      if (action === "replay") await replaySupportDeadLetter(projectRef, item.id);
      else await discardSupportDeadLetter(projectRef, item.id);
      showSuccessNotification(action === "replay" ? "Support job replayed" : "Support job discarded");
      await loadOperations();
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    }
  };

  const saveNotificationPreferences = async () => {
    if (!projectRef) return;
    setLoading(true);
    try {
      const muted = [
        ...new Set(
          mutedEvents
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        ),
      ];
      const result = await updateSupportNotificationPreferences(projectRef, {
        ...notificationPreferences,
        muted_event_types: muted,
      });
      setNotificationPreferences(result.data);
      setMutedEvents(result.data.muted_event_types.join(", "));
      showSuccessNotification("Notification preferences saved");
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  };

  const updateNotification = async (
    item: SupportNotification,
    action: "read" | "snooze" | "delete"
  ) => {
    if (!projectRef) return;
    try {
      if (action === "read") {
        await markSupportNotificationRead(projectRef, item.id);
      } else if (action === "snooze") {
        await snoozeSupportNotification(
          projectRef,
          item.id,
          new Date(Date.now() + 60 * 60 * 1000).toISOString()
        );
      } else {
        await deleteSupportNotification(projectRef, item.id);
      }
      await loadNotifications();
      showSuccessNotification(
        action === "read"
          ? "Notification marked as read"
          : action === "snooze"
            ? "Notification snoozed for one hour"
            : "Notification removed"
      );
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    }
  };

  const markAllNotificationsRead = async () => {
    if (!projectRef) return;
    try {
      await markAllSupportNotificationsRead(projectRef);
      await loadNotifications();
      showSuccessNotification("All notifications marked as read");
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    }
  };

  return (
    <ModulePage
      title="Settings"
      description="Project-wide Support behavior, attachments, features and operations."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <Tabs defaultValue="general">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
            <TabsTrigger value="operations">Operations</TabsTrigger>
          </TabsList>
          <TabsContent className="space-y-6" value="general">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Support profile</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Field label="Business name">
                  <Input
                    value={settings.business_name}
                    onChange={(e) =>
                      setSettings((v) => ({
                        ...v,
                        business_name: e.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="Locale">
                  <Input
                    value={settings.locale}
                    onChange={(e) =>
                      setSettings((v) => ({ ...v, locale: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Timezone">
                  <Input
                    value={settings.timezone}
                    onChange={(e) =>
                      setSettings((v) => ({ ...v, timezone: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Date format">
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={settings.date_format}
                    onChange={(e) =>
                      setSettings((v) => ({
                        ...v,
                        date_format: e.target.value,
                      }))
                    }
                  >
                    <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                    <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                    <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                  </select>
                </Field>
                <Field label="Auto-resolve after (minutes)">
                  <Input
                    min={0}
                    type="number"
                    value={settings.auto_resolve_minutes ?? ""}
                    onChange={(e) =>
                      setSettings((v) => ({
                        ...v,
                        auto_resolve_minutes:
                          e.target.value === "" ? null : Number(e.target.value),
                      }))
                    }
                  />
                </Field>
                <Field label="Attachment limit (MB)">
                  <Input
                    min={1}
                    max={100}
                    type="number"
                    value={Math.round(
                      settings.attachment_max_bytes / 1024 / 1024
                    )}
                    onChange={(e) =>
                      setSettings((v) => ({
                        ...v,
                        attachment_max_bytes:
                          Number(e.target.value) * 1024 * 1024,
                      }))
                    }
                  />
                </Field>
              </CardContent>
            </Card>
            <div className="grid gap-6 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Allowed attachments
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {contentTypes.map((type) => (
                    <label
                      className="flex items-center gap-3 text-sm"
                      key={type}
                    >
                      <Checkbox
                        checked={settings.allowed_content_types.includes(type)}
                        onCheckedChange={(checked) =>
                          toggleContentType(type, checked === true)
                        }
                      />
                      {type}
                    </label>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Support capabilities
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {Object.entries(featureLabels).map(([key, label]) => (
                    <div
                      className="flex items-center justify-between gap-4"
                      key={key}
                    >
                      <Label>{label}</Label>
                      <Switch
                        checked={settings.features[key] !== false}
                        onCheckedChange={(enabled) =>
                          setSettings((current) => ({
                            ...current,
                            features: { ...current.features, [key]: enabled },
                          }))
                        }
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
            <div className="flex justify-end">
              <Button disabled={loading} onClick={() => void save()}>
                <Save /> Save settings
              </Button>
            </div>
          </TabsContent>
          <TabsContent className="space-y-6" value="notifications">
            {notificationError ? (
              <AccessNotice>
                {notificationError}. Personal notification controls require an
                active Support membership; project administration remains
                available in the other Settings tabs.
              </AccessNotice>
            ) : (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Bell /> Delivery preferences
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {(
                    [
                      ["email_enabled", "Email"],
                      ["push_enabled", "Mobile push"],
                      ["browser_enabled", "Browser"],
                      ["in_app_enabled", "In-app"],
                      ["audio_enabled", "Notification sounds"],
                    ] as const
                  ).map(([key, label]) => (
                    <div
                      className="flex items-center justify-between gap-4"
                      key={key}
                    >
                      <Label>{label}</Label>
                      <Switch
                        aria-label={label}
                        checked={notificationPreferences[key]}
                        onCheckedChange={(enabled) =>
                          setNotificationPreferences((current) => ({
                            ...current,
                            [key]: enabled,
                          }))
                        }
                      />
                    </div>
                  ))}
                  <Field label="Muted event types">
                    <Input
                      placeholder="assignment.updated, sla.warning"
                      value={mutedEvents}
                      onChange={(event) => setMutedEvents(event.target.value)}
                    />
                  </Field>
                  <p className="text-xs text-muted-foreground">
                    Use comma-separated native Support event names. Muted
                    events remain visible in audit history.
                  </p>
                  <Button
                    className="w-full"
                    disabled={loading}
                    onClick={() => void saveNotificationPreferences()}
                  >
                    <Save /> Save preferences
                  </Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
                    <span>Recent notifications</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void markAllNotificationsRead()}
                    >
                      <CheckCheck /> Read all
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {notifications.length === 0 ? (
                    <SupportEmpty
                      title="No notifications"
                      description="Assignment, SLA and conversation notifications will appear here."
                    />
                  ) : (
                    notifications.map((item) => (
                      <div className="rounded-md border p-3" key={item.id}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-medium">{item.title}</p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {item.body}
                            </p>
                            <p className="mt-2 text-xs text-muted-foreground">
                              {new Date(item.created_at).toLocaleString()} ·{" "}
                              {item.notification_type}
                            </p>
                          </div>
                          <SupportStatus
                            value={item.read_at ? "read" : "unread"}
                          />
                        </div>
                        <div className="mt-3 flex flex-wrap justify-end gap-2">
                          {!item.read_at ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void updateNotification(item, "read")}
                            >
                              <CheckCheck /> Mark read
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void updateNotification(item, "snooze")}
                          >
                            <Clock3 /> Snooze 1 hour
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void updateNotification(item, "delete")}
                          >
                            <Trash2 /> Remove
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
            )}
          </TabsContent>
          <TabsContent className="space-y-6" value="operations">
            {!administrator ? (
              <AccessNotice>
                Operations and delivery diagnostics are available to project
                owners and administrators.
              </AccessNotice>
            ) : (
              <>
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    onClick={() => void loadOperations()}
                  >
                    <RefreshCw /> Refresh diagnostics
                  </Button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <SupportMetric
                    label="Queued jobs"
                    value={total(operations?.queues)}
                  />
                  <SupportMetric
                    label="Dead letters"
                    value={total(operations?.dead_letters)}
                  />
                  <SupportMetric
                    label="Provider events"
                    value={total(operations?.providers)}
                  />
                  <SupportMetric
                    label="Knowledge documents"
                    value={total(operations?.knowledge)}
                  />
                </div>
                <div className="grid gap-6 xl:grid-cols-2">
                  <OperationGroup
                    icon={<Activity />}
                    title="Queues and schedules"
                    rows={operations?.queues ?? []}
                    label={(row) => String(row.queue_name || "Support queue")}
                  />
                  <OperationGroup
                    icon={<DatabaseZap />}
                    title="Indexing and bulk jobs"
                    rows={[
                      ...(operations?.knowledge ?? []),
                      ...(operations?.imports ?? []),
                      ...(operations?.exports ?? []),
                    ]}
                    label={(row) => String(row.status || "queued")}
                  />
                </div>
                <OperationGroup
                  icon={<Activity />}
                  title="Provider diagnostics"
                  rows={operations?.providers ?? []}
                  label={(row) => String(row.provider || "Support provider")}
                />
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Dead-letter quarantine</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {deadLetters.filter((item) => item.status === "quarantined").length === 0 ? (
                      <SupportEmpty
                        title="Quarantine is empty"
                        description="No Support jobs currently require an operator decision."
                      />
                    ) : (
                      deadLetters
                        .filter((item) => item.status === "quarantined")
                        .map((item) => (
                          <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
                            <div>
                              <p className="font-medium">{item.job_type || "Unclassified Support job"}</p>
                              <p className="text-xs text-muted-foreground">
                                {item.source_queue} · {item.attempts} attempts
                              </p>
                            </div>
                            <div className="flex gap-2">
                              {item.replayable ? (
                                <Button size="sm" variant="outline" onClick={() => void resolveDeadLetter(item, "replay")}>
                                  <RotateCcw /> Replay
                                </Button>
                              ) : null}
                              <Button size="sm" variant="ghost" onClick={() => void resolveDeadLetter(item, "discard")}>
                                <Trash2 /> Discard
                              </Button>
                            </div>
                          </div>
                        ))
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>
        </Tabs>
      )}
    </ModulePage>
  );
}

type CountRow = {
  status?: string;
  count: number;
  queue_name?: string;
  provider?: string;
};
function OperationGroup({
  icon,
  title,
  rows,
  label,
}: {
  icon: React.ReactNode;
  title: string;
  rows: CountRow[];
  label: (row: CountRow) => string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 ? (
          <SupportEmpty
            title="Healthy and idle"
            description="No queued or failed work is currently recorded."
          />
        ) : (
          rows.map((row, index) => (
            <div
              className="flex items-center justify-between rounded-md border p-3"
              key={`${label(row)}-${row.status}-${index}`}
            >
              <div>
                <p className="font-medium">{label(row)}</p>
                <SupportStatus value={row.status} />
              </div>
              <strong>{Number(row.count).toLocaleString()}</strong>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
function total(rows?: Array<{ count: number }>) {
  return (rows ?? [])
    .reduce((sum, row) => sum + Number(row.count), 0)
    .toLocaleString();
}
