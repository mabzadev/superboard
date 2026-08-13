"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Archive,
  CirclePause,
  CirclePlay,
  GitBranch,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Webhook,
} from "lucide-react";
import {
  createMarketingChannelConnector,
  createMarketingJourney,
  deleteMarketingChannelConnector,
  enrollJourneySubscribers,
  getEmailTemplates,
  getJourneyEnrollments,
  getJourneyStatistics,
  getMarketingChannelConnectors,
  getMarketingJourneys,
  transitionMarketingJourney,
  updateMarketingChannelConnector,
  updateMarketingJourney,
  type EmailTemplate,
  type JourneyDefinition,
  type JourneyEnrollment,
  type JourneyStatistics,
  type MarketingChannelConnector,
  type MarketingChannelConnectorInput,
  type MarketingJourney,
  type MarketingJourneyInput,
} from "@/api/marketing/marketingService";
import {
  EmptyProject,
  ModulePage,
  moduleErrorMessage,
} from "@/components/modules/ModulePage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useProjectSelection } from "@/context/useProjectSelection";
import {
  showErrorNotification,
  showSuccessNotification,
} from "@/lib/Notifications";
import { JourneyCanvasEditor } from "./JourneyCanvasEditor";

const emptyDefinition: JourneyDefinition = {
  start_node_id: "exit",
  nodes: [{ id: "exit", type: "exit" }],
  edges: [],
};

