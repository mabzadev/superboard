import { test, expect } from "../../../fixtures/site-browser/base-fixtures.js";
import {
	evidence,
	operatorHeaders,
	projectRef,
	ready,
	savedByClick,
	siteApi,
	unique,
	unwrap,
} from "../../../fixtures/site-browser/site-api.js";

const plugin = "supbrd-plugmod-analytics";

test("funnel query counts a real ordered pair of events for the same installation", async ({
	authenticatedPage: page,
}) => {
	const project = await projectRef(page);
	const application = unique("funnel-app");
	const installation = unique("funnel-install");
	const steps = [unique("qa.started"), unique("qa.finished")];
	const ids: string[] = [];
	for (const [index, name] of steps.entries()) {
		const id = crypto.randomUUID();
		ids.push(id);
		await siteApi(page.request, plugin, "POST", `/api/v1/analytics/projects/${project}/events`, {
			schema_version: 1,
			event_id: id,
			event_name: name,
			occurred_at: new Date(Date.now() - 2000 + index * 1000).toISOString(),
			source: "sdk",
			application_id: application,
			app_instance_id: installation,
			session_id: installation,
			properties: {},
		});
	}
	await expect
		.poll(
			async () =>
				(
					await siteApi(
						page.request,
						plugin,
						"GET",
						`/api/v1/analytics/projects/${project}/events?application_id=${application}`,
					)
				).items.length,
			{ timeout: 20000 },
		)
		.toBe(2);
	await ready(page, "/analytics/insights");
	await page.locator("main input").fill(steps.join(", "));
	const result = page.waitForResponse(
		(response) =>
			response.request().method() === "POST" &&
			(response.url().includes("funnels/query") ||
				(response.request().postData() ?? "").includes("funnels/query")),
	);
	await page.getByRole("button", { name: "Run funnel", exact: true }).click();
	const queried = unwrap(await (await result).json());
	expect(queried.steps.map((step: { subjects: number }) => step.subjects)).toEqual([1, 1]);
	await expect(page.getByText(`2. ${steps[1]}`, { exact: true })).toBeVisible();
	await expect(page.getByText("100% from the first step", { exact: true })).toHaveCount(2);
	await evidence(
		plugin,
		"superboard.analytics_insights",
		ids,
		"Ingested two ordered events for one installation and ran the browser funnel; both steps contain the same one subject with full conversion.",
	);
});

test("analytics timeline annotations persist through the settings form", async ({
	authenticatedPage: page,
}) => {
	const project = await projectRef(page);
	const title = unique("Native annotation");
	await ready(page, "/analytics/settings");
	await page.getByRole("tab", { name: "Annotations", exact: true }).click();
	await page.getByPlaceholder("Version 3.2 released").fill(title);
	const id = await savedByClick(page, "Add now", plugin);
	await page.reload();
	await page.getByRole("tab", { name: "Annotations", exact: true }).click();
	await expect(page.getByText(title, { exact: true })).toBeVisible();
	const saved = await siteApi(
		page.request,
		plugin,
		"GET",
		`/api/v1/analytics/projects/${project}/annotations`,
	);
	expect(saved.items.find((item: { id: string }) => item.id === id)).toMatchObject({ title });
	await evidence(
		plugin,
		"superboard.analytics_settings",
		[id],
		"Added a timeline annotation through Analytics settings, reloaded the tab and confirmed the persisted title.",
	);
});

