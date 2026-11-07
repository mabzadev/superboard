export const DEFAULT_REPORT_TIMEZONE = "UTC";

const DAY_MILLISECONDS = 86_400_000;
const MAX_OFFSET_SEGMENTS = 24;
const formatters = new Map<string, Intl.DateTimeFormat>();

type LocalDayExpression = { sql: string; bindings: string[] };

export function reportTimezone(value: unknown): string {
	if (typeof value !== "string" || !value.trim()) return DEFAULT_REPORT_TIMEZONE;
	try {
		return new Intl.DateTimeFormat("en-US", { timeZone: value.trim() }).resolvedOptions().timeZone;
	} catch {
		return DEFAULT_REPORT_TIMEZONE;
	}
}

export async function projectReportTimezone(db: D1Database, projectId: string): Promise<string> {
	const row = await db
		.prepare("SELECT timezone FROM analytics_project_settings WHERE project_id = ?")
		.bind(projectId)
		.first<{ timezone: string | null }>();
	return reportTimezone(row?.timezone);
}

function formatter(timeZone: string): Intl.DateTimeFormat {
	let cached = formatters.get(timeZone);
	if (!cached) {
		cached = new Intl.DateTimeFormat("en-US", {
			timeZone,
			hourCycle: "h23",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
		formatters.set(timeZone, cached);
	}
	return cached;
}

function localParts(instant: number, timeZone: string) {
	const parts = new Map(
		formatter(timeZone)
			.formatToParts(new Date(instant))
			.map((part) => [part.type, Number(part.value)]),
	);
	const value = (type: Intl.DateTimeFormatPartTypes) => parts.get(type) ?? 0;
	return {
		year: value("year"),
		month: value("month"),
		day: value("day"),
		hour: value("hour"),
		minute: value("minute"),
		second: value("second"),
	};
}

function utcOffsetMinutes(instant: number, timeZone: string): number {
	const local = localParts(instant, timeZone);
	const wallClock = Date.UTC(
		local.year,
		local.month - 1,
		local.day,
		local.hour,
		local.minute,
		local.second,
	);
	return Math.round((wallClock - Math.floor(instant / 1_000) * 1_000) / 60_000);
}

export function localDate(instant: string, timeZone: string): string {
	if (timeZone === DEFAULT_REPORT_TIMEZONE) return instant.slice(0, 10);
	const local = localParts(Date.parse(instant), timeZone);
	const pad = (value: number, length = 2) => String(value).padStart(length, "0");
	return `${pad(local.year, 4)}-${pad(local.month)}-${pad(local.day)}`;
}

function firstInstantWithNewOffset(low: number, high: number, timeZone: string): number {
	const before = utcOffsetMinutes(low, timeZone);
	let start = low;
	let end = high;
	while (end - start > 1) {
		const middle = start + Math.floor((end - start) / 2);
		if (utcOffsetMinutes(middle, timeZone) === before) start = middle;
		else end = middle;
	}
	return end;
}

export function offsetSegments(
	from: string,
	to: string,
	timeZone: string,
): Array<{ until: string | null; offsetMinutes: number }> {
	const start = Date.parse(from);
	const end = Math.max(start, Date.parse(to));
	const segments: Array<{ until: string | null; offsetMinutes: number }> = [];
	let offset = utcOffsetMinutes(start, timeZone);
	for (
		let cursor = start;
		cursor < end && segments.length < MAX_OFFSET_SEGMENTS - 1;
		cursor += DAY_MILLISECONDS
	) {
		const next = Math.min(cursor + DAY_MILLISECONDS, end);
		const nextOffset = utcOffsetMinutes(next, timeZone);
		if (nextOffset === offset) continue;
		const transition = firstInstantWithNewOffset(cursor, next, timeZone);
		segments.push({ until: new Date(transition).toISOString(), offsetMinutes: offset });
		offset = nextOffset;
	}
	segments.push({ until: null, offsetMinutes: offset });
	return segments;
}

export function localDayExpression(
	column: string,
	from: string,
	to: string,
	timeZone: string,
): LocalDayExpression {
	if (timeZone === DEFAULT_REPORT_TIMEZONE)
		return { sql: `substr(${column}, 1, 10)`, bindings: [] };
	const segments = offsetSegments(from, to, timeZone);
	const shift = (minutes: number) => `${minutes >= 0 ? "+" : ""}${minutes} minutes`;
	const last = segments.at(-1) ?? { until: null, offsetMinutes: 0 };
	const bounded = segments.slice(0, -1);
	if (bounded.length === 0)
		return { sql: `date(${column}, ?)`, bindings: [shift(last.offsetMinutes)] };
	return {
		sql: `CASE ${bounded.map(() => `WHEN ${column} < ? THEN date(${column}, ?)`).join(" ")} ELSE date(${column}, ?) END`,
		bindings: [
			...bounded.flatMap((segment) => [segment.until ?? "", shift(segment.offsetMinutes)]),
			shift(last.offsetMinutes),
		],
	};
}
