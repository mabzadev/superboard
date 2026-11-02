import { test, expect } from "../../fixtures/emdash-browser";

const SCHEDULE_API_PATTERN = /\/api\/content\/posts\/[A-Z0-9]+\/schedule/;
const DUPLICATE_API_PATTERN = /\/api\/content\/posts\/[A-Z0-9]+\/duplicate/;
const DISCARD_DRAFT_API_PATTERN = /\/api\/content\/posts\/[A-Z0-9]+\/discard-draft/;
const RESTORE_API_PATTERN = /\/api\/content\/posts\/[A-Z0-9]+\/restore/;
const PERMANENT_DELETE_API_PATTERN = /\/api\/content\/posts\/[A-Z0-9]+\/permanent/;

const TRASH_TAB_LABEL = /Trash/i;
const RESTORE_LABEL = /Restore/i;
const PERM_DELETE_LABEL = /Permanently delete/i;

function apiHeaders(token: string, baseUrl: string) {
	return {
		"Content-Type": "application/json",
		Authorization: `Bearer ${token}`,
		"X-EmDash-Request": "1",
		Origin: baseUrl,
	};
}

async function createPost(
	baseUrl: string,
	headers: Record<string, string>,
	title: string,
	slug: string,
): Promise<string> {
	const res = await fetch(`${baseUrl}/_emdash/api/content/posts`, {
		method: "POST",
		headers,
		body: JSON.stringify({ data: { title }, slug }),
	});
	const json: any = await res.json();
	return json.data?.item?.id ?? json.data?.id;
}

async function publishPost(
	baseUrl: string,
	headers: Record<string, string>,
	id: string,
): Promise<void> {
	await fetch(`${baseUrl}/_emdash/api/content/posts/${id}/publish`, {
		method: "POST",
		headers,
		body: JSON.stringify({}),
	});
}

async function trashPost(
	baseUrl: string,
	headers: Record<string, string>,
	id: string,
): Promise<void> {
	await fetch(`${baseUrl}/_emdash/api/content/posts/${id}`, {
		method: "DELETE",
		headers,
	});
}

async function cleanupPost(
	baseUrl: string,
	headers: Record<string, string>,
	id: string,
): Promise<void> {
	await fetch(`${baseUrl}/_emdash/api/content/posts/${id}`, {
		method: "DELETE",
		headers,
	}).catch(() => {});
	await fetch(`${baseUrl}/_emdash/api/content/posts/${id}/permanent`, {
		method: "DELETE",
		headers,
	}).catch(() => {});
}

