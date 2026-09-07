import { expect, test } from "vitest";

import { analyticsFacts } from "./retirement-api-analytics-fixtures.js";
import {
	apiCommand,
	apiRead,
	jsonResult,
	pluginDatabase,
	prepareApiPlugin,
	proveApi,
} from "./retirement-api-helpers.js";
const plugin = "supbrd-plugmod-analytics";
const file = "retirement-api-analytics.runtime.test.ts";
type Items = { items: Array<Record<string, unknown>> };
test("canonical Analytics APIs read projected trusted events and persist reports, cohorts, remote configuration and jobs", async () => {
	const scope = await prepareApiPlugin(plugin);
	const base = `/api/v1/analytics/projects/${scope.production_project_ref}`;
	const db = pluginDatabase("analytics");
	const facts = await analyticsFacts(scope.production_project_ref);
	const command = (id: string, method: string, path: string, body?: unknown) =>
		apiCommand(plugin, id, {
			method,
			path: `${base}${path}`,
			...(body === undefined ? {} : { body }),
		});
	const read = async <T>(id: string, path: string): Promise<T> =>
		(
			await jsonResult<{ data: T }>(
				await apiRead(plugin, id, { method: "GET", path: `${base}${path}` }),
			)
		).data;
	const ids = facts.events.map((event) => event.event_id);
	const overview = await read<Record<string, unknown>>("analytics_overview", "/overview");
	expect(overview).toMatchObject({
		events: 5,
		unique_subjects: 1,
		sessions: 1,
		installations: 1,
		purchase_events: 1,
	});
	proveApi(plugin, "analytics_overview", "read", file, ids);
	const events = await read<{ items: Array<{ event_id: string }> }>("analytics_events", "/events");
	expect(
		events.items
			.map((event) => event.event_id)
			.toSorted((left, right) => left.localeCompare(right)),
	).toEqual(ids.toSorted((left, right) => left.localeCompare(right)));
	proveApi(plugin, "analytics_events", "read", file, ids);
	const analysis = await read<{ totals: { events: number } }>(
		"analytics_event_analysis",
		"/events/analyze?event_name=screen.viewed",
	);
	expect(analysis.totals.events).toBe(1);
	proveApi(plugin, "analytics_event_analysis", "read", file, [ids[0]!]);
	const installations = await read<Items>("analytics_installations", "/installations");
	expect(installations.items).toContainEqual(
		expect.objectContaining({ source_event_id: ids[3], application_id: facts.application }),
	);
	proveApi(plugin, "analytics_installations", "read", file, [ids[3]!]);
	const purchases = await read<Items>("analytics_purchases", "/purchases");
	expect(purchases.items).toContainEqual(
		expect.objectContaining({ source_event_id: ids[4], amount_micros: 5000000, currency: "CHF" }),
	);
	proveApi(plugin, "analytics_purchases", "read", file, [ids[4]!]);
	const retention = await read<{
		cohorts: Array<{ size: number; days: Array<{ day: number; subjects: number; rate: number }> }>;
	}>("analytics_retention", "/retention");
	expect(retention.cohorts).toContainEqual(
		expect.objectContaining({
			size: 1,
			days: expect.arrayContaining([{ day: 0, subjects: 1, rate: 1 }]),
		}),
	);
	proveApi(plugin, "analytics_retention", "read", file, [ids[3]!]);
	const sessions = await read<Items>("analytics_sessions", "/sessions");
	expect(sessions.items).toContainEqual(
		expect.objectContaining({ application_id: facts.application, event_count: 5 }),
	);
	proveApi(
		plugin,
		"analytics_sessions",
		"read",
		file,
		sessions.items.map((row) => String(row.id)),
	);
	const profiles = await read<Items>("analytics_profiles", "/profiles");
	expect(profiles.items).toHaveLength(1);
	expect(profiles.items[0]).toMatchObject({ application_id: facts.application });
	expect(JSON.stringify(profiles)).not.toContain("proof-customer");
	proveApi(plugin, "analytics_profiles", "read", file, [String(profiles.items[0]!.id)]);
	const views = await read<Items>("analytics_views", "/views");
	expect(views.items).toContainEqual(expect.objectContaining({ view_name: "Checkout", views: 1 }));
	proveApi(plugin, "analytics_views", "read", file, [ids[0]!]);
	const dimensions = await read<{
		dimensions: { platform: Array<{ value: string; events: number }> };
	}>("analytics_dimensions", "/dimensions");
	expect(dimensions.dimensions.platform).toContainEqual(
		expect.objectContaining({ value: "ios", events: 5 }),
	);
	proveApi(plugin, "analytics_dimensions", "read", file, ids);
	const crashes = await read<Items>("analytics_crashes", "/crashes");
	expect(crashes.items).toContainEqual(
		expect.objectContaining({ title: "Proof crash", occurrence_count: 1 }),
	);
	proveApi(plugin, "analytics_crashes", "read", file, [ids[1]!]);
	const feedback = await read<Items>("analytics_feedback", "/feedback");
	expect(feedback.items).toContainEqual(
		expect.objectContaining({ comment: "Proof feedback", rating: 4 }),
	);
	proveApi(plugin, "analytics_feedback", "read", file, [ids[2]!]);
	const reportBody = {
		report_type: "query",
		name: "Canonical report",
		definition: { event_name: "screen.viewed" },
		enabled: true,
	};
	const report = await jsonResult<{ data: { id: string } }>(
		await command("create_analytics_report", "POST", "/reports", reportBody),
		201,
	);
	expect(
		await db
			.prepare("SELECT name FROM analytics_saved_reports WHERE id=?")
			.bind(report.data.id)
			.first(),
	).toEqual({ name: reportBody.name });
	proveApi(plugin, "create_analytics_report", "mutation", file, [report.data.id]);
	await jsonResult(
		await command("update_analytics_report", "PUT", `/reports/${report.data.id}`, {
			...reportBody,
			name: "Updated report",
		}),
	);
	const reports = await read<Items>("analytics_reports", "/reports");
	expect(reports.items).toContainEqual(
		expect.objectContaining({ id: report.data.id, name: "Updated report" }),
	);
	proveApi(plugin, "update_analytics_report", "mutation", file, [report.data.id]);
	proveApi(plugin, "analytics_reports", "read", file, [report.data.id]);
	const dashboardBody = {
		name: "Canonical dashboard",
		visibility: "private",
		layout: { columns: 2 },
	};
	const dashboard = await jsonResult<{ data: { id: string } }>(
		await command("create_analytics_dashboard", "POST", "/dashboards", dashboardBody),
		201,
	);
	expect(
		await db
			.prepare("SELECT name FROM analytics_dashboards WHERE id=?")
			.bind(dashboard.data.id)
			.first(),
	).toEqual({ name: dashboardBody.name });
	proveApi(plugin, "create_analytics_dashboard", "mutation", file, [dashboard.data.id]);
	await jsonResult(
		await command("update_analytics_dashboard", "PUT", `/dashboards/${dashboard.data.id}`, {
			...dashboardBody,
			name: "Updated dashboard",
		}),
	);
	const dashboards = await read<Items>("analytics_dashboards", "/dashboards");
	expect(dashboards.items).toContainEqual(
		expect.objectContaining({ id: dashboard.data.id, name: "Updated dashboard" }),
	);
	proveApi(plugin, "update_analytics_dashboard", "mutation", file, [dashboard.data.id]);
	proveApi(plugin, "analytics_dashboards", "read", file, [dashboard.data.id]);
	const cohort = await jsonResult<{ data: { id: string } }>(
		await command("create_analytics_cohort", "POST", "/cohorts", {
			name: "Checkout visitors",
			definition: { event_name: "screen.viewed", days: 30 },
			enabled: true,
		}),
		201,
	);
	expect(
		await db.prepare("SELECT name FROM analytics_cohorts WHERE id=?").bind(cohort.data.id).first(),
	).toEqual({ name: "Checkout visitors" });
	proveApi(plugin, "create_analytics_cohort", "mutation", file, [cohort.data.id]);
	const evaluated = await jsonResult<{ data: { estimated_size: number } }>(
		await command("evaluate_analytics_cohort", "POST", `/cohorts/${cohort.data.id}/evaluate`, {}),
	);
	expect(evaluated.data.estimated_size).toBe(1);
	const cohorts = await read<Items>("analytics_cohorts", "/cohorts");
	expect(cohorts.items).toContainEqual(
		expect.objectContaining({ id: cohort.data.id, estimated_size: 1 }),
	);
	proveApi(plugin, "evaluate_analytics_cohort", "mutation", file, [cohort.data.id]);
	proveApi(plugin, "analytics_cohorts", "read", file, [cohort.data.id]);
	const key = `banner-${crypto.randomUUID()}`;
	const remote = await jsonResult<{ data: { id: string } }>(
		await command("upsert_analytics_remote_config", "PUT", `/remote-config/${key}`, {
			value: { copy: "Hello from the target" },
			enabled: true,
			environment: "production",
			conditions: [],
		}),
		201,
	);
	const remoteConfigs = await read<Items>("analytics_remote_config", "/remote-config");
	expect(remoteConfigs.items).toContainEqual(
		expect.objectContaining({
			id: remote.data.id,
			config_key: key,
			value: { copy: "Hello from the target" },
		}),
	);
	proveApi(plugin, "upsert_analytics_remote_config", "mutation", file, [remote.data.id]);
	proveApi(plugin, "analytics_remote_config", "read", file, [remote.data.id]);
	const alert = await jsonResult<{ data: { id: string } }>(
		await command("create_analytics_alert", "POST", "/alerts", {
			name: "Checkout threshold",
			alert_type: "metric_threshold",
			definition: {
				event_name: "screen.viewed",
				window_minutes: 60,
				threshold: 2,
				operator: "gte",
			},
			channels: [],
			enabled: true,
		}),
		201,
	);
	const alerts = await read<Items>("analytics_alerts", "/alerts");
	expect(alerts.items).toContainEqual(
		expect.objectContaining({ id: alert.data.id, name: "Checkout threshold" }),
	);
	proveApi(plugin, "create_analytics_alert", "mutation", file, [alert.data.id]);
	proveApi(plugin, "analytics_alerts", "read", file, [alert.data.id]);
	await jsonResult(
		await command("update_analytics_settings", "PUT", "/settings", {
			hot_retention_days: 40,
			timezone: "Europe/Zurich",
			data_collection_enabled: true,
		}),
	);
	const settings = await read<Record<string, unknown>>("analytics_settings", "/settings");
	expect(settings).toMatchObject({
		hot_retention_days: 40,
		timezone: "Europe/Zurich",
		data_collection_enabled: true,
	});
	proveApi(plugin, "update_analytics_settings", "mutation", file, [facts.projectId]);
	proveApi(plugin, "analytics_settings", "read", file, [facts.projectId]);
	const operation = await jsonResult<{ data: { id: string; status: string } }>(
		await command("create_analytics_operation", "POST", "/operations", {
			operation_type: "export",
			input: {},
		}),
		202,
	);
	const job = await db
		.prepare("SELECT id,operation_type,status FROM analytics_operation_jobs WHERE id=?")
		.bind(operation.data.id)
		.first();
	expect(job).toEqual({ id: operation.data.id, operation_type: "export", status: "queued" });
	proveApi(plugin, "create_analytics_operation", "mutation", file, [operation.data.id]);
	await jsonResult(
		await command("delete_analytics_report", "DELETE", `/reports/${report.data.id}`),
	);
	expect(
		await db
			.prepare("SELECT id FROM analytics_saved_reports WHERE id=?")
			.bind(report.data.id)
			.first(),
	).toBeNull();
	proveApi(plugin, "delete_analytics_report", "mutation", file, [report.data.id]);
	await jsonResult(
		await command("delete_analytics_dashboard", "DELETE", `/dashboards/${dashboard.data.id}`),
	);
	expect(
		await db
			.prepare("SELECT id FROM analytics_dashboards WHERE id=?")
			.bind(dashboard.data.id)
			.first(),
	).toBeNull();
	proveApi(plugin, "delete_analytics_dashboard", "mutation", file, [dashboard.data.id]);
});
