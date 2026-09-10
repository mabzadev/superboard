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
					plugins: [
						// Match the admin package build so production-fallback tests keep source messages.
						["@lingui/babel-plugin-lingui-macro", { stripMessageField: false }],
					],
				},
			}),
		],
		test: {
			globals: true,
			include: ["../../tests/checks/packages/admin/**/*.test.{ts,tsx}"],
			setupFiles: ["../../tests/checks/packages/admin/setup.ts"],
			browser: {
				enabled: true,
				// Pin a non-UTC timezone so timestamp-parsing tests catch local-vs-UTC bugs.
				provider: playwright({
					contextOptions: { timezoneId: "America/New_York" },
				}),
				instances: [{ browser: "chromium" }],
				headless: true,
				// Desktop-width viewport: the content editor's settings panel is a
				// slide-in sheet below lg (1024px), which would make its controls
				// unreachable for the tests that exercise them directly.
				viewport: { width: 1280, height: 800 },
			},
		},
	}),
);
