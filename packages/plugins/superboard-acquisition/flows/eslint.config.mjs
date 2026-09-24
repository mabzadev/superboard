import plugin from "@typescript-eslint/eslint-plugin";
import parser from "@typescript-eslint/parser";

export default [
	{
		ignores: [
			"packages/plugins/superboard-acquisition/flows/worker-configuration.d.ts",
			"packages/plugins/superboard-acquisition/flows/.wrangler/**",
		],
	},
	{
		files: [
			"packages/plugins/superboard-acquisition/flows/src/**/*.ts",
			"tests/checks/plugins/superboard-acquisition/flows/**/*.ts",
			"packages/plugins/superboard-acquisition/flows/*.ts",
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
