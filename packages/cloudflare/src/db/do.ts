import { env } from "cloudflare:workers";
import type { Dialect } from "kysely";

import type { EmDashPreviewDB } from "./do-class.js";
import { PreviewDODialect } from "./do-dialect.js";
import type { PreviewDBStub } from "./do-dialect.js";
import type { PreviewDOConfig } from "./do-types.js";

export function createDialect(config: PreviewDOConfig & { name: string }): Dialect {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- Worker binding accessed from untyped env object
	const ns = (env as Record<string, unknown>)[config.binding];

	if (!ns) {
		throw new Error(
			`Durable Object binding "${config.binding}" not found in environment. ` +
				`Check your wrangler.jsonc configuration:\n\n` +
				`[durable_objects]\n` +
				`bindings = [\n` +
				`  { name = "${config.binding}", class_name = "EmDashPreviewDB" }\n` +
				`]\n\n` +
				`[[migrations]]\n` +
				`tag = "v1"\n` +
				`new_sqlite_classes = ["EmDashPreviewDB"]`,
		);
	}

	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- DO namespace binding from untyped env object
	const namespace = ns as DurableObjectNamespace<EmDashPreviewDB>;
	const id = namespace.idFromName(config.name);

	const getStub = (): PreviewDBStub => {
		const stub = namespace.get(id);
		return stub;
	};

	return new PreviewDODialect({ getStub });
}

export { EmDashPreviewDB } from "./do-class.js";
export { createPreviewMiddleware } from "./do-preview.js";
export type { PreviewMiddlewareConfig } from "./do-preview.js";
export { isBlockedInPreview } from "./do-preview-routes.js";
export { signPreviewUrl, verifyPreviewSignature } from "./do-preview-sign.js";
