import { DataError } from "../platform/http.js";

interface Field {
	values: Set<number>;
	wildcard: boolean;
}

export interface CronExpression {
	minute: Field;
	hour: Field;
	day: Field;
	month: Field;
	weekday: Field;
}

const SEARCH_LIMIT_MINUTES = 366 * 24 * 60;

export function parseCron(expression: string): CronExpression {
	const parts = expression.trim().split(/\s+/u);
	const [minute, hour, day, month, weekday] = parts;
	if (parts.length !== 5 || !minute || !hour || !day || !month || !weekday) throw invalid();
	const weekdays = parseField(weekday, [0, 7]);
	return {
		minute: parseField(minute, [0, 59]),
		hour: parseField(hour, [0, 23]),
		day: parseField(day, [1, 31]),
		month: parseField(month, [1, 12]),
		weekday: {
			...weekdays,
			values: new Set([...weekdays.values].map((value) => (value === 7 ? 0 : value))),
		},
	};
}

export function nextRun(expression: string | CronExpression, after: Date): Date {
	const cron = typeof expression === "string" ? parseCron(expression) : expression;
	const candidate = new Date(after.getTime());
	candidate.setUTCSeconds(0, 0);
	candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
	for (let step = 0; step < SEARCH_LIMIT_MINUTES;) {
		if (!cron.month.values.has(candidate.getUTCMonth() + 1)) {
			candidate.setUTCMonth(candidate.getUTCMonth() + 1, 1);
			candidate.setUTCHours(0, 0, 0, 0);
			step += 28 * 24 * 60;
			continue;
		}
		if (!dayMatches(cron, candidate)) {
			candidate.setUTCDate(candidate.getUTCDate() + 1);
			candidate.setUTCHours(0, 0, 0, 0);
			step += 24 * 60;
			continue;
		}
		if (!cron.hour.values.has(candidate.getUTCHours())) {
			candidate.setUTCHours(candidate.getUTCHours() + 1, 0, 0, 0);
			step += 60;
			continue;
		}
		if (!cron.minute.values.has(candidate.getUTCMinutes())) {
			candidate.setUTCMinutes(candidate.getUTCMinutes() + 1, 0, 0);
			step += 1;
			continue;
		}
		return candidate;
	}
	throw new DataError(422, "cron_never_runs", "The schedule never matches a date");
}

function dayMatches(cron: CronExpression, date: Date): boolean {
	const day = cron.day.values.has(date.getUTCDate());
	const weekday = cron.weekday.values.has(date.getUTCDay());
	if (cron.day.wildcard && cron.weekday.wildcard) return true;
	if (cron.day.wildcard) return weekday;
	if (cron.weekday.wildcard) return day;
	return day || weekday;
}

function parseField(field: string, [minimum, maximum]: [number, number]): Field {
	const values = new Set<number>();
	for (const item of field.split(",")) {
		const match = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/u.exec(item);
		if (!match) throw invalid();
		const step = match[4] === undefined ? 1 : Number(match[4]);
		const start = match[1] === "*" ? minimum : Number(match[2]);
		const end =
			match[1] === "*"
				? maximum
				: match[3] === undefined
					? match[4]
						? maximum
						: start
					: Number(match[3]);
		if (step < 1 || start < minimum || end > maximum || start > end) throw invalid();
		for (let value = start; value <= end; value += step) values.add(value);
	}
	return { values, wildcard: field === "*" };
}

function invalid() {
	return new DataError(422, "cron_invalid", "Use five cron fields: minute hour day month weekday");
}
