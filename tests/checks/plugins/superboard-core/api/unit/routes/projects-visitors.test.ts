import { describe, expect, it } from "vitest";

import projects from "../../../../../../../packages/plugins/superboard-core/api/src/routes/projects";
import { Env } from "../../../../../../../packages/plugins/superboard-core/api/src/types";
import { createFakeD1 } from "../../helpers/fake-d1";

describe("dashboard visitor queries", () => {
	it("binds TEXT project identifiers when listing visitors", async () => {
		const db = createFakeD1(({ op, sql, args }) => {
			if (op === "first" && sql.includes("FROM projects WHERE instance_id = ? AND is_test = ?")) {
				return {
					id: 11,
					name: "Reference application",
					identifier: "reference-production_prod_10",
					instance_id: 10,
					is_test: 0,
				};
			}
			if (op === "first" && sql.includes("COUNT(DISTINCT v.id)")) {
				return { total: typeof args[0] === "string" && args[0] === "11" ? 1 : 0 };
			}
			if (op === "all" && sql.includes("FROM visitors v") && sql.includes("LEFT JOIN events e")) {
				return typeof args[4] === "string" && args[4] === "11"
					? [
							{
								id: "visitor-1",
								uuid: "uuid-1",
								sdk_identifier: null,
								updated_at: "2026-08-03 10:58:02",
								platform: "android",
								views: 0,
								opens: 0,
								app_opens: 3,
								installs: 1,
								reinstalls: 1,
								reactivations: 0,
								user_referred: 0,
								time_spent: 895,
								revenue: 0,
							},
						]
					: [];
			}
			return undefined;
		});
		const env = { DB: db } as Env;

		const response = await projects.request(
			"/10-prod/visitors/search",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					page: 1,
					per_page: 20,
					start_date: "2026-08-03",
					end_date: "2026-08-03",
				}),
			},
			env,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			visitors: [{ id: "visitor-1", platform: "android", total_app_opens: 3 }],
			meta: { total_entries: 1, total_pages: 1 },
		});
	});

	it("reads event filter values with batched DISTINCT queries", async () => {
		const distinct: Record<string, unknown[]> = {
			platform: ["ios", "android", "ios"],
			app_version: ["2.0.0", "1.9.0"],
			build: ["42"],
		};
		const distinctArgs: unknown[] = [];
		const db = createFakeD1(({ op, sql, args }) => {
			if (op === "first" && sql.includes("FROM projects WHERE instance_id = ? AND is_test = ?")) {
				return { id: 11, name: "Reference application", instance_id: 10, is_test: 0 };
			}
			const match = /^SELECT DISTINCT (\w+) AS value FROM events WHERE project_id = \?/u.exec(sql);
			if (op === "run" && match) {
				distinctArgs.push(args);
				return { results: (distinct[match[1]] || []).map((value) => ({ value })) };
			}
			return undefined;
		});
		const env = { DB: db } as Env;

		const response = await projects.request("/10-prod/events/metric_values", {}, env);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			metrics_values: {
				platforms: ["android", "ios"],
				app_versions: ["1.9.0", "2.0.0"],
				builds: ["42"],
			},
		});
		expect(distinctArgs).toEqual([[11], [11], [11]]);
		expect(db.calls.some((call) => call.sql.includes("SELECT platform, app_version, build"))).toBe(
			false,
		);
	});
});
