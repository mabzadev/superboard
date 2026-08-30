"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ClipboardList,
  Network,
  RefreshCw,
  Users,
} from "lucide-react";

import { flowsApi, type FlowOverview } from "@/api/flows/flowsService";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FlowsEmptyState, FlowsPage } from "./FlowsPage";
import { useFlows } from "./FlowsContext";
import { useFlowI18n } from "./i18n";

export function FlowsOverviewPage() {
  const { t, locale, tr } = useFlowI18n();
  const { projectRef } = useFlows();
  const [overview, setOverview] = useState<FlowOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!projectRef) return;
    setLoading(true);
    try {
      setOverview(await flowsApi.overview(projectRef));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("apiFailure"));
    } finally {
      setLoading(false);
    }
  }, [projectRef, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const metrics = useMemo(
    () =>
      overview
        ? ([
            [t("workflowsMetric"), overview.counters.workflows, Network],
            [t("activeMetric"), overview.counters.active_workflows, Activity],
            [t("usersMetric"), overview.counters.users, Users],
            [
              t("surveyMetric"),
              overview.counters.survey_responses,
              ClipboardList,
            ],
            [
              t("incidentsMetric"),
              overview.counters.dead_letters,
              AlertTriangle,
            ],
          ] as const)
        : [],
    [overview, t]
  );

  return (
    <FlowsPage
      title={t("overview")}
      description={t("overviewDescription")}
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className={loading ? "animate-spin" : ""} />
          {t("retry")}
        </Button>
      }
    >
      {error && (
        <div
          role="alert"
          className="rounded-[var(--radius)] border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}
      {overview ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {metrics.map(([label, value, Icon]) => (
              <Card key={label} className="gap-3">
                <CardHeader className="grid grid-cols-[1fr_auto] items-center">
                  <CardDescription>{label}</CardDescription>
                  <Icon className="size-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-semibold tabular-nums">
                    {Number(value).toLocaleString(locale)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle>{t("recentActivity")}</CardTitle>
                <CardDescription>
                  {tr(
                    "Runtime, survey and transition events. Purchases and installations stay isolated."
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto px-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">{tr("Event")}</TableHead>
                      <TableHead>{tr("Block")}</TableHead>
                      <TableHead>{tr("Environment")}</TableHead>
                      <TableHead className="pr-4 text-right">
                        {tr("Time")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.recent_activity.map((event) => (
                      <TableRow key={event.event_id}>
                        <TableCell className="pl-4 font-mono text-xs">
                          {event.event_name}
                          {event.legacy_event_type && (
                            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {event.legacy_event_type}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>{event.block_key ?? "—"}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {shortId(event.environment_id)}
                        </TableCell>
                        <TableCell className="pr-4 text-right text-muted-foreground">
                          {formatDate(event.occurred_at, locale)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {overview.recent_activity.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="h-28 text-center text-muted-foreground"
                        >
                          {t("noData")}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </>
      ) : loading ? (
        <div className="min-h-52 animate-pulse rounded-[var(--radius)] border bg-card" />
      ) : (
        <FlowsEmptyState icon={Activity} title={t("noData")} />
      )}
    </FlowsPage>
  );
}

function formatDate(value: string, locale: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function shortId(value: string) {
  return value.length > 14 ? `${value.slice(0, 7)}…${value.slice(-4)}` : value;
}
