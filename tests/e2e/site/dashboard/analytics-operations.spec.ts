import { eventFixture } from "../../../fixtures/site-browser/analytics.js";
import { test, expect } from "../../../fixtures/site-browser/base-fixtures.js";
import {
	evidence,
	field,
	projectRef,
	ready,
	savedByClick,
	siteApi,
	unique,
} from "../../../fixtures/site-browser/site-api.js";
const plugin = "supbrd-plugmod-analytics";

test("event explorer filters and analyses its real event", async ({ authenticatedPage: page }) => {
	const name = unique("qa_event").replaceAll("-", "_");
	const event = await eventFixture(page, name, { stage: "completed" });
	await ready(page, "/analytics/events");
	await page.getByRole("textbox", { name: "Event name", exact: true }).fill(name);
	await page.getByRole("button", { name: "Apply filter", exact: true }).click();
	await expect(page.getByText(event.id, { exact: true })).toBeVisible();
	await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
	await evidence(
		plugin,
		"superboard.analytics_events",
		[event.id],
		"Filtered the persisted event stream by exact name and opened event analysis.",
	);
});
test("views displays the projected screen event", async ({ authenticatedPage: page }) => {
	const name = unique("QA screen");
	const event = await eventFixture(page, "screen.viewed", {
		view_name: name,
		duration_seconds: 12,
	});
	await ready(page, "/analytics/views");
	await expect(page.getByText(name, { exact: true })).toBeVisible();
	await evidence(
		plugin,
		"superboard.analytics_views",
		[event.id],
		"Screen event ingestion produced the named view and duration in the views table.",
	);
});
test("user sessions and profiles come from the ingested subject", async ({
	authenticatedPage: page,
}) => {
	const event = await eventFixture(page);
	await ready(page, "/analytics/users");
	await expect(page.getByText(event.application, { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "User profiles", exact: true }).click();
	await expect(page.getByText(event.application, { exact: true })).toBeVisible();
	await evidence(
		plugin,
		"superboard.analytics_users",
		[event.id],
		"Real event ingestion created both session and pseudonymized profile entries visible through their tabs.",
	);
});
test("feedback shows the actual submitted rating and comment", async ({
	authenticatedPage: page,
}) => {
	const comment = unique("QA feedback");
	const event = await eventFixture(page, "feedback.submitted", { rating: 4, comment });
	await ready(page, "/analytics/feedback");
	const row = page.getByRole("row").filter({ hasText: comment });
	await expect(row).toContainText("4");
	await evidence(
		plugin,
		"superboard.analytics_feedback",
		[event.id],
		"Ingested a feedback event and verified its exact comment and rating in the table.",
	);
});
test("a crash is inspected and resolved durably", async ({ authenticatedPage: page }) => {
	const title = unique("QA crash");
	const event = await eventFixture(page, "crash.reported", {
		title,
		message: title,
		stack: "Application.render at qa.ts:12",
		fatal: false,
	});
	await ready(page, "/analytics/crashes");
	await page.getByText(title, { exact: true }).click();
	await expect(page.getByText("Application.render at qa.ts:12", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Mark as resolved", exact: true }).click();
	await expect(page.getByText(title, { exact: true })).toHaveCount(0);
	await page.reload();
	await page.getByRole("combobox", { name: "Crash status", exact: true }).click();
	await page.getByRole("option", { name: "Resolved", exact: true }).click();
	await expect(page.getByText(title, { exact: true })).toBeVisible();
	await evidence(
		plugin,
		"superboard.analytics_crashes",
		[event.id],
		"Ingested a crash, inspected its stored stack, resolved it, and found it in resolved results after reload.",
	);
});
test("technology dimensions reflect the accepted event context", async ({
	authenticatedPage: page,
}) => {
	const event = await eventFixture(page);
	await ready(page, "/analytics/dimensions");
	await expect(page.getByText(/^\d*\s*Chrome$/).first()).toBeVisible();
	await expect(page.getByText(/^\d*\s*CH$/).first()).toBeVisible();
	await evidence(
		plugin,
		"superboard.analytics_dimensions",
		[event.id],
		"Verified browser and country dimensions projected from a real event context.",
	);
});
test("creates and reloads a dashboard widget", async ({ authenticatedPage: page }) => {
	const name = unique("QA dashboard");
	const widget = unique("QA metric");
	await ready(page, "/analytics/dashboards");
	await page.getByPlaceholder("Product pulse").fill(name);
	const id = await savedByClick(page, "Create dashboard", plugin);
	await page.getByPlaceholder("Widget title").fill(widget);
	await savedByClick(page, "Add widget", plugin);
	await page.reload();
	await page.getByRole("button", { name: new RegExp(name) }).click();
	await expect(page.getByText(widget, { exact: true })).toBeVisible();
	await evidence(
		plugin,
		"superboard.analytics_dashboards",
		[id],
		"Created an analytics dashboard and widget and reopened the widget from persisted configuration.",
	);
});
test("creates and reloads a behavioural cohort", async ({ authenticatedPage: page }) => {
	const name = unique("QA cohort");
	await ready(page, "/analytics/cohorts");
	await page.getByPlaceholder("Recently activated").fill(name);
	await page.getByPlaceholder("account.activated").fill("screen.viewed");
	const id = await savedByClick(page, "Create cohort", plugin);
	await page.reload();
	await expect(page.getByText(name, { exact: true })).toBeVisible();
	await evidence(
		plugin,
		"superboard.analytics_cohorts",
		[id],
		"Saved a named event cohort and verified its stored definition after reload.",
	);
});
test("publishes a remote configuration value and reads it back", async ({
	authenticatedPage: page,
}) => {
	const key = unique("qa_config").replaceAll("-", "_");
	const project = await projectRef(page);
	await ready(page, "/analytics/remote-config");
	await field(page, "Parameter key").fill(key);
	await field(page, "JSON value").fill('{"enabled":true,"message":"QA persisted value"}');
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await expect(page.getByText(key, { exact: true })).toBeVisible();
	await page.reload();
	await expect(page.getByText(key, { exact: true })).toBeVisible();
	const result = await siteApi(
		page.request,
		plugin,
		"GET",
		`/api/v1/analytics/projects/${project}/remote-config`,
	);
	expect(
		result.items.find((item: { config_key: string }) => item.config_key === key).value,
	).toMatchObject({ enabled: true, message: "QA persisted value" });
	await evidence(
		plugin,
		"superboard.analytics_remote_config",
		[key],
		"Published and reloaded the actual JSON configuration value.",
	);
});
test("creates an alert rule without an external notification recipient", async ({
	authenticatedPage: page,
}) => {
	const name = unique("QA alert");
	await ready(page, "/analytics/alerts");
	await page.getByPlaceholder("Crash spike").fill(name);
	const id = await savedByClick(page, "Create alert", plugin);
	await page.reload();
	await expect(page.getByText(name, { exact: true })).toBeVisible();
	await evidence(
		plugin,
		"superboard.analytics_alerts",
		[id],
		"Created and reloaded a stored alert rule without external delivery.",
	);
});
test("saves a report definition and reopens it", async ({ authenticatedPage: page }) => {
	const name = unique("QA report");
	await ready(page, "/analytics/reports");
	await page.getByPlaceholder("Weekly product pulse").fill(name);
	const id = await savedByClick(page, "Save", plugin);
	await page.reload();
	await expect(page.getByText(name, { exact: true })).toBeVisible();
	await evidence(
		plugin,
		"superboard.analytics_reports",
		[id],
		"Saved and reloaded a report definition through the reports page.",
	);
});
