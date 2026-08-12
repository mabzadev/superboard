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
  BarChart3,
  DatabaseBackup,
  Download,
  Filter,
  MousePointerClick,
  Plus,
  RefreshCw,
  Smartphone,
  Trash2,
  Users,
  WalletCards,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  createAnalyticsOperation,
  createAnalyticsReport,
  deleteAnalyticsReport,
  getAnalyticsEventDefinitions,
  getAnalyticsEvents,
  getAnalyticsInstallations,
  getAnalyticsOperations,
  getAnalyticsOverview,
  getAnalyticsPurchases,
  getAnalyticsReports,
  getAnalyticsRetention,
  queryAnalyticsFunnel,
  type AnalyticsEvent,
  type AnalyticsInstallation,
  type AnalyticsOperation,
  type AnalyticsOverview,
  type AnalyticsPurchase,
  type FunnelResult,
  type RetentionResult,
  type SavedAnalyticsReport,
} from "@/api/analytics/analyticsService";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useProjectSelection } from "@/context/useProjectSelection";
import {
  showErrorNotification,
  showSuccessNotification,
} from "@/lib/Notifications";
import {
  EmptyProject,
  ModulePage,
  moduleErrorMessage,
} from "@/components/modules/ModulePage";

export type AnalyticsPageKind =
  | "overview"
  | "events"
  | "installations"
  | "purchases"
  | "insights"
  | "reports";

export function AnalyticsPage({ kind }: { kind: AnalyticsPageKind }) {
  if (kind === "overview") return <OverviewPage />;
  if (kind === "events") return <EventsPage />;
  if (kind === "installations") return <InstallationsPage />;
  if (kind === "purchases") return <PurchasesPage />;
  if (kind === "insights") return <InsightsPage />;
  return <ReportsPage />;
}

function useAnalyticsRange() {
  return useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - 29 * 86_400_000);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);
}

function OverviewPage() {
  const { selectedProject } = useProjectSelection();
  const range = useAnalyticsRange();
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!selectedProject) return;
    try {
      setOverview(await getAnalyticsOverview(selectedProject.id, range));
      setError(null);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    }
  }, [range, selectedProject]);
  useEffect(() => void load(), [load]);

  return (
    <ModulePage
      title="Analytics"
      description="A single, privacy-aware view of product usage, installations and verified revenue."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              icon={Activity}
              label="Events"
              value={overview?.events}
            />
            <MetricCard
              icon={Users}
              label="Unique people"
              value={overview?.unique_subjects}
            />
            <MetricCard
              icon={BarChart3}
              label="Sessions"
              value={overview?.sessions}
            />
            <MetricCard
              icon={Smartphone}
              label="Installations"
              value={overview?.installations}
            />
            <MetricCard
              icon={WalletCards}
              label="Verified purchases"
              value={overview?.successful_purchases}
            />
          </div>
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>Activity over 30 days</CardTitle>
                <CardDescription>
                  Accepted events after idempotency and project isolation.
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                <RefreshCw className="size-4" /> Refresh
              </Button>
            </CardHeader>
            <CardContent>
              <div className="h-80 w-full" aria-label="Events over time">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={overview?.series ?? []}>
                    <defs>
                      <linearGradient
                        id="analyticsEvents"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor="var(--primary)"
                          stopOpacity={0.35}
                        />
                        <stop
                          offset="95%"
                          stopColor="var(--primary)"
                          stopOpacity={0.02}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickLine={false}
                      axisLine={false}
                      minTickGap={24}
                    />
                    <YAxis
                      allowDecimals={false}
                      tickLine={false}
                      axisLine={false}
                      width={36}
                    />
                    <Tooltip />
                    <Area
                      dataKey="events"
                      type="monotone"
                      stroke="var(--primary)"
                      fill="url(#analyticsEvents)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          <div className="grid gap-4 lg:grid-cols-3">
            <SummaryCard
              title="Average session"
              value={formatDuration(
                overview?.average_session_duration_seconds ?? 0
              )}
              detail="Across projected sessions in this period"
            />
            <SummaryCard
              title="Purchase events"
              value={formatNumber(overview?.purchase_events)}
              detail="Purchases, renewals, refunds and chargebacks"
            />
            <SummaryCard
              title="Accounting"
              value="Verified facts only"
              detail="SDK clients cannot forge financial events"
            />
          </div>
        </div>
      )}
    </ModulePage>
  );
}

