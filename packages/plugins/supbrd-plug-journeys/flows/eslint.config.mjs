import plugin from "@typescript-eslint/eslint-plugin";
import parser from "@typescript-eslint/parser";

export default [
	{
		ignores: [
			"packages/plugins/supbrd-plug-journeys/flows/worker-configuration.d.ts",
			"packages/plugins/supbrd-plug-journeys/flows/.wrangler/**",
		],
	},
	{
		files: [
			"packages/plugins/supbrd-plug-journeys/flows/src/**/*.ts",
			"tests/checks/plugins/supbrd-plug-journeys/flows/**/*.ts",
			"packages/plugins/supbrd-plug-journeys/flows/*.ts",
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
