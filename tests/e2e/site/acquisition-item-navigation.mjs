import assert from "node:assert/strict";

import { chromium, expect } from "@playwright/test";

const origin = new URL(process.env.SUPERBOARD_LOCAL_URL ?? "http://127.0.0.1:4321");
assert(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
const browser = await chromium.launch();
const created = [];
try {
	const context = await browser.newContext();
	const page = await context.newPage();
	page.setDefaultTimeout(45000);
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const open = async (path) => {
		await page.goto(new URL(path, origin).href);
		await page.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])').waitFor();
	};
	const read = async (path) => {
		const response = await context.request.get(new URL(path, origin).href);
		assert.ok(response.ok(), await response.text());
		const body = await response.json();
		return body.data ?? body;
	};
	await open("/_emdash/api/auth/dev-bypass?redirect=/acquisition/paywalls");
	try {
		for (const locale of ["en", "fr"]) {
			const fr = locale === "fr";
			for (const kind of ["paywalls", "onboardings"]) {
				await open(`/acquisition/${kind}?lang=${locale}`);
				const settings = page.locator('a[href="/acquisition/settings"]').first();
				const menu = await settings.evaluate((element) => {
					let parent = element.parentElement;
					while (parent && !parent.querySelector('a[href="/acquisition/paywalls"]'))
						parent = parent.parentElement;
					return Array.from(parent.querySelectorAll("a"), (link) => link.getAttribute("href"));
				});
				assert.deepEqual(menu, [
					"/acquisition/paywalls",
					"/acquisition/onboardings",
					"/acquisition/dynamic-links",
					"/acquisition/settings",
				]);
				const main = page.locator("main");
				await expect(
					main.getByRole("button", { name: fr ? "Conception" : "Design", exact: true }),
				).toHaveCount(0);
				const name = `navigation-check-${kind}-${locale}-${Date.now()}`;
				await main
					.getByPlaceholder(fr ? "Nom affiché" : "Display name", { exact: true })
					.fill(name);
				const create =
					kind === "paywalls"
						? fr
							? "Créer un paywall"
							: "Create paywall"
						: fr
							? "Créer un parcours d’accueil"
							: "Create onboarding";
				await main.getByRole("button", { name: create, exact: true }).click();
				await page.waitForURL((url) => Boolean(url.searchParams.get("item")));
				const id = new URL(page.url()).searchParams.get("item");
				const api = `/api/v1/${kind}/projects/1-prod`;
				created.push(kind === "paywalls" ? `${api}/paywalls/${id}` : `${api}/${id}`);
				await expect(main.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
				await expect(main.getByRole("button", { name: create, exact: true })).toHaveCount(0);
				await main
					.locator("summary")
					.filter({ hasText: fr ? "Informations" : "Details" })
					.click();
				const displayName = main.getByLabel(fr ? "Nom affiché" : "Display name", { exact: true });
				await displayName.fill(name + " updated");
				await main
					.getByRole("button", {
						name: fr ? "Enregistrer les informations" : "Save details",
						exact: true,
					})
					.click();
				await expect
					.poll(
						async () =>
							(await read(api))
								.map((item) => ({ ...item, display_name: item.display_name ?? item.name }))
								.find((item) => item.id === id)?.display_name,
					)
					.toBe(name + " updated");
				if (fr || kind !== "paywalls") await page.reload();
				await expect(
					main.getByRole("heading", { level: 1, name: name + " updated", exact: true }),
				).toBeVisible();
				if (!fr && kind === "paywalls") {
					const font = main.getByLabel("Font", { exact: true });
					await font.click();
					await font.fill("Navigation test font");
					await expect(main.getByRole("status")).toContainText("Unsaved changes");
					const menuPrompt = page.waitForEvent("dialog");
					const menuClick = page.locator('a[href="/acquisition/paywalls"]').first().click();
					await (await menuPrompt).dismiss();
					await menuClick;
					await expect(font).toHaveValue("Navigation test font");
					const cancelPrompt = page.waitForEvent("dialog");
					const back = page.evaluate(() => window.history.back());
					await (await cancelPrompt).dismiss();
					await back;

					await expect.poll(() => new URL(page.url()).searchParams.get("item")).toBe(id);
					await expect(font).toHaveValue("Navigation test font");
					const discardPrompt = page.waitForEvent("dialog");
					const discardBack = page.evaluate(() => window.history.back());
					await (await discardPrompt).accept();
					await discardBack;
					await expect(main.getByRole("button", { name: create, exact: true })).toBeVisible();
					await main
						.getByRole("button")
						.filter({ hasText: name + " updated" })
						.click();
					await expect(font).not.toHaveValue("Navigation test font");
					await page.reload();
					await expect(
						main.getByRole("heading", { level: 1, name: name + " updated", exact: true }),
					).toBeVisible();
				}
				for (const section of ["Workflows", "Launchpad", "Components"]) {
					await main
						.getByRole("button", {
							name: section === "Components" && fr ? "Composants" : section,
							exact: true,
						})
						.first()
						.click();
					await expect(
						main.getByText(
							fr
								? "Ces fonctions sont partagées par les expériences de ce projet."
								: "These functions are shared by the experiences in this project.",
							{ exact: true },
						),
					).toBeVisible();
				}
				await main
					.getByRole("button", { name: fr ? "Retour à la liste" : "Back to list", exact: true })
					.click();
				await expect(main.getByRole("button", { name: create, exact: true })).toBeVisible();
				await main
					.getByRole("button")
					.filter({ hasText: name + " updated" })
					.click();
				assert.equal(new URL(page.url()).searchParams.get("item"), id);
				if (!fr)
					await page.screenshot({ path: `/tmp/acquisition-${kind}-detail.png`, fullPage: false });
				console.log(
					`${locale} ${kind}: list, create, detail, save/API reread, reload, advanced sections and return verified`,
				);
			}
			await open(`/acquisition/dynamic-links?lang=${locale}`);
			await page
				.locator("main")
				.getByRole("button", { name: fr ? "Créer un lien" : "Create link", exact: true })
				.first()
				.click();
			const dialog = page.getByRole("dialog");
			const name = `navigation-check-link-${locale}-${Date.now()}`;
			await dialog.getByLabel(fr ? "Nom" : "Name", { exact: true }).fill(name);
			await dialog.getByLabel(fr ? "Identifiant du lien" : "Slug", { exact: true }).fill(name);
			await dialog
				.getByLabel(fr ? "Destination par défaut" : "Default destination", { exact: true })
				.fill("https://example.com/start");
			await dialog
				.getByRole("button", { name: fr ? "Créer un lien" : "Create link", exact: true })
				.click();
			await page.waitForURL((url) => Boolean(url.searchParams.get("item")));
			const id = new URL(page.url()).searchParams.get("item");
			created.push(`/api/v1/dynamic-links/projects/1-prod/links/${id}`);
			await page.locator("main").getByRole("button", { name: "Destinations", exact: true }).click();
			await page
				.getByLabel(fr ? "Destination iOS" : "iOS destination", { exact: true })
				.fill("https://example.com/ios");
			await page
				.getByRole("button", { name: fr ? "Enregistrer le lien" : "Save link", exact: true })
				.click();
			await expect
				.poll(
					async () =>
						(await read("/api/v1/dynamic-links/projects/1-prod/links")).find(
							(link) => link.id === id,
						)?.destinations.ios,
				)
				.toBe("https://example.com/ios");
			await page.reload();
			await expect(page.getByRole("heading", { name, level: 1, exact: true })).toBeVisible();
			await page.locator("main").getByRole("button", { name: "Destinations", exact: true }).click();
			await expect(
				page.getByLabel(fr ? "Destination iOS" : "iOS destination", { exact: true }),
			).toHaveValue("https://example.com/ios");
			console.log(
				`${locale} dynamic links: minimal creation, detail, routing save/API reread and reload verified`,
			);
		}
		assert.deepEqual(errors, []);
	} finally {
		for (const path of created.toReversed()) {
			const response = await context.request.delete(new URL(path, origin).href, {
				headers: {
					Origin: origin.origin,
					"X-EmDash-Request": "1",
					"Idempotency-Key": crypto.randomUUID(),
				},
			});
			assert.ok(response.ok(), `Cleanup ${path}: ${response.status()} ${await response.text()}`);
		}
		console.log(`Removed ${created.length} temporary items from the lists.`);
	}
} finally {
	await browser.close();
}