export function MarketingJourneysPage() {
  const { selectedProject } = useProjectSelection();
  const [journeys, setJourneys] = useState<MarketingJourney[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [connectors, setConnectors] = useState<MarketingChannelConnector[]>([]);
  const [selected, setSelected] = useState<MarketingJourney | null>(null);
  const [statistics, setStatistics] = useState<JourneyStatistics | null>(null);
  const [enrollments, setEnrollments] = useState<JourneyEnrollment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [eventName, setEventName] = useState("account.created");
  const [reentry, setReentry] =
    useState<MarketingJourney["reentry_policy"]>("once");
  const [builderDefinition, setBuilderDefinition] =
    useState<JourneyDefinition>(emptyDefinition);
  const [advanced, setAdvanced] = useState(false);
  const [triggerText, setTriggerText] = useState(
    JSON.stringify({ event_name: "account.created", conditions: [] }, null, 2)
  );
  const [definitionText, setDefinitionText] = useState(
    JSON.stringify(emptyDefinition, null, 2)
  );
  const [subscriberIds, setSubscriberIds] = useState("");

  const load = useCallback(async () => {
    if (!selectedProject) return;
    try {
      const [journeyItems, templateItems, connectorItems] = await Promise.all([
        getMarketingJourneys(selectedProject.id),
        getEmailTemplates(selectedProject.id),
        getMarketingChannelConnectors(selectedProject.id),
      ]);
      setJourneys(journeyItems);
      setTemplates(templateItems);
      setConnectors(connectorItems);
      setError(null);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    }
  }, [selectedProject]);

  useEffect(() => void load(), [load]);

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setDescription("");
    setEventName("account.created");
    setReentry("once");
    setBuilderDefinition(emptyDefinition);
    setAdvanced(false);
    setTriggerText(
      JSON.stringify({ event_name: "account.created", conditions: [] }, null, 2)
    );
    setDefinitionText(JSON.stringify(emptyDefinition, null, 2));
  };

  const edit = (journey: MarketingJourney) => {
    setEditingId(journey.id);
    setName(journey.name);
    setDescription(journey.description ?? "");
    setEventName(journey.trigger.event_name);
    setReentry(journey.reentry_policy);
    setTriggerText(JSON.stringify(journey.trigger, null, 2));
    setDefinitionText(JSON.stringify(journey.definition, null, 2));
    setBuilderDefinition(journey.definition);
    setAdvanced(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProject) return;
    let payload: MarketingJourneyInput;
    try {
      payload = {
        name: name.trim(),
        description: description.trim() || null,
        reentry_policy: reentry,
        trigger: advanced
          ? (parseObject(
              triggerText,
              "Trigger"
            ) as MarketingJourneyInput["trigger"])
          : { event_name: eventName.trim(), conditions: [] },
        definition: advanced
          ? (parseObject(
              definitionText,
              "Journey definition"
            ) as JourneyDefinition)
          : builderDefinition,
      };
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
      return;
    }
    setBusy(true);
    try {
      if (editingId) {
        await updateMarketingJourney(selectedProject.id, editingId, payload);
        showSuccessNotification("Journey version saved");
      } else {
        await createMarketingJourney(selectedProject.id, payload);
        showSuccessNotification("Journey created");
      }
      resetForm();
      await load();
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const transition = async (
    journey: MarketingJourney,
    actionName: "activate" | "pause" | "resume" | "archive"
  ) => {
    if (!selectedProject) return;
    setBusy(true);
    try {
      await transitionMarketingJourney(
        selectedProject.id,
        journey.id,
        actionName
      );
      showSuccessNotification(`Journey ${actionName}d`);
      await load();
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const inspect = async (journey: MarketingJourney) => {
    if (!selectedProject) return;
    try {
      const [stats, enrolled] = await Promise.all([
        getJourneyStatistics(selectedProject.id, journey.id),
        getJourneyEnrollments(selectedProject.id, journey.id),
      ]);
      setSelected(journey);
      setStatistics(stats);
      setEnrollments(enrolled);
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    }
  };

  const manualEnrollment = async () => {
    if (!selectedProject || !selected) return;
    const ids = subscriberIds
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!ids.length) return;
    setBusy(true);
    try {
      const result = await enrollJourneySubscribers(
        selectedProject.id,
        selected.id,
        ids
      );
      showSuccessNotification(
        `${result.enrolled} of ${result.requested} subscribers enrolled`
      );
      setSubscriberIds("");
      await inspect(selected);
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModulePage
      title="Marketing journeys"
      description="Turn product events into versioned, resumable email and omnichannel customer journeys."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>
                {editingId ? "Edit journey" : "Create journey"}
              </CardTitle>
              <CardDescription>
                Each save creates an immutable version. Active enrollments keep
                the version they entered with.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-5" onSubmit={save}>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Name">
                    <Input
                      required
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="New customer activation"
                    />
                  </Field>
                  <Field label="Event that starts the journey">
                    <Input
                      required
                      disabled={advanced}
                      value={eventName}
                      onChange={(event) => setEventName(event.target.value)}
                      placeholder="account.created"
                    />
                  </Field>
                  <Field label="Description">
                    <Input
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="Welcome and activate a new account"
                    />
                  </Field>
                  <Field label="Repeat entry">
                    <select
                      className={selectClass}
                      value={reentry}
                      onChange={(event) =>
                        setReentry(
                          event.target
                            .value as MarketingJourney["reentry_policy"]
                        )
                      }
                    >
                      <option value="once">Only once</option>
                      <option value="after_completion">After completion</option>
                      <option value="every_event">
                        For every matching event
                      </option>
                    </select>
                  </Field>
                </div>

                {!advanced && (
                  <JourneyCanvasEditor
                    value={builderDefinition}
                    onChange={setBuilderDefinition}
                    templates={templates}
                    connectors={connectors}
                  />
                )}

                <details
                  open={advanced}
                  onToggle={(event) => {
                    const open = event.currentTarget.open;
                    if (open) {
                      setDefinitionText(
                        JSON.stringify(builderDefinition, null, 2)
                      );
                    } else {
                      try {
                        setBuilderDefinition(
                          parseObject(
                            definitionText,
                            "Journey definition"
                          ) as JourneyDefinition
                        );
                      } catch {
                        // Validation feedback remains attached to the save action.
                      }
                    }
                    setAdvanced(open);
                  }}
                  className="rounded-xl border p-4"
                >
                  <summary className="cursor-pointer font-medium">
                    Raw graph JSON (advanced)
                  </summary>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Configure conditions, branches, delays, messages and
                    attribute updates using the full versioned graph format.
                  </p>
                  <div className="mt-4 grid gap-4 xl:grid-cols-2">
                    <Field label="Trigger and conditions">
                      <textarea
                        className={textareaClass}
                        rows={12}
                        value={triggerText}
                        onChange={(event) => setTriggerText(event.target.value)}
                      />
                    </Field>
                    <Field label="Journey graph">
                      <textarea
                        className={textareaClass}
                        rows={12}
                        value={definitionText}
                        onChange={(event) =>
                          setDefinitionText(event.target.value)
                        }
                      />
                    </Field>
                  </div>
                </details>

                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy || !name.trim()} type="submit">
                    <GitBranch className="size-4" />
                    {editingId ? "Save new version" : "Create draft"}
                  </Button>
                  {editingId && (
                    <Button type="button" variant="outline" onClick={resetForm}>
                      Cancel edit
                    </Button>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>Journeys</CardTitle>
                <CardDescription>
                  Event-triggered automation with deduplicated entry and step
                  execution.
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                <RefreshCw className="size-4" /> Refresh
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {journeys.map((journey) => (
                <div key={journey.id} className="rounded-xl border p-4">
                  <div className="flex flex-col justify-between gap-4 lg:flex-row">
                    <button
                      type="button"
                      className="text-left"
                      onClick={() => void inspect(journey)}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{journey.name}</span>
                        <StatusBadge status={journey.status} />
                        <Badge variant="outline">
                          v{journey.current_version}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Starts on {journey.trigger_event_name} ·{" "}
                        {journey.enrollments_total ?? 0} entries
                      </p>
                    </button>
                    <div className="flex flex-wrap gap-2">
                      {journey.status !== "archived" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => edit(journey)}
                        >
                          <Pencil className="size-4" /> Edit
                        </Button>
                      )}
                      {journey.status === "draft" && (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() => void transition(journey, "activate")}
                        >
                          <CirclePlay className="size-4" /> Activate
                        </Button>
                      )}
                      {journey.status === "active" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => void transition(journey, "pause")}
                        >
                          <CirclePause className="size-4" /> Pause
                        </Button>
                      )}
                      {journey.status === "paused" && (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() => void transition(journey, "resume")}
                        >
                          <CirclePlay className="size-4" /> Resume
                        </Button>
                      )}
                      {journey.status !== "archived" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void transition(journey, "archive")}
                        >
                          <Archive className="size-4" /> Archive
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {!journeys.length && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No journeys yet. Create the first draft above.
                </p>
              )}
            </CardContent>
          </Card>

          {selected && statistics && (
            <Card>
              <CardHeader>
                <CardTitle>{selected.name} activity</CardTitle>
                <CardDescription>
                  Latest entries remain pinned to journey version and execution
                  receipts.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {Object.entries(statistics).map(([key, value]) => (
                    <div key={key} className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">
                        {labelize(key)}
                      </p>
                      <p className="text-xl font-semibold tabular-nums">
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
                {selected.status === "active" && (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={subscriberIds}
                      onChange={(event) => setSubscriberIds(event.target.value)}
                      placeholder="Subscriber IDs, separated by commas"
                    />
                    <Button
                      disabled={busy || !subscriberIds.trim()}
                      onClick={() => void manualEnrollment()}
                    >
                      <Send className="size-4" /> Enroll
                    </Button>
                  </div>
                )}
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[680px] text-left text-sm">
                    <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
                      <tr>
                        {[
                          "Subscriber",
                          "Version",
                          "Current step",
                          "Status",
                          "Entered",
                        ].map((column) => (
                          <th key={column} className="px-4 py-3 font-medium">
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {enrollments.map((enrollment) => (
                        <tr key={enrollment.id} className="border-t">
                          <td className="px-4 py-3">
                            {enrollment.email || enrollment.subscriber_id}
                          </td>
                          <td className="px-4 py-3">
                            v{enrollment.journey_version}
                          </td>
                          <td className="px-4 py-3">
                            {enrollment.current_node_id}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="outline">{enrollment.status}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            {formatDate(enrollment.enrolled_at)}
                          </td>
                        </tr>
                      ))}
                      {!enrollments.length && (
                        <tr>
                          <td
                            className="px-4 py-8 text-center text-muted-foreground"
                            colSpan={5}
                          >
                            No subscribers have entered this journey.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </ModulePage>
  );
}

export function MarketingChannelsPage() {
  const { selectedProject } = useProjectSelection();
  const [connectors, setConnectors] = useState<MarketingChannelConnector[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [channel, setChannel] =
    useState<MarketingChannelConnector["channel"]>("webhook");
  const [endpoint, setEndpoint] = useState("");
  const [secret, setSecret] = useState("");
  const [headersText, setHeadersText] = useState("{}");
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedProject) return;
    try {
      setConnectors(await getMarketingChannelConnectors(selectedProject.id));
      setError(null);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    }
  }, [selectedProject]);
  useEffect(() => void load(), [load]);

  const reset = () => {
    setEditingId(null);
    setName("");
    setChannel("webhook");
    setEndpoint("");
    setSecret("");
    setHeadersText("{}");
    setEnabled(true);
  };

  const edit = (connector: MarketingChannelConnector) => {
    setEditingId(connector.id);
    setName(connector.name);
    setChannel(connector.channel);
    setEndpoint(connector.endpoint_url);
    setSecret("");
    setHeadersText(JSON.stringify(connector.headers, null, 2));
    setEnabled(connector.enabled);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProject) return;
    let headers: Record<string, string>;
    try {
      const parsed = parseObject(headersText, "Headers");
      headers = Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [key, String(value)])
      );
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
      return;
    }
    const payload: MarketingChannelConnectorInput = {
      name: name.trim(),
      channel,
      endpoint_url: endpoint.trim(),
      headers,
      enabled,
      ...(secret ? { secret } : {}),
    };
    setBusy(true);
    try {
      if (editingId) {
        await updateMarketingChannelConnector(
          selectedProject.id,
          editingId,
          payload
        );
        showSuccessNotification("Channel updated");
      } else {
        await createMarketingChannelConnector(selectedProject.id, payload);
        showSuccessNotification("Channel created");
      }
      reset();
      await load();
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (connector: MarketingChannelConnector) => {
    if (!selectedProject) return;
    setBusy(true);
    try {
      await deleteMarketingChannelConnector(selectedProject.id, connector.id);
      showSuccessNotification("Channel deleted");
      await load();
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModulePage
      title="Marketing channels"
      description="Connect secure HTTPS destinations for SMS, push, WhatsApp, Slack and custom webhooks."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,420px)_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>
                {editingId ? "Edit channel" : "Add a channel"}
              </CardTitle>
              <CardDescription>
                Secrets are encrypted at rest and never returned by the API.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={save}>
                <Field label="Name">
                  <Input
                    required
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Customer notifications"
                  />
                </Field>
                <Field label="Channel">
                  <select
                    className={selectClass}
                    value={channel}
                    onChange={(event) =>
                      setChannel(
                        event.target
                          .value as MarketingChannelConnector["channel"]
                      )
                    }
                  >
                    <option value="webhook">Webhook</option>
                    <option value="sms">SMS</option>
                    <option value="push">Push</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="slack">Slack</option>
                  </select>
                </Field>
                <Field label="HTTPS destination">
                  <Input
                    required
                    type="url"
                    value={endpoint}
                    onChange={(event) => setEndpoint(event.target.value)}
                    placeholder="https://provider.example/messages"
                  />
                </Field>
                <Field
                  label={
                    editingId
                      ? "New signing secret (optional)"
                      : "Signing secret"
                  }
                >
                  <Input
                    type="password"
                    value={secret}
                    onChange={(event) => setSecret(event.target.value)}
                    autoComplete="new-password"
                  />
                </Field>
                <Field label="Additional request headers">
                  <textarea
                    className={textareaClass}
                    rows={5}
                    value={headersText}
                    onChange={(event) => setHeadersText(event.target.value)}
                  />
                </Field>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <Label htmlFor="connector-enabled">Enabled</Label>
                  <Switch
                    id="connector-enabled"
                    checked={enabled}
                    onCheckedChange={setEnabled}
                  />
                </div>
                <div className="flex gap-2">
                  <Button disabled={busy || !name.trim() || !endpoint.trim()}>
                    <Plus className="size-4" />{" "}
                    {editingId ? "Save" : "Add channel"}
                  </Button>
                  {editingId && (
                    <Button type="button" variant="outline" onClick={reset}>
                      Cancel
                    </Button>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Connected channels</CardTitle>
              <CardDescription>
                Journey deliveries carry an idempotency key and an HMAC
                signature.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {connectors.map((connector) => (
                <div
                  key={connector.id}
                  className="flex flex-col justify-between gap-4 rounded-xl border p-4 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Webhook className="size-4 text-muted-foreground" />
                      <span className="font-semibold">{connector.name}</span>
                      <Badge
                        variant={connector.enabled ? "secondary" : "outline"}
                      >
                        {connector.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {labelize(connector.channel)} · {connector.endpoint_url}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {connector.secret_configured
                        ? "Signed requests"
                        : "Unsigned requests"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => edit(connector)}
                    >
                      <Pencil className="size-4" /> Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${connector.name}`}
                      disabled={busy}
                      onClick={() => void remove(connector)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
              {!connectors.length && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No external channels connected yet.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </ModulePage>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div>{children}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: MarketingJourney["status"] }) {
  return (
    <Badge
      variant={
        status === "active"
          ? "secondary"
          : status === "archived"
            ? "outline"
            : "default"
      }
    >
      {labelize(status)}
    </Badge>
  );
}

function parseObject(value: string, label: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} must contain valid JSON.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function labelize(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

const selectClass =
  "border-input h-10 w-full rounded-[var(--radius-sm)] border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const textareaClass =
  "border-input w-full rounded-[var(--radius-sm)] border bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
