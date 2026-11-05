import assert from "node:assert/strict";

import { chromium, expect } from "@playwright/test";

const origin = new URL(process.env.SUPERBOARD_LOCAL_URL ?? "http://127.0.0.1:4321");
const pluginsLinkName = /^(Open in Plugins|Ouvrir dans Plugins)$/;
const pluginsLinkHref =
	/^\/_emdash\/admin\/plugins-manager\/superboard-monetization\/configuration$/;
assert(["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname));
const endpoint = new URL("/_emdash/api/admin/plugins/supbrd-plug-commerce/settings", origin).href;
const diagnostic = new URL(
	"/_emdash/api/superboard/plugins/supbrd-plug-commerce/diagnostic",
	origin,
).href;
const health = diagnostic.replace(/diagnostic$/, "health");
const billingOverviewPath = /\/api\/v1\/billing\/[^/]+$/;
const browser = await chromium.launch();
try {
	const context = await browser.newContext();
	const page = await context.newPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const billingLoaded = page.waitForResponse((response) =>
		billingOverviewPath.test(new URL(response.url()).pathname),
	);
	await page.goto(
		new URL("/_emdash/api/auth/dev-bypass?redirect=/monetization/settings", origin).href,
	);
	const billingResponse = await billingLoaded;
	assert.equal(billingResponse.status(), 200);
	const billingEndpoint = billingResponse.url();
	const originalBilling = (await billingResponse.json()).settings;
	assert.ok(originalBilling);
	const hydrate = async () => {
		await page.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])').waitFor();
		await expect(page.getByRole("link", { name: pluginsLinkName })).toBeVisible();
	};
	try {
		for (const locale of ["en", "fr"]) {
			await page.goto(new URL(`/monetization/settings?lang=${locale}&tab=general`, origin).href);
			await hydrate();
			const purchase = page.getByRole("checkbox", {
				name: locale === "fr" ? "Activer les achats" : "Enable purchases",
			});
			const [restoreBehavior, restoreLabel] =
				locale === "fr"
					? ["block", "Garder l’identifiant d’origine"]
					: [
							"transfer_if_no_active_subscriptions",
							"Transfer if there are no active subscriptions",
						];
			const restore = page.getByRole("radio", { name: restoreLabel, exact: true });
			await purchase.click();
			await restore.click();
			const enabled = await purchase.isChecked();
			await expect(restore).toBeChecked();
			await page
				.getByRole("button", {
					name: locale === "fr" ? "Enregistrer les paramètres" : "Save settings",
					exact: true,
				})
				.click();
			await expect(page.getByRole("status")).toContainText(
				locale === "fr" ? "Paramètres enregistrés." : "Settings saved.",
			);
			const billing = await (await context.request.get(billingEndpoint)).json();
			assert.equal(billing.settings.purchases_enabled, enabled ? 1 : 0);
			assert.equal(billing.settings.restore_behavior, restoreBehavior);
			await page.reload();
			await hydrate();
			await expect(purchase).toBeChecked({ checked: enabled });
			await expect(restore).toBeChecked();
			await page.goto(new URL(`/monetization/settings?lang=${locale}&tab=products`, origin).href);
			await hydrate();
			const general = page.getByRole("tab", {
				name: locale === "fr" ? "Général" : "General",
				exact: true,
			});
			await expect(general).toHaveAttribute("aria-selected", "true");
			await expect(page.getByRole("tab")).toHaveCount(2);
			await expect(
				page.getByRole("tab", { name: locale === "fr" ? "Produits" : "Products", exact: true }),
			).toHaveCount(0);
			await general.focus();
			await general.press("ArrowRight");
			await expect(
				page.getByRole("tab", { name: locale === "fr" ? "Passerelles" : "Gateways", exact: true }),
			).toHaveAttribute("aria-selected", "true");
			await page
				.getByRole("tab", { name: locale === "fr" ? "Passerelles" : "Gateways", exact: true })
				.click();
			const gateways = page.getByRole("heading", {
				name: locale === "fr" ? "Passerelles connectées" : "Connected Gateways",
			});
			await expect(gateways).toBeVisible();
			await expect(page.getByRole("tab", { name: "Configuration", exact: true })).toHaveCount(0);
			await expect(
				page.getByRole("link", {
					name: locale === "fr" ? "Ouvrir dans Plugins" : "Open in Plugins",
					exact: true,
				}),
			).toHaveAttribute("href", pluginsLinkHref);
			const healthResponse = await context.request.post(health, {
				headers: { Origin: origin.origin, "X-EmDash-Request": "1" },
			});
			assert.equal(healthResponse.status(), 200, await healthResponse.text());
			const checked = await healthResponse.json();
			assert.ok(checked.checkedAt);
			const inventory = checked.diagnostic;
			for (const service of ["billing", "products"])
				assert.ok(
					inventory.workers.some((worker) => worker.service === service && worker.physicalName),
				);
			await page.goto(
				new URL(`/monetization/settings?lang=${locale}&tab=configuration`, origin).href,
			);
			await hydrate();
			await expect(
				page.getByRole("tab", { name: locale === "fr" ? "Passerelles" : "Gateways", exact: true }),
			).toHaveAttribute("aria-selected", "true");
			await expect(gateways).toBeVisible();
			console.log(
				`${locale}: settings saved and reread; legacy Products link opens General, keyboard, Plugins diagnostics link, health check (${inventory.routes.api.length} API routes in diagnostic) and legacy configuration link passed`,
			);
		}
	} finally {
		const restoredBilling = await context.request.put(`${billingEndpoint}/settings`, {
			headers: {
				Origin: origin.origin,
				"X-EmDash-Request": "1",
				"Idempotency-Key": crypto.randomUUID(),
			},
			data: {
				purchases_enabled: originalBilling.purchases_enabled === 1,
				restore_behavior: originalBilling.restore_behavior,
			},
		});
		assert.equal(restoredBilling.status(), 200);
	}
	const anonymous = await browser.newContext();
	for (const [url, method] of [
		[endpoint, "GET"],
		[endpoint, "PUT"],
		[diagnostic, "GET"],
		[health, "POST"],
	]) {
		const response = await anonymous.request.fetch(url, {
			method,
			headers: { Origin: origin.origin, "X-EmDash-Request": "1" },
			data: method === "PUT" ? { values: {} } : undefined,
		});
		assert.equal(response.status(), 401);
	}
	assert.deepEqual(errors, []);
	console.log("Anonymous access refused; original settings restored; no payments executed.");
} finally {
	await browser.close();
}
