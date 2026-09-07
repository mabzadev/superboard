import { initDataLayer, pushToDataLayer } from "./ads.js";
import { EVENTS, AD_CONVERSION_EVENTS, type EventName } from "./events.js";

export { EVENTS, type EventName };

export function initAnalytics() {
	initDataLayer();
}

export function trackEvent(event: EventName, properties?: Record<string, unknown>) {
	if (AD_CONVERSION_EVENTS.includes(event)) {
		pushToDataLayer(event, properties);
	}
}
