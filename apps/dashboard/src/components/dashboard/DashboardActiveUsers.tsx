"use client";
import React, { useEffect, useState } from "react";

import { Button } from "../ui/button";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "../ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Skeleton } from "../ui/skeleton";
import { BarChart3, Link2, Plus } from "lucide-react";
import { useGlobalLinkDialog } from "@/context/useLinkDialogContext";
import type { ChartDataPoint } from "@/types";

const DashboardLinksView = React.memo(function DashboardLinksView({
  data,
  loading,
  hasCreatedLinks,
}: {
  data: Record<string, number> | null;
  loading?: boolean;
  hasCreatedLinks?: boolean;
}) {
  const { openLinkDialog } = useGlobalLinkDialog();
  const [fullData, setFullData] = useState<ChartDataPoint[]>([]);

  const chartConfig = {
    users: {
      label: "Views",
      color: "var(--chart-users)",
    },
  } satisfies ChartConfig;

  const numberFormatter = new Intl.NumberFormat("de-DE"); // dot for thousands

  useEffect(() => {
    if (!data) {
      setFullData([]);
      return;
    }
    const parsedData = Object.entries(data).map(([dateStr, users]) => {
      const date = new Date(dateStr);
      const name = date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });

      return { name, users };
    });
    setFullData(parsedData);
  }, [data]);

  return (
    <div className="rounded-md border border-sidebar-border bg-background p-6 shadow-none relative flex flex-col min-w-0">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold">Links views</h3>
      </div>

      {loading ? (
        <Skeleton className="h-[300px] w-full rounded-xl" />
      ) : fullData.length === 0 ||
        fullData.every((d: ChartDataPoint) => d.users === 0) ? (
        <div className="flex flex-col items-center justify-center py-16 px-8 bg-sidebar rounded-xl animate-in fade-in-0 slide-in-from-bottom-3 duration-500">
          <div className="relative mb-5">
            <div className="flex items-center justify-center h-14 w-14 rounded-2xl bg-sidebar border border-sidebar-border text-muted-foreground animate-in zoom-in-50 duration-500">
              {hasCreatedLinks ? (
                <BarChart3 className="h-6 w-6" />
              ) : (
                <Link2 className="h-6 w-6" />
              )}
            </div>
            <div className="absolute -inset-2 rounded-3xl bg-sidebar/50 border border-sidebar-border/50 -z-10 animate-in zoom-in-75 duration-700" />
          </div>
          <h3 className="text-sm font-semibold text-foreground mb-1">
            {hasCreatedLinks ? "No link views" : "No links yet"}
          </h3>
          <p className="text-xs text-muted-foreground text-center max-w-[320px] leading-relaxed">
            {hasCreatedLinks
              ? "No views were recorded for the selected date range."
              : "Create your first link to start tracking views and engagement."}
          </p>
          {hasCreatedLinks ? (
            <span className="text-[11px] text-muted-foreground/60 mt-3">
              Try selecting a different period or share your links to start
              tracking views.
            </span>
          ) : (
            <Button
              className="mt-5"
              size="sm"
              onClick={() => openLinkDialog({})}
            >
              <Plus className="h-4 w-4" />
              Create Link
            </Button>
          )}
        </div>
      ) : (
        <ChartContainer
          config={chartConfig}
          className="h-[400px] w-full aspect-auto"
        >
          <BarChart accessibilityLayer data={fullData} margin={{ bottom: 5 }}>
            <defs>
              <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="var(--chart-users)"
                  stopOpacity={1}
                />
                <stop
                  offset="100%"
                  stopColor="var(--chart-users)"
                  stopOpacity={0.4}
                />
              </linearGradient>
              <linearGradient id="barGradientHover" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="var(--chart-users-hover)"
                  stopOpacity={1}
                />
                <stop
                  offset="100%"
                  stopColor="var(--chart-users-hover)"
                  stopOpacity={0.5}
                />
              </linearGradient>
            </defs>
            <CartesianGrid
              vertical={false}
              strokeDasharray="3 3"
              className="stroke-sidebar-border"
            />
            <Bar
              dataKey="users"
              fill="url(#barGradient)"
              activeBar={{ fill: "url(#barGradientHover)" }}
              radius={[6, 6, 0, 0]}
              animationDuration={800}
              animationEasing="ease-out"
            />
            <ChartTooltip
              cursor={{ fill: "var(--chart-users)", opacity: 0.08 }}
              isAnimationActive={false}
              content={
                <ChartTooltipContent
                  valueFormatter={(v: number) => numberFormatter.format(v)}
                />
              }
            />
            <XAxis
              dataKey="name"
              tickLine={false}
              tickMargin={10}
              axisLine={false}
              ticks={[
                fullData[0]?.name ?? "",
                fullData[fullData.length - 1]?.name ?? "",
              ]}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              dataKey="users"
              tickFormatter={(value) => numberFormatter.format(value)}
            />
          </BarChart>
        </ChartContainer>
      )}
    </div>
  );
});

export default DashboardLinksView;
