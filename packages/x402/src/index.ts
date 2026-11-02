import type { AstroIntegration } from "astro";

import type { X402Config } from "./types.js";

const VIRTUAL_MODULE_ID = "virtual:x402/config";
const RESOLVED_VIRTUAL_MODULE_ID = "\0" + VIRTUAL_MODULE_ID;

export function x402(config: X402Config): AstroIntegration {
	return {
		name: "@emdash-cms/x402",
		hooks: {
			"astro:config:setup": ({ addMiddleware, updateConfig }) => {
				updateConfig({
					vite: {
						plugins: [
							{
								name: "x402-virtual-config",
								resolveId(id: string) {
									if (id === VIRTUAL_MODULE_ID) return RESOLVED_VIRTUAL_MODULE_ID;
								},
								load(id: string) {
									if (id === RESOLVED_VIRTUAL_MODULE_ID) {
										return `export default ${JSON.stringify(config)}`;
									}
								},
							},
						],
						optimizeDeps: {
							exclude: ["@emdash-cms/x402"],
						},
						ssr: {
							optimizeDeps: {
								exclude: ["@emdash-cms/x402"],
							},
						},
					},
				});

				addMiddleware({
					entrypoint: "@emdash-cms/x402/middleware",
					order: "pre",
				});
			},
		},
	};
}

export type {
	EnforceOptions,
	EnforceResult,
	Network,
	Price,
	X402Config,
	X402Enforcer,
} from "./types.js";
