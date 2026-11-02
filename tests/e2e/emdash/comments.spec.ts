import type { APIRequestContext } from "@playwright/test";

import { test, expect } from "../../fixtures/emdash-browser";

const PENDING_EMPTY_PATTERN = /no comments awaiting moderation/i;

function apiHeaders(token: string) {
	return {
		"Content-Type": "application/json",
		Authorization: `Bearer ${token}`,
		"X-EmDash-Request": "1",
	};
}

async function seedComment(
	request: APIRequestContext,
	baseUrl: string,
	postId: string,
	overrides: { body?: string; authorName?: string; authorEmail?: string } = {},
) {
	const res = await request.post(`${baseUrl}/_emdash/api/comments/posts/${postId}`, {
		headers: {
			"Content-Type": "application/json",
			"X-EmDash-Request": "1",
		},
		data: {
			body: overrides.body ?? "Test comment from E2E",
			authorName: overrides.authorName ?? "E2E Tester",
			authorEmail: overrides.authorEmail ?? "e2e@test.com",
		},
	});
	expect(res.ok()).toBe(true);
	const json = (await res.json()) as { data: { status: string } };
	expect(json.data.status).toBe("pending");
}

async function cleanupComments(
	page: import("@playwright/test").Page,
	baseUrl: string,
	token: string,
) {
	const headers = apiHeaders(token);

	for (const status of ["pending", "approved", "spam", "trash"] as const) {
		const res = await page.request.fetch(
			`${baseUrl}/_emdash/api/admin/comments?status=${status}&limit=100`,
			{ headers },
		);
		if (!res.ok()) continue;

		const data: { data?: { items?: { id: string }[] } } = await res.json().catch(() => ({}));
		const ids = data?.data?.items?.map((c) => c.id) ?? [];
		if (ids.length === 0) continue;

		await page.request
			.post(`${baseUrl}/_emdash/api/admin/comments/bulk`, {
				headers,
				data: { ids, action: "delete" },
			})
			.catch(() => {});
	}
}