test.describe("Schedule content", () => {
	let headers: Record<string, string>;
	let baseUrl: string;
	let postId: string;

	test.beforeEach(async ({ admin, serverInfo }) => {
		await admin.devBypassAuth();
		baseUrl = serverInfo.baseUrl;
		headers = apiHeaders(serverInfo.token, baseUrl);

		postId = await createPost(
			baseUrl,
			headers,
			"Schedule Test Post",
			`schedule-test-${Date.now()}`,
		);
	});

	test.afterEach(async () => {
		await cleanupPost(baseUrl, headers, postId);
	});

	test("schedule a draft post for future publishing", async ({ admin, page }) => {
		await admin.goToEditContent("posts", postId);
		await admin.waitForLoading();

		await expect(page.locator("#field-title")).toHaveValue("Schedule Test Post");

		const scheduleButton = page.getByRole("button", { name: "Schedule for later" });
		await expect(scheduleButton).toBeVisible({ timeout: 5000 });
		await scheduleButton.click();

		const dateInput = page.getByLabel("Schedule for");
		await expect(dateInput).toBeVisible({ timeout: 5000 });

		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		tomorrow.setHours(9, 0, 0, 0);
		const dateValue = tomorrow.toISOString().slice(0, 16);
		await dateInput.fill(dateValue);

		const scheduleResponse = page.waitForResponse(
			(res) =>
				SCHEDULE_API_PATTERN.test(res.url()) &&
				res.request().method() === "POST" &&
				res.status() === 200,
			{ timeout: 10000 },
		);
		await page.getByRole("button", { name: "Schedule", exact: true }).click();
		await scheduleResponse;

		await expect(page.getByRole("heading", { name: "Scheduled" })).toBeVisible({ timeout: 5000 });

		await expect(page.locator("text=Scheduled for:")).toBeVisible({ timeout: 5000 });

		await expect(page.getByRole("button", { name: "Unschedule" })).toBeVisible();
	});

	test("unschedule a scheduled post", async ({ admin, page }) => {
		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		await fetch(`${baseUrl}/_emdash/api/content/posts/${postId}/schedule`, {
			method: "POST",
			headers,
			body: JSON.stringify({ scheduledAt: tomorrow.toISOString() }),
		});

		await admin.goToEditContent("posts", postId);
		await admin.waitForLoading();

		await expect(page.locator("text=Scheduled for:")).toBeVisible({ timeout: 5000 });

		const unscheduleResponse = page.waitForResponse(
			(res) =>
				SCHEDULE_API_PATTERN.test(res.url()) &&
				res.request().method() === "DELETE" &&
				res.status() === 200,
			{ timeout: 10000 },
		);
		await page.getByRole("button", { name: "Unschedule" }).click();
		await unscheduleResponse;

		await expect(page.locator("text=Scheduled for:")).not.toBeVisible({ timeout: 5000 });

		await expect(page.getByRole("button", { name: "Schedule for later" })).toBeVisible({
			timeout: 5000,
		});
	});
});

test.describe("Duplicate content", () => {
	let headers: Record<string, string>;
	let baseUrl: string;
	let postId: string;
	let duplicateId: string | undefined;

	test.beforeEach(async ({ admin, serverInfo }) => {
		await admin.devBypassAuth();
		baseUrl = serverInfo.baseUrl;
		headers = apiHeaders(serverInfo.token, baseUrl);

		postId = await createPost(
			baseUrl,
			headers,
			"Duplicate Source Post",
			`dup-source-${Date.now()}`,
		);
	});

	test.afterEach(async () => {
		await cleanupPost(baseUrl, headers, postId);
		if (duplicateId) {
			await cleanupPost(baseUrl, headers, duplicateId);
		}
	});

	test("duplicate a post from the content list", async ({ admin, page }) => {
		await admin.goToContent("posts");
		await admin.waitForLoading();

		const row = page.locator("tr", { hasText: "Duplicate Source Post" });
		await expect(row).toBeVisible({ timeout: 5000 });

		const duplicateResponse = page.waitForResponse(
			(res) =>
				DUPLICATE_API_PATTERN.test(res.url()) &&
				res.request().method() === "POST" &&
				(res.status() === 200 || res.status() === 201),
			{ timeout: 10000 },
		);

		await row.getByRole("button", { name: "Duplicate Duplicate Source Post" }).click();
		const response = await duplicateResponse;
		const body = await response.json();
		duplicateId = body.data?.item?.id ?? body.data?.id;

		await admin.waitForLoading();

		await page.reload();
		await admin.waitForShell();
		await admin.waitForLoading();

		expect(duplicateId).toBeTruthy();
		const getRes = await fetch(`${baseUrl}/_emdash/api/content/posts/${duplicateId}`, {
			headers,
		});
		expect(getRes.ok).toBe(true);
	});
});

