"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Activity,
  AlertTriangle,
  AppWindow,
  BellRing,
  CheckCircle2,
  Clock3,
  Gauge,
  Globe2,
  LayoutDashboard,
  MapPin,
  MonitorSmartphone,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Star,
  Trash2,
  Webhook,
  Wifi,
  XCircle,
} from "lucide-react";
import {
  createAnalyticsAlert,
  createAnalyticsAnnotation,
  createAnalyticsCohort,
  createAnalyticsDashboard,
  createAnalyticsDashboardWidget,
  createAnalyticsHook,
  deleteAnalyticsAlert,
  deleteAnalyticsAnnotation,
  deleteAnalyticsCohort,
  deleteAnalyticsDashboard,
  deleteAnalyticsDashboardWidget,
  deleteAnalyticsHook,
  deleteAnalyticsRemoteConfig,
  evaluateAnalyticsCohort,
  getAnalyticsAlerts,
  getAnalyticsAnnotations,
  getAnalyticsApplications,
  getAnalyticsCohorts,
  getAnalyticsCrash,
  getAnalyticsCrashes,
  getAnalyticsDashboard,
  getAnalyticsDashboards,
  getAnalyticsDimensions,
  getAnalyticsFeedback,
  getAnalyticsHooks,
  getAnalyticsProfiles,
  getAnalyticsRemoteConfig,
  getAnalyticsSessions,
  getAnalyticsSettings,
  getAnalyticsViews,
  updateAnalyticsAlertIncident,
  updateAnalyticsApplication,
  updateAnalyticsCrash,
  updateAnalyticsSettings,
  upsertAnalyticsRemoteConfig,
  type AnalyticsAlert,
  type AnalyticsAlertIncident,
  type AnalyticsAnnotation,
  type AnalyticsApplication,
  type AnalyticsCohort,
  type AnalyticsCrash,
  type AnalyticsDashboard,
  type AnalyticsDashboardWidget,
  type AnalyticsDimensionValue,
  type AnalyticsFeedback,
  type AnalyticsHook,
  type AnalyticsProfile,
  type AnalyticsRemoteConfig,
  type AnalyticsSession,
  type AnalyticsSettings,
  type AnalyticsView,
} from "@/api/analytics/analyticsService";
import {
  EmptyProject,
  ModulePage,
  moduleErrorMessage,
} from "@/components/modules/ModulePage";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProjectSelection } from "@/context/useProjectSelection";
import {
  showErrorNotification,
  showSuccessNotification,
} from "@/lib/Notifications";

const range30Days = () => {
  const to = new Date();
  return {
    from: new Date(to.getTime() - 29 * 86_400_000).toISOString(),
    to: to.toISOString(),
  };
};

export function AnalyticsDashboardsPage() {
  const { selectedProject } = useProjectSelection();
  const [items, setItems] = useState<AnalyticsDashboard[]>([]);
  const [selected, setSelected] = useState<AnalyticsDashboard | null>(null);
  const [name, setName] = useState("");
  const [widgetTitle, setWidgetTitle] = useState("");
  const [widgetType, setWidgetType] =
    useState<AnalyticsDashboardWidget["widget_type"]>("metric");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!selectedProject) return;
    try {
      const dashboards = await getAnalyticsDashboards(selectedProject.id);
      setItems(dashboards.items);
      const wanted = selected?.id ?? dashboards.items[0]?.id;
      setSelected(
        wanted ? await getAnalyticsDashboard(selectedProject.id, wanted) : null
      );
      setError(null);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    }
  }, [selected?.id, selectedProject]);
  useEffect(() => void load(), [load]);

  const mutate = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await action();
      showSuccessNotification(message);
      await load();
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModulePage
      title="Dashboards"
      description="Build project dashboards from reusable product, revenue, stability and audience widgets."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-base">Your dashboards</CardTitle>
              <CardDescription>
                Private or shared with this project.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Product pulse"
                />
                <Button
                  size="icon"
                  disabled={busy || !name.trim()}
                  aria-label="Create dashboard"
                  onClick={() =>
                    void mutate(async () => {
                      const created = await createAnalyticsDashboard(
                        selectedProject.id,
                        {
                          name: name.trim(),
                          visibility: "project",
                          description: "Shared analytics dashboard",
                          layout: { columns: 12 },
                        }
                      );
                      setName("");
                      setSelected(created);
                    }, "Dashboard created")
                  }
                >
                  <Plus className="size-4" />
                </Button>
              </div>
              <div className="space-y-1">
                {items.map((dashboard) => (
                  <button
                    type="button"
                    key={dashboard.id}
                    className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      selected?.id === dashboard.id
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/60"
                    }`}
                    onClick={() =>
                      void getAnalyticsDashboard(
                        selectedProject.id,
                        dashboard.id
                      )
                        .then(setSelected)
                        .catch((cause: unknown) =>
                          showErrorNotification(moduleErrorMessage(cause))
                        )
                    }
                  >
                    <span className="block truncate font-medium">
                      {dashboard.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {dashboard.widget_count} widgets · {dashboard.visibility}
                    </span>
                  </button>
                ))}
                {!items.length && (
                  <EmptyState compact>Create your first dashboard.</EmptyState>
                )}
              </div>
            </CardContent>
          </Card>

          {selected ? (
            <div className="space-y-5">
              <Card>
                <CardHeader className="flex-row items-start justify-between gap-4">
                  <div>
                    <CardTitle>{selected.name}</CardTitle>
                    <CardDescription>
                      {selected.description || "Custom analytics workspace"}
                    </CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete dashboard"
                    disabled={busy}
                    onClick={() =>
                      void mutate(async () => {
                        await deleteAnalyticsDashboard(
                          selectedProject.id,
                          selected.id
                        );
                        setSelected(null);
                      }, "Dashboard deleted")
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-[180px_1fr_auto]">
                  <Select
                    value={widgetType}
                    onValueChange={(value) =>
                      setWidgetType(
                        value as AnalyticsDashboardWidget["widget_type"]
                      )
                    }
                  >
                    <SelectTrigger aria-label="Widget type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[
                        "metric",
                        "timeseries",
                        "event",
                        "funnel",
                        "retention",
                        "table",
                        "map",
                        "crashes",
                        "views",
                        "purchases",
                        "installations",
                      ].map((type) => (
                        <SelectItem key={type} value={type}>
                          {labelize(type)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={widgetTitle}
                    onChange={(event) => setWidgetTitle(event.target.value)}
                    placeholder="Widget title"
                  />
                  <Button
                    disabled={busy || !widgetTitle.trim()}
                    onClick={() =>
                      void mutate(async () => {
                        await createAnalyticsDashboardWidget(
                          selectedProject.id,
                          selected.id,
                          {
                            widget_type: widgetType,
                            title: widgetTitle.trim(),
                            definition: { range_days: 30 },
                            position: { width: 6, height: 3 },
                          }
                        );
                        setWidgetTitle("");
                      }, "Widget added")
                    }
                  >
                    <Plus className="size-4" /> Add widget
                  </Button>
                </CardContent>
              </Card>
              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {(selected.widgets ?? []).map((widget) => (
                  <Card key={widget.id} className="min-h-44">
                    <CardHeader className="flex-row items-start justify-between gap-3">
                      <div>
                        <Badge variant="outline">
                          {labelize(widget.widget_type)}
                        </Badge>
                        <CardTitle className="mt-3 text-base">
                          {widget.title}
                        </CardTitle>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${widget.title}`}
                        onClick={() =>
                          void mutate(
                            () =>
                              deleteAnalyticsDashboardWidget(
                                selectedProject.id,
                                selected.id,
                                widget.id
                              ),
                            "Widget deleted"
                          )
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </CardHeader>
                    <CardContent>
                      <WidgetPreview type={widget.widget_type} />
                    </CardContent>
                  </Card>
                ))}
              </div>
              {!selected.widgets?.length && (
                <EmptyState>
                  Add widgets above to reproduce the dashboard workflow with
                  SuperBoard data.
                </EmptyState>
              )}
            </div>
          ) : (
            <EmptyState>Select or create a dashboard.</EmptyState>
          )}
        </div>
      )}
    </ModulePage>
  );
}

