import { createDeferredTaskTracker } from "../../deferred-tasks.js";
import type { DeferredTaskTracker } from "../../deferred-tasks.js";

export const ASTRO_COOKIES_SYMBOL = Symbol.for("astro.cookies");

interface ScopedDbLifecycle {
	commit: () => void;
	close?: () => void;
}

export function requestEndedAuthenticated(
	isAuthenticated: boolean,
	cookies: { headers(): Iterable<string> },
): boolean {
	if (isAuthenticated) return true;
	for (const header of cookies.headers()) {
		if (header.startsWith("astro-session=")) return true;
	}
	return false;
}

export function coordinateScopedDbLifecycle(scoped: ScopedDbLifecycle): {
	closed?: Promise<void>;
	deferredTasks?: DeferredTaskTracker;
	lifecycle: ScopedDbLifecycle;
} {
	if (!scoped.close) return { lifecycle: scoped };

	const close = scoped.close;
	const deferredTasks = createDeferredTaskTracker(() => {
		try {
			close();
		} catch (error) {
			console.error("[emdash] request-scoped db close failed:", error);
		}
	});
	return {
		closed: deferredTasks.settled,
		deferredTasks,
		lifecycle: { commit: scoped.commit, close: deferredTasks.settle },
	};
}

export function wrapResponseForScopedClose(response: Response, close: () => void): Response {
	let closed = false;
	const runClose = () => {
		if (closed) return;
		closed = true;
		try {
			close();
		} catch (error) {
			console.error("[emdash] request-scoped db close failed:", error);
		}
	};

	if (!response.body) {
		runClose();
		return response;
	}

	const transform = new TransformStream<Uint8Array, Uint8Array>({
		flush: runClose,
		cancel: runClose,
	});
	const wrapped = new Response(response.body.pipeThrough(transform), response);
	const astroCookies = Reflect.get(response, ASTRO_COOKIES_SYMBOL);
	if (astroCookies !== undefined) {
		Reflect.set(wrapped, ASTRO_COOKIES_SYMBOL, astroCookies);
	}
	wrapped.headers.delete("Content-Length");
	return wrapped;
}

export async function finishScoped(
	scoped: ScopedDbLifecycle,
	run: () => Promise<Response>,
): Promise<Response> {
	let response: Response;
	try {
		response = await run();
	} catch (error) {
		commitSafely(scoped.commit);
		closeSafely(scoped.close);
		throw error;
	}
	try {
		scoped.commit();
	} catch (error) {
		closeSafely(scoped.close);
		throw error;
	}
	return scoped.close ? wrapResponseForScopedClose(response, scoped.close) : response;
}

function commitSafely(commit: () => void): void {
	try {
		commit();
	} catch (error) {
		console.error("[emdash] request-scoped db commit failed during error handling:", error);
	}
}

function closeSafely(close: (() => void) | undefined): void {
	if (!close) return;
	try {
		close();
	} catch (error) {
		console.error("[emdash] request-scoped db close failed during error handling:", error);
	}
}
