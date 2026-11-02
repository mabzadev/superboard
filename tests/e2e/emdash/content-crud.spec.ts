import { test, expect } from "../../fixtures/emdash-browser";

const CONTENT_EDIT_URL_PATTERN = /\/content\/posts\/[A-Z0-9]+(?:\?.*)?$/;
const CONTENT_ID_PATTERN = /\/content\/posts\/[A-Z0-9]+(?:\?.*)?$/;
const NEW_CONTENT_URL_PATTERN = /\/content\/posts\/new(?:[?#].*)?$/;

test.describe("Content CRUD", () => {
	test.beforeEach(async ({ admin }) => {
		await admin.devBypassAuth();
	});

	test.describe("Content List", () => {
		test("displays content list with seeded items", async ({ admin }) => {
			await admin.goToContent("posts");
			await admin.waitForLoading();

			await admin.expectPageTitle("Posts");

			await expect(admin.page.locator("table")).toBeVisible();

			await expect(admin.page.getByRole("link", { name: "First Post", exact: true })).toBeVisible();
			await expect(
				admin.page.getByRole("link", { name: "Second Post", exact: true }),
			).toBeVisible();
			await expect(admin.page.getByRole("link", { name: "Draft Post", exact: true })).toBeVisible();

			await expect(admin.page.getByRole("link", { name: "Add New" })).toBeVisible();
		});

		test("clicking Add New navigates to content editor", async ({ admin }) => {
			await admin.goToContent("posts");
			await admin.waitForLoading();

			await admin.page.getByRole("link", { name: "Add New" }).click();

			await expect(admin.page).toHaveURL(NEW_CONTENT_URL_PATTERN, {
				timeout: 10000,
			});
		});
	});

	test.describe("Create Content", () => {
		test("creates new post with title", async ({ admin }) => {
			await admin.goToNewContent("posts");
			await admin.waitForLoading();

			await admin.fillField("title", "E2E Test Post");

			await admin.clickSave();

			await expect(admin.page).toHaveURL(CONTENT_EDIT_URL_PATTERN, {
				timeout: 10000,
			});
		});

		test("auto-generates slug from title", async ({ admin }) => {
			await admin.goToNewContent("posts");
			await admin.waitForLoading();

			await admin.fillField("title", "My Amazing Blog Post");

			const slugInput = admin.page.getByLabel("Slug");
			await expect(slugInput).toHaveValue("my-amazing-blog-post");
		});
	});

	test.describe("Edit Content", () => {
		test("vertically aligns standard section drag handles with their headings", async ({
			admin,
		}) => {
			await admin.goToContent("posts");
			await admin.waitForLoading();
			await admin.page.getByRole("link", { name: "First Post", exact: true }).click();
			await admin.waitForLoading();

			const dragHandle = admin.page.getByRole("button", {
				name: "Drag to reorder Publish",
			});
			const section = dragHandle.locator("xpath=ancestor::section");
			const heading = section.getByRole("heading", { name: "Publish" });
			const [handleBox, headingBox] = await Promise.all([
				dragHandle.boundingBox(),
				heading.boundingBox(),
			]);

			expect(handleBox).not.toBeNull();
			expect(headingBox).not.toBeNull();
			expect(
				Math.abs(handleBox!.y + handleBox!.height / 2 - (headingBox!.y + headingBox!.height / 2)),
			).toBeLessThanOrEqual(1);
		});

		test("vertically aligns disclosure section drag handles with their headers", async ({
			admin,
		}) => {
			await admin.goToContent("posts");
			await admin.waitForLoading();
			await admin.page.getByRole("link", { name: "First Post", exact: true }).click();
			await admin.waitForLoading();

			const dragHandle = admin.page.getByRole("button", {
				name: "Drag to reorder Revisions",
			});
			const section = dragHandle.locator("xpath=ancestor::section");
			const disclosureTrigger = section.getByRole("button", { name: /^Revisions/ });
			const [handleBox, triggerBox] = await Promise.all([
				dragHandle.boundingBox(),
				disclosureTrigger.boundingBox(),
			]);

			expect(handleBox).not.toBeNull();
			expect(triggerBox).not.toBeNull();
			expect(
				Math.abs(handleBox!.y + handleBox!.height / 2 - (triggerBox!.y + triggerBox!.height / 2)),
			).toBeLessThanOrEqual(1);
		});

		test("loads existing content for editing", async ({ admin }) => {
			await admin.goToContent("posts");
			await admin.waitForLoading();

			await admin.page.getByRole("link", { name: "First Post", exact: true }).click();

			await expect(admin.page).toHaveURL(CONTENT_ID_PATTERN);

			await expect(admin.page.locator("#field-title")).toHaveValue("First Post");
		});

		test("saves updated content", async ({ admin }) => {
			await admin.goToContent("posts");
			await admin.waitForLoading();

			await admin.page.getByRole("link", { name: "First Post", exact: true }).click();
			await admin.waitForLoading();

			const newTitle = `Updated Post ${Date.now()}`;
			await admin.fillField("title", newTitle);

			await admin.clickSave();
			await admin.waitForSaveComplete();

			await admin.page.reload();
			await admin.waitForShell();
			await admin.waitForLoading();

			await expect(admin.page.locator("#field-title")).toHaveValue(newTitle);
		});
	});

	test.describe("Content Status", () => {
		test("displays content status badges", async ({ admin }) => {
			await admin.goToContent("posts");
			await admin.waitForLoading();

			const statusBadges = admin.page.locator("span.inline-flex");
			const count = await statusBadges.count();
			expect(count).toBeGreaterThan(0);
		});

		test("publish action changes status", async ({ admin }) => {
			await admin.goToNewContent("posts");
			await admin.waitForLoading();

			await admin.fillField("title", "Draft to Publish Test");
			await admin.clickSave();

			await expect(admin.page).toHaveURL(CONTENT_EDIT_URL_PATTERN, {
				timeout: 10000,
			});

			const publishButton = admin.page.getByRole("button", {
				name: "Publish",
				exact: true,
			});
			await expect(publishButton).toBeVisible();
			await publishButton.click();
			await admin.waitForLoading();

			await expect(
				admin.page.getByRole("button", { name: "Unpublish Post", exact: true }),
			).toBeVisible({ timeout: 10000 });
		});
	});
});