export function AnalyticsUsersPage() {
  const { selectedProject } = useProjectSelection();
  const range = useMemo(() => range30Days(), []);
  const [sessions, setSessions] = useState<AnalyticsSession[]>([]);
  const [profiles, setProfiles] = useState<AnalyticsProfile[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedProject) return;
    void Promise.all([
      getAnalyticsSessions(selectedProject.id, range),
      getAnalyticsProfiles(selectedProject.id),
    ])
      .then(([sessionData, profileData]) => {
        setSessions(sessionData.items);
        setProfiles(profileData.items);
        setError(null);
      })
      .catch((cause: unknown) => setError(moduleErrorMessage(cause)));
  }, [range, selectedProject]);
  return (
    <ModulePage
      title="Users & sessions"
      description="Explore pseudonymized profiles and session timelines without exposing raw SDK identifiers."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <Tabs defaultValue="sessions" className="space-y-4">
          <TabsList>
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
            <TabsTrigger value="profiles">User profiles</TabsTrigger>
          </TabsList>
          <TabsContent value="sessions">
            <Card>
              <CardHeader>
                <CardTitle>Recent sessions</CardTitle>
                <CardDescription>
                  Session duration and event depth over the last 30 days.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FeatureTable
                  columns={[
                    "Started",
                    "Application",
                    "Platform",
                    "Events",
                    "Duration",
                    "Profile",
                  ]}
                  empty="No sessions in this period."
                >
                  {sessions.map((session) => (
                    <tr key={session.id} className="border-b last:border-0">
                      <Cell>{date(session.started_at)}</Cell>
                      <Cell>{session.application_id}</Cell>
                      <Cell>{session.platform || "—"}</Cell>
                      <Cell>{numberFormat(session.event_count)}</Cell>
                      <Cell>{duration(session.duration_seconds)}</Cell>
                      <Cell mono>{shortId(session.profile_id)}</Cell>
                    </tr>
                  ))}
                </FeatureTable>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="profiles">
            <Card>
              <CardHeader>
                <CardTitle>Pseudonymized profiles</CardTitle>
                <CardDescription>
                  Identity aliases are hashed before they reach Analytics.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FeatureTable
                  columns={[
                    "Last seen",
                    "Application",
                    "Profile",
                    "Properties",
                  ]}
                  empty="No profiles have been resolved yet."
                >
                  {profiles.map((profile) => (
                    <tr key={profile.id} className="border-b last:border-0">
                      <Cell>{date(profile.last_seen_at)}</Cell>
                      <Cell>{profile.application_id}</Cell>
                      <Cell mono>{shortId(profile.id)}</Cell>
                      <Cell>
                        <code className="block max-w-80 truncate text-xs">
                          {JSON.stringify(profile.properties)}
                        </code>
                      </Cell>
                    </tr>
                  ))}
                </FeatureTable>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </ModulePage>
  );
}

