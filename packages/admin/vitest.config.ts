import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

import { centralTests } from "../../tests/checks/project-config.mjs";

export default centralTests(
	import.meta.url,
	defineConfig({
		plugins: [
			react({
				babel: {
					plugins: [["@lingui/babel-plugin-lingui-macro", { stripMessageField: false }]],
				},
			}),
		],
		test: {
			globals: true,
			include: ["../../tests/checks/packages/admin/**/*.test.{ts,tsx}"],
			setupFiles: ["../../tests/checks/packages/admin/setup.ts"],
			browser: {
				enabled: true,
				provider: playwright({
					contextOptions: { timezoneId: "America/New_York" },
				}),
				instances: [{ browser: "chromium" }],
				headless: true,
				viewport: { width: 1280, height: 800 },
			},
		},
	}),
);
