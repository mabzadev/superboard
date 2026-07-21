import { parseSecondsInDaysHoursMinutesSeconds } from "@/lib/utils";
import { formatDayMonthYear, formatTime } from "@/lib/dateUtils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { Copy } from "lucide-react";
import { handleCopyText } from "@/lib/copyTextHelper";
import type {
  VisitorDetailMetrics,
  AggregatedVisitorMetrics,
  InvitedUser,
} from "@/types";

const AudienceItemDetailsAnalytics = ({
  metrics,
  agregatedMetrics,
}: {
  metrics: VisitorDetailMetrics | null;
  agregatedMetrics: AggregatedVisitorMetrics | null;
}) => {
  if (!metrics) return null;

  return (
    <div className="flex flex-col gap-5">
      {/* User Analytics */}
      <section className="flex flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-medium">User Analytics</h3>
          <p className="text-xs text-muted-foreground">
            Metrics from all links for this user
          </p>
        </div>
        <div className="rounded-lg border border-sidebar-border overflow-hidden">
          <div className="grid grid-cols-3">
            <MetricCell label="Platform" value={metrics.platform} />
            <MetricCell label="Views" value={metrics.total_views} />
            <MetricCell label="Opens" value={metrics.total_app_opens} />
            <MetricCell label="Installs" value={metrics.total_installs} />
            <MetricCell label="Reinstalls" value={metrics.total_reinstalls} />
            <MetricCell
              label="Reactivations"
              value={metrics.total_reactivations}
            />
            <MetricCell
              label="Invited Users"
              value={metrics.total_user_referred}
            />
            <MetricCell
              label="Engagement Time"
              value={parseSecondsInDaysHoursMinutesSeconds(
                metrics.total_time_spent
              )}
              span={2}
            />
          </div>
        </div>
      </section>

      {/* Referral Metrics */}
      <section className="flex flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-medium">Referral Metrics</h3>
          <p className="text-xs text-muted-foreground">
            Combined metrics from all users and links referred by this user
          </p>
        </div>
        <div className="rounded-lg border border-sidebar-border overflow-hidden">
          <div className="grid grid-cols-3">
            <MetricCell
              label="Generated Links"
              value={agregatedMetrics?.number_of_generated_links}
            />
            <MetricCell label="Views" value={agregatedMetrics?.invited_views} />
            <MetricCell
              label="Opens"
              value={agregatedMetrics?.invited_app_opens}
            />
            <MetricCell
              label="Installs"
              value={agregatedMetrics?.invited_installs}
            />
            <MetricCell
              label="Reinstalls"
              value={agregatedMetrics?.invited_reinstalls}
            />
            <MetricCell
              label="Reactivations"
              value={agregatedMetrics?.invited_reactivations}
            />
            <MetricCell
              label="Users Referred"
              value={agregatedMetrics?.invited_user_referred}
            />
            <MetricCell
              label="Engagement Time"
              value={
                agregatedMetrics?.invited_time_spent
                  ? parseSecondsInDaysHoursMinutesSeconds(
                      agregatedMetrics.invited_time_spent
                    )
                  : undefined
              }
              span={2}
            />
          </div>
        </div>
      </section>

      {/* Activity */}
      <section className="flex flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-medium">Activity</h3>
          <p className="text-xs text-muted-foreground">
            First and last recorded interactions for this user
          </p>
        </div>
        <div className="rounded-lg border border-sidebar-border overflow-hidden">
          <div className="grid grid-cols-2">
            <div className="px-3 py-2.5 border-r border-sidebar-border bg-sidebar">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-0.5">
                First Seen
              </p>
              <p className="text-sm font-semibold tabular-nums">
                {metrics.created_at
                  ? formatDayMonthYear(metrics.created_at)
                  : "\u2014"}
              </p>
              {metrics.created_at && (
                <p className="text-xs text-muted-foreground tabular-nums mt-0.5">
                  {formatTime(metrics.created_at)}
                </p>
              )}
            </div>
            <div className="px-3 py-2.5 bg-sidebar">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-0.5">
                Last Seen
              </p>
              <p className="text-sm font-semibold tabular-nums">
                {metrics.updated_at
                  ? formatDayMonthYear(metrics.updated_at)
                  : "\u2014"}
              </p>
              {metrics.updated_at && (
                <p className="text-xs text-muted-foreground tabular-nums mt-0.5">
                  {formatTime(metrics.updated_at)}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Invited Users Table */}
      {(metrics?.invited?.length ?? 0) > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Invited Users</h3>
          <div className="rounded-md border overflow-hidden border-sidebar-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-table-header">
                  <TableHead className="text-foreground p-2">ID</TableHead>
                  <TableHead className="text-foreground p-2">
                    SDK Identifier
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {metrics.invited!.map((invited: InvitedUser) => (
                  <TableRow
                    key={invited.id}
                    className="bg-background border-sidebar-border"
                  >
                    <TableCell className="p-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="truncate">{invited?.uuid}</span>
                        {invited?.uuid && (
                          <button
                            onClick={() => handleCopyText(invited.uuid)}
                            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="p-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="truncate">
                          {invited?.sdk_identifier}
                        </span>
                        {invited?.sdk_identifier && (
                          <button
                            onClick={() =>
                              handleCopyText(invited.sdk_identifier)
                            }
                            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}
    </div>
  );
};

const MetricCell = ({
  label,
  value,
  span,
}: {
  label: string;
  value: string | number | undefined;
  span?: number;
}) => (
  <div
    className={`px-3 py-2.5 border-r border-sidebar-border last:border-r-0 bg-sidebar [&:not(:nth-last-child(-n+2))]:border-b ${
      span === 2 ? "col-span-2 border-r-0" : "[&:nth-child(3n)]:border-r-0"
    }`}
  >
    <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-0.5">
      {label}
    </p>
    <p className="text-sm font-semibold tabular-nums leading-tight whitespace-nowrap">
      {value ?? "\u2014"}
    </p>
  </div>
);

export default AudienceItemDetailsAnalytics;
