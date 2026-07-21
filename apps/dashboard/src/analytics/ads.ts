declare global {
  interface Window {
    dataLayer: Record<string, unknown>[];
  }
}

export function initDataLayer() {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
}

export function pushToDataLayer(
  event: string,
  properties?: Record<string, unknown>
) {
  if (typeof window === "undefined") return;
  if (!window.dataLayer) {
    window.dataLayer = [];
  }

  window.dataLayer.push({
    event,
    ...properties,
  });
}
