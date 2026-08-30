import type { Metadata } from "next";

import { FlowsOverviewPage } from "@/features/flows/OverviewPage";

export const metadata: Metadata = { title: "Flows · SuperBoard" };

export default function Page() {
  return <FlowsOverviewPage />;
}
