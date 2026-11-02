import { test, expect } from "../../fixtures/emdash-browser";

function apiHeaders(token: string, baseUrl: string): Record<string, string> {
	return {
		"Content-Type": "application/json",
		Authorization: `Bearer ${token}`,
		"X-EmDash-Request": "1",
		Origin: baseUrl,
	};
}

test.describe("Byline custom fields", () => {
	test.beforeEach(async ({ admin }) => {
		await admin.devBypassAuth();
	});

	test("top-aligns schema switches when one has helper text", async ({ admin, page }) => {
		await admin.goto("/byline-schema");
		await admin.waitForLoading();
		await page.getByRole("button", { name: "New field" }).click();

		const requiredBox = await page.getByRole("switch", { name: "Required" }).boundingBox();
		const translatableBox = await page.getByRole("switch", { name: "Translatable" }).boundingBox();

		expect(requiredBox).not.toBeNull();
		expect(translatableBox).not.toBeNull();
		expect(Math.abs(requiredBox!.y - translatableBox!.y)).toBeLessThanOrEqual(1);
	});

	test("custom field value round-trips through the API end to end", async ({
		admin,
		page,
		serverInfo,
	}) => {
		const unique = Date.now();
		const fieldSlug = `job_title_${unique}`;
		const fieldLabel = `Job title ${unique}`;
		const bylineDisplayName = `Jane Custom ${unique}`;
		const bylineSlug = `jane-custom-${unique}`;
		const fieldValue = "Editor";

		await admin.goto("/byline-schema");
		await admin.waitForLoading();

		await page.getByRole("button", { name: "New field" }).click();
		await page.getByLabel("Label").fill(fieldLabel);
		await page.getByLabel("Slug").fill(fieldSlug);
		await page.getByRole("button", { name: "Create field" }).click();

		await expect(page.locator("table").getByText(fieldLabel)).toBeVisible({
			timeout: 5000,
		});

		await admin.goto("/bylines");
		await admin.waitForLoading();

		await page.getByRole("button", { name: "New" }).click();
		await page.getByLabel("Display name").fill(bylineDisplayName);
		await page.getByLabel("Slug").fill(bylineSlug);
		await page.getByRole("switch", { name: "Guest byline" }).click();
		await page.getByRole("button", { name: "Create" }).click();

		await expect(page.getByRole("button", { name: bylineDisplayName })).toBeVisible({
			timeout: 5000,
		});

		await expect(page.getByLabel(fieldLabel)).toBeVisible();
		await page.getByLabel(fieldLabel).fill(fieldValue);
		await page.getByRole("button", { name: "Save" }).click();

		const headers = apiHeaders(serverInfo.token, serverInfo.baseUrl);
		const listResponse = await fetch(
			`${serverInfo.baseUrl}/_emdash/api/admin/bylines?search=${encodeURIComponent(bylineSlug)}`,
			{ headers },
		);
		expect(listResponse.ok).toBe(true);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const listBody: any = await listResponse.json();
		const created = (listBody.data?.items ?? []).find(
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(b: any) => b.slug === bylineSlug,
		);
		expect(created).toBeTruthy();
		expect(created.displayName).toBe(bylineDisplayName);

		const getResponse = await fetch(
			`${serverInfo.baseUrl}/_emdash/api/admin/bylines/${created.id}`,
			{ headers },
		);
		expect(getResponse.ok).toBe(true);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const getBody: any = await getResponse.json();
		const fetched = getBody.data;

		expect(fetched.customFields).toBeTruthy();
		expect(fetched.customFields[fieldSlug]).toBe(fieldValue);
	});
});
