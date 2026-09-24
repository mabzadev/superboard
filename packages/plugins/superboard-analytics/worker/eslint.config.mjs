import plugin from "@typescript-eslint/eslint-plugin";
import parser from "@typescript-eslint/parser";

export default [
	{ ignores: ["packages/plugins/superboard-analytics/worker/worker-configuration.d.ts"] },
	{
		files: [
			"packages/plugins/superboard-analytics/worker/src/**/*.ts",
			"tests/checks/plugins/superboard-analytics/worker/**/*.ts",
			"packages/plugins/superboard-analytics/worker/*.ts",
		],
		languageOptions: {
			parser,
			parserOptions: { ecmaVersion: 2022, sourceType: "module" },
		},
		plugins: { "@typescript-eslint": plugin },
		rules: {
			"@typescript-eslint/no-explicit-any": "error",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{ argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
			],
			"no-var": "error",
			"prefer-const": "error",
		},
	},
];
