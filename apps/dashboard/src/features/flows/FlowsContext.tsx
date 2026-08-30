"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { useProjectSelection } from "@/context/useProjectSelection";

type FlowsContextValue = {
  projectRef: string | null;
};

const FlowsContext = createContext<FlowsContextValue | null>(null);

export function FlowsProvider({ children }: { children: ReactNode }) {
  const { selectedProject } = useProjectSelection();
  const projectRef = selectedProject?.id ?? null;
  const value = useMemo<FlowsContextValue>(
    () => ({ projectRef }),
    [projectRef]
  );

  return (
    <FlowsContext.Provider value={value}>{children}</FlowsContext.Provider>
  );
}

export function useFlows() {
  const context = useContext(FlowsContext);
  if (!context) throw new Error("useFlows must be used inside FlowsProvider");
  return context;
}
