import astro from "eslint-plugin-astro";
import imports from "eslint-plugin-import";
import accessibility from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import hooks from "eslint-plugin-react-hooks";
import typescript from "typescript-eslint";

import superboard from "./quality-rules.mjs";

export default [
	{ ignores: ["**/node_modules/**", "**/dist/**", "**/generated/**", "**/.wrangler/**"] },
	{
		files: ["**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"],
		languageOptions: { parser: typescript.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
	},
	...astro.configs["flat/recommended"],
	{
		files: ["**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,astro}"],
		plugins: { superboard, import: imports },
		linterOptions: { reportUnusedDisableDirectives: "off" },
		settings: {
			"import/resolver": {
				typescript: {
					project: [
						"tsconfig.json",
						"apps/*/tsconfig.json",
						"packages/*/tsconfig.json",
						"packages/plugins/*/tsconfig.json",
						"packages/plugins/*/*/tsconfig.json",
						"sdks/*/tsconfig.json",
					],
				},
			},
		},
		rules: {
			...Object.fromEntries(
				Object.keys(superboard.rules).map((name) => [`superboard/${name}`, "error"]),
			),
			"no-async-promise-executor": "error",
			"no-promise-executor-return": "error",
			"no-return-await": "off",
			"no-unsafe-finally": "error",
			"no-unsafe-optional-chaining": "error",
			"no-unreachable": "error",
			"no-unreachable-loop": "error",
			"no-constructor-return": "error",
			"no-constant-binary-expression": "error",
			"no-self-compare": "error",
			"no-template-curly-in-string": "error",
			"no-loss-of-precision": "error",
			"no-sparse-arrays": "error",
			"no-fallthrough": "error",
			"no-debugger": "error",
			"no-eval": "error",
			"no-implied-eval": "error",
			"no-new-func": "error",
			"no-script-url": "error",
			"no-proto": "error",
			"no-extend-native": "error",
			"no-empty": ["error", { allowEmptyCatch: false }],
			"no-empty-static-block": "error",
			"no-unsafe-negation": "error",
			"constructor-super": "error",
			"getter-return": "error",
			"for-direction": "error",
			"use-isnan": "error",
			"valid-typeof": "error",
			"import/no-self-import": "error",
			"import/no-mutable-exports": "error",
			"import/no-absolute-path": "error",
			"import/no-useless-path-segments": "error",
		},
	},
	{
		files: ["**/*.{jsx,tsx}"],
		plugins: { react, "react-hooks": hooks, "jsx-a11y": accessibility },
		settings: { react: { version: "19.2" } },
		rules: {
			...hooks.configs.recommended.rules,
			...accessibility.configs.recommended.rules,
			"react/jsx-key": ["error", { checkFragmentShorthand: true }],
			"react/no-array-index-key": "error",
			"react/no-danger": "error",
			"react/no-danger-with-children": "error",
			"react/no-unknown-property": "error",
			"react/button-has-type": "error",
			"react/jsx-no-target-blank": "error",
			"react/jsx-no-duplicate-props": "error",
		},
	},
	{
		files: ["{apps,packages,sdks}/**/src/**/*.{js,mjs,cjs,jsx,ts,tsx}"],
		rules: {
			"import/no-extraneous-dependencies": [
				"error",
				{ devDependencies: false, optionalDependencies: true, peerDependencies: true },
			],
		},
	},
	...astro.configs["flat/jsx-a11y-recommended"],
];
