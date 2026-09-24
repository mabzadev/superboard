import { DurableObject } from "cloudflare:workers";
import type { FlowWebSocketMessage } from "@superboard/contracts/flows";
import { configuredSecrets, matchesAnySecret } from "@superboard/contracts/secret";
import type { Env } from "../types";

type SocketAttachment = { userIdHash: string; connectedAt: string };

export class FlowRealtimeHub extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname !== "/connect") {
      return Response.json({ message: "Not found" }, { status: 404 });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return Response.json({ message: "WebSocket upgrade required" }, { status: 426 });
    }
    const allowed = await matchesAnySecret(
      request.headers.get("x-flow-hub-capability") ?? "",
      configuredSecrets(
        this.env.INTERNAL_API_TOKEN,
        this.env.INTERNAL_API_TOKEN_PREVIOUS,
      ),
    );
    const userIdHash = request.headers.get("x-flow-user-id-hash") ?? "";
    if (!allowed || !/^[a-f0-9]{64}$/u.test(userIdHash)) {
      return Response.json({ message: "WebSocket capability rejected" }, { status: 401 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      userIdHash,
      connectedAt: new Date().toISOString(),
    } satisfies SocketAttachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async broadcast(
    userIdHash: string,
    message: FlowWebSocketMessage,
  ): Promise<number> {
    const encoded = JSON.stringify(message);
    let delivered = 0;
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (attachment?.userIdHash !== userIdHash) continue;
      try {
        socket.send(encoded);
        delivered += 1;
      } catch {
        try {
          socket.close(1011, "Delivery failed");
        } catch {
          // Socket is already closed.
        }
      }
    }
    return delivered;
  }

  webSocketMessage(socket: WebSocket, message: ArrayBuffer | string): void {
    if (message === "ping") socket.send("pong");
  }

  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    socket.close(code, reason);
  }

  webSocketError(socket: WebSocket): void {
    try {
      socket.close(1011, "WebSocket error");
    } catch {
      // Socket is already closed.
    }
  }
}
