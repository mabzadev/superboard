import { test, expect } from "../../fixtures/emdash-browser";

const REVISIONS_API_PATTERN = /\/api\/content\/[^/]+\/[^/]+\/revisions/;

function apiHeaders(token: string, baseUrl: string) {
	return {
		"Content-Type": "application/json",
		Authorization: `Bearer ${token}`,
		"X-EmDash-Request": "1",
		Origin: baseUrl,
	};
}

test.describe("Revisions", () => {
	let collectionSlug: string;
	let postId: string;
	let headers: Record<string, string>;
	let baseUrl: string;

	test.beforeEach(async ({ admin, serverInfo }) => {
		await admin.devBypassAuth();

		baseUrl = serverInfo.baseUrl;
		headers = apiHeaders(serverInfo.token, baseUrl);

		collectionSlug = `rev_test_${Date.now()}`;
		await fetch(`${baseUrl}/_emdash/api/schema/collections`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				slug: collectionSlug,
				label: "Revision Test",
				labelSingular: "Revision Test",
				supports: ["revisions", "drafts"],
			}),
		});

		await fetch(`${baseUrl}/_emdash/api/schema/collections/${collectionSlug}/fields`, {
			method: "POST",
			headers,
			body: JSON.stringify({ slug: "title", type: "string", label: "Title", required: true }),
		});

		await fetch(`${baseUrl}/_emdash/api/schema/collections/${collectionSlug}/fields`, {
			method: "POST",
			headers,
			body: JSON.stringify({ slug: "excerpt", type: "text", label: "Excerpt" }),
		});

		const createRes = await fetch(`${baseUrl}/_emdash/api/content/${collectionSlug}`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				data: { title: "Original Title", excerpt: "Original excerpt" },
				slug: "revision-test-post",
			}),
		});
		const createData: any = await createRes.json();
		postId = createData.data?.item?.id ?? createData.data?.id;

		await fetch(`${baseUrl}/_emdash/api/content/${collectionSlug}/${postId}/publish`, {
			method: "POST",
			headers,
			body: JSON.stringify({}),
		});
	});

	test.afterEach(async () => {
		await fetch(`${baseUrl}/_emdash/api/content/${collectionSlug}/${postId}`, {
			method: "DELETE",
			headers,
		}).catch(() => {});
		await fetch(`${baseUrl}/_emdash/api/schema/collections/${collectionSlug}`, {
			method: "DELETE",
			headers,
		}).catch(() => {});
	});

	test("revision history panel is visible for collections with revision support", async ({
		admin,
		page,
	}) => {
		await admin.goToEditContent(collectionSlug, postId);
		await admin.waitForLoading();

		await expect(page.locator("#field-title")).toHaveValue("Original Title");

		const revisionsButton = page.locator("button", { hasText: "Revisions" });
		await expect(revisionsButton).toBeVisible({ timeout: 10000 });
	});

	test("expanding revision history shows existing revisions", async ({ admin, page }) => {
		await admin.goToEditContent(collectionSlug, postId);
		await admin.waitForLoading();

		const revisionsButton = page.locator("button", { hasText: "Revisions" });
		await revisionsButton.click();

		await page
			.waitForResponse((res) => REVISIONS_API_PATTERN.test(res.url()) && res.status() === 200, {
				timeout: 10000,
			})
			.catch(() => {});

		const currentBadge = page.locator("span.rounded-full", { hasText: "Current" });
		await expect(currentBadge.first()).toBeVisible({ timeout: 10000 });
	});

	test("editing and saving creates a new revision", async ({ admin, page }) => {
		const initialRes = await fetch(
			`${baseUrl}/_emdash/api/content/${collectionSlug}/${postId}/revisions`,
			{ headers },
		);
		const initialData: any = await initialRes.json();
		const initialCount = initialData.data?.total ?? 0;

		await admin.goToEditContent(collectionSlug, postId);
		await admin.waitForLoading();

		const titleInput = page.locator("#field-title");
		await expect(titleInput).toHaveValue("Original Title");

		await page.waitForTimeout(3000);

		const contentUrl = `/_emdash/api/content/${collectionSlug}/${postId}`;
		const autosavePut = page.waitForResponse(
			(res) => res.url().includes(contentUrl) && res.request().method() === "PUT",
			{ timeout: 15000 },
		);

		await titleInput.fill("Updated Title for Revision");
		const response = await autosavePut;
		expect(response.status()).toBe(200);

		await expect(page.getByRole("status").filter({ hasText: "Saved" }).first()).toBeVisible({
			timeout: 5000,
		});

		const publishButton = page.getByRole("button", { name: "Publish" });
		if (await publishButton.isVisible({ timeout: 3000 }).catch(() => false)) {
			await publishButton.click();
			await admin.waitForLoading();
		}

		const afterRes = await fetch(
			`${baseUrl}/_emdash/api/content/${collectionSlug}/${postId}/revisions`,
			{ headers },
		);
		const afterData: any = await afterRes.json();
		const afterCount = afterData.data?.total ?? 0;

		expect(afterCount).toBeGreaterThan(initialCount);
	});

	test("can view a revision's data by clicking on it", async ({ admin, page }) => {
		await fetch(`${baseUrl}/_emdash/api/content/${collectionSlug}/${postId}`, {
			method: "PUT",
			headers,
			body: JSON.stringify({ data: { title: "Second Version", excerpt: "Updated excerpt" } }),
		});
		await fetch(`${baseUrl}/_emdash/api/content/${collectionSlug}/${postId}/publish`, {
			method: "POST",
			headers,
			body: JSON.stringify({}),
		});

		await admin.goToEditContent(collectionSlug, postId);
		await admin.waitForLoading();

		const revisionsButton = page.locator("button", { hasText: "Revisions" });
		await revisionsButton.click();

		await page
			.waitForResponse((res) => REVISIONS_API_PATTERN.test(res.url()) && res.status() === 200, {
				timeout: 10000,
			})
			.catch(() => {});

		await expect(page.locator("span.rounded-full", { hasText: "Current" }).first()).toBeVisible({
			timeout: 10000,
		});

		const revisionItems = page.locator(".rounded-lg.border.p-3");
		const count = await revisionItems.count();
		expect(count).toBeGreaterThanOrEqual(2);

		const olderRevision = revisionItems.nth(1);
		await olderRevision.locator("button.flex-1.text-start").click();

		const snapshotOrDiff = page.locator("text=Content snapshot").or(page.locator("text=change"));
		await expect(snapshotOrDiff.first()).toBeVisible({ timeout: 5000 });
	});

	test("restoring a revision updates the content", async ({ admin, page }) => {
		const originalTitle = "Original Title";

		await fetch(`${baseUrl}/_emdash/api/content/${collectionSlug}/${postId}`, {
			method: "PUT",
			headers,
			body: JSON.stringify({ data: { title: "Changed Title", excerpt: "Changed excerpt" } }),
		});
		await fetch(`${baseUrl}/_emdash/api/content/${collectionSlug}/${postId}/publish`, {
			method: "POST",
			headers,
			body: JSON.stringify({}),
		});

		const revisionsRes = await fetch(
			`${baseUrl}/_emdash/api/content/${collectionSlug}/${postId}/revisions`,
			{ headers },
		);
		const revisionsData: any = await revisionsRes.json();
		const revisions = revisionsData.data?.items ?? [];

		expect(revisions.length).toBeGreaterThanOrEqual(2);

		const olderRevision = revisions[1];
		expect(olderRevision).toBeDefined();

		await admin.goToEditContent(collectionSlug, postId);
		await admin.waitForLoading();

		await expect(page.locator("#field-title")).toHaveValue("Changed Title");

		const revisionsButton = page.locator("button", { hasText: "Revisions" });
		await revisionsButton.click();

		await page
			.waitForResponse((res) => REVISIONS_API_PATTERN.test(res.url()) && res.status() === 200, {
				timeout: 10000,
			})
			.catch(() => {});

		const revisionItems = page.locator(".rounded-lg.border.p-3");
		await expect(revisionItems.first()).toBeVisible({ timeout: 10000 });

		const restoreButton = page.locator('button[aria-label="Restore this version"]').first();
		await expect(restoreButton).toBeVisible({ timeout: 5000 });

		await restoreButton.click();

		const confirmDialog = page.getByRole("dialog", { name: /Restore Revision/ });
		await expect(confirmDialog).toBeVisible({ timeout: 5000 });

		await confirmDialog.getByRole("button", { name: "Restore" }).click();

		await expect(confirmDialog).not.toBeVisible({ timeout: 10000 });

		await admin.waitForLoading();

		const contentRes = await fetch(`${baseUrl}/_emdash/api/content/${collectionSlug}/${postId}`, {
			headers,
		});
		const contentData: any = await contentRes.json();
		const currentTitle = contentData.data?.item?.data?.title ?? contentData.data?.item?.title;

		expect(currentTitle).toBe(originalTitle);
	});

	test("restore creates a new revision in the history", async ({ admin: _admin }) => {
		await fetch(`${baseUrl}/_emdash/api/content/${collectionSlug}/${postId}`, {
			method: "PUT",
			headers,
			body: JSON.stringify({ data: { title: "Version 2", excerpt: "v2 excerpt" } }),
		});
		await fetch(`${baseUrl}/_emdash/api/content/${collectionSlug}/${postId}/publish`, {
			method: "POST",
			headers,
			body: JSON.stringify({}),
		});

		const beforeRes = await fetch(
			`${baseUrl}/_emdash/api/content/${collectionSlug}/${postId}/revisions`,
			{ headers },
		);
		const beforeData: any = await beforeRes.json();
		const countBefore = beforeData.data?.total ?? 0;
		const revisions = beforeData.data?.items ?? [];

		expect(revisions.length).toBeGreaterThanOrEqual(2);
		const olderRevisionId = revisions[1].id;

		const restoreRes = await fetch(`${baseUrl}/_emdash/api/revisions/${olderRevisionId}/restore`, {
			method: "POST",
			headers,
		});
		expect(restoreRes.status).toBe(200);

		const afterRes = await fetch(
			`${baseUrl}/_emdash/api/content/${collectionSlug}/${postId}/revisions`,
			{ headers },
		);
		const afterData: any = await afterRes.json();
		const countAfter = afterData.data?.total ?? 0;

		expect(countAfter).toBeGreaterThan(countBefore);
	});
});
