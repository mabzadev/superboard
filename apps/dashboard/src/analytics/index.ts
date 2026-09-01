import { initDataLayer, pushToDataLayer } from "./ads";
import { EVENTS, AD_CONVERSION_EVENTS, type EventName } from "./events";

export { EVENTS, type EventName };

export function initAnalytics() {
  initDataLayer();
}

export function trackEvent(
  event: EventName,
  properties?: Record<string, unknown>
) {
  if (AD_CONVERSION_EVENTS.includes(event)) {
    pushToDataLayer(event, properties);
  }
}
