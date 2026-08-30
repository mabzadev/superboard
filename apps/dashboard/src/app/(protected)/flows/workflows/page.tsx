import type { Metadata } from "next";

import { FlowsWorkflowsPage } from "@/features/flows/WorkflowsPage";

export const metadata: Metadata = { title: "Workflows · Flows · SuperBoard" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ origin?: string }>;
}) {
  const { origin } = await searchParams;
  return <FlowsWorkflowsPage initialOrigin={origin} />;
}
