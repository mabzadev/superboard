import assert from "node:assert/strict";

import { chromium, expect } from "@playwright/test";

const origin = new URL(process.env.SUPERBOARD_LOCAL_URL ?? "http://127.0.0.1:4321");
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
		await expect(page.getByRole("tab", { name: "Configuration", exact: true })).toBeVisible();
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
				persisted.values["supbrd-plug-products__default_currency"],
				locale === "fr" ? "CHF" : "EUR",
			);
			assert.equal(persisted.values["supbrd-plug-products__store_environment"], "sandbox");
			assert.equal(persisted.values["supbrd-plug-products__catalog_sync_enabled"], false);
			await page.reload();
			await hydrate();
			await expect(page.locator("#setting-default_currency")).toHaveValue(
				locale === "fr" ? "CHF" : "EUR",
			);
			await page
				.getByRole("tab", { name: locale === "fr" ? "Passerelles" : "Gateways", exact: true })
				.click();
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
				const key = `supbrd-plugmod-billing__${field}`;
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
			await save.click();
			await expect(page.getByRole("status")).toContainText(
				locale === "fr" ? "Paramètres enregistrés." : "Settings saved.",
			);
			persisted = await read();
			assert.equal(
				persisted.values["supbrd-plugmod-billing__apple_issuer_id"],
				`isolated-${locale}`,
			);
			assert.equal(persisted.values["supbrd-plugmod-billing__apple_key_id"], `isolated-${locale}`);
			for (const field of secretFields) {
				const key = `supbrd-plugmod-billing__${field}`;
				assert.equal(persisted.secretsSet[key], true);
				assert.equal(key in persisted.values, false);
			}
			await page.reload();
			await hydrate();
			for (const field of secretFields)
				await expect(page.locator(`#setting-${field}`)).toHaveValue("");
			await page.getByRole("tab", { name: "Configuration", exact: true }).click();
			await expect(
				page.getByText(locale === "fr" ? "Cycle de vie du plugin" : "Plugin Lifecycle", {
					exact: true,
				}),
			).toBeVisible();
			const refreshed = page.waitForResponse(
				(r) => r.url() === health && r.request().method() === "POST",
			);
			const recheck = page.getByRole("button", {
				name: locale === "fr" ? "Vérifier à nouveau" : "Re-check Health",
				exact: true,
			});
			await recheck.click();
			const healthResponse = await refreshed;
			assert.equal(healthResponse.status(), 200);
			const checked = await healthResponse.json();
			assert.ok(checked.checkedAt);
			const inventory = checked.diagnostic;
			for (const service of ["billing", "products"])
				assert.ok(
					inventory.workers.some((worker) => worker.service === service && worker.physicalName),
				);
			const routeLabel = locale === "fr" ? "Routes API" : "API Routes";
			await page
				.getByRole("button", {
					name: `${routeLabel} (${inventory.routes.api.length})`,
					exact: true,
				})
				.click();
			const seen = [];
			const table = page.getByRole("table", { name: routeLabel, exact: true });
			while (seen.length < inventory.routes.api.length) {
				await expect(table.getByRole("row").nth(1).getByRole("cell").nth(1)).toHaveText(
					inventory.routes.api[seen.length].path,
				);
				const rows = table.getByRole("row");
				for (let index = 1; index < (await rows.count()); index++)
					seen.push(await rows.nth(index).getByRole("cell").allTextContents());
				if (seen.length < inventory.routes.api.length)
					await page
						.getByRole("button", { name: locale === "fr" ? "Suivant" : "Next", exact: true })
						.click();
			}
			assert.deepEqual(
				seen,
				inventory.routes.api.map((route) => [
					route.method,
					route.path,
					route.worker ?? (locale === "fr" ? "Inconnu" : "Unknown"),
					route.url ?? (locale === "fr" ? "Inconnu" : "Unknown"),
				]),
			);
			await page.route(health, (route) => route.abort("failed"));
			await recheck.click();
			await expect(
				page.getByRole("table", {
					name: locale === "fr" ? "Services et Workers associés" : "Associated Services & Workers",
					exact: true,
				}),
			).toContainText(locale === "fr" ? "Inconnu" : "Unknown");
			await page.unroute(health);
			await page.route(diagnostic, (route) => route.abort("failed"));
			await page.reload();
			await hydrate();
			await expect(
				page.getByText(
					locale === "fr" ? "Échec du chargement du diagnostic" : "Failed to load diagnostic",
					{ exact: true },
				),
			).toBeVisible();
			await page.unroute(diagnostic);
			await page
				.getByRole("button", { name: locale === "fr" ? "Réessayer" : "Retry", exact: true })
				.click();
			await expect(
				page.getByText(locale === "fr" ? "Cycle de vie du plugin" : "Plugin Lifecycle", {
					exact: true,
				}),
			).toBeVisible();
			console.log(
				`${locale}: settings saved and reread; secret masking, reload, keyboard, ${seen.length} API routes, health refresh/failure and diagnostic retry passed`,
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
