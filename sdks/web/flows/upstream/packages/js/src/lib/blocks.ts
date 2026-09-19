import {
  applyUpdateMessageToBlocksState,
  getApi,
  getWebSocketUrl,
  getUserLanguage,
  log,
  parseWebsocketMessage,
} from "@superboard/flows-shared";
import { blocks, blocksError, config, pendingMessages, updateBlocks } from "../store";
import { type Disconnect, websocket } from "./websocket";
import { packageAndVersion } from "./constants";

let disconnect: Disconnect | null = null;

type Props = {
  onAfterLoad: () => void;
};

export const connectToWebsocketAndFetchBlocks = ({ onAfterLoad }: Props): void => {
  const configuration = config.value;
  if (!configuration) return;

  const { environment, projectId, userId, apiUrl, customFetch, sdkKey } = configuration;
  const params = { environment, projectId, userId };
  const wsUrl = getWebSocketUrl(apiUrl, "/ws/sdk/block-updates", {
    ...params,
    ...(sdkKey ? { sdkKey } : {}),
  });

  const fetchBlocks = (): void => {
    blocksError.value = false;
    void getApi({ apiUrl, version: packageAndVersion, customFetch })
      .getBlocks({
        ...params,
        language: getUserLanguage(configuration.language),
        userProperties: configuration.userProperties,
      })
      .then((res) => {
        const blocksWithUpdates = pendingMessages.value.reduce(
          applyUpdateMessageToBlocksState,
          res.blocks,
        );
        updateBlocks(blocksWithUpdates);
        pendingMessages.value = [];

        onAfterLoad();
      })
      .catch((err: unknown) => {
        blocksError.value = true;
        log.error("Failed to load blocks", err);
      });
  };
  const onMessage = (event: MessageEvent<unknown>): void => {
    const data = parseWebsocketMessage(event);
    if (!data) return;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- there will be more message types in the future
    if (data.type === "block-updates") {
      if (!blocks.value) pendingMessages.value = [...pendingMessages.value, data];
      else updateBlocks(applyUpdateMessageToBlocksState(blocks.value ?? [], data));
    }
  };

  // Disconnect previous connection if it exists
  disconnect?.();

  let firstWebSocketOpen = true;
  const handleWebSocketOpen = (): void => {
    if (firstWebSocketOpen) {
      firstWebSocketOpen = false;
      return;
    }
    fetchBlocks();
  };

  fetchBlocks();
  const websocketResult = websocket({ url: wsUrl, onMessage, onOpen: handleWebSocketOpen });
  disconnect = websocketResult.disconnect;
};
