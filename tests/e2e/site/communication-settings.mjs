import assert from "node:assert/strict";

import { chromium, expect } from "@playwright/test";

const origin = new URL(process.env.SUPERBOARD_LOCAL_URL ?? "http://127.0.0.1:4321");
const pluginsLinkName = /^(Open in Plugins|Ouvrir dans Plugins)$/;
const pluginsLinkHref =
	/^\/_emdash\/admin\/plugins-manager\/superboard-communication\/configuration$/;
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
		(r) =>
			r.method() === "GET" && r.url().includes("/marketing/") && r.url().endsWith("/settings/smtp"),
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
		await expect(page.getByRole("link", { name: pluginsLinkName })).toBeVisible();
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
				name: fr ? "Expéditeurs et domaines" : "Senders & domains",
				exact: true,
			});
			await first.focus();
			await first.press("ArrowRight");
			await expect(
				page.getByRole("tab", {
					name: fr ? "Préférences d’envoi" : "Sending preferences",
					exact: true,
				}),
			).toHaveAttribute("aria-selected", "true");
			for (const [tab, endpoint] of [
				["delivery", email],
				["email", email],
			]) {
				await open(tab, locale);
				console.log("Checking sender", locale, tab);
				const profileName = `issue82-${tab}-${locale}-${Date.now()}`;
				const savedSender = () =>
					page.waitForResponse(
						(r) =>
							(r.url() === endpoint + "/settings/smtp" && r.request().method() === "PUT") ||
							(r.url().includes(".command.save_smtp_settings") && r.request().method() === "POST"),
					);
				await page
					.getByRole("button", {
						name: fr ? "Ajouter un expéditeur" : "Add a sender",
						exact: true,
					})
					.click();
				await page
					.getByLabel(fr ? "Nom interne" : "Internal name", { exact: true })
					.fill(profileName);
				const settings = await read(endpoint + "/settings/smtp");
				if (settings.provider !== "aws-ses") {
					await page
						.getByLabel(fr ? "Serveur SMTP" : "SMTP host", { exact: true })
						.fill("smtp.invalid");
					await page
						.getByLabel(fr ? "Mot de passe" : "Password", { exact: true })
						.fill("issue82-local-test-secret");
				}
				await page
					.getByLabel(fr ? "Adresse d’expédition" : "From email", { exact: true })
					.fill("issue82@example.invalid");
				await expect(
					page.getByLabel(
						fr ? "Sélecteur DKIM (exemple : mail)" : "DKIM selector (for example: mail)",
						{
							exact: true,
						},
					),
				).toHaveCount(0);
				const enabled = page.getByRole("switch", {
					name: fr ? "Disponible comme expéditeur de secours" : "Enabled for failover pool",
				});
				await enabled.uncheck();
				const created = savedSender();
				await page
					.getByRole("button", {
						name: fr ? "Ajouter l’expéditeur" : "Add sender",
						exact: true,
					})
					.click();
				const saved = await created;
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
				const row = page.getByRole("button", { name: new RegExp(profileName) }).first();
				await expect(row).toContainText(fr ? "Désactivé" : "Off");
				await row.click();
				if (settings.provider !== "aws-ses" && profile.provider !== "aws-ses")
					await expect(
						page.getByLabel(fr ? "Serveur SMTP" : "SMTP host", { exact: true }),
					).toHaveValue("smtp.invalid");
				if (settings.provider !== "aws-ses" && profile.provider !== "aws-ses")
					await expect(
						page.getByLabel(fr ? "Mot de passe" : "Password", { exact: true }),
					).toHaveValue("");
				await expect(
					page.getByRole("button", {
						name: fr ? "Enregistrer l’expéditeur" : "Save profile",
						exact: true,
					}),
				).toHaveCount(0);
				const autosaved = savedSender();
				await page
					.getByLabel(fr ? "Nom de l’expéditeur" : "From name", { exact: true })
					.fill("Issue 82");
				assert.ok((await autosaved).ok());
				const reread = await read(endpoint + "/settings/smtp");
				const updated = (reread.profiles ?? [reread]).find((item) => item.id === profile.id);
				assert.equal(updated.configured, true);
				assert.equal(updated.from_name, "Issue 82");
			}
			for (const [tab, endpoint] of [
				["webhooks", marketing],
				["email-webhooks", email],
			]) {
				await open(tab, locale);
				await expect(
					page.getByRole("tab", { name: fr ? "Avancé" : "Advanced", exact: true }),
				).toHaveAttribute("aria-selected", "true");
				const webhooks = page.getByRole("region", { name: "Webhooks", exact: true });
				await expect(
					webhooks.getByRole("heading", {
						name: fr ? "Recevoir les événements du fournisseur" : "Receive provider events",
						exact: true,
					}),
				).toBeVisible();
				await expect(
					webhooks.getByRole("heading", {
						name: fr
							? "Envoyer les événements à vos points de terminaison"
							: "Send events to your endpoints",
						exact: true,
					}),
				).toBeVisible();
				await page
					.getByRole("button", {
						name: fr ? "Ajouter un webhook fournisseur" : "Add a provider webhook",
						exact: true,
					})
					.click();
				const provider = `issue82_${locale}_${Date.now()}`;
				if (endpoint === marketing) {
					await page.getByLabel(fr ? "Événements pour" : "Events for", { exact: true }).click();
					await page
						.getByRole("option", {
							name: fr ? "Campagnes et parcours" : "Campaigns and journeys",
							exact: true,
						})
						.click();
				}
				await page
					.getByLabel(fr ? "Identifiant du fournisseur" : "Provider identifier", {
						exact: true,
					})
					.fill(provider);
				const secret = page.getByLabel(
					fr ? "Secret partagé (16 caractères minimum)" : "Shared secret (minimum 16 characters)",
					{ exact: true },
				);
				await secret.fill("short");
				const create = page.getByRole("button", {
					name: fr ? "Créer le point de réception" : "Create endpoint",
					exact: true,
				});
				await expect(create).toBeDisabled();
				await secret.fill("issue82-local-webhook-secret");
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
				await expect(page.getByText(provider)).toBeVisible();
			}
			await page.goto(
				new URL(`/communication/marketing-email?tab=settings&lang=${locale}`, origin).href,
			);
			await page.waitForURL((url) => url.pathname === "/communication/settings");
			await hydrate();
			await expect(
				page.getByRole("tab", {
					name: fr ? "Expéditeurs et domaines" : "Senders & domains",
					exact: true,
				}),
			).toHaveAttribute("aria-selected", "true");
			await open("languages", locale);
			await page
				.getByRole("switch", {
					name: fr
						? "Limiter les e-mails marketing par contact"
						: "Limit marketing emails per contact",
				})
				.check();
			await page.getByLabel(fr ? "Unité" : "Unit", { exact: true }).click();
			await page.getByRole("option", { name: fr ? "heures" : "hours", exact: true }).click();
			const frequency = page.getByLabel(
				fr
					? "Délai minimum entre deux e-mails marketing"
					: "Minimum time between two marketing emails",
				{ exact: true },
			);
			await frequency.fill(fr ? "47" : "46");
			await expect(
				page.getByRole("button", { name: fr ? "Enregistrer" : "Save", exact: true }),
			).toHaveCount(0);
			await expect
				.poll(async () => (await read(studio)).marketing_frequency_hours, { timeout: 10000 })
				.toBe(fr ? 47 : 46);
			await page.reload();
			await hydrate();
			await expect(frequency).toHaveValue(fr ? "47" : "46");
			await open("configuration", locale);
			await expect(page.getByRole("tab", { name: "Configuration", exact: true })).toHaveCount(0);
			await expect(
				page.getByRole("tab", {
					name: fr ? "Expéditeurs et domaines" : "Senders & domains",
					exact: true,
				}),
			).toHaveAttribute("aria-selected", "true");
			await expect(
				page.getByRole("link", {
					name: fr ? "Ouvrir dans Plugins" : "Open in Plugins",
					exact: true,
				}),
			).toHaveAttribute("href", pluginsLinkHref);
			const checked = await context.request.post(health, {
				headers: { Origin: origin.origin, "X-EmDash-Request": "1" },
			});
			assert.equal(checked.status(), 200, await checked.text());
			const result = await checked.json();
			assert.ok(result.checkedAt);
			const inventory = result.diagnostic;
			assert.equal(inventory.pluginId, "superboard-communication");
			assert.ok(
				inventory.workers.some((worker) => worker.service === "email" && worker.physicalName),
			);
			await page.goto(new URL(`/communication/channels?lang=${locale}`, origin).href);
			await page.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])').waitFor();
			await page
				.getByRole("button", { name: fr ? "Ajouter un canal" : "Add a channel", exact: true })
				.click();
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
				`${locale}: Sender created with its button and autosaved; webhooks grouped and saved/reread/reloaded; secrets preserved; marketing frequency autosaved; keyboard, legacy links, Plugins diagnostics link and health check (${inventory.routes.api.length} API routes in diagnostic) passed`,
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