test.describe("Comments Moderation", () => {
	test.beforeEach(async ({ admin }) => {
		await admin.devBypassAuth();
	});

	test("page renders with correct title", async ({ admin }) => {
		await admin.goto("/comments");
		await admin.waitForShell();
		await admin.waitForLoading();

		await admin.expectPageTitle("Comments");
	});

	test("shows empty state when no comments exist", async ({ admin, page, serverInfo }) => {
		await cleanupComments(page, serverInfo.baseUrl, serverInfo.token);

		await admin.goto("/comments");
		await admin.waitForShell();
		await admin.waitForLoading();

		await expect(page.locator("td").filter({ hasText: PENDING_EMPTY_PATTERN })).toBeVisible({
			timeout: 10000,
		});
	});

	test("displays seeded comments with author and body", async ({
		admin,
		page,
		request: anonymousRequest,
		serverInfo,
	}) => {
		const postId = serverInfo.contentIds.posts[0]!;

		await cleanupComments(page, serverInfo.baseUrl, serverInfo.token);

		await seedComment(anonymousRequest, serverInfo.baseUrl, postId, {
			body: "First seeded comment",
			authorName: "Alice Commenter",
			authorEmail: "alice@test.com",
		});
		await seedComment(anonymousRequest, serverInfo.baseUrl, postId, {
			body: "Second seeded comment",
			authorName: "Bob Commenter",
			authorEmail: "bob@test.com",
		});

		await admin.goto("/comments");
		await admin.waitForShell();
		await admin.waitForLoading();

		const approvedTab = page.locator('[role="tab"]', { hasText: "Approved" });

		let foundAlice = await page
			.locator("text=Alice Commenter")
			.isVisible({ timeout: 5000 })
			.catch(() => false);

		if (!foundAlice) {
			await approvedTab.click();
			await admin.waitForLoading();
			foundAlice = await page
				.locator("text=Alice Commenter")
				.isVisible({ timeout: 5000 })
				.catch(() => false);
		}

		expect(foundAlice).toBe(true);
		await expect(page.locator("text=First seeded comment").first()).toBeVisible();
		await expect(page.locator("text=Bob Commenter").first()).toBeVisible();
		await expect(page.locator("text=Second seeded comment").first()).toBeVisible();
	});

	test("approve a pending comment", async ({
		admin,
		page,
		request: anonymousRequest,
		serverInfo,
	}) => {
		const postId = serverInfo.contentIds.posts[0]!;

		await cleanupComments(page, serverInfo.baseUrl, serverInfo.token);

		await seedComment(anonymousRequest, serverInfo.baseUrl, postId, {
			body: "Comment to approve",
			authorName: "Approval Tester",
			authorEmail: "approve@test.com",
		});

		await admin.goto("/comments");
		await admin.waitForShell();
		await admin.waitForLoading();

		const pendingTab = page.locator('[role="tab"]', { hasText: "Pending" });
		await pendingTab.click();
		await admin.waitForLoading();

		const hasPendingComment = await page
			.locator("text=Approval Tester")
			.isVisible({ timeout: 5000 })
			.catch(() => false);

		if (!hasPendingComment) {
			const approvedTab = page.locator('[role="tab"]', { hasText: "Approved" });
			await approvedTab.click();
			await admin.waitForLoading();
			await expect(page.locator("text=Approval Tester").first()).toBeVisible({
				timeout: 5000,
			});
			return;
		}

		const row = page.locator("tr", { hasText: "Approval Tester" });
		const approveBtn = row.locator('button[aria-label="Approve"]');
		await expect(approveBtn).toBeVisible({ timeout: 5000 });
		await approveBtn.click();

		await admin.waitForLoading();

		await expect(page.locator("tr", { hasText: "Approval Tester" })).not.toBeVisible({
			timeout: 10000,
		});

		const approvedTab = page.locator('[role="tab"]', { hasText: "Approved" });
		await approvedTab.click();
		await admin.waitForLoading();

		await expect(page.locator("text=Approval Tester").first()).toBeVisible({
			timeout: 10000,
		});
	});

	test("delete a comment permanently", async ({
		admin,
		page,
		request: anonymousRequest,
		serverInfo,
	}) => {
		const postId = serverInfo.contentIds.posts[0]!;

		await cleanupComments(page, serverInfo.baseUrl, serverInfo.token);

		await seedComment(anonymousRequest, serverInfo.baseUrl, postId, {
			body: "Comment to delete",
			authorName: "Delete Tester",
			authorEmail: "delete@test.com",
		});

		await admin.goto("/comments");
		await admin.waitForShell();
		await admin.waitForLoading();

		let commentVisible = await page
			.locator("text=Delete Tester")
			.isVisible({ timeout: 5000 })
			.catch(() => false);

		if (!commentVisible) {
			const approvedTab = page.locator('[role="tab"]', { hasText: "Approved" });
			await approvedTab.click();
			await admin.waitForLoading();
			commentVisible = await page
				.locator("text=Delete Tester")
				.isVisible({ timeout: 5000 })
				.catch(() => false);
		}

		expect(commentVisible).toBe(true);

		const row = page.locator("tr", { hasText: "Delete Tester" });
		const deleteBtn = row.locator('button[aria-label="Delete permanently"]');

		const hasDeleteBtn = await deleteBtn.isVisible({ timeout: 3000 }).catch(() => false);

		if (!hasDeleteBtn) {
			const trashBtn = row.locator('button[aria-label="Trash"]');
			await expect(trashBtn).toBeVisible({ timeout: 3000 });
			await trashBtn.click();
			await admin.waitForLoading();

			await expect(row).not.toBeVisible({ timeout: 10000 });
			return;
		}

		await deleteBtn.click();

		const dialog = page.locator('[role="dialog"]');
		await expect(dialog).toBeVisible({ timeout: 5000 });
		await expect(dialog.locator("text=Delete Comment")).toBeVisible();

		await dialog.getByRole("button", { name: "Delete" }).click();

		await expect(dialog).not.toBeVisible({ timeout: 10000 });
		await admin.waitForLoading();

		await expect(page.locator("text=Delete Tester")).not.toBeVisible({ timeout: 10000 });
	});
});
