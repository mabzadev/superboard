"use client";

import { useEffect } from "react";
import { initAnalytics } from "./index";
import { capturePosthog } from "./posthog";
import { registerGlobalErrorHandlers } from "@/lib/errorUtils";

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initAnalytics();
    registerGlobalErrorHandlers(capturePosthog);
  }, []);

  return <>{children}</>;
}
