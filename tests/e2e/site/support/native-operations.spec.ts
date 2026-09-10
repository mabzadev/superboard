import { test, expect } from "../../../fixtures/site-browser/base-fixtures.js";
import {
	evidence,
	field,
	ready,
	savedByClick,
	unique,
} from "../../../fixtures/site-browser/site-api.js";

const plugin = "supbrd-plugmod-support";
test("contacts save and reopen a real customer record", async ({ authenticatedPage: page }) => {
	const name = unique("Support contact");
	await ready(page, "/support/contacts");
	await page.getByRole("button", { name: "New contact", exact: true }).click();
	await page.getByLabel("Customer ID", { exact: true }).fill(unique("customer"));
	await page.getByLabel("Name", { exact: true }).fill(name);
	await page.getByLabel("Email", { exact: true }).fill(`${unique("contact")}@example.test`);
	const id = await savedByClick(page, "Save contact", plugin);
	await page.reload();
	await page.getByPlaceholder("Search name, email, phone, or customer ID").fill(name);
	await page.getByRole("button", { name: "Search", exact: true }).click();
	await expect(page.getByText(name, { exact: true })).toBeVisible();
	await evidence(
		plugin,
		"superboard.support_contacts",
		[id],
		"Saved a real support contact, reloaded the page, and searched for its stored identity.",
	);
});
test("workforce creates a team that survives reload", async ({ authenticatedPage: page }) => {
	const name = unique("Support team");
	await ready(page, "/support/workforce");
	await page.getByRole("tab", { name: "Teams", exact: true }).click();
	await field(page, "Name").fill(name);
	await field(page, "Description").fill("Isolated support team");
	const id = await savedByClick(page, "Create team", plugin);
	await page.reload();
	await page.getByRole("tab", { name: "Teams", exact: true }).click();
	await expect(page.getByText(name, { exact: true })).toBeVisible();
	await evidence(
		plugin,
		"superboard.support_workforce",
		[id],
		"Created and reloaded a persisted team through workforce controls.",
	);
});
test("automations persists a service-level policy", async ({ authenticatedPage: page }) => {
	const name = unique("Support SLA");
	await ready(page, "/support/automations");
	await page.getByRole("tab", { name: "SLA", exact: true }).click();
	await field(page, "Name").fill(name);
	const id = await savedByClick(page, "Create SLA", plugin);
	await page.reload();
	await page.getByRole("tab", { name: "SLA", exact: true }).click();
	await expect(page.getByText(name, { exact: true })).toBeVisible();
	await evidence(
		plugin,
		"superboard.support_automations",
		[id],
		"Created a service-level policy and found it after reload.",
	);
});
test("help center creates a real portal draft", async ({ authenticatedPage: page }) => {
	const name = unique("Support portal");
	await ready(page, "/support/help-center");
	await page.getByRole("tab", { name: "Portals", exact: true }).click();
	await field(page, "Name").fill(name);
	await field(page, "Slug").fill(unique("portal"));
	const id = await savedByClick(page, "Create portal", plugin);
	await page.reload();
	await page.getByRole("tab", { name: "Portals", exact: true }).click();
	await expect(page.getByText(name, { exact: true })).toBeVisible();
	await evidence(
		plugin,
		"superboard.support_help_center",
		[id],
		"Created a help-center portal through its form and reopened its stored record.",
	);
});
test("Captain saves an assistant configuration without invoking an external model", async ({
	authenticatedPage: page,
}) => {
	const name = unique("Support assistant");
	await ready(page, "/support/captain");
	await field(page, "Name").fill(name);
	await field(page, "Description").fill("Local QA assistant configuration");
	await field(page, "Instructions").fill(
		"Suggest answers from the local help center and request human handoff.",
	);
	const id = await savedByClick(page, "Create assistant", plugin);
	await page.reload();
	await expect(page.getByText(name, { exact: true })).toBeVisible();
	await evidence(
		plugin,
		"superboard.support_captain",
		[id],
		"Saved and reloaded an assistant configuration; no external model invocation claimed.",
	);
});
