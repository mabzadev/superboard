import { getDefaultApiUrl, getPathname, sendEvents, withSdkKey } from "@superboard/flows-shared";
import { handleDocumentClick } from "./lib/click";
import { connectToWebsocketAndFetchBlocks } from "./lib/blocks";
import { addHandlers } from "./lib/handler";
import { config, pathname } from "./store";
import { type FlowsOptions } from "./types/configuration";
import { createKeydownDebugListener, initDebugPanel } from "./lib/debug";

const LOCATION_CHANGE_EVENT = "superboard-flows:locationchange";
const HISTORY_PATCHED = Symbol.for("superboard.flows.historyPatched");
let stopLocationTracking: (() => void) | null = null;

const patchHistory = (): void => {
  const history = window.history as History & { [HISTORY_PATCHED]?: true };
  if (history[HISTORY_PATCHED]) return;
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method];
    history[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
      const result = original.apply(this, args);
      window.dispatchEvent(new Event(LOCATION_CHANGE_EVENT));
      return result;
    };
  }
  history[HISTORY_PATCHED] = true;
};

const trackLocation = (): (() => void) => {
  const update = (): void => {
    const newPathname = getPathname();
    if (pathname.value !== newPathname) {
      pathname.value = newPathname;
    }
  };
  patchHistory();
  const events = ["popstate", "hashchange", LOCATION_CHANGE_EVENT];
  for (const type of events) window.addEventListener(type, update);
  update();
  return () => {
    for (const type of events) window.removeEventListener(type, update);
  };
};

/**
 * Identify the user and initialize `@superboard/flows-js`.
 *
 * @param options - The configuration options for Flows
 */
export const init = ({ debug, onDebugShortcut, ...options }: FlowsOptions): void => {
  const apiUrl = options.apiUrl ?? getDefaultApiUrl();
  const customFetch = withSdkKey(options.customFetch, options.sdkKey);
  config.value = { ...options, apiUrl, customFetch };

  window.__flows_onNavigate = options.onNavigate;

  connectToWebsocketAndFetchBlocks({
    onAfterLoad: () => {
      void sendEvents(customFetch);
    },
  });

  stopLocationTracking?.();
  stopLocationTracking = trackLocation();

  addHandlers([
    { type: "click", handler: handleDocumentClick },
    { type: "keydown", handler: createKeydownDebugListener(onDebugShortcut) },
  ]);

  initDebugPanel(debug);
};
