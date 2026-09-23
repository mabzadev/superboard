import assert from "node:assert/strict";

import { expect } from "@playwright/test";

import { AdminPage } from "../emdash-browser/admin.ts";

export async function discoverPublishedLinks(page, origin) {
	if (new URL(page.url()).pathname.startsWith("/_emdash/admin")) return [];
	const links = await page
		.locator("aside a[href], main nav a[href]")
		.evaluateAll((nodes) =>
			nodes.map((node) => ({ href: node.getAttribute("href"), label: node.textContent?.trim() })),
		);
	return links
		.map((link) => ({ ...link, url: new URL(link.href, origin) }))
		.filter(({ url }) => url.origin === origin)
		.map(({ url, label }) => {
			url.searchParams.delete("lang");
			return { href: `${url.pathname}${url.search}`, label };
		});
}

export async function checkPublishedPage(
	context,
	{ origin, href, locale, releaseId, verify, timeout = 60000, beforeCheck, dataTimeout = timeout },
) {
	const url = new URL(href, origin);
	url.searchParams.set("lang", locale);
	const result = {
		url: url.href,
		locale,
		expected_release: releaseId,
		observed_release: null,
		status: "failed",
		expected: verify?.description ?? "Missing view contract",
		limitations: verify?.limitations ?? [],
		errors: [],
		requests: [],
		links: [],
	};
	const page = await context.newPage();
	if (url.pathname.startsWith("/_emdash/admin")) {
		await context.addCookies([
			{
				name: "emdash-locale",
				value: locale,
				domain: url.hostname,
				path: "/_emdash",
				sameSite: "Lax",
			},
		]);
	}
	page.setDefaultTimeout(timeout);
	page.setDefaultNavigationTimeout(timeout);
	const pending = new Set();
	const bodies = [];
	const api = (request) =>
		["fetch", "xhr"].includes(request.resourceType()) &&
		new URL(request.url()).origin === origin &&
		/^\/(?:api\/|_emdash\/api\/|_superboard\/api\/)/u.test(new URL(request.url()).pathname);
	let signalRenderError;
	const renderError = new Promise((resolveError) => {
		signalRenderError = resolveError;
	});
	page.on("pageerror", (error) => {
		result.errors.push({ kind: "render", symptom: error.message });
		signalRenderError(error.message);
	});
	page.on("console", (message) => {
		if (
			message.type() === "error" &&
			/\[astro-island\] Error hydrating|\[hydrate\] Error parsing props|Failed to fetch dynamically imported module/u.test(
				message.text(),
			)
		) {
			result.errors.push({ kind: "render", symptom: message.text() });
			signalRenderError(message.text());
		}
	});
	page.on("request", (request) => {
		if (api(request)) pending.add(request);
	});
	page.on("requestfinished", (request) => pending.delete(request));
	page.on("requestfailed", (request) => {
		pending.delete(request);
		result.errors.push({
			kind: "network",
			url: request.url(),
			symptom: request.failure()?.errorText,
		});
	});
	page.on("response", (response) => {
		if (response.status() >= 400)
			result.errors.push({
				kind: "http",
				url: response.url(),
				symptom: `HTTP ${response.status()}`,
			});
		if (api(response.request())) {
			const record = { url: response.url(), status: response.status() };
			result.requests.push(record);
			bodies.push(
				response
					.json()
					.then((body) => {
						if (body?.success === false || body?.error)
							result.errors.push({
								kind: "api",
								url: response.url(),
								symptom: JSON.stringify(body.error ?? body),
							});
					})
					.catch(() => {
						result.errors.push({
							kind: "api",
							url: response.url(),
							symptom: "API response was not readable JSON",
						});
					})
					.finally(() => pending.delete(response.request())),
			);
		}
	});
	try {
		const response = await page.goto(url.href, { waitUntil: "domcontentloaded" });
		result.http_status = response?.status();
		assert.equal(result.http_status, 200, "Published link did not return HTTP 200");
		assert.equal(
			new URL(page.url()).pathname.replace(/\/$/u, ""),
			url.pathname.replace(/\/$/u, ""),
			"Published link redirected to another view",
		);
		const admin = url.pathname.startsWith("/_emdash/admin");
		if (!admin) {
			result.observed_release = await page
				.locator('meta[name="superboard-release-id"]')
				.getAttribute("content");
			assert.equal(
				result.observed_release,
				releaseId,
				"Browser is serving a different Release Front",
			);
		}
		const hydration = admin
			? new AdminPage(page).waitForHydration(timeout)
			: page.locator('astro-island[component-url*="NativeFrontApp"]:not([ssr])').waitFor();
		const renderFailure = await Promise.race([hydration.then(() => null), renderError]);
		if (renderFailure) throw new Error(renderFailure);
		await expect(page.locator("html")).toHaveAttribute("lang", locale);
		if (beforeCheck) await beforeCheck(page);
		assert.ok(verify, `No content assertion registered for ${url.pathname}`);
		await verify.check(page, locale);
		result.observed_content = (await page.locator("main").innerText()).slice(0, 4000);
		await expect.poll(() => pending.size, { timeout: dataTimeout }).toBe(0);
		await page.waitForLoadState("networkidle", { timeout: dataTimeout });
		await Promise.all(bodies);
		await expect(page.locator('main [aria-busy="true"], vite-error-overlay')).toHaveCount(0);
		const alerts = await page.locator('main [role="alert"]').allTextContents();
		for (const symptom of alerts.filter(
			(text) => text.trim() && !verify.informationalAlerts?.includes(text),
		))
			result.errors.push({ kind: "alert", symptom });
		if (verify.api)
			assert.ok(
				result.requests.some(
					({ url: requested, status }) =>
						verify.api.test(decodeURIComponent(requested)) && status >= 200 && status < 300,
				),
				"Necessary view API did not complete successfully",
			);
		result.status = result.errors.length ? "failed" : "passed";
	} catch (error) {
		result.errors.push({ kind: "assertion", symptom: error.message });
		result.render_diagnostic = (
			await page
				.locator("body")
				.innerText()
				.catch(() => "")
		).slice(0, 8000);
	} finally {
		result.links = await discoverPublishedLinks(page, origin).catch(() => []);
		for (const request of pending)
			result.errors.push({
				kind: "loading",
				url: request.url(),
				symptom: "Request still pending at the page deadline",
			});
		await page.close();
	}
	if (result.errors.length) result.status = "failed";
	return result;
}
