import { GET } from "@/lib/api";
import {
  getSupportAction,
  getSupportResource,
  listSupportResource,
  postSupportAction,
  supportProjectPath,
} from "./nativeClient";

export type SupportReport = {
  period: { from: string | null; to: string | null };
  totals: {
    conversations?: number;
    backlog?: number;
    resolved?: number;
    first_response_seconds?: number | null;
    resolution_seconds?: number | null;
  };
  dimensions: {
    inbox: Array<{ dimension: string; conversations: number }>;
    agent: Array<{ dimension: string; conversations: number }>;
    team: Array<{ dimension: string; conversations: number }>;
    label: Array<{ dimension: string; conversations: number }>;
    channel: Array<{ dimension: string; conversations: number }>;
    provider: Array<{ dimension: string; conversations: number }>;
  };
  sla: Array<{ status: string; count: number }>;
  csat: { responses: number; average: number | null };
  proactive_support: Array<{ status: string; count: number }>;
};

export type SupportReportExport = {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  filters: { from?: string; to?: string };
  result: { count?: number };
  error_code: string | null;
  download_ref: string | null;
  created_at: string;
  updated_at: string;
};

export const getSupportReports = (
  projectRef: string,
  period: { from?: string; to?: string } = {}
) => getSupportAction<SupportReport>(projectRef, "reports", period);

export const exportSupportReports = (
  projectRef: string,
  filters: { from?: string; to?: string }
) =>
  postSupportAction<{ id: string; status: "queued" }>(
    projectRef,
    "reports/exports",
    { filters }
  );

export const listSupportReportExports = (projectRef: string) =>
  listSupportResource<SupportReportExport>(projectRef, "reports/exports", {
    limit: 20,
  });

export const getSupportReportExport = (projectRef: string, id: string) =>
  getSupportResource<SupportReportExport>(projectRef, "reports/exports", id);

export const downloadSupportReportExport = async (
  projectRef: string,
  id: string
) =>
  (
    await GET(
      `${supportProjectPath(projectRef, "reports/exports")}/${encodeURIComponent(id)}/download`,
      { responseType: "blob" }
    )
  ).data as Blob;
