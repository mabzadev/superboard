import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import { centralTests, checksDirectory } from "../../tests/checks/project-config.mjs";
const shared = fileURLToPath(new URL("./src/", import.meta.url));
export function pluginTestConfig(root: string) {
	return centralTests(
		root,
		defineConfig({
			root,
			plugins: [react()],
			resolve: {
				alias: [
					{ find: "next/navigation", replacement: shared + "navigation.tsx" },
					{ find: "next/link", replacement: shared + "next-link.tsx" },
					{ find: "next/image", replacement: shared + "next-image.tsx" },
					{ find: "next/dynamic", replacement: shared + "next-dynamic.tsx" },
				],
			},
			test: {
				coverage: {
					provider: "v8",
					include: ["src/front/**/hooks/**"],
					exclude: [
						"**/__tests__/**",
						"**/lib/api.ts",
						"**/lib/RefreshTokenHelper.ts",
						"**/lib/Notifications.ts",
						"**/lib/ProtectedRoute.tsx",
						"**/lib/adminOnlyDisplay.tsx",
						"**/lib/copyTextHelper.tsx",
						"**/lib/config.ts",
						"**/hooks/use-mobile.ts",
						"**/hooks/useCreateLinkForm.ts",
						"**/hooks/useResolvedRedirects.ts",
						"**/hooks/useSetupProgress.ts",
					],
					thresholds: { statements: 80, branches: 70, functions: 80, lines: 80 },
				},
				environment: "jsdom",
				include: [
					`${checksDirectory(root)}/front/**/*.test.{ts,tsx}`,
					`${checksDirectory(root)}/unit/**/*.test.{ts,tsx}`,
					`${checksDirectory(root)}/integration/**/*.test.{ts,tsx}`,
				],
				setupFiles: [
					fileURLToPath(
						new URL("../../tests/checks/packages/supbrd-front-ui/setup.ts", import.meta.url),
					),
				],
				execArgv: ["--no-experimental-webstorage"],
				env: {
					NEXT_PUBLIC_API_URL: "https://api.example.test",
					NEXT_PUBLIC_AUTH_URL: "https://auth.example.test",
					NEXT_PUBLIC_CLIENT_ID: "front-test",
					NEXT_PUBLIC_DOCS_URL: "https://docs.example.test",
					NEXT_PUBLIC_SDK_URL: "https://sdk.example.test",
					NEXT_PUBLIC_SHORTLINK_URL: "https://links.example.test",
					NEXT_PUBLIC_MCP_URL: "https://mcp.example.test",
				},
			},
		}),
	);
}
