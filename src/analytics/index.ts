import {
  initPosthog,
  identifyPosthog,
  capturePosthog,
  resetPosthog,
} from "./posthog";
import { initDataLayer, pushToDataLayer } from "./ads";
import { EVENTS, AD_CONVERSION_EVENTS, type EventName } from "./events";

export { EVENTS, type EventName };

export function initAnalytics() {
  initDataLayer();
  initPosthog();
}

export function identify(userId: string, traits?: Record<string, unknown>) {
  identifyPosthog(userId, traits);
}

export function trackEvent(
  event: EventName,
  properties?: Record<string, unknown>
) {
  // Always send to PostHog
  capturePosthog(event, properties);

  // Only send conversion events to GTM/Ads
  if (AD_CONVERSION_EVENTS.includes(event)) {
    pushToDataLayer(event, properties);
  }
}

export function reset() {
  resetPosthog();
}
