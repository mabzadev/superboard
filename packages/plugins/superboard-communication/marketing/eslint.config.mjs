import plugin from "@typescript-eslint/eslint-plugin";
import parser from "@typescript-eslint/parser";

export default [
	{
		ignores: ["packages/plugins/superboard-communication/marketing/worker-configuration.d.ts"],
	},
	{
		files: [
			"packages/plugins/superboard-communication/marketing/src/**/*.ts",
			"tests/checks/plugins/superboard-communication/marketing/**/*.ts",
			"packages/plugins/superboard-communication/marketing/*.ts",
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
