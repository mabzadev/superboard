import assert from "node:assert/strict";

import { chromium, expect as baseExpect } from "@playwright/test";
const expect = baseExpect.configure({ timeout: 30000 });
const origin = new URL(process.env.SUPERBOARD_LOCAL_URL ?? "http://127.0.0.1:4321");
assert(["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname));
const browser = await chromium.launch();
const cleanup = [];
try {
	const context = await browser.newContext();
	const page = await context.newPage();
	page.setDefaultTimeout(30000);
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(new URL("/_emdash/api/auth/dev-bypass?redirect=/support/inbox", origin).href);
	const api = new URL("/api/v1/support/projects/1-prod/", origin).href;
	const read = async (path) => {
		const response = await context.request.get(api + path);
		assert.ok(response.ok(), await response.text());
		return (await response.json()).data;
	};
	const write = async (path, method, data) => {
		const response = await context.request.fetch(api + path, {
			method,
			data,
			headers: {
				Origin: origin.origin,
				"X-EmDash-Request": "1",
				"Idempotency-Key": crypto.randomUUID(),
			},
		});
		assert.ok(response.ok(), await response.text());
		return (await response.json()).data;
	};
	const open = async (path, locale) => {
		await page.goto(
			new URL(path + (path.includes("?") ? "&" : "?") + "lang=" + locale, origin).href,
		);
		await page.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])').waitFor();
	};
	try {
		for (const locale of ["en", "fr"]) {
			const fr = locale === "fr";
			const suffix = crypto.randomUUID().slice(0, 8);
			await open("/support/inbox", locale);
			const links = await page
				.locator("aside a")
				.evaluateAll((nodes) => [
					...new Set(
						nodes
							.map((node) => new URL(node.href).pathname)
							.filter((path) => path.startsWith("/support/")),
					),
				]);
			assert.deepEqual(links.toSorted(), [
				"/support/help-center",
				"/support/inbox",
				"/support/settings",
			]);
			await expect(page.getByRole("tab")).toHaveCount(0);
			await page
				.getByRole("button", { name: fr ? "Ajouter un élément" : "Add an item", exact: true })
				.click();
			await page.getByLabel(fr ? "Nom" : "Name", { exact: true }).fill("Inbox " + suffix);
			await page
				.getByRole("button", {
					name: fr ? "Créer et configurer" : "Create and configure",
					exact: true,
				})
				.click();
			await page.waitForURL((url) => url.searchParams.has("inbox"));
			const inboxId = new URL(page.url()).searchParams.get("inbox");
			cleanup.push("workforce/inboxes/" + inboxId);
			await expect(page.getByLabel(fr ? "Nom" : "Name", { exact: true })).toHaveValue(
				"Inbox " + suffix,
			);
			await page.getByLabel(fr ? "Nom" : "Name", { exact: true }).fill("Renamed " + suffix);
			await Promise.all([
				page.waitForResponse(
					(response) => response.request().method() === "PATCH" && response.url().includes(inboxId),
				),
				page
					.getByRole("button", {
						name: fr ? "Enregistrer les paramètres" : "Save settings",
						exact: true,
					})
					.click(),
			]);
			assert.equal((await read("workforce/inboxes/" + inboxId)).name, "Renamed " + suffix);
			await page.reload();
			await expect(page.getByLabel(fr ? "Nom" : "Name", { exact: true })).toHaveValue(
				"Renamed " + suffix,
			);
			const report = page.waitForResponse(
				(response) =>
					response.url().includes("/reports?") &&
					new URL(response.url()).searchParams.get("inbox_id") === inboxId,
			);
			await page.getByRole("tab", { name: fr ? "Rapports" : "Reports", exact: true }).click();
			assert.ok((await report).ok());
			await expect(page.locator("main h1")).toHaveCount(1);
			await page
				.getByRole("tab", { name: fr ? "Automatisations" : "Automations", exact: true })
				.click();
			await page.getByLabel(fr ? "Nom" : "Name", { exact: true }).fill("Automation " + suffix);
			await page.getByLabel(fr ? "Action" : "Action", { exact: true }).selectOption("set_priority");
			await page
				.getByLabel(fr ? "Valeur de l’action" : "Action value", { exact: true })
				.fill("high");
			const [automationResponse] = await Promise.all([
				page.waitForResponse(
					(response) =>
						response.request().method() === "POST" && response.url().endsWith("/automations"),
				),
				page
					.getByRole("button", { name: fr ? "Créer une règle" : "Create rule", exact: true })
					.click(),
			]);
			assert.ok(automationResponse.ok(), await automationResponse.text());
			const automation = (await automationResponse.json()).data;
			cleanup.push("automations/" + automation.id);
			assert.equal(automation.conditions[0].value, inboxId);
			await expect(
				page.getByRole("heading", { name: "Automation " + suffix, exact: true }),
			).toBeVisible();
			const automationReport = page.waitForResponse(
				(response) => new URL(response.url()).searchParams.get("automation_id") === automation.id,
			);
			await page
				.getByRole("tab", { name: fr ? "Rapports" : "Reports", exact: true })
				.last()
				.click();
			assert.equal((await (await automationReport).json()).data.executions, 0);
			for (let attempt = 0; attempt < 5; attempt++) {
				await page
					.getByRole("tab", { name: fr ? "Paramètres" : "Settings", exact: true })
					.last()
					.click();
				if (attempt === 0)
					await page
						.getByLabel(fr ? "Nom" : "Name", { exact: true })
						.fill("Renamed automation " + suffix);
				else
					await expect(page.getByLabel(fr ? "Nom" : "Name", { exact: true })).toHaveValue(
						"Renamed automation " + suffix,
					);
				await page.getByLabel(fr ? "Conditions" : "Conditions", { exact: true }).fill("[]");

				const [savedRule] = await Promise.all([
					page.waitForResponse(
						(response) =>
							response.request().method() === "PATCH" && response.url().includes(automation.id),
					),
					page
						.getByRole("button", {
							name: fr ? "Enregistrer les paramètres" : "Save settings",
							exact: true,
						})
						.click(),
				]);
				assert.ok(savedRule.ok(), await savedRule.text());
				await page
					.getByRole("button", { name: "Renamed automation " + suffix, exact: true })
					.click();
				await expect(
					page.getByRole("heading", { name: "Renamed automation " + suffix, exact: true }),
				).toBeVisible();
			}
			await page.reload();
			await expect(
				page.getByRole("heading", { name: "Renamed automation " + suffix, exact: true }),
			).toBeVisible();

			await open("/support/help-center", locale);
			await expect(page.getByRole("tab")).toHaveCount(0);
			await page
				.getByRole("button", { name: fr ? "Ajouter un élément" : "Add an item", exact: true })
				.click();
			await page.getByLabel(fr ? "Nom" : "Name", { exact: true }).fill("Help " + suffix);
			await page
				.getByRole("button", {
					name: fr ? "Créer et configurer" : "Create and configure",
					exact: true,
				})
				.click();
			await page.waitForURL((url) => url.searchParams.has("portal"));
			const portalId = new URL(page.url()).searchParams.get("portal");
			cleanup.push("help-center/portals/" + portalId);
			await expect(page.getByLabel(fr ? "Nom" : "Name", { exact: true })).toHaveValue(
				"Help " + suffix,
			);
			await page.getByLabel(fr ? "Nom" : "Name", { exact: true }).fill("Updated help " + suffix);
			await Promise.all([
				page.waitForResponse(
					(response) =>
						response.request().method() === "PATCH" && response.url().includes(portalId),
				),
				page
					.getByRole("button", {
						name: fr ? "Enregistrer les paramètres" : "Save settings",
						exact: true,
					})
					.click(),
			]);
			assert.equal((await read("help-center/portals/" + portalId)).name, "Updated help " + suffix);
			const other = await write("help-center/portals", "POST", {
				name: "Other " + suffix,
				slug: "other-" + suffix,
				locale,
				status: "draft",
			});
			cleanup.push("help-center/portals/" + other.id);
			const foreign = await write("help-center/articles", "POST", {
				portal_id: other.id,
				title: "Other article " + suffix,
				slug: "other-article-" + suffix,
				content: "Other",
				status: "draft",
			});
			cleanup.push("help-center/articles/" + foreign.id);
			await page.getByRole("tab", { name: fr ? "Contenu" : "Content", exact: true }).click();
			await page
				.getByLabel(fr ? "Titre" : "Title", { exact: true })
				.fill("Local article " + suffix);
			await page
				.getByLabel(fr ? "Contenu de l’article" : "Article content", { exact: true })
				.fill("Draft article");
			const [created] = await Promise.all([
				page.waitForResponse(
					(response) =>
						response.request().method() === "POST" &&
						response.url().includes("help-center/articles"),
				),
				page
					.getByRole("button", {
						name: fr ? "Enregistrer le brouillon" : "Save draft",
						exact: true,
					})
					.click(),
			]);
			assert.ok(created.ok(), await created.text());
			const article = (await created.json()).data;
			cleanup.push("help-center/articles/" + article.id);
			assert.equal(article.portal_id, portalId);
			await expect(page.getByText("Local article " + suffix, { exact: true })).toBeVisible();
			await expect(page.getByText("Other article " + suffix, { exact: true })).toHaveCount(0);
			const portalReport = page.waitForResponse(
				(response) =>
					response.url().includes("/reports?") &&
					new URL(response.url()).searchParams.get("portal_id") === portalId,
			);
			await page.getByRole("tab", { name: fr ? "Rapports" : "Reports", exact: true }).click();
			assert.equal((await (await portalReport).json()).data.articles, 1);
			await page.reload();
			await expect(
				page.getByRole("tab", { name: fr ? "Rapports" : "Reports", exact: true }),
			).toHaveAttribute("aria-selected", "true");
			assert.deepEqual(errors, []);
			console.log(
				locale +
					": three menu entries, create/open/configure Inbox and Help Center, persisted settings, scoped content and reports passed",
			);
		}
	} finally {
		for (const path of cleanup.toReversed()) await write(path, "DELETE");
	}
	console.log(
		"Test Inbox, portals and draft articles removed; no messages sent or articles published.",
	);
} finally {
	await browser.close();
}
