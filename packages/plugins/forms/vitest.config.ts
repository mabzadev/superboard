import { getViteConfig } from "astro/config";

import { centralTests } from "../../../tests/checks/project-config.mjs";

export default centralTests(
	import.meta.url,
	getViteConfig({
		test: {
			globals: true,
			environment: "node",
			include: ["../../../tests/checks/plugins/forms/**/*.test.{ts,tsx}"],
		},
	}),
);
