import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import { centralTests } from "../../tests/checks/project-config.mjs";

export default centralTests(
	import.meta.url,
	defineConfig({
		plugins: [react()],
		test: {
			environment: "node",
			include: ["../../tests/checks/apps/site/plugin-front-menu-integration.test.tsx"],
		},
	}),
);