test.describe("Trash and restore content", () => {
	let headers: Record<string, string>;
	let baseUrl: string;
	let postId: string;

	test.beforeEach(async ({ admin, serverInfo }) => {
		await admin.devBypassAuth();
		baseUrl = serverInfo.baseUrl;
		headers = apiHeaders(serverInfo.token, baseUrl);

		postId = await createPost(baseUrl, headers, "Trash Test Post", `trash-test-${Date.now()}`);
	});

	test.afterEach(async () => {
		await cleanupPost(baseUrl, headers, postId);
	});

	test("move a post to trash from the content list", async ({ admin, page }) => {
		await admin.goToContent("posts");
		await admin.waitForLoading();

		const row = page.locator("tr", { hasText: "Trash Test Post" });
		await expect(row).toBeVisible({ timeout: 5000 });
		await row.getByRole("button", { name: "Move Trash Test Post to trash" }).click();

		const dialog = page.locator('[role="dialog"]').filter({ hasText: "Move to Trash?" });
		await expect(dialog).toBeVisible({ timeout: 5000 });
		await expect(dialog.locator("text=Trash Test Post")).toBeVisible();

		const deleteResponse = page.waitForResponse(
			(res) =>
				res.url().includes(`/api/content/posts/${postId}`) &&
				res.request().method() === "DELETE" &&
				res.status() === 200,
			{ timeout: 10000 },
		);
		await dialog.getByRole("button", { name: "Move to Trash" }).click();
		await deleteResponse;

		await expect(dialog).not.toBeVisible({ timeout: 5000 });

		await admin.waitForLoading();
		await expect(page.locator("tr", { hasText: "Trash Test Post" })).not.toBeVisible({
			timeout: 5000,
		});
	});

	test("restore a trashed post from the trash tab", async ({ admin, page }) => {
		await trashPost(baseUrl, headers, postId);

		await admin.goToContent("posts");
		await admin.waitForLoading();

		const trashTab = page.getByRole("tab", { name: TRASH_TAB_LABEL });
		await expect(trashTab).toBeVisible({ timeout: 5000 });
		await trashTab.click();

		await admin.waitForLoading();

		const trashedRow = page.locator("tr", { hasText: "Trash Test Post" });
		await expect(trashedRow).toBeVisible({ timeout: 10000 });

		const restoreResponse = page.waitForResponse(
			(res) =>
				RESTORE_API_PATTERN.test(res.url()) &&
				res.request().method() === "POST" &&
				res.status() === 200,
			{ timeout: 10000 },
		);
		await trashedRow.getByRole("button", { name: RESTORE_LABEL }).click();
		await restoreResponse;

		await admin.waitForLoading();

		const allTab = page.getByRole("tab", { name: "All" });
		await allTab.click();
		await admin.waitForLoading();

		await expect(page.locator("tr", { hasText: "Trash Test Post" })).toBeVisible({
			timeout: 10000,
		});
	});
});

test.describe("Permanent delete", () => {
	let headers: Record<string, string>;
	let baseUrl: string;
	let postId: string;

	test.beforeEach(async ({ admin, serverInfo }) => {
		await admin.devBypassAuth();
		baseUrl = serverInfo.baseUrl;
		headers = apiHeaders(serverInfo.token, baseUrl);

		postId = await createPost(baseUrl, headers, "Permanent Delete Post", `perm-del-${Date.now()}`);
		await trashPost(baseUrl, headers, postId);
	});

	test("permanently delete a trashed post", async ({ admin, page }) => {
		await admin.goToContent("posts");
		await admin.waitForLoading();

		const trashTab = page.getByRole("tab", { name: TRASH_TAB_LABEL });
		await trashTab.click();
		await admin.waitForLoading();

		const trashedRow = page.locator("tr", { hasText: "Permanent Delete Post" });
		await expect(trashedRow).toBeVisible({ timeout: 10000 });

		await trashedRow.getByRole("button", { name: PERM_DELETE_LABEL }).click();

		const dialog = page.locator('[role="dialog"]').filter({ hasText: "Delete Permanently?" });
		await expect(dialog).toBeVisible({ timeout: 5000 });
		await expect(dialog.locator("text=Permanent Delete Post")).toBeVisible();

		const permanentDeleteResponse = page.waitForResponse(
			(res) =>
				PERMANENT_DELETE_API_PATTERN.test(res.url()) &&
				res.request().method() === "DELETE" &&
				res.status() === 200,
			{ timeout: 10000 },
		);
		await dialog.getByRole("button", { name: "Delete Permanently" }).click();
		await permanentDeleteResponse;

		await expect(dialog).not.toBeVisible({ timeout: 5000 });

		await admin.waitForLoading();
		await expect(page.locator("tr", { hasText: "Permanent Delete Post" })).not.toBeVisible({
			timeout: 5000,
		});

		const getRes = await fetch(`${baseUrl}/_emdash/api/content/posts/${postId}`, { headers });
		expect(getRes.status).toBe(404);
	});
});

