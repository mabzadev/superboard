import plugin from "@typescript-eslint/eslint-plugin";
import parser from "@typescript-eslint/parser";

export default [
	{
		ignores: ["packages/plugins/superboard-support/worker/worker-configuration.d.ts"],
	},
	{
		files: [
			"packages/plugins/superboard-support/worker/src/**/*.ts",
			"tests/checks/plugins/superboard-support/worker/**/*.ts",
			"packages/plugins/superboard-support/worker/*.ts",
		],
		languageOptions: { parser, parserOptions: { ecmaVersion: 2022, sourceType: "module" } },
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
