import "dotenv/config";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server.js";
import { createApp } from "./app.js";
import { configuredApiBaseUrl, normalizeApiBaseUrl } from "./api-client.js";

const isStdio = process.argv.includes("--stdio");
const SUPERBOARD_API_URL = configuredApiBaseUrl();

if (isStdio) {
  serveStdio(() => createServer(), {
    legacy: "serve",
    onerror: (error) => console.error(error),
  });
} else {
  const PORT = parseInt(process.env.PORT || "8080", 10);
  const PUBLIC_URL = normalizeApiBaseUrl(process.env.PUBLIC_URL, "PUBLIC_URL");

  const app = createApp(SUPERBOARD_API_URL, PUBLIC_URL);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`SuperBoard MCP server listening on port ${PORT}`);
    console.log(`Backend API: ${SUPERBOARD_API_URL}`);
  });
}
