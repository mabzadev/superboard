import posthog from "posthog-js";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST;

let isInitialized = false;

export function initPosthog() {
  if (typeof window === "undefined") return;
  if (!POSTHOG_KEY) {
    console.warn("PostHog key not configured");
    return;
  }
  if (!POSTHOG_HOST) {
    console.warn("PostHog host not configured");
    return;
  }
  if (isInitialized) return;

  const isProduction = process.env.NEXT_PUBLIC_ENV === "production";

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true,
    persistence: "localStorage+cookie",
    cross_subdomain_cookie: true,
    disable_session_recording: !isProduction,
    session_recording: {
      recordCrossOriginIframes: false,
    },
  });

  isInitialized = true;
}

export function identifyPosthog(
  userId: string,
  traits?: Record<string, unknown>
) {
  if (!isInitialized) return;
  posthog.identify(userId, traits);
}

export function capturePosthog(
  event: string,
  properties?: Record<string, unknown>
) {
  if (!isInitialized) return;
  posthog.capture(event, properties);
}

export function resetPosthog() {
  if (!isInitialized) return;
  posthog.reset();
}