function EventsPage() {
  const { selectedProject } = useProjectSelection();
  const range = useAnalyticsRange();
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);
  const [eventName, setEventName] = useState("");
  const [appliedName, setAppliedName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!selectedProject) return;
    try {
      const result = await getAnalyticsEvents(selectedProject.id, {
        ...range,
        event_name: appliedName || undefined,
        limit: "100",
      });
      setEvents(result.items);
      setError(null);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    }
  }, [appliedName, range, selectedProject]);
  useEffect(() => void load(), [load]);
  return (
    <ModulePage
      title="Event explorer"
      description="Inspect the recent, pseudonymized event stream without exposing raw user identifiers."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Recent events</CardTitle>
            <CardDescription>Filter by the exact event name.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                setAppliedName(eventName.trim());
              }}
            >
              <Input
                value={eventName}
                onChange={(event) => setEventName(event.target.value)}
                placeholder="checkout.completed"
                aria-label="Event name"
              />
              <Button type="submit">
                <Filter className="size-4" /> Apply filter
              </Button>
            </form>
            <DataTable
              columns={[
                "Event",
                "Source",
                "Application",
                "Occurred",
                "Properties",
              ]}
              empty="No events match this period and filter."
            >
              {events.map((event) => (
                <tr key={event.event_id} className="border-b last:border-0">
                  <Cell>
                    <div className="font-medium">{event.event_name}</div>
                    <div className="max-w-48 truncate font-mono text-xs text-muted-foreground">
                      {event.event_id}
                    </div>
                  </Cell>
                  <Cell>
                    <Badge variant="outline">{event.source}</Badge>
                  </Cell>
                  <Cell>{event.application_id}</Cell>
                  <Cell>{formatDate(event.occurred_at)}</Cell>
                  <Cell>
                    <code className="block max-w-80 truncate text-xs">
                      {JSON.stringify(event.properties)}
                    </code>
                  </Cell>
                </tr>
              ))}
            </DataTable>
          </CardContent>
        </Card>
      )}
    </ModulePage>
  );
}

function InstallationsPage() {
  const { selectedProject } = useProjectSelection();
  const range = useAnalyticsRange();
  const [items, setItems] = useState<AnalyticsInstallation[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedProject) return;
    void getAnalyticsInstallations(selectedProject.id, range)
      .then((result) => {
        setItems(result.items);
        setError(null);
      })
      .catch((cause: unknown) => setError(moduleErrorMessage(cause)));
  }, [range, selectedProject]);
  return (
    <ModulePage
      title="Installations"
      description="Canonical first installs only—retries and repeated attribution calls do not increase this count."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <DataTable
              columns={[
                "Installed",
                "Application",
                "Platform",
                "Version",
                "Attribution",
              ]}
              empty="No installations in this period."
            >
              {items.map((item) => (
                <tr key={item.id} className="border-b last:border-0">
                  <Cell>{formatDate(item.installed_at)}</Cell>
                  <Cell>{item.application_id}</Cell>
                  <Cell>{item.platform || "—"}</Cell>
                  <Cell>{item.app_version || "—"}</Cell>
                  <Cell>{item.attribution_id || "Organic / unknown"}</Cell>
                </tr>
              ))}
            </DataTable>
          </CardContent>
        </Card>
      )}
    </ModulePage>
  );
}

