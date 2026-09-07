import { readFileSync } from "node:fs";

import type { Page, Response as BrowserResponse } from "@playwright/test";

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
const plugin = "supbrd-plugmod-support";
function requestPath(response: BrowserResponse) {
	const url = new URL(response.url());
	try {
		const envelope =
			response.request().method() === "POST"
				? response.request().postDataJSON()
				: JSON.parse(url.searchParams.get("request") ?? "null");
		if (typeof envelope?.path === "string") return new URL(envelope.path, url.origin).pathname;
	} catch {}
	return url.pathname;
}
async function conversation(page: Page) {
	const ref = await projectRef(page);
	const base = `/api/v1/support/projects/${ref}`;
	const name = unique("support-browser");
	const inbox = await siteApi(page.request, plugin, "POST", `${base}/workforce/inboxes`, {
		name,
		identifier: name,
		channel_type: "widget",
		status: "active",
		auto_assignment: false,
		allow_reopen: true,
		csat_enabled: false,
	});
	const item = await siteApi(page.request, plugin, "POST", `${base}/conversations`, {
		external_user_id: unique("support-customer"),
		client_conversation_id: crypto.randomUUID(),
		subject: name,
		inbox_id: inbox.id,
	});
	return { ref, base, name, inboxId: inbox.id, id: item.id };
}

test("Support Inbox persists a private note and closed-state filters", async ({
	authenticatedPage: page,
}) => {
	const fixture = await conversation(page);
	const note = unique("Private QA note");
	await ready(page, "/support/inbox");
	await page.getByRole("button", { name: new RegExp(fixture.name) }).click();
	await page.getByRole("checkbox", { name: "Private note — visible only to agents" }).check();
	await page.getByPlaceholder("Write a private note for the team…").fill(note);
	const sent = page.waitForResponse(
		(response) =>
			response.request().method() === "POST" && requestPath(response).endsWith("/messages"),
	);
	await page.getByRole("button", { name: "Add note", exact: true }).click();
	expect((await sent).ok()).toBe(true);
	const messages = await siteApi(
		page.request,
		plugin,
		"GET",
		`${fixture.base}/conversations/${fixture.id}/messages`,
	);
	const stored = messages.find((item: { body: string }) => item.body === note);
	expect(stored).toMatchObject({ body: note, visibility: "private", sender_kind: "agent" });
	await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("closed");
	await expect
		.poll(async () => {
			const items = await siteApi(page.request, plugin, "GET", `${fixture.base}/conversations`);
			return items.find((item: { id: string }) => item.id === fixture.id)?.status;
		})
		.toBe("closed");
	await page.reload();
	await page.getByRole("combobox", { name: "Filter by status", exact: true }).selectOption("open");
	await expect(page.getByRole("button", { name: new RegExp(fixture.name) })).toHaveCount(0);
	await page
		.getByRole("combobox", { name: "Filter by status", exact: true })
		.selectOption("closed");
	await page.getByRole("button", { name: new RegExp(fixture.name) }).click();
	await expect(page.getByText(note, { exact: true })).toBeVisible();
	await evidence(
		plugin,
		"superboard.support_inbox",
		[fixture.id, stored.id],
		"Created a real conversation through the owning API, saved a private agent note in the browser, closed it and verified reload plus open/closed filtering. No public reply was sent.",
	);
});

