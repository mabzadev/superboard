import { test, expect } from "../../fixtures/base-fixtures.js";
import {
	evidence,
	field,
	projectRef,
	ready,
	savedByClick,
	siteApi,
	unique,
} from "../../fixtures/site-api.js";

const plugin = "supbrd-plugmod-marketing";

test("subscriber search and CSV export contain the subscriber created in the form", async ({
	authenticatedPage: page,
}) => {
	const project = await projectRef(page);
	const email = `${unique("subscriber")}@example.test`;
	await ready(page, "/marketing/email");
	await page.getByPlaceholder("Email", { exact: true }).fill(email);
	await page.getByPlaceholder("Name", { exact: true }).fill("Native subscriber");
	const optIn = page.getByRole("switch");
	if ((await optIn.getAttribute("aria-checked")) === "true") await optIn.click();
	const id = await savedByClick(page, "Add subscriber", plugin);
	const persisted = await siteApi(
		page.request,
		plugin,
		"GET",
		`/api/v1/marketing/projects/${project}/email/subscribers/${id}`,
	);
	expect(persisted.email).toBe(email);
	await page.getByPlaceholder("Search subscribers").fill(email);
	await expect(page.getByText(email, { exact: true })).toBeVisible();
	const download = page.waitForEvent("download");
	await page.getByRole("button", { name: "Export CSV", exact: true }).click();
	const stream = await (await download).createReadStream();
	const chunks: Buffer[] = [];
	for await (const chunk of stream!) chunks.push(chunk);
	expect(Buffer.concat(chunks).toString()).toContain(email);
	await evidence(
		plugin,
		"superboard.marketing_email",
		[id],
		"Created a subscriber without sending opt-in mail, read it back, filtered the table and downloaded a CSV containing its exact address.",
	);
});

test("email template and campaign draft persist without sending a campaign", async ({
	authenticatedPage: page,
}) => {
	const project = await projectRef(page);
	const name = unique("campaign");
	await ready(page, "/marketing/campaigns");
	await page.getByPlaceholder("Template name", { exact: true }).fill(name);
	await page.getByPlaceholder("Default subject", { exact: true }).fill("Local draft");
	await page
		.getByPlaceholder("Template content", { exact: true })
		.fill("<p>Persisted native template</p>");
	const template = await savedByClick(page, "Create template", plugin);
	await page.getByPlaceholder("Campaign name", { exact: true }).fill(name);
	await page.getByPlaceholder("Subject", { exact: true }).fill("Local campaign draft");
	await page.getByRole("combobox", { name: "Template", exact: true }).selectOption(template);
	const id = await savedByClick(page, "Create draft", plugin);
	const persisted = await siteApi(
		page.request,
		plugin,
		"GET",
		`/api/v1/marketing/projects/${project}/campaigns/${id}`,
	);
	expect(persisted).toMatchObject({ name, subject: "Local campaign draft", status: "draft" });
	await page.reload();
	await expect(
		page.getByText(name, { exact: true }).filter({ visible: true }).first(),
	).toBeVisible();
	await evidence(
		plugin,
		"superboard.marketing_campaigns",
		[template, id],
		"Created an HTML template and linked campaign draft through the forms, verified draft state and content through the owner API, then reloaded the table.",
	);
});

test("journey graph becomes a persisted version and can be activated then paused", async ({
	authenticatedPage: page,
}) => {
	const project = await projectRef(page);
	const name = unique("journey");
	await ready(page, "/marketing/journeys");
	await field(page, "Name").fill(name);
	await field(page, "Event that starts the journey").fill(unique("qa.event"));
	const id = await savedByClick(page, "Create draft", plugin);
	const row = page.getByText(name, { exact: true }).locator("xpath=ancestor::button[1]/..");
	await row.getByRole("button", { name: "Activate", exact: true }).click();
	await expect
		.poll(
			async () =>
				(
					await siteApi(
						page.request,
						plugin,
						"GET",
						`/api/v1/marketing/projects/${project}/journeys/${id}`,
					)
				).status,
		)
		.toBe("active");
	await row.getByRole("button", { name: "Pause", exact: true }).click();
	await page.reload();
	await expect(row).toContainText("Paused");
	const saved = await siteApi(
		page.request,
		plugin,
		"GET",
		`/api/v1/marketing/projects/${project}/journeys/${id}`,
	);
	expect(saved.status).toBe("paused");
	expect(saved.definition.nodes).toContainEqual({ id: "exit", type: "exit" });
	await evidence(
		plugin,
		"superboard.marketing_journeys",
		[id],
		"Saved a real exit-only journey, activated it with an unused QA trigger, paused it and verified its stored graph and state after reload; no message delivery was configured.",
	);
});

test("disabled channel settings survive creation and reload", async ({
	authenticatedPage: page,
}) => {
	const project = await projectRef(page);
	const name = unique("channel");
	await ready(page, "/marketing/channels");
	await field(page, "Name").fill(name);
	await field(page, "HTTPS destination").fill("https://capture.example.test/disabled");
	await page.getByRole("switch", { name: "Enabled", exact: true }).uncheck();
	const id = await savedByClick(page, "Add channel", plugin);
	await page.reload();
	await expect(page.getByText(name, { exact: true })).toBeVisible();
	const saved = await siteApi(
		page.request,
		plugin,
		"GET",
		`/api/v1/marketing/projects/${project}/channel-connectors`,
	);
	expect(saved.find((item: { id: string }) => item.id === id)).toMatchObject({
		name,
		enabled: false,
		endpoint_url: "https://capture.example.test/disabled",
	});
	await evidence(
		plugin,
		"superboard.marketing_channels",
		[id],
		"Saved an explicitly disabled webhook connector in the browser and verified its destination and disabled state after reload; no webhook was dispatched.",
	);
});
