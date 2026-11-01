import { wsError } from "../store";

interface Props {
  url: string;
  onMessage: (event: MessageEvent<unknown>) => void;
  onOpen: () => void;
}

export type Disconnect = () => void;

export const websocket = (props: Props): { disconnect: Disconnect } => {
  let reconnectAttempts = 0;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  let disconnected = false;
  let disconnectCurrent: Disconnect = () => undefined;

  const connect = (): void => {
    if (disconnected) return;
    const socket = new WebSocket(props.url);
    wsError.value = false;

    const handleOpen = (): void => {
      props.onOpen();
      reconnectAttempts = 0;
    };
    const handleClose = (): void => {
      if (disconnected) return;
      if (reconnectTimeout !== null) clearTimeout(reconnectTimeout);
      reconnectTimeout = setTimeout(
        () => {
          reconnectTimeout = null;
          connect();
        },
        Math.min(1000 * 4 ** reconnectAttempts, 120_000),
      );
      reconnectAttempts += 1;
    };
    const handleError = (): void => {
      wsError.value = true;
    };

    socket.addEventListener("message", props.onMessage);
    socket.addEventListener("open", handleOpen);
    socket.addEventListener("close", handleClose);
    socket.addEventListener("error", handleError);

    disconnectCurrent = (): void => {
      socket.removeEventListener("message", props.onMessage);
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("close", handleClose);
      socket.removeEventListener("error", handleError);

      if (socket.readyState === WebSocket.CONNECTING) {
        socket.addEventListener("open", () => {
          socket.close();
        });
      } else socket.close();
    };
  };

  connect();

  return {
    disconnect: () => {
      disconnected = true;
      if (reconnectTimeout !== null) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
      disconnectCurrent();
    },
  };
};
