import type { Context } from "hono";

import type { DataEnv, Deferral } from "../platform/env.js";
import { immediate } from "../platform/env.js";
import { failure } from "../platform/http.js";

export type DataContext = Context<{ Bindings: DataEnv }>;

export const DATA_PLUGIN_ID = "superboard-files";

export function deferralOf(c: DataContext): Deferral {
	try {
		return c.executionCtx;
	} catch {
		return immediate;
	}
}

export function action(scope: string, handler: (c: DataContext) => Promise<Response>) {
	return async (c: DataContext): Promise<Response> => {
		try {
			return await handler(c);
		} catch (cause) {
			return failure(cause, scope);
		}
	};
}

export function searchParams(c: DataContext): URLSearchParams {
	return new URL(c.req.url).searchParams;
}

export function wildcardPath(c: DataContext, prefix: string): string {
	const pathname = decodeURIComponent(new URL(c.req.url).pathname);
	return pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
}

export function param(c: DataContext, name: string): string {
	return c.req.param(name) ?? "";
}
