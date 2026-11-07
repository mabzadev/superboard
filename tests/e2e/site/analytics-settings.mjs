import assert from "node:assert/strict";

import { chromium, expect } from "@playwright/test";

const origin = new URL(process.env.SUPERBOARD_LOCAL_URL ?? "http://127.0.0.1:4321");
const pluginsLinkName = /^(Open in Plugins|Ouvrir dans Plugins)$/;
const pluginsLinkHref = /^\/_emdash\/admin\/plugins-manager\/superboard-analytics\/configuration$/;
assert(["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname));
const diagnostic = new URL(
	"/_emdash/api/superboard/plugins/superboard-analytics/diagnostic",
	origin,
).href;
const health = diagnostic.replace(/diagnostic$/, "health");
const analyticsApplicationPattern = /\/api\/v1\/analytics\/projects\/([^/]+)\/applications/;
const settingsCommand = "command.update_analytics_settings";
const copy = {
	en: {
		reports: "Reports",
		advanced: "Advanced",
		timezone: "Reporting timezone",
		saved: "All changes saved.",
		saveButton: "Save settings",
		globalSwitch: "Process collected events",
		retention: "Detailed event retention (days)",
		retentionError: "Enter a number of days between 1 and 366.",
		identifiers: "Application identifiers",
		noApplications: "No applications observed.",
		name: "Name",
		endpoint: "Endpoint",
		someEvents: "Only some events",
		eventNames: "Event names",
		alerts: "Send triggered alerts",
		alertsLabel: "Triggered alerts",
		hookEvents: "Events: ",
		sign: "Sign deliveries",
		secret: "Signing secret",
		addHook: "Add webhook",
		annotationTitle: "Annotation title",
		addAnnotation: "Add now",
		plugins: "Open in Plugins",
	},
	fr: {
		reports: "Rapports",
		advanced: "Avancé",
		timezone: "Fuseau horaire des rapports",
		saved: "Modifications enregistrées.",
		saveButton: "Enregistrer les paramètres",
		globalSwitch: "Traiter les événements collectés",
		retention: "Conservation des événements détaillés (jours)",
		retentionError: "Saisissez un nombre de jours entre 1 et 366.",
		identifiers: "Identifiants des applications",
		noApplications: "Aucune application observée.",
		name: "Nom",
		endpoint: "Adresse",
		someEvents: "Seulement certains événements",
		eventNames: "Noms des événements",
		alerts: "Envoyer les alertes déclenchées",
		alertsLabel: "Alertes déclenchées",
		hookEvents: "Événements : ",
		sign: "Signer les envois",
		secret: "Secret de signature",
		addHook: "Ajouter un webhook",
		annotationTitle: "Titre de l’annotation",
		addAnnotation: "Ajouter maintenant",
		plugins: "Ouvrir dans Plugins",
	},
};
const browser = await chromium.launch();
try {
	const context = await browser.newContext();
	const page = await context.newPage();
	page.setDefaultTimeout(30000);
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const hydrate = async () => {
		await page.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])').waitFor();
		await expect(page.getByRole("link", { name: pluginsLinkName })).toBeVisible();
	};
	const mutationHeaders = () => ({
		Origin: origin.origin,
		"X-EmDash-Request": "1",
		"Idempotency-Key": crypto.randomUUID(),
	});
	await page.goto(
		new URL("/_emdash/api/auth/dev-bypass?redirect=/analytics/settings?tab=collection", origin)
			.href,
	);
	await hydrate();
	await page.getByLabel(/^(Reporting timezone|Fuseau horaire des rapports)$/).waitFor();
	const project = await page.evaluate((pattern) => {
		const applicationRequest = new RegExp(pattern);
		const requests = performance.getEntriesByType("resource").map((entry) => entry.name);
		return requests.map((url) => url.match(applicationRequest)).find(Boolean)?.[1];
	}, analyticsApplicationPattern.source);
	assert.ok(project, "Observed project scope from Analytics application request");
	const base = new URL(`/api/v1/analytics/projects/${project}`, origin).href;
	const endpoint = `${base}/settings`;
	const read = async (path) => {
		const response = await context.request.get(base + path);
		assert.equal(response.status(), 200, await response.text());
		return (await response.json()).data;
	};
	const original = await read("/settings");
	try {
		for (const locale of ["en", "fr"]) {
			const text = copy[locale];
			await page.goto(new URL(`/analytics/settings?lang=${locale}&tab=collection`, origin).href);
			await hydrate();
			const reports = page.getByRole("tab", { name: text.reports, exact: true });
			await expect(reports).toHaveAttribute("aria-selected", "true");
			const sidebarLink = page.locator('aside a[href*="/analytics/settings"]');
			await expect(sidebarLink).toHaveText("Analytics");
			await reports.focus();
			await reports.press("ArrowRight");
			await expect(page.getByRole("tab", { name: "Webhooks", exact: true })).toHaveAttribute(
				"aria-selected",
				"true",
			);
			await reports.click();
			await expect(page.getByRole("button", { name: text.saveButton, exact: true })).toHaveCount(0);
			await expect(page.getByRole("switch", { name: text.globalSwitch, exact: true })).toHaveCount(
				0,
			);
			const zone = locale === "fr" ? "Europe/Paris" : "Europe/Zurich";
			const field = page.getByLabel(text.timezone, { exact: true });
			const saved = page.waitForResponse(
				(response) =>
					response.request().method() === "POST" && response.url().includes(settingsCommand),
			);
			await field.fill(zone);
			assert.equal((await saved).status(), 200);
			await expect(page.getByText(text.saved, { exact: true })).toBeVisible();
			assert.equal((await read("/settings")).timezone, zone);
			await page.reload();
			await hydrate();
			await expect(field).toHaveValue(zone);
			assert.equal((await read("/settings")).hot_retention_days, original.hot_retention_days);

			await page.getByRole("tab", { name: text.advanced, exact: true }).click();
			await expect(
				page.getByRole("heading", { name: text.identifiers, exact: true }),
			).toBeVisible();
			const retention = page.getByLabel(text.retention, { exact: true });
			await expect(retention).toHaveValue(String(original.hot_retention_days));
			let settingsWrites = 0;
			const countSettingsWrites = (request) => {
				if (request.method() === "POST" && request.url().includes(settingsCommand))
					settingsWrites += 1;
			};
			page.on("request", countSettingsWrites);
			await retention.fill("0");
			await expect(page.getByText(text.retentionError, { exact: true })).toBeVisible();
			await page.waitForTimeout(1500);
			await retention.fill(String(original.hot_retention_days));
			await expect(page.getByText(text.retentionError, { exact: true })).toHaveCount(0);
			await page.waitForTimeout(1500);
			page.off("request", countSettingsWrites);
			assert.equal(settingsWrites, 0, "An out-of-range retention is never saved");

			await page.getByRole("tab", { name: "Applications", exact: true }).click();
			const applications = (await read("/applications")).items;
			const application = applications.find(
				(item) => applications.filter((other) => other.name === item.name).length === 1,
			);
			let applicationEvidence = "no observed application";
			if (!applications.length) {
				await expect(page.getByText(text.noApplications)).toBeVisible();
			} else if (application) {
				const applicationPath = `/applications/${encodeURIComponent(application.application_id)}`;
				const toggle = page.getByRole("switch", { name: application.name, exact: true });
				const activeOnServer = async () =>
					(await read("/applications")).items.find(
						(item) => item.application_id === application.application_id,
					)?.active;
				const updated = () =>
					page.waitForResponse(
						(response) =>
							response.request().method() === "PUT" &&
							new URL(response.url()).pathname.endsWith(applicationPath),
					);
				try {
					await expect(toggle).toBeChecked({ checked: application.active });
					const switched = updated();
					await toggle.click();
					assert.equal((await switched).status(), 200);
					await expect(page.getByText(text.saved, { exact: true })).toBeVisible();
					assert.equal(await activeOnServer(), !application.active);
					const restored = updated();
					await toggle.click();
					assert.equal((await restored).status(), 200);
					assert.equal(await activeOnServer(), application.active);
					applicationEvidence = "application switch saved and restored";
				} finally {
					if ((await activeOnServer()) !== application.active) {
						const reset = await context.request.put(base + applicationPath, {
							headers: mutationHeaders(),
							data: { active: application.active },
						});
						assert.equal(reset.status(), 200, await reset.text());
					}
				}
			}

			await page.getByRole("tab", { name: "Webhooks", exact: true }).click();
			const hookName = `issue85-${locale}-${crypto.randomUUID()}`;
			await page.getByRole("textbox", { name: text.name, exact: true }).fill(hookName);
			await page
				.getByRole("textbox", { name: text.endpoint, exact: true })
				.fill("https://example.com/issue85");
			await expect(page.getByLabel(text.eventNames, { exact: true })).toHaveCount(0);
			await page.getByRole("switch", { name: text.someEvents, exact: true }).click();
			await page.getByRole("textbox", { name: text.eventNames, exact: true }).fill("issue85.test");
			await page.getByRole("switch", { name: text.alerts, exact: true }).click();
			await expect(page.getByLabel(text.secret, { exact: true })).toHaveCount(0);
			await page.getByRole("switch", { name: text.sign, exact: true }).click();
			const addHook = page.getByRole("button", { name: text.addHook, exact: true });
			await expect(addHook).toBeDisabled();
			await page.getByLabel(text.secret, { exact: true }).fill(crypto.randomUUID());
			await addHook.click();
			await expect(page.getByText(hookName, { exact: true })).toBeVisible();
			await expect(
				page.getByText(`${text.hookEvents}issue85.test, ${text.alertsLabel}`, { exact: true }),
			).toBeVisible();
			const storedHook = (await read("/hooks")).items.find((item) => item.name === hookName);
			assert.ok(storedHook);
			assert.equal(storedHook.endpoint_url, "https://example.com/issue85");
			assert.deepEqual(storedHook.event_types, ["issue85.test", "alert.triggered"]);
			assert.equal(storedHook.secret, undefined);
			assert.equal(storedHook.secret_configured, true);
			try {
				await page.reload();
				await hydrate();
				await expect(page.getByText(hookName, { exact: true })).toBeVisible();
			} finally {
				const removed = await context.request.delete(`${base}/hooks/${storedHook.id}`, {
					headers: mutationHeaders(),
				});
				assert.equal(removed.status(), 200, await removed.text());
			}

			await page.getByRole("tab", { name: "Annotations", exact: true }).click();
			const annotationTitle = `issue85-${locale}-${crypto.randomUUID()}`;
			await page
				.getByRole("textbox", { name: text.annotationTitle, exact: true })
				.fill(annotationTitle);
			await page.getByRole("button", { name: text.addAnnotation, exact: true }).click();
			await expect(page.getByText(annotationTitle, { exact: true })).toBeVisible();
			const storedAnnotation = (await read("/annotations")).items.find(
				(item) => item.title === annotationTitle,
			);
			assert.ok(storedAnnotation);
			try {
				await page.reload();
				await hydrate();
				await expect(page.getByText(annotationTitle, { exact: true })).toBeVisible();
			} finally {
				const removed = await context.request.delete(`${base}/annotations/${storedAnnotation.id}`, {
					headers: mutationHeaders(),
				});
				assert.equal(removed.status(), 200, await removed.text());
			}

			await expect(page.getByRole("tab", { name: "Configuration", exact: true })).toHaveCount(0);
			await expect(page.getByRole("link", { name: text.plugins, exact: true })).toHaveAttribute(
				"href",
				pluginsLinkHref,
			);
			const checked = await context.request.post(health, {
				headers: { Origin: origin.origin, "X-EmDash-Request": "1" },
			});
			assert.equal(checked.status(), 200, await checked.text());
			const result = await checked.json();
			assert.ok(result.checkedAt);
			const inventory = result.diagnostic;
			assert.equal(inventory.pluginId, "superboard-analytics");
			assert.ok(
				inventory.workers.some((worker) => worker.service === "analytics" && worker.physicalName),
			);
			await page.goto(new URL(`/analytics/settings?lang=${locale}&tab=configuration`, origin).href);
			await hydrate();
			await expect(page.getByRole("tab", { name: "Applications", exact: true })).toHaveAttribute(
				"aria-selected",
				"true",
			);
			for (const [tab, name] of [
				["applications", "Applications"],
				["collection", text.reports],
				["hooks", "Webhooks"],
				["annotations", "Annotations"],
				["advanced", text.advanced],
			]) {
				await page.goto(new URL(`/analytics/settings?lang=${locale}&tab=${tab}`, origin).href);
				await hydrate();
				await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute(
					"aria-selected",
					"true",
				);
				assert.equal(new URL(page.url()).searchParams.get("tab"), tab);
				assert.equal(new URL(page.url()).searchParams.get("lang"), locale);
			}

			console.log(
				`${locale}: sidebar, tab URL/reload, keyboard, report time zone autosave/API reread, retention bounds without write, ${applicationEvidence}, webhook event switches and signing, annotation reload, Plugins diagnostics link, health check (${inventory.routes.api.length} API routes in diagnostic) and legacy configuration link passed`,
			);
		}
	} finally {
		const response = await context.request.put(endpoint, {
			headers: mutationHeaders(),
			data: original,
		});
		assert.equal(response.status(), 200, await response.text());
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
			headers: mutationHeaders(),
			data: method === "PUT" ? {} : undefined,
		});
		assert.equal(response.status(), 401);
	}
	const deniedPage = await anonymous.request.get(new URL("/analytics/settings", origin).href, {
		maxRedirects: 0,
	});
	assert.equal(deniedPage.status(), 302);
	assert.ok(deniedPage.headers().location.includes("login"));
	assert.deepEqual(errors, []);
	console.log(
		"Anonymous settings and diagnostic access refused; original settings restored; retention unchanged.",
	);
} finally {
	await browser.close();
}
