import assert from "node:assert/strict";

import { chromium, expect } from "@playwright/test";

const origin = new URL(process.env.SUPERBOARD_LOCAL_URL ?? "http://127.0.0.1:4321");
assert(["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname));
const browser = await chromium.launch();
try {
	const context = await browser.newContext();
	const page = await context.newPage();
	page.setDefaultTimeout(30000);
	const configurationResponse = page.waitForResponse((response) =>
		response.url().endsWith("/api/v1/configuration"),
	);
	await page.goto(new URL("/_emdash/api/auth/dev-bypass?redirect=/auth/settings", origin).href);
	const endpoint = (await configurationResponse).url();
	const read = async () => {
		const response = await context.request.get(endpoint);
		assert.equal(response.status(), 200);
		return response.json();
	};
	const write = async (values) => {
		const current = await read();
		const response = await context.request.put(endpoint, {
			headers: {
				Origin: origin.origin,
				"X-EmDash-Request": "1",
				"Idempotency-Key": crypto.randomUUID(),
			},
			data: { revision: current.revision, values },
		});
		assert.equal(response.status(), 200, await response.text());
	};
	const original = await read();
	const hydrate = async () => {
		await page.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])').waitFor();
		await expect(page.locator("#setting-EMAIL_SENDER_NAME")).toBeVisible();
	};
	try {
		for (const locale of ["en", "fr"]) {
			await page.goto(new URL(`/auth/settings?lang=${locale}`, origin).href);
			await hydrate();
			await expect(page.locator("#setting-SUPPORTED_LOCALES")).toHaveValue(
				original.values.SUPPORTED_LOCALES.join(", "),
			);
			const advanced = page.getByRole("button", {
				name: locale === "fr" ? "Avancé" : "Advanced",
				exact: true,
			});
			await advanced.focus();
			await advanced.press("Enter");
			const duration = page.locator("#setting-AUTHORIZATION_CODE_EXPIRES_IN");
			await expect(duration).toHaveValue(String(original.values.AUTHORIZATION_CODE_EXPIRES_IN));
			const next = original.values.AUTHORIZATION_CODE_EXPIRES_IN === 120 ? 180 : 120;
			await duration.fill(String(next));
			const saved = page.waitForResponse(
				(response) => response.url() === endpoint && response.request().method() === "PUT",
			);
			await page
				.getByRole("button", {
					name: locale === "fr" ? "Enregistrer" : "Save changes",
					exact: true,
				})
				.click();
			assert.equal((await saved).status(), 200);
			assert.equal((await read()).values.AUTHORIZATION_CODE_EXPIRES_IN, next);
			await page.reload();
			await hydrate();
			await advanced.click();
			await expect(duration).toHaveValue(String(next));
			await page
				.getByRole("button", { name: locale === "fr" ? "Général" : "General", exact: true })
				.click();
			const sender = page.locator("#setting-EMAIL_SENDER_NAME");
			await sender.fill("Unsaved operator draft");
			await write({ EMAIL_SENDER_NAME: "Concurrent operator" });
			const conflict = page.waitForResponse(
				(response) => response.url() === endpoint && response.request().method() === "PUT",
			);
			await page
				.getByRole("button", {
					name: locale === "fr" ? "Enregistrer" : "Save changes",
					exact: true,
				})
				.click();
			assert.equal((await conflict).status(), 409);
			await expect(sender).toHaveValue("Unsaved operator draft");
			await expect(page.getByRole("alert")).toBeVisible();
			await page
				.getByRole("button", {
					name: locale === "fr" ? "Recharger les valeurs" : "Reload values",
					exact: true,
				})
				.click();
			await expect(sender).toHaveValue("Concurrent operator");
			const diagnosticPattern = "**/plugins/supbrd-plug-identity/diagnostic";
			await page.route(diagnosticPattern, (route) => route.abort("failed"));
			await page.getByRole("button", { name: "Configuration", exact: true }).click();
			await expect(
				page.getByText(
					locale === "fr"
						? "Une erreur est survenue lors de la récupération des données de diagnostic."
						: "An error occurred while fetching configuration diagnostic data.",
					{ exact: true },
				),
			).toBeVisible();
			await page.unroute(diagnosticPattern);
			await page
				.getByRole("button", { name: locale === "fr" ? "Réessayer" : "Retry", exact: true })
				.click();
			await expect(
				page.getByText(locale === "fr" ? "Cycle de vie du plugin" : "Plugin Lifecycle", {
					exact: true,
				}),
			).toBeVisible();
			await write({
				EMAIL_SENDER_NAME: original.values.EMAIL_SENDER_NAME,
				AUTHORIZATION_CODE_EXPIRES_IN: original.values.AUTHORIZATION_CODE_EXPIRES_IN,
			});
			console.log(
				`${locale}: list/number rendering, keyboard navigation, save/API reread/reload, conflict/draft/reload, diagnostic failure/retry passed`,
			);
		}
	} finally {
		await write({
			EMAIL_SENDER_NAME: original.values.EMAIL_SENDER_NAME,
			AUTHORIZATION_CODE_EXPIRES_IN: original.values.AUTHORIZATION_CODE_EXPIRES_IN,
		});
	}
	const anonymous = await browser.newContext();
	for (const action of ["diagnostic", "health"]) {
		const response = await anonymous.request.fetch(
			new URL(`/_emdash/api/superboard/plugins/supbrd-plug-identity/${action}`, origin).href,
			{
				method: action === "health" ? "POST" : "GET",
				headers: {
					Origin: origin.origin,
					"X-EmDash-Request": "1",
					"Idempotency-Key": crypto.randomUUID(),
				},
			},
		);
		assert.equal(response.status(), 401);
	}
	console.log("Anonymous diagnostic/health access denied; original settings restored.");
} finally {
	await browser.close();
}
