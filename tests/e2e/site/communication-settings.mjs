import assert from "node:assert/strict";

import { chromium, expect } from "@playwright/test";

const origin = new URL(process.env.SUPERBOARD_LOCAL_URL ?? "http://127.0.0.1:4321");
assert(["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname));
const diagnostic = new URL(
	"/_emdash/api/superboard/plugins/supbrd-plug-communication/diagnostic",
	origin,
).href;
const health = diagnostic.replace(/diagnostic$/, "health");
const deliveryOperation =
	/(?:smtp\/test|verify-domain|transactional|\/send|\/retry|\/replay|\.command.test_smtp_settings|\.command.verify_smtp_domain|\.command.send_transactional_email)(?:\?|$)/u;
const browser = await chromium.launch();
try {
	const context = await browser.newContext();
	const page = await context.newPage();
	page.setDefaultTimeout(30000);
	const errors = [];
	const deliveries = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.route("**/*", (route) => {
		if (route.request().method() === "POST" && deliveryOperation.test(route.request().url())) {
			deliveries.push(route.request().url());
			return route.abort("blockedbyclient");
		}
		return route.continue();
	});
	const firstRead = page.waitForRequest(
		(r) => r.method() === "GET" && r.url().endsWith("/settings/smtp"),
	);
	await page.goto(
		new URL("/_emdash/api/auth/dev-bypass?redirect=/communication/settings", origin).href,
	);
	const marketing = (await firstRead).url().replace(/\/settings\/smtp$/, "");
	const email = marketing.replace("/marketing/", "/email/");
	const studio = marketing + "/studio/settings";
	const read = async (url) => {
		const response = await context.request.get(url);
		assert.equal(response.status(), 200, await response.text());
		const body = await response.json();
		return body.data ?? body;
	};
	const mutate = async (url, method, data) => {
		const response = await context.request.fetch(url, {
			method,
			headers: {
				Origin: origin.origin,
				"X-EmDash-Request": "1",
				"Idempotency-Key": crypto.randomUUID(),
			},
			data,
		});
		assert.ok(response.ok(), await response.text());
	};
	for (const endpoint of [marketing, email]) {
		const settings = await read(endpoint + "/settings/smtp");
		for (const profile of settings.profiles ?? (settings.id ? [settings] : [])) {
			if (profile.name.startsWith("issue82-"))
				await mutate(endpoint + "/settings/smtp/" + profile.id, "DELETE");
		}
	}
	const original = await read(studio);
	const cleanup = [];
	const hydrate = async () => {
		await page.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])').waitFor();
		await expect(page.getByRole("tab", { name: "Configuration", exact: true })).toBeVisible();
	};
	const open = async (tab, locale) => {
		await page.goto(new URL(`/communication/settings?tab=${tab}&lang=${locale}`, origin).href);
		await hydrate();
	};
	try {
		for (const locale of ["en", "fr"]) {
			const fr = locale === "fr";
			await open("delivery", locale);
			await expect(
				page.getByText(fr ? "Boîte d’envoi" : "Delivery outbox", { exact: true }),
			).toHaveCount(0);
			const first = page.getByRole("tab", {
				name: fr ? "Paramètres d’envoi" : "Delivery settings",
				exact: true,
			});
			await first.focus();
			await first.press("ArrowRight");
			await expect(
				page.getByRole("tab", {
					name: fr ? "Webhooks marketing" : "Marketing webhooks",
					exact: true,
				}),
			).toHaveAttribute("aria-selected", "true");
			for (const [tab, endpoint] of [
				["delivery", marketing],
				["email", email],
			]) {
				await open(tab, locale);
				console.log("Checking sender", locale, tab);
				const profileName = `issue82-${tab}-${locale}-${Date.now()}`;
				await page
					.getByPlaceholder(fr ? "Nom de l’expéditeur" : "Profile name", { exact: true })
					.first()
					.fill(profileName);
				const settings = await read(endpoint + "/settings/smtp");
				if (settings.provider !== "aws-ses") {
					await page
						.getByPlaceholder(fr ? "Serveur SMTP" : "SMTP host", { exact: true })
						.fill("smtp.invalid");
					await page.locator('input[type="password"]').fill("issue82-local-test-secret");
				}
				await page
					.getByPlaceholder(fr ? "Adresse d’expédition" : "From email", { exact: true })
					.fill("issue82@example.invalid");
				const enabled = page.getByRole("switch");
				await enabled.uncheck();
				console.log(
					"Saving",
					endpoint,
					"disabled:",
					await page
						.getByRole("button", {
							name: fr ? "Enregistrer l’expéditeur" : "Save profile",
							exact: true,
						})
						.isDisabled(),
				);
				const save = page.waitForResponse(
					(r) =>
						(r.url() === endpoint + "/settings/smtp" && r.request().method() === "PUT") ||
						(r.url().includes(".command.save_smtp_settings") && r.request().method() === "POST"),
				);
				await page
					.getByRole("button", {
						name: fr ? "Enregistrer l’expéditeur" : "Save profile",
						exact: true,
					})
					.click();
				const saved = await save;
				assert.ok(saved.ok(), await saved.text());
				const value = await read(endpoint + "/settings/smtp");
				const profile = (value.profiles ?? (value.id ? [value] : [])).find(
					(row) => row.name === profileName,
				);
				assert.ok(profile);
				cleanup.push(endpoint + "/settings/smtp/" + profile.id);
				assert.equal(profile.enabled, false);
				assert.equal(profile.configured, true);
				assert.ok(
					settings.provider === "aws-ses" ||
						profile.provider === "aws-ses" ||
						profile.host === "smtp.invalid",
				);
				assert.ok(!JSON.stringify(value).includes("issue82-local-test-secret"));
				await page.reload();
				await hydrate();
				await page
					.getByRole("button", { name: new RegExp(profileName) })
					.first()
					.click();
				if (settings.provider !== "aws-ses" && profile.provider !== "aws-ses")
					await expect(
						page.getByPlaceholder(fr ? "Serveur SMTP" : "SMTP host", { exact: true }),
					).toHaveValue("smtp.invalid");
				if (settings.provider !== "aws-ses" && profile.provider !== "aws-ses")
					await expect(page.locator('input[type="password"]')).toHaveValue("");
				const saveAgain = page.waitForResponse(
					(r) =>
						(r.url() === endpoint + "/settings/smtp" && r.request().method() === "PUT") ||
						(r.url().includes(".command.save_smtp_settings") && r.request().method() === "POST"),
				);
				await page
					.getByRole("button", {
						name: fr ? "Enregistrer l’expéditeur" : "Save profile",
						exact: true,
					})
					.click();
				assert.ok((await saveAgain).ok());
				const reread = await read(endpoint + "/settings/smtp");
				assert.equal(
					(reread.profiles ?? [reread]).find((row) => row.id === profile.id).configured,
					true,
				);
			}
			for (const [tab, endpoint] of [
				["webhooks", marketing],
				["email-webhooks", email],
			]) {
				await open(tab, locale);
				const provider = `issue82_${locale}_${Date.now()}`;
				await page
					.getByPlaceholder(fr ? "Identifiant du fournisseur" : "Provider identifier", {
						exact: true,
					})
					.fill(provider);
				await page.locator('input[type="password"]').fill("short");
				const create = page.getByRole("button", {
					name: fr ? "Créer le point de réception" : "Create endpoint",
					exact: true,
				});
				await expect(create).toBeDisabled();
				await page.locator('input[type="password"]').fill("issue82-local-webhook-secret");
				const saved = page.waitForResponse(
					(r) =>
						r.url() === endpoint + "/settings/provider-webhooks" && r.request().method() === "POST",
				);
				await create.click();
				const response = await saved;
				assert.ok(response.ok(), await response.text());
				const rows = await read(endpoint + "/settings/provider-webhooks");
				const row = rows.find((item) => item.provider === provider);
				assert.ok(row);
				cleanup.push(endpoint + "/settings/provider-webhooks/" + row.id);
				assert.ok(!JSON.stringify(rows).includes("issue82-local-webhook-secret"));
				await page.reload();
				await hydrate();
				await expect(page.getByText(provider, { exact: true })).toBeVisible();
			}
			await page.goto(
				new URL(`/communication/marketing-email?tab=settings&lang=${locale}`, origin).href,
			);
			await page.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])').waitFor();
			const frequency = page.getByLabel(
				fr ? "Intervalle marketing (heures)" : "Marketing frequency (hours)",
				{ exact: true },
			);
			await frequency.fill(fr ? "47" : "46");
			const saved = page.waitForResponse(
				(r) => r.url() === studio && r.request().method() === "PUT",
			);
			await page.getByRole("button", { name: fr ? "Enregistrer" : "Save", exact: true }).click();
			assert.equal((await saved).status(), 200);
			assert.equal((await read(studio)).marketing_frequency_hours, fr ? 47 : 46);
			await page.reload();
			await page.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])').waitFor();
			await expect(frequency).toHaveValue(fr ? "47" : "46");
			await open("configuration", locale);
			await expect(
				page.getByText(locale === "fr" ? "Cycle de vie du plugin" : "Plugin Lifecycle", {
					exact: true,
				}),
			).toBeVisible();
			const checked = page.waitForResponse(
				(response) => response.url() === health && response.request().method() === "POST",
			);
			await page
				.getByRole("button", {
					name: locale === "fr" ? "Vérifier à nouveau" : "Re-check Health",
					exact: true,
				})
				.click();
			const result = await (await checked).json();
			assert.ok(result.checkedAt);
			const inventory = result.diagnostic;
			assert.equal(inventory.pluginId, "supbrd-plug-communication");
			assert.ok(
				inventory.workers.some((worker) => worker.service === "email" && worker.physicalName),
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
			await page
				.getByRole("button", {
					name: locale === "fr" ? "Vérifier à nouveau" : "Re-check Health",
					exact: true,
				})
				.click();
			const workers = page.getByRole("table", {
				name: locale === "fr" ? "Services et Workers associés" : "Associated Services & Workers",
				exact: true,
			});
			await expect(workers).toContainText(locale === "fr" ? "Inconnu" : "Unknown");
			await expect(workers).toContainText(
				inventory.workers.find((worker) => worker.service === "email").physicalName,
			);
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
			await expect(workers).toBeVisible();
			await page.goto(new URL(`/communication/channels?lang=${locale}`, origin).href);
			await page.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])').waitFor();
			await expect(
				page.getByPlaceholder(fr ? "Notifications clients" : "Customer notifications", {
					exact: true,
				}),
			).toBeVisible();

			await page.goto(new URL(`/marketing/settings?lang=${locale}&tab=email`, origin).href);
			await page.waitForURL((url) => url.pathname === "/communication/settings");
			await hydrate();
			assert.equal(new URL(page.url()).searchParams.get("tab"), "email");
			console.log(
				`${locale}: Sender identities and webhooks saved/reread/reloaded; secrets preserved; language settings saved; keyboard, legacy links, ${seen.length} diagnostic routes, health failure and retry passed`,
			);
		}
	} finally {
		for (const url of cleanup.toReversed()) await mutate(url, "DELETE");
		await mutate(studio, "PUT", original);
	}
	const anonymous = await browser.newContext();
	for (const [url, method] of [
		[marketing + "/settings/smtp", "GET"],
		[marketing + "/settings/smtp", "PUT"],
		[email + "/settings/smtp", "GET"],
		[email + "/settings/smtp", "PUT"],
		[studio, "GET"],
		[studio, "PUT"],
		[diagnostic, "GET"],
		[health, "POST"],
	]) {
		const response = await anonymous.request.fetch(url, {
			method,
			headers: { Origin: origin.origin, "X-EmDash-Request": "1" },
			data: method === "PUT" ? {} : undefined,
		});
		assert.equal(response.status(), 401);
	}
	const denied = await anonymous.request.get(new URL("/communication/settings", origin).href, {
		maxRedirects: 0,
	});
	assert.equal(denied.status(), 302);
	assert.match(denied.headers().location, /login/);
	assert.deepEqual(deliveries, []);
	assert.deepEqual(errors, []);
	console.log(
		"Anonymous access denied; zero sends; test profiles/webhooks removed and original studio settings restored.",
	);
} finally {
	await browser.close();
}