function PurchasesPage() {
  const { selectedProject } = useProjectSelection();
  const range = useAnalyticsRange();
  const [items, setItems] = useState<AnalyticsPurchase[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedProject) return;
    void getAnalyticsPurchases(selectedProject.id, range)
      .then((result) => {
        setItems(result.items);
        setError(null);
      })
      .catch((cause: unknown) => setError(moduleErrorMessage(cause)));
  }, [range, selectedProject]);
  return (
    <ModulePage
      title="Verified purchases"
      description="Financial facts emitted only after store or billing verification, deduplicated by transaction and event type."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <DataTable
              columns={[
                "Occurred",
                "Type",
                "Product",
                "Amount",
                "Store",
                "Transaction",
              ]}
              empty="No verified purchase facts in this period."
            >
              {items.map((item) => (
                <tr key={item.id} className="border-b last:border-0">
                  <Cell>{formatDate(item.occurred_at)}</Cell>
                  <Cell>
                    <Badge
                      variant={
                        negativePurchase(item.event_type)
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {labelize(item.event_type)}
                    </Badge>
                  </Cell>
                  <Cell>{item.product_id || "—"}</Cell>
                  <Cell>{formatPurchaseAmount(item)}</Cell>
                  <Cell>
                    {labelize(item.store)} · {item.environment}
                  </Cell>
                  <Cell>
                    <span className="block max-w-44 truncate font-mono text-xs">
                      {item.store_transaction_id}
                    </span>
                  </Cell>
                </tr>
              ))}
            </DataTable>
          </CardContent>
        </Card>
      )}
    </ModulePage>
  );
}

