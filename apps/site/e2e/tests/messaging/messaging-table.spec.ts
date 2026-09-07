import { test, expect } from "../../fixtures/base-fixtures.js";
import {
	evidence,
	projectRef,
	ready,
	savedByClick,
	siteApi,
	unique,
} from "../../fixtures/site-api.js";

const platforms = /^Platforms/;
const disabledPush = /Push Notifications\s*Disabled/;

test("creates an in-app message without external push and filters the persisted table", async ({
	authenticatedPage: page,
}) => {
	const project = await projectRef(page);
	const title = unique("Native in-app message");
	await ready(page, "/marketing/in-app-messages");
	await page.getByRole("button", { name: "Create Message", exact: true }).first().click();
	await page.getByPlaceholder("Enter the title of the message").fill(title);
	await page
		.getByPlaceholder("Enter the subtitle of the message")
		.fill("Local browser delivery check");
	await page.getByRole("button", { name: platforms }).click();
	await page.getByRole("button", { name: "iOS", exact: true }).click();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("button", { name: disabledPush })).toBeVisible();
	await page.getByRole("dialog").getByText("Content", { exact: true }).click();
	await page
		.getByText("Text", { exact: true })
		.locator("..")
		.dragTo(page.locator("[data-craft-canvas] > div").first());
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	const id = await savedByClick(page, "Confirm Publish", "supbrd-plugmod-marketing");
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await page.getByPlaceholder("Search message").fill(title);
	await expect(page.getByRole("cell", { name: title, exact: true })).toBeVisible();
	await page.reload();
	await expect(page.getByRole("cell", { name: title, exact: true })).toBeVisible();
	const result = await siteApi(
		page.request,
		"supbrd-plugmod-marketing",
		"POST",
		`/api/v1/projects/${project}/notifications/search`,
		{ term: title, page: 1, archived: false },
	);
	const entries = Array.isArray(result)
		? result
		: (result.notifications ?? result.data ?? result.items);
	expect(entries.find((item: { id: number | string }) => String(item.id) === id)).toMatchObject({
		title,
		send_push: false,
	});
	await evidence(
		"supbrd-plugmod-marketing",
		"superboard.marketing_in_app_messages",
		[id],
		"Published an in-app message with push explicitly disabled, searched it, reloaded the table and checked its persisted delivery flags.",
	);
});
test("empty message cannot bypass the publish validation", async ({ authenticatedPage: page }) => {
	await ready(page, "/marketing/in-app-messages");
	await page.getByRole("button", { name: "Create Message", exact: true }).first().click();
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await expect(page.getByText("Title is required", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Confirm Publish", exact: true })).toHaveCount(0);
});