test.describe("Discard draft changes", () => {
	let headers: Record<string, string>;
	let baseUrl: string;
	let postId: string;

	test.beforeEach(async ({ admin, serverInfo }) => {
		await admin.devBypassAuth();
		baseUrl = serverInfo.baseUrl;
		headers = apiHeaders(serverInfo.token, baseUrl);

		postId = await createPost(
			baseUrl,
			headers,
			"Published Original Title",
			`discard-draft-${Date.now()}`,
		);
		await publishPost(baseUrl, headers, postId);
	});

	test.afterEach(async () => {
		await cleanupPost(baseUrl, headers, postId);
	});

	test("discard draft reverts to the published version", async ({ admin, page }) => {
		await admin.goToEditContent("posts", postId);
		await admin.waitForLoading();

		const titleInput = page.locator("#field-title");
		await expect(titleInput).toHaveValue("Published Original Title");

		await titleInput.fill("Draft Modified Title");

		await admin.clickSave();
		await admin.waitForSaveComplete();

		await expect(page.locator("text=Pending changes")).toBeVisible({ timeout: 5000 });

		const discardButton = page.getByRole("button", { name: "Discard changes" });
		await expect(discardButton).toBeVisible({ timeout: 5000 });
		await discardButton.click();

		const dialog = page.locator('[role="dialog"]').filter({ hasText: "Discard draft changes?" });
		await expect(dialog).toBeVisible({ timeout: 5000 });

		const discardResponse = page.waitForResponse(
			(res) =>
				DISCARD_DRAFT_API_PATTERN.test(res.url()) &&
				res.request().method() === "POST" &&
				res.status() === 200,
			{ timeout: 10000 },
		);
		await dialog.getByRole("button", { name: "Discard changes" }).click();
		await discardResponse;

		await admin.waitForLoading();

		await expect(titleInput).toHaveValue("Published Original Title", { timeout: 10000 });

		await expect(page.locator("text=Pending changes")).not.toBeVisible({ timeout: 5000 });

		await expect(discardButton).not.toBeVisible({ timeout: 5000 });
	});
});

test.describe("Trash from editor", () => {
	let headers: Record<string, string>;
	let baseUrl: string;
	let postId: string;

	test.beforeEach(async ({ admin, serverInfo }) => {
		await admin.devBypassAuth();
		baseUrl = serverInfo.baseUrl;
		headers = apiHeaders(serverInfo.token, baseUrl);

		postId = await createPost(baseUrl, headers, "Editor Trash Post", `editor-trash-${Date.now()}`);
	});

	test.afterEach(async () => {
		await cleanupPost(baseUrl, headers, postId);
	});

	test("move a post to trash from the editor sidebar", async ({ admin, page }) => {
		await admin.goToEditContent("posts", postId);
		await admin.waitForLoading();

		const trashButton = page.getByRole("button", { name: "Move to Trash" });
		await expect(trashButton).toBeVisible({ timeout: 5000 });
		await trashButton.click();

		const dialog = page.locator('[role="dialog"]').filter({ hasText: "Move to Trash?" });
		await expect(dialog).toBeVisible({ timeout: 5000 });

		const deleteResponse = page.waitForResponse(
			(res) =>
				res.url().includes(`/api/content/posts/${postId}`) &&
				res.request().method() === "DELETE" &&
				res.status() === 200,
			{ timeout: 10000 },
		);
		await dialog.getByRole("button", { name: "Move to Trash" }).click();
		await deleteResponse;

		const getRes = await fetch(`${baseUrl}/_emdash/api/content/posts/${postId}`, { headers });
		expect(getRes.status).toBe(404);
	});
});
