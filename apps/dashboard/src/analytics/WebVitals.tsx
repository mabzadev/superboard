"use client";

import { useReportWebVitals } from "next/web-vitals";
import { capturePosthog } from "./posthog";
import { EVENTS } from "./events";

export function WebVitals() {
  useReportWebVitals((metric) => {
    capturePosthog(EVENTS.WEB_VITALS, {
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      delta: metric.delta,
      id: metric.id,
      navigationType: metric.navigationType,
    });
  });

  return null;
}
