import type { Page } from "@playwright/test";

import { projectRef, siteApi, unique } from "./site-api.js";

export async function linkFixture(page: Page, active = true) {
	const project = await projectRef(page);
	const slug = unique("site-link");
	const name = `Site link ${slug}`;
	const saved = await siteApi(
		page.request,
		"supbrd-plugmod-dynamic-links",
		"POST",
		`/api/v1/dynamic-links/projects/${project}/links`,
		{
			slug,
			name,
			destination_url: "https://example.test/destination",
			destinations: { ios: "https://example.test/ios", android: "https://example.test/android" },
			active,
		},
	);
	return { id: String(saved.id), slug, name, project };
}
export async function dialogField(page: Page, label: string, value: string) {
	await page
		.getByRole("dialog")
		.getByText(label, { exact: true })
		.locator("..")
		.locator("input")
		.fill(value);
}
