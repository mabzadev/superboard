import type { LogEvent, Logger } from "kysely";

import { getRequestContext } from "../request-context.js";

export const QUERY_LOG_ENV = "EMDASH_QUERY_LOG";
export const QUERY_LOG_PREFIX = "[emdash-query-log]";

export interface QueryEvent {
	sql: string;
	params: readonly unknown[];
	durationMs: number;
	route: string;
	method: string;
	phase: string;
}

export interface QueryRecorder {
	events: QueryEvent[];
	route: string;
	method: string;
	phase: string;
	flushed?: boolean;
	deferredFlush?: boolean;
}

export function createRecorder(route: string, method: string, phase: string): QueryRecorder {
	return { events: [], route, method, phase };
}

export function recordEvent(
	rec: QueryRecorder,
	sql: string,
	params: readonly unknown[],
	durationMs: number,
): void {
	rec.events.push({
		sql,
		params,
		durationMs,
		route: rec.route,
		method: rec.method,
		phase: rec.phase,
	});
}

export function flushRecorder(rec: QueryRecorder): void {
	if (rec.flushed) return;
	rec.flushed = true;
	for (const e of rec.events) {
		console.log(`${QUERY_LOG_PREFIX} ${JSON.stringify(e)}`);
	}
}

export function isInstrumentationEnabled(): boolean {
	return Boolean(
		typeof process !== "undefined" && process.env && process.env[QUERY_LOG_ENV] === "1",
	);
}

function kyselyLog(event: LogEvent): void {
	if (event.level !== "query") return;
	const ctx = getRequestContext();
	if (!ctx) return;
	const dur = event.queryDurationMillis;
	if (ctx.metrics) {
		const m = ctx.metrics;
		m.dbCount += 1;
		m.dbTotalMs += dur;
		const finishedAt = performance.now() - m.start;
		const startedAt = finishedAt - dur;
		if (m.dbFirstOffset === null) m.dbFirstOffset = startedAt;
		m.dbLastOffset = finishedAt;
	}
	if (ctx.queryRecorder) {
		recordEvent(ctx.queryRecorder, event.query.sql, event.query.parameters, dur);
	}
}

export function kyselyLogOption(): Logger {
	return kyselyLog;
}

export function recordRpc(count = 1): void {
	const ctx = getRequestContext();
	if (ctx?.metrics) ctx.metrics.rpcCount += count;
}
