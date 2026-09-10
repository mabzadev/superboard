import plugin from "@typescript-eslint/eslint-plugin";
import parser from "@typescript-eslint/parser";

export default [
	{
		ignores: ["packages/plugins/supbrd-plug-support/worker/worker-configuration.d.ts"],
	},
	{
		files: [
			"packages/plugins/supbrd-plug-support/worker/src/**/*.ts",
			"tests/checks/plugins/supbrd-plug-support/worker/**/*.ts",
			"packages/plugins/supbrd-plug-support/worker/*.ts",
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
