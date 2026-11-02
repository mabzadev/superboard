import { AsyncLocalStorage } from "node:async_hooks";

import type { QueryRecorder } from "./database/instrumentation.js";
import type { DeferredTaskTracker } from "./deferred-tasks.js";

export interface RequestMetrics {
	start: number;
	dbCount: number;
	dbTotalMs: number;
	dbFirstOffset: number | null;
	dbLastOffset: number | null;
	cacheHits: number;
	cacheMisses: number;
	rpcCount: number;
}

export function createRequestMetrics(start: number): RequestMetrics {
	return {
		start,
		dbCount: 0,
		dbTotalMs: 0,
		dbFirstOffset: null,
		dbLastOffset: null,
		cacheHits: 0,
		cacheMisses: 0,
		rpcCount: 0,
	};
}

export interface EmDashRequestContext {
	editMode: boolean;
	preview?: {
		collection: string;
		id: string;
	};
	locale?: string;
	db?: unknown;
	dbIsIsolated?: boolean;
	queryRecorder?: QueryRecorder;
	metrics?: RequestMetrics;
	deferredTasks?: DeferredTaskTracker;
}

const ALS_KEY = Symbol.for("emdash:request-context");

const storage: AsyncLocalStorage<EmDashRequestContext> =
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- globalThis singleton pattern
	((globalThis as Record<symbol, unknown>)[ALS_KEY] as
		| AsyncLocalStorage<EmDashRequestContext>
		| undefined) ??
	(() => {
		const als = new AsyncLocalStorage<EmDashRequestContext>();
		(globalThis as Record<symbol, unknown>)[ALS_KEY] = als;
		return als;
	})();

export function runWithContext<T>(ctx: EmDashRequestContext, fn: () => T): T {
	return storage.run(ctx, fn);
}

export function getRequestContext(): EmDashRequestContext | undefined {
	return storage.getStore();
}
