import { getDefaultApiUrl, getPathname, sendEvents, withSdkKey } from "@superboard/flows-shared";
import { handleDocumentClick } from "./lib/click";
import { connectToWebsocketAndFetchBlocks } from "./lib/blocks";
import { addHandlers } from "./lib/handler";
import { config, pathname } from "./store";
import { type FlowsOptions } from "./types/configuration";
import { createKeydownDebugListener, initDebugPanel } from "./lib/debug";

let locationChangeInterval: number | null = null;

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

  if (locationChangeInterval !== null) clearInterval(locationChangeInterval);
  locationChangeInterval = window.setInterval(() => {
    const newPathname = getPathname();
    if (pathname.value !== newPathname) {
      pathname.value = newPathname;
    }
  }, 250);

  addHandlers([
    { type: "click", handler: handleDocumentClick },
    { type: "keydown", handler: createKeydownDebugListener(onDebugShortcut) },
  ]);

  initDebugPanel(debug);
};
