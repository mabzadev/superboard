"use client";

import { useEffect } from "react";
import { initAnalytics } from "./index";

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initAnalytics();
  }, []);

  return <>{children}</>;
}
