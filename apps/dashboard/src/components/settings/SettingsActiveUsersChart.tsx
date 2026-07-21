"use client";
import React, { useEffect, useState } from "react";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "../ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { BarChart3 } from "lucide-react";
import type { ChartDataPoint } from "@/types";

const SettingsActiveUsersChart = React.memo(function SettingsActiveUsersChart({
  data,
}: {
  data: Record<string, number> | null;
}) {
  const [fullData, setFullData] = useState<ChartDataPoint[]>([]);

  const chartConfig = {
    users: {
      label: "Users",
      color: "var(--chart-users)",
    },
  } satisfies ChartConfig;

  const numberFormatter = new Intl.NumberFormat("de-DE");

  useEffect(() => {
    if (!data) {
      setFullData([]);
      return;
    }

    const parsedData = Object.entries(data)?.map(([dateStr, users]) => {
      const date = new Date(dateStr);
      const name = date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });

      return { name, users };
    });
    setFullData(parsedData);
  }, [data]);

  const isEmpty =
    fullData.length === 0 ||
    fullData.every((d: ChartDataPoint) => !d.users || d.users === 0);

  if (isEmpty) {
    return (
      <div className="min-w-0 pr-6">
        <div className="flex flex-col items-center justify-center h-[300px] rounded-xl border border-dashed border-sidebar-border mx-6">
          <div className="flex items-center justify-center h-12 w-12 rounded-xl bg-muted mb-3">
            <BarChart3 className="h-6 w-6 text-muted-foreground" />
          </div>
          <span className="text-sm font-medium text-muted-foreground">
            No data for this period
          </span>
          <span className="text-xs text-muted-foreground/60 mt-1">
            Active users will appear here once your app starts receiving
            traffic.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 pr-6">
      <ChartContainer
        config={chartConfig}
        className="!aspect-auto h-[300px] w-full overflow-hidden"
      >
        <BarChart accessibilityLayer data={fullData} margin={{ bottom: 5 }}>
          <defs>
            <linearGradient
              id="barGradientSettings"
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
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
            <linearGradient
              id="barGradientSettingsHover"
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
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
            fill="url(#barGradientSettings)"
            activeBar={{ fill: "url(#barGradientSettingsHover)" }}
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
    </div>
  );
});

export default SettingsActiveUsersChart;
