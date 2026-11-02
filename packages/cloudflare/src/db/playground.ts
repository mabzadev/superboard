import type { Dialect } from "kysely";

import { PreviewDODialect } from "./do-dialect.js";
import type { PreviewDBStub } from "./do-dialect.js";
import type { PreviewDOConfig } from "./do-types.js";

export function createDialect(_config: PreviewDOConfig): Dialect {
	const notInitialized: PreviewDBStub = {
		async query(): Promise<{ rows: Record<string, unknown>[] }> {
			throw new Error(
				"Playground database not initialized. " +
					"Ensure the playground middleware is registered in src/middleware.ts " +
					"and all requests go through it.",
			);
		},
	};

	return new PreviewDODialect({ getStub: () => notInitialized });
}

export { EmDashPreviewDB } from "./do-class.js";
export { isBlockedInPlayground } from "./do-playground-routes.js";