function InsightsPage() {
  const { selectedProject } = useProjectSelection();
  const range = useAnalyticsRange();
  const [stepsText, setStepsText] = useState(
    "app.opened, checkout.started, purchase.completed"
  );
  const [funnel, setFunnel] = useState<FunnelResult | null>(null);
  const [retention, setRetention] = useState<RetentionResult | null>(null);
  const [definitions, setDefinitions] = useState<
    Array<{ event_name: string; event_count: number }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!selectedProject) return;
    try {
      const [retentionData, definitionData] = await Promise.all([
        getAnalyticsRetention(selectedProject.id, { ...range, days: "30" }),
        getAnalyticsEventDefinitions(selectedProject.id),
      ]);
      setRetention(retentionData);
      setDefinitions(definitionData.items);
      setError(null);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    }
  }, [range, selectedProject]);
  useEffect(() => void load(), [load]);
  const runFunnel = async () => {
    if (!selectedProject) return;
    const steps = stepsText
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (steps.length < 2) {
      showErrorNotification("Add at least two comma-separated event names.");
      return;
    }
    try {
      setFunnel(
        await queryAnalyticsFunnel(selectedProject.id, { ...range, steps })
      );
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    }
  };
  return (
    <ModulePage
      title="Funnels & retention"
      description="Understand conversion sequences and whether new installations return over time."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Funnel</CardTitle>
              <CardDescription>
                Enter ordered event names separated by commas.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                value={stepsText}
                onChange={(event) => setStepsText(event.target.value)}
              />
              <Button onClick={() => void runFunnel()}>
                <MousePointerClick className="size-4" /> Run funnel
              </Button>
              <div className="space-y-3">
                {funnel?.steps.map((step, index) => (
                  <div
                    key={`${step.event_name}-${index}`}
                    className="rounded-lg border p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">
                        {index + 1}. {step.event_name}
                      </span>
                      <span>{formatNumber(step.subjects)} people</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{
                          width: `${Math.max(2, step.conversion_from_first * 100)}%`,
                        }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatPercent(step.conversion_from_first)} from the first
                      step
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Installation retention</CardTitle>
              <CardDescription>
                Return rate by install cohort for the first 30 days.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={["Cohort", "Size", "Day 1", "Day 7", "Day 30"]}
                empty="Retention appears once installations return and emit events."
              >
                {retention?.cohorts.slice(-20).map((cohort) => (
                  <tr
                    key={cohort.cohort_date}
                    className="border-b last:border-0"
                  >
                    <Cell>{cohort.cohort_date}</Cell>
                    <Cell>{formatNumber(cohort.size)}</Cell>
                    {[1, 7, 30].map((day) => (
                      <Cell key={day}>
                        {formatPercent(
                          cohort.days.find((entry) => entry.day === day)
                            ?.rate ?? 0
                        )}
                      </Cell>
                    ))}
                  </tr>
                ))}
              </DataTable>
            </CardContent>
          </Card>
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>Known event definitions</CardTitle>
              <CardDescription>
                Most recently observed event vocabulary for funnel and journey
                configuration.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {definitions.length ? (
                definitions.map((definition) => (
                  <Badge key={definition.event_name} variant="outline">
                    {definition.event_name} ·{" "}
                    {formatNumber(definition.event_count)}
                  </Badge>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No events have been projected yet.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </ModulePage>
  );
}

function ReportsPage() {
  const { selectedProject } = useProjectSelection();
  const [reports, setReports] = useState<SavedAnalyticsReport[]>([]);
  const [operations, setOperations] = useState<AnalyticsOperation[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!selectedProject) return;
    try {
      const [saved, jobs] = await Promise.all([
        getAnalyticsReports(selectedProject.id),
        getAnalyticsOperations(selectedProject.id),
      ]);
      setReports(saved.items);
      setOperations(jobs.items);
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
      title="Reports & data operations"
      description="Save reusable analysis definitions and run durable export or rollup jobs."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Saved reports</CardTitle>
              <CardDescription>
                Definitions stay scoped to the selected project.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Weekly product pulse"
                />
                <Button
                  disabled={busy || !name.trim()}
                  onClick={() =>
                    void run(async () => {
                      await createAnalyticsReport(selectedProject.id, {
                        report_type: "dashboard",
                        name: name.trim(),
                        description: "Dashboard report",
                        definition: {
                          range_days: 30,
                          metrics: [
                            "events",
                            "sessions",
                            "installations",
                            "purchases",
                          ],
                        },
                        enabled: true,
                      });
                      setName("");
                    }, "Report saved")
                  }
                >
                  <Plus className="size-4" /> Save
                </Button>
              </div>
              <div className="space-y-2">
                {reports.map((report) => (
                  <div
                    key={report.id}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div>
                      <div className="font-medium">{report.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {labelize(report.report_type)} · updated{" "}
                        {formatDate(report.updated_at)}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${report.name}`}
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            deleteAnalyticsReport(
                              selectedProject.id,
                              report.id
                            ),
                          "Report deleted"
                        )
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                {!reports.length && (
                  <p className="text-sm text-muted-foreground">
                    No saved reports yet.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Durable operations</CardTitle>
              <CardDescription>
                Long-running work uses resumable Cloudflare Workflows.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () =>
                        createAnalyticsOperation(selectedProject.id, {
                          operation_type: "export",
                          input: {},
                        }),
                      "Export queued"
                    )
                  }
                >
                  <Download className="size-4" /> Export events
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () =>
                        createAnalyticsOperation(selectedProject.id, {
                          operation_type: "rebuild_rollups",
                          input: {},
                        }),
                      "Rollup rebuild queued"
                    )
                  }
                >
                  <DatabaseBackup className="size-4" /> Rebuild rollups
                </Button>
              </div>
              <DataTable
                columns={["Operation", "Status", "Created"]}
                empty="No analytics operations yet."
              >
                {operations.map((operation) => (
                  <tr key={operation.id} className="border-b last:border-0">
                    <Cell>{labelize(operation.operation_type)}</Cell>
                    <Cell>
                      <Badge
                        variant={
                          operation.status === "failed"
                            ? "destructive"
                            : "outline"
                        }
                      >
                        {operation.status}
                      </Badge>
                    </Cell>
                    <Cell>{formatDate(operation.created_at)}</Cell>
                  </tr>
                ))}
              </DataTable>
            </CardContent>
          </Card>
        </div>
      )}
    </ModulePage>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Activity;
  label: string;
  value?: number;
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
            {formatNumber(value)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryCard({
  title,
  value,
  detail,
}: {
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle>{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {detail}
      </CardContent>
    </Card>
  );
}

function DataTable({
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
      <table className="w-full min-w-[680px] text-left text-sm">
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
                className="px-4 py-10 text-center text-muted-foreground"
                colSpan={columns.length}
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

function Cell({ children }: { children: ReactNode }) {
  return <td className="px-4 py-3 align-top">{children}</td>;
}

function formatNumber(value?: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
    value ?? 0
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function formatPercent(value: number) {
  return new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPurchaseAmount(item: AnalyticsPurchase) {
  if (item.amount_micros == null || !item.currency) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: item.currency,
    }).format(item.amount_micros / 1_000_000);
  } catch {
    return `${(item.amount_micros / 1_000_000).toFixed(2)} ${item.currency}`;
  }
}

function negativePurchase(type: string) {
  return type === "refund" || type === "chargeback" || type === "cancellation";
}

function labelize(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
