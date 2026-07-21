import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { createApp } from "./app.js";

const isStdio = process.argv.includes("--stdio");

if (isStdio) {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
} else {
  const PORT = parseInt(process.env.PORT || "8080", 10);
  const GROVS_API_URL = process.env.GROVS_API_URL || "https://mcp.grovs.io";
  const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

  const app = createApp(GROVS_API_URL, PUBLIC_URL);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Grovs MCP server listening on port ${PORT}`);
    console.log(`Backend API: ${GROVS_API_URL}`);
  });
}
