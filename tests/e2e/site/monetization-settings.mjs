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
	const read = async () => {
		const response = await context.request.get(endpoint);
		assert.equal(response.status(), 200);
		return (await response.json()).data;
	};
	const original = await read();
	const restore = { ...original.values };
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
			const transfer = page.getByRole("checkbox", {
				name:
					locale === "fr"
						? "Bloquer le transfert des achats entre utilisateurs"
						: "Block purchase transfers between users",
			});
			await purchase.click();
			await transfer.click();
			const enabled = await purchase.isChecked();
			const blocked = await transfer.isChecked();
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
			assert.equal(billing.settings.restore_behavior, blocked ? "block" : "transfer");
			await page.reload();
			await hydrate();
			await expect(purchase).toBeChecked({ checked: enabled });
			await expect(transfer).toBeChecked({ checked: blocked });
			await page.goto(new URL(`/monetization/settings?lang=${locale}&tab=products`, origin).href);
			await hydrate();
			const products = page.getByRole("tab", {
				name: locale === "fr" ? "Produits" : "Products",
				exact: true,
			});
			await expect(products).toHaveAttribute("aria-selected", "true");
			await products.focus();
			await products.press("ArrowRight");
			await expect(
				page.getByRole("tab", { name: locale === "fr" ? "Passerelles" : "Gateways", exact: true }),
			).toHaveAttribute("aria-selected", "true");
			await products.click();
			await page.locator("#setting-default_currency").fill(locale === "fr" ? "CHF" : "EUR");
			await page.locator("#setting-store_environment").selectOption("sandbox");
			await page.locator("#setting-catalog_sync_enabled").selectOption("false");
			const save = page.getByRole("button", {
				name: locale === "fr" ? "Enregistrer" : "Save changes",
				exact: true,
			});
			await save.click();
			await expect(page.getByRole("status")).toContainText(
				locale === "fr" ? "Paramètres enregistrés." : "Settings saved.",
			);
			let persisted = await read();
			assert.equal(
				persisted.values["superboard-products__default_currency"],
				locale === "fr" ? "CHF" : "EUR",
			);
			assert.equal(persisted.values["superboard-products__store_environment"], "sandbox");
			assert.equal(persisted.values["superboard-products__catalog_sync_enabled"], false);
			await page.reload();
			await hydrate();
			await expect(page.locator("#setting-default_currency")).toHaveValue(
				locale === "fr" ? "CHF" : "EUR",
			);
			await page
				.getByRole("tab", { name: locale === "fr" ? "Passerelles" : "Gateways", exact: true })
				.click();
			// Store credentials live in the collapsed Advanced section of the Gateways tab.
			const advancedLabel = locale === "fr" ? "Avancé" : "Advanced";
			const advanced = page.locator("details", {
				has: page.getByText(advancedLabel, { exact: true }),
			});
			await expect(advanced).not.toHaveAttribute("open", "");
			await advanced.getByText(advancedLabel, { exact: true }).click();
			await expect(advanced).toHaveAttribute("open", "");
			for (const field of ["apple_issuer_id", "apple_key_id"])
				await page.locator(`#setting-${field}`).fill(`isolated-${locale}`);
			const secretFields = [
				"apple_private_key",
				"google_service_account_json",
				"stripe_secret_key",
				"webhook_signing_secret",
			];
			for (const field of secretFields) {
				await expect(page.locator(`#setting-${field}`)).toHaveValue("");
				const key = `superboard-billing__${field}`;
				if (!original.secretsSet[key]) {
					restore[key] = null;
					const secret =
						field === "apple_private_key"
							? `-----BEGIN PRIVATE KEY-----\nisolated-${locale}\n-----END PRIVATE KEY-----`
							: `isolated-test-${locale}-${field}`;
					await page.locator(`#setting-${field}`).fill(secret);
					await expect(page.locator(`#setting-${field}`)).toHaveValue(secret);
				}
			}
			await advanced
				.getByRole("button", {
					name: locale === "fr" ? "Enregistrer" : "Save changes",
					exact: true,
				})
				.click();
			await expect(advanced.getByRole("status")).toContainText(
				locale === "fr" ? "Paramètres enregistrés." : "Settings saved.",
			);
			persisted = await read();
			assert.equal(persisted.values["superboard-billing__apple_issuer_id"], `isolated-${locale}`);
			assert.equal(persisted.values["superboard-billing__apple_key_id"], `isolated-${locale}`);
			for (const field of secretFields) {
				const key = `superboard-billing__${field}`;
				assert.equal(persisted.secretsSet[key], true);
				assert.equal(key in persisted.values, false);
			}
			await page.reload();
			await hydrate();
			for (const field of secretFields)
				await expect(page.locator(`#setting-${field}`)).toHaveValue("");
			// Plugin health and lifecycle are owned by the central Plugins page.
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
			// Legacy configuration links open the Gateways tab with Advanced expanded.
			await page.goto(
				new URL(`/monetization/settings?lang=${locale}&tab=configuration`, origin).href,
			);
			await hydrate();
			await expect(
				page.getByRole("tab", { name: locale === "fr" ? "Passerelles" : "Gateways", exact: true }),
			).toHaveAttribute("aria-selected", "true");
			await expect(advanced).toHaveAttribute("open", "");
			console.log(
				`${locale}: settings saved and reread; secret masking, reload, keyboard, Plugins diagnostics link, health check (${inventory.routes.api.length} API routes in diagnostic) and legacy configuration link passed`,
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
		const response = await context.request.put(endpoint, {
			headers: { Origin: origin.origin, "X-EmDash-Request": "1" },
			data: { values: restore },
		});
		assert.equal(response.status(), 200);
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
