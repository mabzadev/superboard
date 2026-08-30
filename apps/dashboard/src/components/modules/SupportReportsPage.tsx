"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import {
  downloadSupportReportExport,
  exportSupportReports,
  getSupportReportExport,
  getSupportReports,
  listSupportReportExports,
  type SupportReport,
  type SupportReportExport,
} from "@/api/support/reportsService";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProjectSelection } from "@/context/useProjectSelection";
import {
  showErrorNotification,
  showSuccessNotification,
} from "@/lib/Notifications";
import { EmptyProject, ModulePage, moduleErrorMessage } from "./ModulePage";
import { SupportEmpty, SupportMetric } from "@/components/support/SupportUi";

export default function SupportReportsPage() {
  const { selectedProject } = useProjectSelection();
  const projectRef = selectedProject?.id;
  const [report, setReport] = useState<SupportReport | null>(null);
  const [exports, setExports] = useState<SupportReportExport[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectRef) return;
    setLoading(true);
    try {
      const [reportResult, exportResult] = await Promise.all([
        getSupportReports(projectRef, {
            from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
            to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
        }),
        listSupportReportExports(projectRef),
      ]);
      setReport(reportResult.data);
      setExports(exportResult.data);
      setError(null);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [from, projectRef, to]);
  useEffect(() => void load(), [load]);

  useEffect(() => {
    if (!projectRef || !exports.some((item) => item.status === "queued" || item.status === "processing")) {
      return;
    }
    const timer = window.setInterval(() => {
      void Promise.all(
        exports
          .filter((item) => item.status === "queued" || item.status === "processing")
          .map((item) => getSupportReportExport(projectRef, item.id))
      ).then((results) => {
        const updates = new Map(results.map((result) => [result.data.id, result.data]));
        setExports((current) => current.map((item) => updates.get(item.id) ?? item));
      }).catch((cause) => setError(moduleErrorMessage(cause)));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [exports, projectRef]);

  const requestExport = async () => {
    if (!projectRef) return;
    try {
      const result = await exportSupportReports(projectRef, {
        from: from || undefined,
        to: to || undefined,
      });
      const job = await getSupportReportExport(projectRef, result.data.id);
      setExports((current) => [job.data, ...current.filter((item) => item.id !== job.data.id)]);
      showSuccessNotification(`Report export ${result.data.id} queued`);
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    }
  };

  const downloadExport = async (job: SupportReportExport) => {
    if (!projectRef || job.status !== "completed") return;
    try {
      const blob = await downloadSupportReportExport(projectRef, job.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `support-report-${job.id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    }
  };

  return (
    <ModulePage
      title="Reports"
      description="Support volume, response, resolution, backlog, SLA, satisfaction and campaign performance."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label>From</Label>
              <Input
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>To</Label>
              <Input
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </div>
            <Button
              variant="outline"
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCw className={loading ? "animate-spin" : ""} /> Apply
              period
            </Button>
            <Button disabled={loading} onClick={() => void requestExport()}>
              <Download /> Export
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <SupportMetric
              label="Conversations"
              value={number(report?.totals.conversations)}
            />
            <SupportMetric
              label="Backlog"
              value={number(report?.totals.backlog)}
            />
            <SupportMetric
              label="Resolved"
              value={number(report?.totals.resolved)}
            />
            <SupportMetric
              label="First response"
              value={duration(report?.totals.first_response_seconds)}
            />
            <SupportMetric
              label="Resolution"
              value={duration(report?.totals.resolution_seconds)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SupportMetric
              label="CSAT"
              value={
                report?.csat.average == null
                  ? "—"
                  : `${Number(report.csat.average).toFixed(2)} / 5`
              }
              description={`${number(report?.csat.responses)} responses`}
            />
            <SupportMetric
              label="SLA events"
              value={(report?.sla ?? []).reduce(
                (total, item) => total + Number(item.count),
                0
              )}
              description={
                (report?.sla ?? [])
                  .map((item) => `${item.status}: ${item.count}`)
                  .join(" · ") || "No SLA events"
              }
            />
          </div>
          <Tabs defaultValue="inbox">
            <TabsList>
              <TabsTrigger value="inbox">By inbox</TabsTrigger>
              <TabsTrigger value="agent">By agent</TabsTrigger>
              <TabsTrigger value="team">By team</TabsTrigger>
              <TabsTrigger value="label">By label</TabsTrigger>
              <TabsTrigger value="channel">By channel</TabsTrigger>
              <TabsTrigger value="provider">By provider</TabsTrigger>
              <TabsTrigger value="campaigns">Proactive Support</TabsTrigger>
            </TabsList>
            <TabsContent value="inbox">
              <Dimension
                title="Inbox volume"
                rows={report?.dimensions.inbox ?? []}
              />
            </TabsContent>
            <TabsContent value="agent">
              <Dimension
                title="Agent load"
                rows={report?.dimensions.agent ?? []}
              />
            </TabsContent>
            <TabsContent value="team">
              <Dimension title="Team load" rows={report?.dimensions.team ?? []} />
            </TabsContent>
            <TabsContent value="label">
              <Dimension title="Label volume" rows={report?.dimensions.label ?? []} />
            </TabsContent>
            <TabsContent value="channel">
              <Dimension title="Channel volume" rows={report?.dimensions.channel ?? []} />
            </TabsContent>
            <TabsContent value="provider">
              <Dimension title="Provider volume" rows={report?.dimensions.provider ?? []} />
            </TabsContent>
            <TabsContent value="campaigns">
              <Dimension
                title="Campaign delivery"
                rows={(report?.proactive_support ?? []).map((item) => ({
                  dimension: item.status,
                  conversations: item.count,
                }))}
              />
            </TabsContent>
          </Tabs>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Report exports</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {exports.length === 0 ? (
                <SupportEmpty
                  title="No report exports"
                  description="Request an export for the selected reporting period."
                />
              ) : (
                exports.map((job) => (
                  <div key={job.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                    <div>
                      <div className="font-medium">{job.status}</div>
                      <div className="text-xs text-muted-foreground">{job.id}</div>
                    </div>
                    {job.status === "completed" ? (
                      <Button variant="outline" onClick={() => void downloadExport(job)}>
                        <Download /> Download
                      </Button>
                    ) : job.status === "failed" ? (
                      <span className="text-sm text-destructive">Export failed</span>
                    ) : (
                      <span className="text-sm text-muted-foreground">Processing…</span>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </ModulePage>
  );
}

function Dimension({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ dimension: string; conversations: number }>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 ? (
          <SupportEmpty
            title="No data for this period"
            description="Adjust the period or wait for Support activity."
          />
        ) : (
          rows.map((row) => (
            <div
              key={row.dimension}
              className="flex items-center justify-between rounded-md border p-3"
            >
              <span>{row.dimension}</span>
              <strong>{number(row.conversations)}</strong>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
function number(value?: number | null) {
  return Number(value || 0).toLocaleString();
}
function duration(value?: number | null) {
  if (value == null) return "—";
  const seconds = Number(value);
  return seconds < 3600
    ? `${Math.round(seconds / 60)} min`
    : `${(seconds / 3600).toFixed(1)} h`;
}
