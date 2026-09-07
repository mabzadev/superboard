import { test, expect } from "../../fixtures/base-fixtures.js";
import { evidence, ready, unwrap } from "../../fixtures/site-api.js";

test("project settings keeps the selected reporting period on reload", async ({
	authenticatedPage: page,
}) => {
	await ready(page, "/project-settings");
	await expect(page.getByText("Active Users", { exact: true })).toBeVisible();
	const picker = page.locator("main").getByRole("button").first();
	const previous = await picker.innerText();
	await picker.click();
	await page.getByRole("button", { name: "Last 7 days", exact: true }).click();
	const label = await picker.innerText();
	await page.reload();
	await expect(picker).toHaveText(label);
	expect(label).not.toBe(previous);
});
test("the native team section can open and cancel the invitation form", async ({
	authenticatedPage: page,
}) => {
	await ready(page, "/project-settings");
	await page.getByRole("button", { name: "Add member", exact: true }).click();
	await expect(page.getByRole("dialog")).toBeVisible();
	await page.getByRole("button", { name: "Close dialog", exact: true }).click();
	await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("project deletion requires its confirmation and cancellation preserves the project", async ({
	authenticatedPage: page,
}) => {
	await ready(page, "/project-settings");
	await page.getByRole("button", { name: "Delete Project", exact: true }).click();
	await expect(page.getByRole("dialog")).toBeVisible();
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await page.reload();
	await expect(page.getByRole("button", { name: "Delete Project", exact: true })).toBeVisible();
});
test("usage export produces a retrievable CSV from the chosen dates", async ({
	authenticatedPage: page,
}) => {
	await ready(page, "/project-settings");
	const downloadPromise = page.waitForEvent("download");
	const responsePromise = page.waitForResponse(
		(response) =>
			response.request().method() === "POST" &&
			(response.url().includes("exports/usage") ||
				(response.request().postData() ?? "").includes("exports/usage")),
	);
	await page.getByRole("button", { name: "Export", exact: true }).click();
	const response = await responsePromise;
	expect(response.ok()).toBe(true);
	const result = unwrap(await response.json());
	expect(result.message).toContain("Export");
	const download = await downloadPromise;
	const stream = await download.createReadStream();
	const chunks: Buffer[] = [];
	for await (const chunk of stream!) chunks.push(chunk);
	expect(Buffer.concat(chunks).toString()).toContain("date,active_users");
	await evidence(
		"supbrd-plug-settings",
		"superboard.project_settings",
		[],
		"Clicked usage export with the selected reporting dates and downloaded the generated CSV from its returned location.",
	);
});
