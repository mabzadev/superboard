import { createRequire } from "node:module";

import prettier from "eslint-config-prettier";
import imports from "eslint-plugin-import";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import hooks from "eslint-plugin-react-hooks";
import typescript from "typescript-eslint";

const frontRequire = createRequire(
	new URL("../../packages/supbrd-front-ui/package.json", import.meta.url),
);

export default [
	{ ignores: ["**/dist/**", "**/node_modules/**", "**/.wrangler/**", "**/coverage/**"] },
	{ ...react.configs.flat.recommended, files: ["**/*.{js,mjs,cjs,jsx,ts,tsx}"] },
	react.configs.flat["jsx-runtime"],
	...typescript.configs.recommended,
	{
		plugins: { "react-hooks": hooks, "jsx-a11y": jsxA11y, import: imports },
		settings: { react: { version: frontRequire("react/package.json").version } },
		rules: {
			...hooks.configs.recommended.rules,
			"import/no-anonymous-default-export": "warn",
			"react/no-unknown-property": "off",
			"react/prop-types": "off",
			"react/jsx-no-target-blank": "off",
			"jsx-a11y/alt-text": ["warn", { elements: ["img"], img: ["Image"] }],
			"jsx-a11y/aria-props": "warn",
			"jsx-a11y/aria-proptypes": "warn",
			"jsx-a11y/aria-unsupported-elements": "warn",
			"jsx-a11y/role-has-required-aria-props": "warn",
			"jsx-a11y/role-supports-aria-props": "warn",
			"react-hooks/set-state-in-effect": "off",
			"react-hooks/refs": "off",
			"react-hooks/purity": "off",
			"react-hooks/preserve-manual-memoization": "off",
			"react-hooks/incompatible-library": "off",
			"@typescript-eslint/no-unused-vars": [
				"warn",
				{ argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
			],
			"@typescript-eslint/no-explicit-any": "error",
			"no-console": ["warn", { allow: ["warn", "error"] }],
			"prefer-const": "error",
			"no-var": "error",
		},
	},
	{ files: ["**/*.{ts,tsx}"], rules: { "react/prop-types": "off" } },
	prettier,
];
