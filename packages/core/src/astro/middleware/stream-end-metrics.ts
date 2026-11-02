import { flushRecorder, isInstrumentationEnabled } from "../../database/instrumentation.js";
import { getRequestContext } from "../../request-context.js";
import { ASTRO_COOKIES_SYMBOL } from "./scoped-db.js";

export const STREAM_END_PREFIX = "[emdash-stream-end]";

export interface StreamEndSnapshot {
	route?: string;
	method?: string;
	phase?: string;
	totalMs: number;
	dbCount: number;
	dbTotalMs: number;
	dbFirstOffset: number | null;
	dbLastOffset: number | null;
	cacheHits: number;
	cacheMisses: number;
}

export function wrapBodyForStreamMetrics(response: Response): Response {
	if (!isInstrumentationEnabled()) return response;
	if (!response.body) return response;

	const ctx = getRequestContext();
	const metrics = ctx?.metrics;
	if (!metrics) return response;
	const recorder = ctx?.queryRecorder;

	if (recorder) recorder.deferredFlush = true;

	const transform = new TransformStream<Uint8Array, Uint8Array>({
		flush() {
			const snapshot: StreamEndSnapshot = {
				route: recorder?.route,
				method: recorder?.method,
				phase: recorder?.phase,
				totalMs: performance.now() - metrics.start,
				dbCount: metrics.dbCount,
				dbTotalMs: metrics.dbTotalMs,
				dbFirstOffset: metrics.dbFirstOffset,
				dbLastOffset: metrics.dbLastOffset,
				cacheHits: metrics.cacheHits,
				cacheMisses: metrics.cacheMisses,
			};
			console.log(`${STREAM_END_PREFIX} ${JSON.stringify(snapshot)}`);
			if (recorder) flushRecorder(recorder);
		},
	});

	const wrapped = new Response(response.body.pipeThrough(transform), response);
	const astroCookies = Reflect.get(response, ASTRO_COOKIES_SYMBOL);
	if (astroCookies !== undefined) {
		Reflect.set(wrapped, ASTRO_COOKIES_SYMBOL, astroCookies);
	}
	wrapped.headers.delete("Content-Length");
	return wrapped;
}