export function AnalyticsViewsPage() {
  const { selectedProject } = useProjectSelection();
  const range = useMemo(() => range30Days(), []);
  const [items, setItems] = useState<AnalyticsView[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedProject) return;
    void getAnalyticsViews(selectedProject.id, range)
      .then((result) => {
        setItems(result.items);
        setError(null);
      })
      .catch((cause: unknown) => setError(moduleErrorMessage(cause)));
  }, [range, selectedProject]);
  const total = items.reduce((sum, item) => sum + Number(item.views), 0);
  return (
    <ModulePage
      title="Views"
      description="Page and screen performance, visit depth and time spent across web and mobile applications."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-3">
            <FeatureMetric
              icon={AppWindow}
              label="Tracked views"
              value={total}
            />
            <FeatureMetric
              icon={Globe2}
              label="Unique screens"
              value={items.length}
            />
            <FeatureMetric
              icon={Clock3}
              label="Average time"
              text={duration(
                Math.round(
                  items.reduce(
                    (sum, item) => sum + Number(item.average_duration_seconds),
                    0
                  ) / Math.max(1, items.length)
                )
              )}
            />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Top views</CardTitle>
              <CardDescription>
                Last 30 days, ordered by volume.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FeatureTable
                columns={[
                  "View",
                  "URL",
                  "Views",
                  "Sessions",
                  "Avg. time",
                  "Last seen",
                ]}
                empty="Send view.opened, screen.viewed or [CLY]_view events to populate this report."
              >
                {items.map((item) => (
                  <tr key={item.view_name} className="border-b last:border-0">
                    <Cell strong>{item.view_name}</Cell>
                    <Cell mono>{item.view_url || "—"}</Cell>
                    <Cell>{numberFormat(item.views)}</Cell>
                    <Cell>{numberFormat(item.sessions)}</Cell>
                    <Cell>{duration(item.average_duration_seconds)}</Cell>
                    <Cell>{date(item.last_seen_at)}</Cell>
                  </tr>
                ))}
              </FeatureTable>
            </CardContent>
          </Card>
        </div>
      )}
    </ModulePage>
  );
}