test("Support Quality refreshes live conversation metrics and the audit trail", async ({
	authenticatedPage: page,
}) => {
	const fixture = await conversation(page);
	await ready(page, "/support/quality");
	const before = await siteApi(page.request, plugin, "GET", `${fixture.base}/quality`);
	const metric = page
		.locator('[data-slot="card"]')
		.filter({ has: page.getByText("Open conversations", { exact: true }) });
	await expect(metric.locator('[data-slot="card-title"]')).toHaveText(
		String(before.conversations.open),
	);
	await siteApi(page.request, plugin, "PATCH", `${fixture.base}/conversations/${fixture.id}`, {
		status: "closed",
		inbox_id: fixture.inboxId,
	});
	const refreshed = page.waitForResponse(
		(response) => response.url().includes("/quality") && response.request().method() === "GET",
	);
	await page.getByRole("button", { name: "Refresh", exact: true }).click();
	expect((await refreshed).ok()).toBe(true);
	const after = await siteApi(page.request, plugin, "GET", `${fixture.base}/quality`);
	expect(after.conversations.open).toBe(Number(before.conversations.open) - 1);
	await expect(metric.locator('[data-slot="card-title"]')).toHaveText(
		String(after.conversations.open),
	);
	const audit = await siteApi(page.request, plugin, "GET", `${fixture.base}/audit`);
	const event = audit.find(
		(item: { action: string; payload_json: string }) =>
			item.action === "conversation.updated" &&
			JSON.parse(item.payload_json).inbox_id === fixture.inboxId,
	);
	expect(event).toBeDefined();
	await expect(page.getByText("conversation.updated", { exact: true }).first()).toBeVisible();
	await evidence(
		plugin,
		"superboard.support_quality",
		[fixture.id, event.id],
		"Refreshed after a real conversation state change, checked the decremented open count and the persisted audit event shown by Quality.",
	);
});

test("Support Reports exports the selected reporting period and downloads its real queued result", async ({
	authenticatedPage: page,
}) => {
	const fixture = await conversation(page);
	await ready(page, "/support/reports");
	await field(page, "From").fill("2099-01-01");
	await field(page, "To").fill("2099-01-02");
	await page.getByRole("button", { name: "Apply period", exact: true }).click();
	const id = await savedByClick(page, "Export", plugin);
	await expect
		.poll(
			async () =>
				(await siteApi(page.request, plugin, "GET", `${fixture.base}/reports/exports/${id}`))
					.status,
			{ timeout: 30000 },
		)
		.toBe("completed");
	const job = page
		.locator('[data-slot="card-content"] > div')
		.filter({ has: page.getByText(id, { exact: true }) });
	await expect(job.getByRole("button", { name: "Download", exact: true })).toBeVisible({
		timeout: 30000,
	});
	const downloaded = page.waitForEvent("download");
	await job.getByRole("button", { name: "Download", exact: true }).click();
	const download = await downloaded;
	const path = await download.path();
	expect(path).toBeTruthy();
	const payload = JSON.parse(readFileSync(path!, "utf8"));
	expect(payload.data).toEqual([]);
	const stored = await siteApi(
		page.request,
		plugin,
		"GET",
		`${fixture.base}/reports/exports/${id}`,
	);
	expect(stored.filters).toMatchObject({ from: "2099-01-01", to: "2099-01-02" });
	expect(stored.result.count).toBe(0);
	await evidence(
		plugin,
		"superboard.support_reports",
		[id, fixture.id],
		"Selected an empty future period, queued a real report export, waited for the actual Worker consumer, downloaded its R2 JSON and checked the persisted filters and empty result.",
	);
});

test("Proactive Support saves and searches an undelivered campaign draft", async ({
	authenticatedPage: page,
}) => {
	const fixture = await conversation(page);
	const name = unique("support-campaign");
	const message = "QA draft only: do not deliver";
	await ready(page, "/support/proactive-support");
	await field(page, "Campaign name").fill(name);
	await field(page, "Inbox ID").fill(fixture.inboxId);
	await field(page, "Support message").fill(message);
	const id = await savedByClick(page, "Create campaign", plugin);
	await page.reload();
	await page.getByPlaceholder("Search").fill(name);
	await page.getByRole("button", { name: "Search", exact: true }).click();
	await expect(page.getByText(name, { exact: true })).toBeVisible();
	await expect(page.getByText(message, { exact: true })).toBeVisible();
	const stored = await siteApi(
		page.request,
		plugin,
		"GET",
		`${fixture.base}/proactive-support/campaigns/${id}`,
	);
	expect(stored).toMatchObject({
		id,
		name,
		message,
		status: "draft",
		inbox_id: fixture.inboxId,
		started_at: null,
	});
	await evidence(
		plugin,
		"superboard.support_proactive_support",
		[id, fixture.inboxId],
		"Created a proactive campaign through the form, reloaded and searched it, and read back its draft state without starting or sending it.",
	);
});
