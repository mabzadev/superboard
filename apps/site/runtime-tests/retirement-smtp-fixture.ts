import { createServer, type Server, type Socket } from "node:net";

export function createSmtpCaptureFixture() {
	let server: Server | undefined;
	const sockets = new Set<Socket>();
	const messages: string[] = [];
	return async (request: Request) => {
		if (request.method === "DELETE") {
			for (const socket of sockets) socket.destroy();
			if (server)
				await new Promise<void>((resolve, reject) =>
					server!.close((error) => {
						if (error) {
							reject(error);
						} else {
							resolve();
						}
					}),
				);
			server = undefined;
			return Response.json({ closed: true });
		}
		if (!server) {
			server = createServer((socket) => {
				sockets.add(socket);
				socket.on("close", () => sockets.delete(socket));
				socket.on("error", () => socket.destroy());
				socket.write("220 localhost SMTP capture ready\r\n");
				let buffer = "";
				let content: string[] | null = null;
				socket.on("data", (chunk) => {
					buffer += chunk.toString();
					let end = buffer.indexOf("\r\n");
					while (end !== -1) {
						const line = buffer.slice(0, end);
						buffer = buffer.slice(end + 2);
						if (content) {
							if (line === ".") {
								messages.push(content.join("\r\n"));
								content = null;
								socket.write("250 local capture accepted\r\n");
							} else content.push(line.startsWith("..") ? line.slice(1) : line);
						} else if (line.startsWith("EHLO "))
							socket.write("250-localhost\r\n250 AUTH PLAIN\r\n");
						else if (line.startsWith("AUTH PLAIN ")) socket.write("235 authenticated\r\n");
						else if (line.startsWith("MAIL FROM:") || line.startsWith("RCPT TO:"))
							socket.write("250 accepted\r\n");
						else if (line === "DATA") {
							content = [];
							socket.write("354 send message\r\n");
						} else if (line === "QUIT") socket.end("221 closing\r\n");
						else socket.write("500 unsupported command\r\n");
						end = buffer.indexOf("\r\n");
					}
				});
			});
			await new Promise<void>((resolve, reject) => {
				server!.once("error", reject);
				server!.listen(0, "127.0.0.1", resolve);
			});
		}
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("SMTP fixture did not bind localhost");
		return Response.json({ port: address.port, messages });
	};
}
