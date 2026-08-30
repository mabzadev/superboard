import type { Metadata } from "next";

import { WorkflowEditorPage } from "@/features/flows/editor/WorkflowEditorPage";

export const metadata: Metadata = {
  title: "Workflow editor · Flows · SuperBoard",
};

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <WorkflowEditorPage workflowId={id} />;
}
