import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	STREAM_END_PREFIX,
	wrapBodyForStreamMetrics,
} from "../../../../../../packages/core/src/astro/middleware/stream-end-metrics.js";
import {
	QUERY_LOG_ENV,
	QUERY_LOG_PREFIX,
	createRecorder,
	flushRecorder,
	recordEvent,
} from "../../../../../../packages/core/src/database/instrumentation.js";
import {
	createRequestMetrics,
	runWithContext,
	type RequestMetrics,
} from "../../../../../../packages/core/src/request-context.js";

const ASTRO_COOKIES_SYMBOL = Symbol.for("astro.cookies");

function wrapInContext(
	response: Response,
	metrics: RequestMetrics,
	extra: { queryRecorder?: ReturnType<typeof createRecorder> } = {},
): Response {
	return runWithContext({ editMode: false, metrics, ...extra }, () =>
		wrapBodyForStreamMetrics(response),
	);
}

function captureStreamEndLines(): { lines: string[]; spy: ReturnType<typeof vi.spyOn> } {
	const lines: string[] = [];
	const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
		const line = args.map(String).join(" ");
		if (line.startsWith(STREAM_END_PREFIX)) lines.push(line);
	});
	return { lines, spy };
}

function parseSnapshot(line: string): Record<string, unknown> {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- test helper parsing our own NDJSON
	return JSON.parse(line.slice(STREAM_END_PREFIX.length + 1)) as Record<string, unknown>;
}

function captureQueryLogLines(): { lines: string[]; spy: ReturnType<typeof vi.spyOn> } {
	const lines: string[] = [];
	const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
		const line = args.map(String).join(" ");
		if (line.startsWith(QUERY_LOG_PREFIX)) lines.push(line);
	});
	return { lines, spy };
}

describe("wrapBodyForStreamMetrics", () => {
	beforeEach(() => {
		vi.stubEnv(QUERY_LOG_ENV, "1");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it("returns the response unchanged when instrumentation is disabled", () => {
		vi.stubEnv(QUERY_LOG_ENV, "");
		const metrics = createRequestMetrics(performance.now());
		const response = new Response("hello");
		const wrapped = wrapInContext(response, metrics);
		expect(wrapped).toBe(response);
	});

	it("returns a null-body response unchanged", () => {
		const metrics = createRequestMetrics(performance.now());
		const response = new Response(null, { status: 204 });
		const wrapped = wrapInContext(response, metrics);
		expect(wrapped).toBe(response);
	});

	it("returns the response unchanged when no request metrics are attached", () => {
		const response = new Response("hello");
		const wrapped = wrapBodyForStreamMetrics(response);
		expect(wrapped).toBe(response);
	});

	it("passes body bytes through unchanged", async () => {
		const { lines } = captureStreamEndLines();
		const metrics = createRequestMetrics(performance.now());
		const body = "<html><body>chunked content éè—</body></html>";
		const response = new Response(body, {
			status: 201,
			headers: { "Content-Type": "text/html", "X-Custom": "kept" },
		});

		const wrapped = wrapInContext(response, metrics);
		expect(wrapped).not.toBe(response);
		expect(wrapped.status).toBe(201);
		expect(wrapped.headers.get("Content-Type")).toBe("text/html");
		expect(wrapped.headers.get("X-Custom")).toBe("kept");
		await expect(wrapped.text()).resolves.toBe(body);
		expect(lines).toHaveLength(1);
	});

	it("snapshots metrics at stream end, including queries recorded after headers", async () => {
		const { lines } = captureStreamEndLines();
		const metrics = createRequestMetrics(performance.now());
		metrics.dbCount = 1;
		metrics.dbTotalMs = 3;
		metrics.dbFirstOffset = 1;
		metrics.dbLastOffset = 4;

		const wrapped = wrapInContext(new Response("streamed page"), metrics);

		metrics.dbCount = 7;
		metrics.dbTotalMs = 120.5;
		metrics.dbLastOffset = 250;
		metrics.cacheHits = 3;
		metrics.cacheMisses = 2;

		expect(lines).toHaveLength(0);
		await wrapped.text();
		expect(lines).toHaveLength(1);

		const snapshot = parseSnapshot(lines[0]!);
		expect(snapshot).toMatchObject({
			dbCount: 7,
			dbTotalMs: 120.5,
			dbFirstOffset: 1,
			dbLastOffset: 250,
			cacheHits: 3,
			cacheMisses: 2,
		});
		expect(typeof snapshot.totalMs).toBe("number");
		expect(snapshot.totalMs).toBeGreaterThanOrEqual(0);
	});

	it("includes route, method, and phase from the query recorder", async () => {
		const { lines } = captureStreamEndLines();
		const metrics = createRequestMetrics(performance.now());
		const queryRecorder = createRecorder("/posts", "GET", "cold");

		const wrapped = wrapInContext(new Response("page"), metrics, { queryRecorder });
		await wrapped.text();

		expect(lines).toHaveLength(1);
		expect(parseSnapshot(lines[0]!)).toMatchObject({
			route: "/posts",
			method: "GET",
			phase: "cold",
		});
	});

	it("defers the recorder flush to stream end, capturing queries recorded after headers", async () => {
		const { lines } = captureQueryLogLines();
		const metrics = createRequestMetrics(performance.now());
		const recorder = createRecorder("/posts/example", "GET", "cold");
		recordEvent(recorder, "select 1", [], 1);

		const wrapped = wrapInContext(new Response("streamed page"), metrics, {
			queryRecorder: recorder,
		});

		expect(recorder.deferredFlush).toBe(true);

		recordEvent(recorder, "select 2", [], 1);
		recordEvent(recorder, "select 3", [], 1);

		expect(lines).toHaveLength(0);

		await wrapped.text();

		expect(lines).toHaveLength(3);
		expect(lines.some((l) => l.includes("select 2"))).toBe(true);
		expect(lines.some((l) => l.includes("select 3"))).toBe(true);
	});

	it("is idempotent: a fallback flush after stream end does not double-emit", async () => {
		const { lines } = captureQueryLogLines();
		const metrics = createRequestMetrics(performance.now());
		const recorder = createRecorder("/posts/example", "GET", "warm");
		recordEvent(recorder, "select 1", [], 1);

		const wrapped = wrapInContext(new Response("page"), metrics, { queryRecorder: recorder });
		await wrapped.text();
		expect(lines).toHaveLength(1);

		flushRecorder(recorder);
		expect(lines).toHaveLength(1);
	});

	it("forwards the Astro cookies symbol and drops Content-Length", () => {
		const metrics = createRequestMetrics(performance.now());
		const cookiesMarker = { _marker: "astro-cookies" };
		const response = new Response("hello", {
			headers: { "Content-Length": "5" },
		});
		Reflect.set(response, ASTRO_COOKIES_SYMBOL, cookiesMarker);

		const wrapped = wrapInContext(response, metrics);
		expect(wrapped).not.toBe(response);
		expect(Reflect.get(wrapped, ASTRO_COOKIES_SYMBOL)).toBe(cookiesMarker);
		expect(wrapped.headers.has("Content-Length")).toBe(false);
	});
});
