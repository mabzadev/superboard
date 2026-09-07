import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

import { projectRef, siteApi, unique } from "./site-api.js";

export async function eventFixture(
	page: Page,
	eventName = "qa.event",
	properties: Record<string, unknown> = {},
) {
	const project = await projectRef(page);
	const id = crypto.randomUUID();
	const application = unique("qa-app");
	await siteApi(
		page.request,
		"supbrd-plugmod-analytics",
		"POST",
		`/api/v1/analytics/projects/${project}/events`,
		{
			schema_version: 1,
			event_id: id,
			event_name: eventName,
			occurred_at: new Date().toISOString(),
			source: "sdk",
			application_id: application,
			app_instance_id: unique("qa-install"),
			session_id: unique("qa-session"),
			properties,
			context: {
				platform: "web",
				app_version: "1.0.0",
				country_code: "CH",
				city: "Geneva",
				browser: "Chrome",
			},
		},
	);
	await expect
		.poll(
			async () => {
				const records = await siteApi(
					page.request,
					"supbrd-plugmod-analytics",
					"GET",
					`/api/v1/analytics/projects/${project}/events?event_name=${encodeURIComponent(eventName)}&limit=100`,
				);
				return records.items.some((item: { event_id: string }) => item.event_id === id);
			},
			{ timeout: 30000 },
		)
		.toBe(true);
	return { id, application, project, eventName };
}