export function AnalyticsDimensionsPage() {
  const { selectedProject } = useProjectSelection();
  const range = useMemo(() => range30Days(), []);
  const [dimensions, setDimensions] = useState<
    Record<string, AnalyticsDimensionValue[]>
  >({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedProject) return;
    void getAnalyticsDimensions(selectedProject.id, range)
      .then((result) => {
        setDimensions(result.dimensions);
        setError(null);
      })
      .catch((cause: unknown) => setError(moduleErrorMessage(cause)));
  }, [range, selectedProject]);
  const groups = [
    {
      title: "Platforms & versions",
      icon: MonitorSmartphone,
      keys: ["platform", "app_version", "os_version", "device", "device_type"],
    },
    {
      title: "Web technology",
      icon: Globe2,
      keys: ["browser", "browser_version", "screen_resolution"],
    },
    {
      title: "Locations",
      icon: MapPin,
      keys: ["country_code", "city", "carrier"],
    },
    {
      title: "Acquisition & connection",
      icon: Wifi,
      keys: ["connection_type", "campaign", "acquisition_source"],
    },
  ];
  return (
    <ModulePage
      title="Technology & location"
      description="Compare application versions, devices, browsers, countries, carriers and acquisition context."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {groups.map(({ title, icon: Icon, keys }) => (
            <Card key={title}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Icon className="size-5 text-primary" /> {title}
                </CardTitle>
                <CardDescription>
                  Top values over the last 30 days.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue={keys[0]}>
                  <TabsList className="h-auto flex-wrap">
                    {keys.map((key) => (
                      <TabsTrigger key={key} value={key}>
                        {labelize(key)}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {keys.map((key) => (
                    <TabsContent
                      key={key}
                      value={key}
                      className="space-y-2 pt-2"
                    >
                      {(dimensions[key] ?? [])
                        .slice(0, 10)
                        .map((item, index) => {
                          const maximum = Number(
                            dimensions[key]?.[0]?.events ?? 1
                          );
                          return (
                            <div key={item.value} className="space-y-1.5">
                              <div className="flex items-center justify-between gap-3 text-sm">
                                <span className="truncate">
                                  <span className="mr-2 text-xs text-muted-foreground">
                                    {index + 1}
                                  </span>
                                  {item.value}
                                </span>
                                <span className="shrink-0 tabular-nums text-muted-foreground">
                                  {numberFormat(item.users)} users ·{" "}
                                  {numberFormat(item.events)} events
                                </span>
                              </div>
                              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                <div
                                  className="h-full rounded-full bg-primary"
                                  style={{
                                    width: `${Math.max(2, (Number(item.events) / maximum) * 100)}%`,
                                  }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      {!dimensions[key]?.length && (
                        <EmptyState compact>
                          No {labelize(key).toLowerCase()} data.
                        </EmptyState>
                      )}
                    </TabsContent>
                  ))}
                </Tabs>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </ModulePage>
  );
}

export function AnalyticsCrashesPage() {
  const { selectedProject } = useProjectSelection();
  const [items, setItems] = useState<AnalyticsCrash[]>([]);
  const [selected, setSelected] = useState<AnalyticsCrash | null>(null);
  const [status, setStatus] = useState("open");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!selectedProject) return;
    try {
      const result = await getAnalyticsCrashes(selectedProject.id, {
        resolved: status === "all" ? undefined : String(status === "resolved"),
      });
      setItems(result.items);
      setError(null);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    }
  }, [selectedProject, status]);
  useEffect(() => void load(), [load]);
  const open = async (item: AnalyticsCrash) => {
    if (!selectedProject) return;
    try {
      setSelected(
        await getAnalyticsCrash(selectedProject.id, item.fingerprint)
      );
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    }
  };
  const resolve = async (resolved: boolean) => {
    if (!selectedProject || !selected) return;
    try {
      await updateAnalyticsCrash(selectedProject.id, selected.fingerprint, {
        resolved,
      });
      showSuccessNotification(resolved ? "Crash resolved" : "Crash reopened");
      setSelected(null);
      await load();
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    }
  };
  return (
    <ModulePage
      title="Crashes"
      description="Group recurring errors by deterministic fingerprint, inspect occurrences and manage resolution."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-4">
              <div>
                <CardTitle>Crash groups</CardTitle>
                <CardDescription>
                  Fatal and non-fatal SDK reports.
                </CardDescription>
              </div>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-36" aria-label="Crash status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              <FeatureTable
                columns={["Crash", "Impact", "Version", "Last seen", "Status"]}
                empty="No crash groups match this filter."
              >
                {items.map((item) => (
                  <tr
                    key={`${item.application_id}:${item.fingerprint}`}
                    className="cursor-pointer border-b hover:bg-muted/40 last:border-0"
                    onClick={() => void open(item)}
                  >
                    <Cell>
                      <div className="flex items-center gap-2 font-medium">
                        {item.fatal && (
                          <AlertTriangle className="size-4 text-destructive" />
                        )}
                        {item.title}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {shortId(item.fingerprint)}
                      </div>
                    </Cell>
                    <Cell>
                      {numberFormat(item.occurrence_count)} occurrences ·{" "}
                      {numberFormat(item.affected_profiles)} users
                    </Cell>
                    <Cell>{item.last_app_version || "—"}</Cell>
                    <Cell>{date(item.last_seen_at)}</Cell>
                    <Cell>
                      <StatusBadge
                        ok={item.resolved}
                        okText="Resolved"
                        badText="Open"
                      />
                    </Cell>
                  </tr>
                ))}
              </FeatureTable>
            </CardContent>
          </Card>
          <Card className="h-fit xl:sticky xl:top-5">
            <CardHeader>
              <CardTitle className="text-base">
                {selected?.title || "Crash details"}
              </CardTitle>
              <CardDescription>
                {selected
                  ? `${selected.occurrence_count} occurrences since ${date(selected.first_seen_at)}`
                  : "Select a group to inspect its latest stack traces."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {selected ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">
                      {selected.last_platform || "unknown platform"}
                    </Badge>
                    <Badge variant="outline">
                      {selected.last_app_version || "unknown version"}
                    </Badge>
                    {selected.fatal && (
                      <Badge variant="destructive">Fatal</Badge>
                    )}
                  </div>
                  {(selected.occurrences ?? [])
                    .slice(0, 5)
                    .map((occurrence) => (
                      <div
                        key={occurrence.id}
                        className="rounded-lg border p-3"
                      >
                        <div className="text-xs text-muted-foreground">
                          {date(occurrence.occurred_at)}
                        </div>
                        <div className="mt-1 text-sm">
                          {occurrence.message || selected.title}
                        </div>
                        {occurrence.stack && (
                          <pre className="mt-2 max-h-32 overflow-auto rounded bg-muted p-2 text-xs">
                            {occurrence.stack}
                          </pre>
                        )}
                      </div>
                    ))}
                  <Button
                    className="w-full"
                    onClick={() => void resolve(!selected.resolved)}
                  >
                    {selected.resolved ? (
                      <RefreshCw className="size-4" />
                    ) : (
                      <CheckCircle2 className="size-4" />
                    )}
                    {selected.resolved ? "Reopen group" : "Mark as resolved"}
                  </Button>
                </>
              ) : (
                <EmptyState compact>No crash selected.</EmptyState>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </ModulePage>
  );
}

export function AnalyticsFeedbackPage() {
  const { selectedProject } = useProjectSelection();
  const [items, setItems] = useState<AnalyticsFeedback[]>([]);
  const [summary, setSummary] = useState({
    responses: 0,
    average_rating: null as number | null,
    positive: 0,
    negative: 0,
  });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedProject) return;
    void getAnalyticsFeedback(selectedProject.id)
      .then((result) => {
        setItems(result.items);
        setSummary(result.summary);
        setError(null);
      })
      .catch((cause: unknown) => setError(moduleErrorMessage(cause)));
  }, [selectedProject]);
  return (
    <ModulePage
      title="Feedback"
      description="Review star ratings and written feedback captured from web and mobile experiences."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <FeatureMetric
              icon={Star}
              label="Average rating"
              text={
                summary.average_rating == null
                  ? "—"
                  : `${summary.average_rating.toFixed(1)} / 5`
              }
            />
            <FeatureMetric
              icon={Activity}
              label="Responses"
              value={summary.responses}
            />
            <FeatureMetric
              icon={CheckCircle2}
              label="Positive"
              value={summary.positive}
            />
            <FeatureMetric
              icon={XCircle}
              label="Critical"
              value={summary.negative}
            />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Recent responses</CardTitle>
              <CardDescription>
                Ratings of 4–5 are positive; 1–2 require attention.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FeatureTable
                columns={[
                  "Rating",
                  "Comment",
                  "Application",
                  "Widget",
                  "Submitted",
                ]}
                empty="No feedback has been submitted yet."
              >
                {items.map((item) => (
                  <tr key={item.id} className="border-b last:border-0">
                    <Cell>
                      <span className="inline-flex items-center gap-1 font-medium">
                        <Star className="size-4 fill-amber-400 text-amber-400" />
                        {item.rating ?? "—"}
                      </span>
                    </Cell>
                    <Cell>{item.comment || "No comment"}</Cell>
                    <Cell>{item.application_id}</Cell>
                    <Cell mono>{item.widget_id || "—"}</Cell>
                    <Cell>{date(item.occurred_at)}</Cell>
                  </tr>
                ))}
              </FeatureTable>
            </CardContent>
          </Card>
        </div>
      )}
    </ModulePage>
  );
}

export function AnalyticsCohortsPage() {
  const { selectedProject } = useProjectSelection();
  const [items, setItems] = useState<AnalyticsCohort[]>([]);
  const [name, setName] = useState("");
  const [eventName, setEventName] = useState("");
  const [days, setDays] = useState("30");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!selectedProject) return;
    try {
      setItems((await getAnalyticsCohorts(selectedProject.id)).items);
      setError(null);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    }
  }, [selectedProject]);
  useEffect(() => void load(), [load]);
  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await action();
      showSuccessNotification(message);
      await load();
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ModulePage
      title="Cohorts"
      description="Define reusable audiences from behavior and keep their estimated size current."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-base">New behavioral cohort</CardTitle>
              <CardDescription>
                Users who performed an event in a rolling window.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Name">
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Recently activated"
                />
              </Field>
              <Field label="Event">
                <Input
                  value={eventName}
                  onChange={(event) => setEventName(event.target.value)}
                  placeholder="account.activated"
                />
              </Field>
              <Field label="Lookback days">
                <Input
                  type="number"
                  min={1}
                  max={366}
                  value={days}
                  onChange={(event) => setDays(event.target.value)}
                />
              </Field>
              <Button
                className="w-full"
                disabled={busy || !name.trim() || !eventName.trim()}
                onClick={() =>
                  void run(async () => {
                    await createAnalyticsCohort(selectedProject.id, {
                      name: name.trim(),
                      definition: {
                        event_name: eventName.trim(),
                        days: Number(days),
                      },
                      enabled: true,
                    });
                    setName("");
                    setEventName("");
                  }, "Cohort created")
                }
              >
                <Plus className="size-4" /> Create cohort
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Saved cohorts</CardTitle>
              <CardDescription>
                Evaluate on demand before using a cohort in journeys or reports.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {items.map((cohort) => (
                <div
                  key={cohort.id}
                  className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{cohort.name}</span>
                      <StatusBadge
                        ok={cohort.enabled}
                        okText="Active"
                        badText="Paused"
                      />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {numberFormat(cohort.estimated_size)} estimated users ·{" "}
                      {String(cohort.definition.event_name)} in{" "}
                      {String(cohort.definition.days)} days
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {cohort.last_evaluated_at
                        ? `Evaluated ${date(cohort.last_evaluated_at)}`
                        : "Not evaluated yet"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            evaluateAnalyticsCohort(
                              selectedProject.id,
                              cohort.id
                            ),
                          "Cohort evaluated"
                        )
                      }
                    >
                      <RefreshCw className="size-4" /> Evaluate
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${cohort.name}`}
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            deleteAnalyticsCohort(
                              selectedProject.id,
                              cohort.id
                            ),
                          "Cohort deleted"
                        )
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
              {!items.length && (
                <EmptyState compact>No cohorts yet.</EmptyState>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </ModulePage>
  );
}

export function AnalyticsRemoteConfigPage() {
  const { selectedProject, projectType } = useProjectSelection();
  const environment =
    projectType.toLowerCase() === "test" ? "test" : "production";
  const [items, setItems] = useState<AnalyticsRemoteConfig[]>([]);
  const [key, setKey] = useState("");
  const [value, setValue] = useState('{\n  "enabled": true\n}');
  const [rollout, setRollout] = useState("100");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!selectedProject) return;
    try {
      setItems((await getAnalyticsRemoteConfig(selectedProject.id)).items);
      setError(null);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    }
  }, [selectedProject]);
  useEffect(() => void load(), [load]);
  const save = async () => {
    if (!selectedProject) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      showErrorNotification("The configuration value must be valid JSON.");
      return;
    }
    setBusy(true);
    try {
      await upsertAnalyticsRemoteConfig(selectedProject.id, key.trim(), {
        environment,
        value: parsed,
        conditions: [{ rollout_percentage: Number(rollout) }],
        enabled: true,
      });
      showSuccessNotification("Remote configuration published");
      setKey("");
      await load();
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ModulePage
      title="Remote Config"
      description="Publish versioned JSON values with deterministic rollouts for the selected environment."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="space-y-5">
          <Alert>
            <ShieldCheck className="size-4" />
            <AlertTitle>Stable assignments</AlertTitle>
            <AlertDescription>
              Rollout buckets are computed from a pseudonymous identity, project
              and key. The same installation always receives the same result.
            </AlertDescription>
          </Alert>
          <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
            <Card className="h-fit">
              <CardHeader>
                <CardTitle className="text-base">Publish parameter</CardTitle>
                <CardDescription>
                  Environment: <Badge variant="outline">{environment}</Badge>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field label="Parameter key">
                  <Input
                    value={key}
                    onChange={(event) => setKey(event.target.value)}
                    placeholder="checkout_banner"
                  />
                </Field>
                <Field label="JSON value">
                  <textarea
                    className="min-h-36 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                  />
                </Field>
                <Field label={`Rollout · ${rollout}%`}>
                  <Input
                    type="range"
                    min={0}
                    max={100}
                    value={rollout}
                    onChange={(event) => setRollout(event.target.value)}
                  />
                </Field>
                <Button
                  className="w-full"
                  disabled={busy || !key.trim()}
                  onClick={() => void save()}
                >
                  <Save className="size-4" /> Publish
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Parameters</CardTitle>
                <CardDescription>
                  Each update increments an immutable client-visible version.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {items.map((item) => (
                  <div key={item.id} className="rounded-xl border p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="font-semibold">
                            {item.config_key}
                          </code>
                          <Badge variant="outline">v{item.version}</Badge>
                          <Badge variant="secondary">{item.environment}</Badge>
                          <StatusBadge
                            ok={item.enabled}
                            okText="Live"
                            badText="Disabled"
                          />
                        </div>
                        <pre className="mt-3 max-h-36 overflow-auto rounded-lg bg-muted/60 p-3 text-xs">
                          {JSON.stringify(item.value, null, 2)}
                        </pre>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${item.config_key}`}
                        onClick={() =>
                          void deleteAnalyticsRemoteConfig(
                            selectedProject.id,
                            item.config_key,
                            item.environment
                          )
                            .then(load)
                            .then(() =>
                              showSuccessNotification("Parameter deleted")
                            )
                            .catch((cause: unknown) =>
                              showErrorNotification(moduleErrorMessage(cause))
                            )
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                ))}
                {!items.length && (
                  <EmptyState compact>
                    No remote parameters published.
                  </EmptyState>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </ModulePage>
  );
}

export function AnalyticsAlertsPage() {
  const { selectedProject } = useProjectSelection();
  const [items, setItems] = useState<AnalyticsAlert[]>([]);
  const [incidents, setIncidents] = useState<AnalyticsAlertIncident[]>([]);
  const [name, setName] = useState("");
  const [type, setType] = useState<AnalyticsAlert["alert_type"]>("crash_spike");
  const [threshold, setThreshold] = useState("10");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!selectedProject) return;
    try {
      const result = await getAnalyticsAlerts(selectedProject.id);
      setItems(result.items);
      setIncidents(result.incidents);
      setError(null);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    }
  }, [selectedProject]);
  useEffect(() => void load(), [load]);
  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await action();
      showSuccessNotification(message);
      await load();
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const definition = () => {
    if (type === "purchase_drop" || type === "installation_drop")
      return { window_minutes: 60, drop_percentage: Number(threshold) };
    if (type === "no_data") return { window_minutes: Number(threshold) };
    return {
      window_minutes: 60,
      threshold: Number(threshold),
      operator: "gte",
    };
  };
  return (
    <ModulePage
      title="Alerts"
      description="Continuously evaluate product, crash, installation and verified-payment signals at the edge."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <Tabs defaultValue="rules" className="space-y-4">
          <TabsList>
            <TabsTrigger value="rules">Alert rules</TabsTrigger>
            <TabsTrigger value="incidents">
              Incidents{" "}
              <Badge className="ml-2" variant="secondary">
                {incidents.filter((item) => item.status !== "resolved").length}
              </Badge>
            </TabsTrigger>
          </TabsList>
          <TabsContent
            value="rules"
            className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]"
          >
            <Card className="h-fit">
              <CardHeader>
                <CardTitle className="text-base">New alert</CardTitle>
                <CardDescription>
                  Evaluated every minute by the Analytics Worker.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field label="Rule name">
                  <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Crash spike"
                  />
                </Field>
                <Field label="Signal">
                  <Select
                    value={type}
                    onValueChange={(value) =>
                      setType(value as AnalyticsAlert["alert_type"])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="crash_spike">Crash spike</SelectItem>
                      <SelectItem value="no_data">No incoming data</SelectItem>
                      <SelectItem value="purchase_drop">
                        Verified purchase drop
                      </SelectItem>
                      <SelectItem value="installation_drop">
                        Installation drop
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  label={
                    type === "no_data"
                      ? "No-data minutes"
                      : type.endsWith("_drop")
                        ? "Drop percentage"
                        : "Threshold"
                  }
                >
                  <Input
                    type="number"
                    min={0}
                    value={threshold}
                    onChange={(event) => setThreshold(event.target.value)}
                  />
                </Field>
                <Field label="AWS SES recipient (optional)">
                  <Input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="team@example.com"
                  />
                </Field>
                <Button
                  className="w-full"
                  disabled={busy || !name.trim()}
                  onClick={() =>
                    void run(async () => {
                      await createAnalyticsAlert(selectedProject.id, {
                        name: name.trim(),
                        alert_type: type,
                        definition: definition(),
                        channels: email.trim()
                          ? [{ type: "email", to: email.trim() }]
                          : [],
                        enabled: true,
                        cooldown_minutes: 60,
                      });
                      setName("");
                    }, "Alert created")
                  }
                >
                  <BellRing className="size-4" /> Create alert
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Active rules</CardTitle>
                <CardDescription>
                  Notifications use the central AWS SES Email Worker.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{item.name}</span>
                        <StatusBadge
                          ok={item.enabled}
                          okText="Enabled"
                          badText="Paused"
                        />
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {labelize(item.alert_type)} · {item.cooldown_minutes}{" "}
                        min cooldown
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.last_evaluated_at
                          ? `Evaluated ${date(item.last_evaluated_at)}`
                          : "Awaiting first evaluation"}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${item.name}`}
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            deleteAnalyticsAlert(selectedProject.id, item.id),
                          "Alert deleted"
                        )
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                {!items.length && (
                  <EmptyState compact>No alert rules configured.</EmptyState>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="incidents">
            <Card>
              <CardHeader>
                <CardTitle>Incident history</CardTitle>
                <CardDescription>
                  Acknowledge active incidents and resolve them after
                  investigation.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FeatureTable
                  columns={[
                    "Triggered",
                    "Summary",
                    "Status",
                    "Notification",
                    "Actions",
                  ]}
                  empty="No incidents have been triggered."
                >
                  {incidents.map((incident) => (
                    <tr key={incident.id} className="border-b last:border-0">
                      <Cell>{date(incident.triggered_at)}</Cell>
                      <Cell strong>{incident.summary}</Cell>
                      <Cell>
                        <Badge
                          variant={
                            incident.status === "open"
                              ? "destructive"
                              : "outline"
                          }
                        >
                          {labelize(incident.status)}
                        </Badge>
                      </Cell>
                      <Cell>
                        <Badge variant="secondary">
                          {labelize(incident.notification_status)}
                        </Badge>
                      </Cell>
                      <Cell>
                        <div className="flex gap-2">
                          {incident.status === "open" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                void run(
                                  () =>
                                    updateAnalyticsAlertIncident(
                                      selectedProject.id,
                                      incident.id,
                                      "acknowledge"
                                    ),
                                  "Incident acknowledged"
                                )
                              }
                            >
                              Acknowledge
                            </Button>
                          )}
                          {incident.status !== "resolved" && (
                            <Button
                              size="sm"
                              onClick={() =>
                                void run(
                                  () =>
                                    updateAnalyticsAlertIncident(
                                      selectedProject.id,
                                      incident.id,
                                      "resolve"
                                    ),
                                  "Incident resolved"
                                )
                              }
                            >
                              Resolve
                            </Button>
                          )}
                        </div>
                      </Cell>
                    </tr>
                  ))}
                </FeatureTable>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </ModulePage>
  );
}

export function AnalyticsSettingsPage() {
  const { selectedProject } = useProjectSelection();
  const [settings, setSettings] = useState<AnalyticsSettings | null>(null);
  const [applications, setApplications] = useState<AnalyticsApplication[]>([]);
  const [hooks, setHooks] = useState<AnalyticsHook[]>([]);
  const [annotations, setAnnotations] = useState<AnalyticsAnnotation[]>([]);
  const [hookName, setHookName] = useState("");
  const [hookUrl, setHookUrl] = useState("");
  const [hookEvents, setHookEvents] = useState("*");
  const [hookSecret, setHookSecret] = useState("");
  const [annotation, setAnnotation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!selectedProject) return;
    try {
      const [settingsData, applicationData, hookData, annotationData] =
        await Promise.all([
          getAnalyticsSettings(selectedProject.id),
          getAnalyticsApplications(selectedProject.id),
          getAnalyticsHooks(selectedProject.id),
          getAnalyticsAnnotations(selectedProject.id),
        ]);
      setSettings(settingsData);
      setApplications(applicationData.items);
      setHooks(hookData.items);
      setAnnotations(annotationData.items);
      setError(null);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    }
  }, [selectedProject]);
  useEffect(() => void load(), [load]);
  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await action();
      showSuccessNotification(message);
      await load();
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ModulePage
      title="Analytics settings"
      description="Manage applications, retention, collection, signed webhooks and timeline annotations."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <Tabs defaultValue="applications" className="space-y-4">
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="applications">Applications</TabsTrigger>
            <TabsTrigger value="collection">Data collection</TabsTrigger>
            <TabsTrigger value="hooks">Webhooks</TabsTrigger>
            <TabsTrigger value="annotations">Annotations</TabsTrigger>
          </TabsList>
          <TabsContent value="applications">
            <Card>
              <CardHeader>
                <CardTitle>Observed applications</CardTitle>
                <CardDescription>
                  Applications appear automatically after their first accepted
                  event.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {applications.map((application) => (
                  <div
                    key={application.application_id}
                    className="flex flex-col gap-3 rounded-xl border p-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{application.name}</span>
                        <Badge variant="outline">
                          {application.platform || "unknown"}
                        </Badge>
                      </div>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">
                        {application.application_id}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Last seen {date(application.last_seen_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Label
                        htmlFor={`application-${application.application_id}`}
                      >
                        Collect data
                      </Label>
                      <Switch
                        id={`application-${application.application_id}`}
                        checked={application.active}
                        onCheckedChange={(active) =>
                          void run(
                            () =>
                              updateAnalyticsApplication(
                                selectedProject.id,
                                application.application_id,
                                { active }
                              ),
                            active
                              ? "Application enabled"
                              : "Application disabled"
                          )
                        }
                      />
                    </div>
                  </div>
                ))}
                {!applications.length && (
                  <EmptyState compact>No applications observed.</EmptyState>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="collection">
            {settings && (
              <Card className="max-w-2xl">
                <CardHeader>
                  <CardTitle>Collection & retention</CardTitle>
                  <CardDescription>
                    Raw hot events expire automatically; aggregated facts and R2
                    archives remain available for reports and exports.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="flex items-center justify-between rounded-lg border p-4">
                    <div>
                      <div className="font-medium">
                        Collect analytics events
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Applies to the selected project.
                      </div>
                    </div>
                    <Switch
                      checked={settings.data_collection_enabled}
                      onCheckedChange={(data_collection_enabled) =>
                        setSettings({ ...settings, data_collection_enabled })
                      }
                    />
                  </div>
                  <Field label="Hot-event retention (days)">
                    <Input
                      type="number"
                      min={1}
                      max={366}
                      value={settings.hot_retention_days}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          hot_retention_days: Number(event.target.value),
                        })
                      }
                    />
                  </Field>
                  <Field label="Reporting timezone">
                    <Input
                      value={settings.timezone}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          timezone: event.target.value,
                        })
                      }
                    />
                  </Field>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          updateAnalyticsSettings(selectedProject.id, settings),
                        "Analytics settings saved"
                      )
                    }
                  >
                    <Save className="size-4" /> Save settings
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>
          <TabsContent
            value="hooks"
            className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]"
          >
            <Card className="h-fit">
              <CardHeader>
                <CardTitle className="text-base">Signed webhook</CardTitle>
                <CardDescription>
                  Only public HTTPS endpoints are accepted. Secrets are
                  encrypted at rest.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field label="Name">
                  <Input
                    value={hookName}
                    onChange={(event) => setHookName(event.target.value)}
                    placeholder="Data warehouse"
                  />
                </Field>
                <Field label="Endpoint">
                  <Input
                    type="url"
                    value={hookUrl}
                    onChange={(event) => setHookUrl(event.target.value)}
                    placeholder="https://hooks.example.com/analytics"
                  />
                </Field>
                <Field label="Events">
                  <Input
                    value={hookEvents}
                    onChange={(event) => setHookEvents(event.target.value)}
                    placeholder="*, alert.triggered"
                  />
                </Field>
                <Field label="Signing secret">
                  <Input
                    type="password"
                    value={hookSecret}
                    onChange={(event) => setHookSecret(event.target.value)}
                  />
                </Field>
                <Button
                  className="w-full"
                  disabled={busy || !hookName.trim() || !hookUrl.trim()}
                  onClick={() =>
                    void run(async () => {
                      await createAnalyticsHook(selectedProject.id, {
                        name: hookName.trim(),
                        endpoint_url: hookUrl.trim(),
                        event_types: hookEvents
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean),
                        secret: hookSecret || undefined,
                        enabled: true,
                      });
                      setHookName("");
                      setHookUrl("");
                      setHookSecret("");
                    }, "Webhook created")
                  }
                >
                  <Webhook className="size-4" /> Add webhook
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Destinations</CardTitle>
                <CardDescription>
                  Deliveries are idempotent, signed and retried with backoff.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {hooks.map((hook) => (
                  <div
                    key={hook.id}
                    className="flex items-start justify-between gap-4 rounded-xl border p-4"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{hook.name}</span>
                        <StatusBadge
                          ok={hook.enabled}
                          okText="Active"
                          badText="Paused"
                        />
                      </div>
                      <p className="mt-1 break-all text-sm text-muted-foreground">
                        {hook.endpoint_url}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {hook.event_types.join(", ")} ·{" "}
                        {hook.secret_configured ? "HMAC signed" : "unsigned"} ·{" "}
                        {hook.last_delivery_status || "no deliveries"}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${hook.name}`}
                      onClick={() =>
                        void run(
                          () =>
                            deleteAnalyticsHook(selectedProject.id, hook.id),
                          "Webhook deleted"
                        )
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                {!hooks.length && (
                  <EmptyState compact>No webhook destinations.</EmptyState>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent
            value="annotations"
            className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]"
          >
            <Card className="h-fit">
              <CardHeader>
                <CardTitle className="text-base">Add annotation</CardTitle>
                <CardDescription>
                  Mark releases or campaigns on the analytics timeline.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field label="Title">
                  <Input
                    value={annotation}
                    onChange={(event) => setAnnotation(event.target.value)}
                    placeholder="Version 3.2 released"
                  />
                </Field>
                <Button
                  className="w-full"
                  disabled={!annotation.trim()}
                  onClick={() =>
                    void run(async () => {
                      await createAnalyticsAnnotation(selectedProject.id, {
                        title: annotation.trim(),
                        annotation_at: new Date().toISOString(),
                        color: "#6366f1",
                      });
                      setAnnotation("");
                    }, "Annotation added")
                  }
                >
                  <Plus className="size-4" /> Add now
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Timeline</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {annotations.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-4 rounded-xl border p-4"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="size-3 rounded-full"
                        style={{ backgroundColor: item.color }}
                      />
                      <div>
                        <div className="font-medium">{item.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {date(item.annotation_at)}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${item.title}`}
                      onClick={() =>
                        void run(
                          () =>
                            deleteAnalyticsAnnotation(
                              selectedProject.id,
                              item.id
                            ),
                          "Annotation deleted"
                        )
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                {!annotations.length && (
                  <EmptyState compact>No timeline annotations.</EmptyState>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </ModulePage>
  );
}

function WidgetPreview({
  type,
}: {
  type: AnalyticsDashboardWidget["widget_type"];
}) {
  const icon =
    type === "crashes"
      ? AlertTriangle
      : type === "views"
        ? AppWindow
        : type === "purchases"
          ? ShieldCheck
          : type === "installations"
            ? AppWindow
            : Gauge;
  const Icon = icon;
  return (
    <div className="flex min-h-20 items-center gap-3 rounded-lg border border-dashed bg-muted/30 p-4">
      <div className="rounded-lg bg-primary/10 p-2 text-primary">
        <Icon className="size-5" />
      </div>
      <div>
        <div className="font-medium">Live {labelize(type)} widget</div>
        <div className="text-xs text-muted-foreground">
          Uses the selected dashboard range and project filters.
        </div>
      </div>
    </div>
  );
}

function FeatureMetric({
  icon: Icon,
  label,
  value,
  text,
}: {
  icon: typeof Activity;
  label: string;
  value?: number;
  text?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 pt-6">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <Icon className="size-5" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tabular-nums">
            {text ?? numberFormat(value ?? 0)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function FeatureTable({
  columns,
  empty,
  children,
}: {
  columns: string[];
  empty: string;
  children: ReactNode;
}) {
  const hasRows = Array.isArray(children)
    ? children.length > 0
    : Boolean(children);
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            {columns.map((column) => (
              <th key={column} className="px-4 py-3 font-medium">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hasRows ? (
            children
          ) : (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-10 text-center text-muted-foreground"
              >
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Cell({
  children,
  mono,
  strong,
}: {
  children: ReactNode;
  mono?: boolean;
  strong?: boolean;
}) {
  return (
    <td
      className={`px-4 py-3 align-top ${mono ? "font-mono text-xs" : ""} ${strong ? "font-medium" : ""}`}
    >
      {children}
    </td>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function EmptyState({
  children,
  compact = false,
}: {
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-dashed text-center text-sm text-muted-foreground ${compact ? "p-5" : "p-10"}`}
    >
      <LayoutDashboard className="mx-auto mb-2 size-5 opacity-60" />
      {children}
    </div>
  );
}

function StatusBadge({
  ok,
  okText,
  badText,
}: {
  ok: boolean;
  okText: string;
  badText: string;
}) {
  return (
    <Badge variant={ok ? "secondary" : "outline"}>
      {ok ? okText : badText}
    </Badge>
  );
}

function labelize(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function date(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function numberFormat(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(
    Number(value) || 0
  );
}

function duration(value: number) {
  const seconds = Math.max(0, Math.round(Number(value) || 0));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function shortId(value?: string | null) {
  if (!value) return "—";
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}
