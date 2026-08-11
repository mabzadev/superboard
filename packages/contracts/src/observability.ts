export const OBSERVABILITY_HEALTH_PATH = "/internal/v1/health";
export const OBSERVABILITY_SUMMARY_PATH = "/internal/v1/summary";

export const OBSERVABILITY_WINDOWS_MINUTES = [5, 15, 60, 360, 1440] as const;
export type ObservabilityWindowMinutes = (typeof OBSERVABILITY_WINDOWS_MINUTES)[number];

export type RuntimeMetricRow = {
  service: string;
  outcome: string;
  eventType: string;
  invocations: number;
  exceptions: number;
  truncated: number;
  averageCpuMs: number | null;
  averageWallMs: number | null;
  maximumCpuMs: number | null;
  maximumWallMs: number | null;
};

export type ObservabilitySummary = {
  status: "ok" | "misconfigured" | "unavailable";
  environment: string;
  dataset: string;
  windowMinutes: ObservabilityWindowMinutes;
  generatedAt: string;
  rows: RuntimeMetricRow[];
  error?: string;
};
