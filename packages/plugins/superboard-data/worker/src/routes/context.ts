import type { Context } from "hono";

import type { DataEnv, Deferral } from "../platform/env.js";
import { immediate } from "../platform/env.js";
import { DataError, failure } from "../platform/http.js";

export type DataContext = Context<{ Bindings: DataEnv }>;

export const DATA_PLUGINS = {
	database: "superboard-database",
	storage: "superboard-storage",
	functions: "superboard-functions",
	vectors: "superboard-vectors",
} as const;

export type DataBrick = keyof typeof DATA_PLUGINS;

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
	let pathname: string;
	try {
		pathname = decodeURIComponent(new URL(c.req.url).pathname);
	} catch {
		throw new DataError(422, "path_invalid", "The path is not valid percent-encoding");
	}
	return pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
}

export function param(c: DataContext, name: string): string {
	return c.req.param(name) ?? "";
}
