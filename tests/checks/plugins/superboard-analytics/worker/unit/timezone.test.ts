import { describe, expect, it } from "vitest";

import {
	localDate,
	localDayExpression,
	offsetSegments,
	reportTimezone,
} from "../../../../../../packages/plugins/superboard-analytics/worker/src/timezone";

describe("analytics report time zone", () => {
	it("falls back to UTC when the stored time zone is missing or unknown", () => {
		expect(reportTimezone(undefined)).toBe("UTC");
		expect(reportTimezone("")).toBe("UTC");
		expect(reportTimezone("Europe/Nowhere")).toBe("UTC");
		expect(reportTimezone(" Europe/Paris ")).toBe("Europe/Paris");
	});

	it("places a late-evening UTC instant on the project's calendar day", () => {
		expect(localDate("2026-11-04T23:30:00.000Z", "UTC")).toBe("2026-11-04");
		expect(localDate("2026-11-04T23:30:00.000Z", "Europe/Paris")).toBe("2026-11-05");
		expect(localDate("2026-11-05T02:30:00.000Z", "America/New_York")).toBe("2026-11-04");
		expect(localDate("2026-11-04T18:30:00.000Z", "Asia/Kolkata")).toBe("2026-11-05");
	});

	it("splits a range at the exact daylight saving transition", () => {
		expect(
			offsetSegments("2026-10-20T00:00:00.000Z", "2026-10-30T00:00:00.000Z", "Europe/Paris"),
		).toEqual([
			{ until: "2026-10-25T01:00:00.000Z", offsetMinutes: 120 },
			{ until: null, offsetMinutes: 60 },
		]);
		expect(
			offsetSegments("2026-03-01T00:00:00.000Z", "2026-03-20T00:00:00.000Z", "America/New_York"),
		).toEqual([
			{ until: "2026-03-08T07:00:00.000Z", offsetMinutes: -300 },
			{ until: null, offsetMinutes: -240 },
		]);
	});

	it("keeps the UTC day expression unchanged and binds every shift for other zones", () => {
		expect(
			localDayExpression(
				"occurred_at",
				"2026-11-01T00:00:00.000Z",
				"2026-11-06T00:00:00.000Z",
				"UTC",
			),
		).toEqual({ sql: "substr(occurred_at, 1, 10)", bindings: [] });
		expect(
			localDayExpression(
				"occurred_at",
				"2026-10-20T00:00:00.000Z",
				"2026-10-30T00:00:00.000Z",
				"Europe/Paris",
			),
		).toEqual({
			sql: "CASE WHEN occurred_at < ? THEN date(occurred_at, ?) ELSE date(occurred_at, ?) END",
			bindings: ["2026-10-25T01:00:00.000Z", "+120 minutes", "+60 minutes"],
		});
	});
});
