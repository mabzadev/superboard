import { test, expect } from "../../../fixtures/site-browser/base-fixtures.js";
import {
	evidence,
	projectRef,
	ready,
	savedByClick,
	siteApi,
	unique,
} from "../../../fixtures/site-browser/site-api.js";

const productsPlugin = "supbrd-plug-products";
const billingPlugin = "supbrd-plugmod-billing";

test("Products offerings retains a linked catalog and archives only the selected offering", async ({
	authenticatedPage: page,
}) => {
	const ref = await projectRef(page);
	const base = `/api/v1/products/projects/${ref}`;
	const name = unique("browser-catalog").replaceAll("-", "_");
	await ready(page, "/products/offerings");
	const product = page
		.locator('[data-slot="card"]')
		.filter({ has: page.getByText("A purchasable catalog item", { exact: true }) });
	await product.getByPlaceholder("Identifier", { exact: true }).fill(`${name}_product`);
	await product.getByPlaceholder("Display name", { exact: true }).fill(`${name} Product`);
	await page.getByLabel("Product status", { exact: true }).selectOption("active");
	const productId = await savedByClick(page, "Create product", productsPlugin);
	const pkg = page
		.locator('[data-slot="card"]')
		.filter({ has: page.getByText("Connect a product to an offering", { exact: true }) });
	await pkg.getByPlaceholder("Identifier", { exact: true }).fill(`${name}_package`);
	await pkg.getByPlaceholder("Display name", { exact: true }).fill(`${name} Package`);
	await page.getByLabel("Package product", { exact: true }).selectOption(productId);
	const packageId = await savedByClick(page, "Create package", productsPlugin);
	const offering = page
		.locator('[data-slot="card"]')
		.filter({ has: page.getByText("Resolve packages for an SDK placement", { exact: true }) });
	await offering.getByPlaceholder("Identifier", { exact: true }).fill(`${name}_offering`);
	await offering.getByPlaceholder("Display name", { exact: true }).fill(`${name} Offering`);
	await offering.getByPlaceholder("Placement", { exact: true }).fill(`${name}_placement`);
	await offering.getByRole("checkbox", { name: `${name} Package`, exact: true }).check();
	const offeringId = await savedByClick(page, "Create offering", productsPlugin);
	const offerings = await siteApi(page.request, productsPlugin, "GET", `${base}/offerings`);
	expect(offerings.find((row: { id: string }) => row.id === offeringId)).toMatchObject({
		packages: [expect.objectContaining({ id: packageId, product_id: productId })],
	});
	await page.reload();
	await page.getByPlaceholder("Search catalog").fill(`${name}_offering`);
	const row = page.getByRole("row").filter({ hasText: `${name}_offering` });
	await expect(row).toContainText(`${name} Offering`);
	await row.getByRole("button", { name: "Edit", exact: true }).click();
	await offering.getByPlaceholder("Display name", { exact: true }).fill(`${name} Updated`);
	await savedByClick(page, "Save offering", productsPlugin);
	await expect(page.getByRole("row").filter({ hasText: `${name}_offering` })).toContainText(
		`${name} Updated`,
	);
	const archived = page.waitForResponse(
		(response) =>
			response.request().method() === "POST" && response.url().includes("command.archive_offering"),
	);
	await page
		.getByRole("row")
		.filter({ hasText: `${name}_offering` })
		.getByRole("button", { name: "Archive", exact: true })
		.click();
	expect((await archived).ok()).toBe(true);
	await page.getByLabel("Catalog status", { exact: true }).selectOption("active");
	await expect(page.getByRole("row").filter({ hasText: `${name}_offering` })).toHaveCount(0);
	await page.getByLabel("Catalog status", { exact: true }).selectOption("archived");
	await expect(page.getByRole("row").filter({ hasText: `${name}_offering` })).toContainText(
		"archived",
	);
	const persisted = await siteApi(page.request, productsPlugin, "GET", `${base}/offerings`);
	expect(persisted.find((item: { id: string }) => item.id === offeringId)).toMatchObject({
		display_name: `${name} Updated`,
		active: false,
	});
	const catalog = await siteApi(page.request, productsPlugin, "GET", `${base}/catalog/products`);
	expect(catalog.find((item: { id: string }) => item.id === productId).status).toBe("active");
	await evidence(
		productsPlugin,
		"superboard.products_offerings",
		[productId, packageId, offeringId],
		"Created linked product/package/offering using real forms; edited and archived the offering, verified filters and persisted relationships while the product remains active.",
	);
});

