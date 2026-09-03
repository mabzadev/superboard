import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import { dashboardViteAliases } from "./dashboard-vite-aliases.mjs";

export default defineConfig({
	plugins: [react()],
	define: {
		"process.env.NEXT_PUBLIC_SUPERBOARD_EMDASH_FRONT": JSON.stringify("1"),
	},
	resolve: { alias: dashboardViteAliases },
	test: {
		environment: "jsdom",
		execArgv: ["--no-experimental-webstorage"],
		include: ["tests/front-release-dom-parity.test.tsx"],
		env: {
			NEXT_PUBLIC_API_URL: "https://api.example.test",
			NEXT_PUBLIC_AUTH_URL: "https://auth.example.test",
			NEXT_PUBLIC_CLIENT_ID: "site-parity-test",
			NEXT_PUBLIC_DOCS_URL: "https://docs.example.test",
			NEXT_PUBLIC_SDK_URL: "https://sdk.example.test",
			NEXT_PUBLIC_SHORTLINK_URL: "https://links.example.test",
			NEXT_PUBLIC_MCP_URL: "https://mcp.example.test",
		},
	},
});
