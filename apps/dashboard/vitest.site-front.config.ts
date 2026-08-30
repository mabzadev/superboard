import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    execArgv: ["--no-experimental-webstorage"],
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/context/__tests__/*.site.tsx"],
    env: {
      NEXT_PUBLIC_API_URL: "https://api.example.test",
      NEXT_PUBLIC_AUTH_URL: "https://auth.example.test",
      NEXT_PUBLIC_CLIENT_ID: "dashboard-test",
      NEXT_PUBLIC_DOCS_URL: "https://docs.example.test",
      NEXT_PUBLIC_SDK_URL: "https://sdk.example.test",
      NEXT_PUBLIC_SHORTLINK_URL: "https://links.example.test",
      NEXT_PUBLIC_MCP_URL: "https://mcp.example.test",
    },
  },
  resolve: {
    alias: [
      {
        find: "@/context/useProjectSelection",
        replacement: path.resolve(
          import.meta.dirname,
          "../site/src/compat/dashboard-project-context.tsx"
        ),
      },
      { find: "@", replacement: path.resolve(import.meta.dirname, "./src") },
    ],
  },
});