test("Billing customers searches a real SDK-created identity and persists block/unblock", async ({
	authenticatedPage: page,
}) => {
	const ref = await projectRef(page);
	const identifier = `${unique("billing-sdk")}.example.test`;
	const setupPath = `/api/v1/app/projects/${ref}/setup/web`;
	const previousWeb = await siteApi(page.request, "supbrd-plug-settings", "GET", setupPath);
	try {
		await siteApi(page.request, "supbrd-plug-settings", "PUT", setupPath, {
			domain: identifier,
			minimum_version: "1.0.0",
			recommended_version: "1.0.0",
			maintenance_enabled: false,
		});
		const key = await siteApi(
			page.request,
			"supbrd-plug-user",
			"POST",
			`/api/v1/app/projects/${ref}/access-key/rotate`,
			{},
		);
		if (typeof key.secret !== "string" || !key.secret || typeof key.id !== "string")
			throw new Error("The native App access-key rotation did not issue an SDK credential.");
		const sdkHeaders = {
			"PROJECT-KEY": key.secret,
			PLATFORM: "web",
			IDENTIFIER: identifier,
			ENVIRONMENT: "production",
		};
		const anonymousId = `$superboard_anon_${crypto.randomUUID()}`;
		const overview = await siteApi(page.request, billingPlugin, "GET", `/api/v1/billing/${ref}`);
		const wasEnabled = Boolean(overview.settings?.purchases_enabled);
		if (!wasEnabled)
			await siteApi(page.request, billingPlugin, "PUT", `/api/v1/billing/${ref}/settings`, {
				purchases_enabled: true,
				restore_behavior: overview.settings?.restore_behavior ?? "transfer",
			});
		let customerId: string | undefined;
		try {
			const created = await page.request.get("/api/v1/sdk/purchases/v2/customer-info", {
				headers: { ...sdkHeaders, "X-SuperBoard-Anonymous-ID": anonymousId },
			});
			if (!created.ok()) {
				const failure = await created.json();
				throw new Error(
					`Real SDK customer-info HTTP ${created.status()}: ${failure.error?.code ?? failure.error?.message ?? failure.error ?? "request_failed"}`,
				);
			}
			const info = await created.json();
			customerId = info.customer_id;
			expect(typeof customerId).toBe("string");
			const api = `/api/v2/purchases/projects/${ref}/customers/${customerId}`;
			const initial = await siteApi(page.request, billingPlugin, "GET", api);
			expect(initial.customer.primary_app_user_id).toBe(anonymousId);
			await ready(page, "/products/customers");
			await page.getByPlaceholder("App user ID or alias").fill(anonymousId);
			await page.getByRole("button", { name: `Open ${anonymousId}`, exact: true }).click();
			const blocked = page.waitForResponse(
				(response) => response.request().method() === "POST" && response.url().includes("/block"),
			);
			await page.getByRole("button", { name: "Block", exact: true }).click();
			expect((await blocked).ok()).toBe(true);
			expect((await siteApi(page.request, billingPlugin, "GET", api)).customer.blocked).toBe(1);
			await page.reload();
			await page.getByPlaceholder("App user ID or alias").fill(anonymousId);
			await page.getByRole("button", { name: `Open ${anonymousId}`, exact: true }).click();
			await expect(page.getByRole("button", { name: "Unblock", exact: true })).toBeVisible();
			const unblocked = page.waitForResponse(
				(response) => response.request().method() === "POST" && response.url().includes("/block"),
			);
			await page.getByRole("button", { name: "Unblock", exact: true }).click();
			expect((await unblocked).ok()).toBe(true);
			expect((await siteApi(page.request, billingPlugin, "GET", api)).customer.blocked).toBe(0);
			await page.getByPlaceholder("App user ID or alias").fill("absent-customer-87df3265");
			await expect(
				page.getByText("No customer matches this search.", { exact: true }),
			).toBeVisible();
			await evidence(
				billingPlugin,
				"superboard.products_customers",
				[customerId!],
				"Created a real SDK anonymous customer, found it in the browser, blocked it, confirmed persistence after reload, then unblocked and verified no-result search.",
			);
		} finally {
			if (customerId)
				await siteApi(
					page.request,
					billingPlugin,
					"POST",
					`/api/v2/purchases/projects/${ref}/customers/${customerId}/block`,
					{ blocked: false },
				);
			if (!wasEnabled)
				await siteApi(page.request, billingPlugin, "PUT", `/api/v1/billing/${ref}/settings`, {
					purchases_enabled: false,
					restore_behavior: overview.settings?.restore_behavior ?? "transfer",
				});
		}
	} finally {
		if (previousWeb?.configuration && previousWeb.status !== "not_configured")
			await siteApi(
				page.request,
				"supbrd-plug-settings",
				"PUT",
				setupPath,
				previousWeb.configuration,
			);
		else await siteApi(page.request, "supbrd-plug-settings", "DELETE", setupPath);
		const restoredWeb = await siteApi(page.request, "supbrd-plug-settings", "GET", setupPath);
		expect(restoredWeb?.configuration ?? null).toEqual(previousWeb?.configuration ?? null);
	}
});
