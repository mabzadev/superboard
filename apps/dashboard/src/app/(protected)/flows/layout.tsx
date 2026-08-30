import type { ReactNode } from "react";

import { FlowsProvider } from "@/features/flows/FlowsContext";

export default function FlowsLayout({ children }: { children: ReactNode }) {
  return <FlowsProvider>{children}</FlowsProvider>;
}