test("SDK attribution creates exactly one installation visible in Analytics", async ({
	authenticatedPage: page,
}) => {
	test.setTimeout(90000);
	const domain = `${unique("native-installation")}.example.test`;
	const project = await projectRef(page);
	const setup = `/api/v1/app/projects/${project}/setup/web`;
	const before = await siteApi(page.request, "supbrd-plug-settings", "GET", setup);
	try {
		await siteApi(page.request, "supbrd-plug-settings", "PUT", setup, {
			domain,
			minimum_version: "1.0.0",
			recommended_version: "1.0.0",
			maintenance_enabled: false,
		});
		const key = await siteApi(
			page.request,
			"supbrd-plug-user",
			"POST",
			`/api/v1/app/projects/${project}/access-key/rotate`,
			{},
		);
		const credential = {
			headers: {
				"PROJECT-KEY": key.secret,
				PLATFORM: "web",
				IDENTIFIER: domain,
				ENVIRONMENT: "production",
			},
		};
		const scopeResponse = await page.request.post("/_emdash/api/superboard/operator-context", {
			headers: operatorHeaders(),
			data: {},
		});
		const scope = unwrap(await scopeResponse.json());
		const projectId = Number(scope.instance.production.internal_id);
		expect(Number.isInteger(projectId)).toBe(true);
		const beforeIds = new Set(
			(
				await siteApi(
					page.request,
					plugin,
					"GET",
					`/api/v1/analytics/projects/${project}/installations`,
				)
			).items.map((item: { id: string }) => item.id),
		);
		const sdk = async (action: string, data: unknown) => {
			const response = await page.request.post(`/api/v1/sdk/${action}`, {
				headers: {
					...credential.headers,
					...operatorHeaders("supbrd-plug-user"),
					"User-Agent": `NativeSdkQA/${vendor}`,
				},
				data,
			});
			expect(response.status(), `SDK ${action}`).toBe(200);
			return unwrap(await response.json());
		};
		const vendor = unique("sdk-install");
		await sdk("authenticate", { app_version: "1.0.0", user_agent: vendor, vendor_id: vendor });
		const registered = await sdk("register", { platform: "web", app_version: "1.0.0", vendor });
		expect(registered.device_id).toBeTruthy();
		const payload = {
			device_id: registered.device_id,
			project_id: projectId,
			install_id: registered.install_id,
		};
		const first = await sdk("attribution", payload);
		expect(first.installation_created).toBe(true);
		expect((await sdk("attribution", payload)).installation_created).toBe(false);
		let persisted: { id: string; application_id: string } | undefined;
		await expect
			.poll(
				async () => {
					const list = await siteApi(
						page.request,
						plugin,
						"GET",
						`/api/v1/analytics/projects/${project}/installations`,
					);
					const matches = list.items.filter((item: { id: string }) => !beforeIds.has(item.id));
					persisted = matches[0];
					return matches.length;
				},
				{ timeout: 30000 },
			)
			.toBe(1);
		await ready(page, "/analytics/installations");
		await expect(
			page.getByRole("cell", { name: persisted!.application_id, exact: true }).first(),
		).toBeVisible();
		await page.reload();
		await expect(
			page.getByRole("cell", { name: persisted!.application_id, exact: true }).first(),
		).toBeVisible();
		await evidence(
			plugin,
			"superboard.analytics_installations",
			[persisted!.id, String(registered.device_id)],
			"Authenticated and registered a real SDK device, performed attribution twice, observed one canonical installation and reloaded its Analytics row.",
		);
	} finally {
		if (before?.configuration && before.status !== "not_configured")
			await siteApi(page.request, "supbrd-plug-settings", "PUT", setup, before.configuration);
		else await siteApi(page.request, "supbrd-plug-settings", "DELETE", setup);
	}
});

test("an unverified SDK claim cannot appear in the verified purchase register", async ({
	authenticatedPage: page,
}) => {
	const project = await projectRef(page);
	const base = `/api/v1/analytics/projects/${project}`;
	const before = await siteApi(page.request, plugin, "GET", `${base}/purchases`);
	const id = crypto.randomUUID();
	const response = await page.request.post(`${base}/events`, {
		headers: operatorHeaders(plugin),
		data: {
			schema_version: 1,
			event_id: id,
			event_name: "superboard.analytics.purchase.verified.v1",
			occurred_at: new Date().toISOString(),
			source: "sdk",
			application_id: unique("unverified-app"),
			properties: { transaction_id: unique("unverified-transaction"), price_cents: 999999 },
		},
	});
	expect(response.status()).toBe(400);
	const refusal = await response.json();
	expect(refusal.error.code).toBe("analytics_event_reserved");
	const after = await siteApi(page.request, plugin, "GET", `${base}/purchases`);
	expect(after.items.map((item: { id: string }) => item.id)).toEqual(
		before.items.map((item: { id: string }) => item.id),
	);
	await ready(page, "/analytics/purchases");
	if (after.items.length === 0)
		await expect(
			page.getByText("No verified purchase facts in this period.", { exact: true }),
		).toBeVisible();
	else
		await expect(
			page.getByText(after.items[0].store_transaction_id, { exact: true }),
		).toBeVisible();
	await evidence(
		plugin,
		"superboard.analytics_purchases",
		after.items.map((item: { id: string }) => item.id),
		"Rejected an SDK event claiming to be a verified purchase, confirmed the financial register remained unchanged and verified its resulting UI state; no externally verified purchase was invented.",
	);
});
