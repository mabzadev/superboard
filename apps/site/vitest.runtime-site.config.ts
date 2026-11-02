import runtime, { siteMigrationRuntimeTests } from "./vitest.runtime.config.ts";

export default {
	...runtime,
	test: {
		...runtime.test,
		include: siteMigrationRuntimeTests,
		exclude: [],
		setupFiles: ["../../tests/checks/apps/site/runtime/apply-site-migrations.ts"],
	},
};
