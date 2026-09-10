import react from "@vitejs/plugin-react";
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
			environment: "jsdom",
			include: ["../../tests/checks/apps/labeler/ui/**/*.test.{ts,tsx}"],
		},
	}),
);
