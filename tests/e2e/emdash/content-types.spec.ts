import { test, expect } from "../../fixtures/emdash-browser";

const CONTENT_TYPES_SLUG_PATTERN = /\/content-types\/posts$/;

const TEST_SLUG = "e2e_test_articles";
const TEST_LABEL_SINGULAR = "Article";
const TEST_LABEL_PLURAL = `${TEST_LABEL_SINGULAR}s`;

test.describe("Content Types", () => {
	test.beforeEach(async ({ admin }) => {
		await admin.devBypassAuth();
	});

	test.describe("Content Types List", () => {
		test("displays seeded collections in a table", async ({ admin }) => {
			await admin.goto("/content-types");
			await admin.waitForLoading();

			await admin.expectPageTitle("Content Types");

			await expect(admin.page.locator("table")).toBeVisible();

			const table = admin.page.locator("table");
			await expect(table.getByRole("link", { name: "Posts", exact: true })).toBeVisible();
			await expect(table.getByRole("link", { name: "Pages", exact: true })).toBeVisible();
		});

		test("shows slug column for each collection", async ({ admin }) => {
			await admin.goto("/content-types");
			await admin.waitForLoading();

			await expect(admin.page.locator("table code", { hasText: "posts" })).toBeVisible();
			await expect(admin.page.locator("table code", { hasText: "pages" })).toBeVisible();
		});

		test("has a New Content Type button", async ({ admin }) => {
			await admin.goto("/content-types");
			await admin.waitForLoading();

			await expect(admin.page.getByRole("link", { name: "New Content Type" })).toBeVisible();
		});
	});

	test.describe("View Content Type", () => {
		test("clicking a collection shows its field list", async ({ admin }) => {
			await admin.goto("/content-types");
			await admin.waitForLoading();

			await admin.page.locator("table").getByRole("link", { name: "Posts", exact: true }).click();

			await expect(admin.page).toHaveURL(CONTENT_TYPES_SLUG_PATTERN, {
				timeout: 10000,
			});

			await admin.expectPageTitle("Posts");

			await expect(admin.page.getByText("System Fields")).toBeVisible();

			await expect(admin.page.getByText("Custom Fields", { exact: true })).toBeVisible();
		});

		test("shows expected custom fields for posts", async ({ admin }) => {
			await admin.goto("/content-types/posts");
			await admin.waitForShell();
			await admin.waitForLoading();

			await expect(admin.page.getByText("Title").first()).toBeVisible();
			await expect(admin.page.getByText("Body").first()).toBeVisible();
			await expect(admin.page.getByText("Excerpt").first()).toBeVisible();

			await expect(admin.page.locator("code", { hasText: "title" }).first()).toBeVisible();
			await expect(admin.page.locator("code", { hasText: "body" }).first()).toBeVisible();
			await expect(admin.page.locator("code", { hasText: "excerpt" }).first()).toBeVisible();
		});

		test("shows system fields for a collection", async ({ admin }) => {
			await admin.goto("/content-types/posts");
			await admin.waitForShell();
			await admin.waitForLoading();

			for (const slug of ["id", "slug", "status", "created_at", "updated_at", "published_at"]) {
				await expect(admin.page.locator("code", { hasText: slug }).first()).toBeVisible();
			}
		});
	});

	test.describe("Save Content Type Settings", () => {
		test("toggling a feature and saving persists across reloads", async ({ admin }) => {
			await admin.goto("/content-types/posts");
			await admin.waitForShell();
			await admin.waitForLoading();

			const toggleLabel = admin.page.locator("label", { hasText: "Enable comments" });
			const savedButton = () => admin.page.getByRole("button", { name: "Saved" }).first();
			const saveButton = () =>
				admin.page.getByRole("button", { name: "Save", exact: true }).first();

			await expect(savedButton()).toBeDisabled();

			await toggleLabel.click();
			await expect(saveButton()).toBeEnabled();

			const savePut = admin.page.waitForResponse(
				(res) =>
					res.url().includes("/api/schema/collections/posts") && res.request().method() === "PUT",
				{ timeout: 10000 },
			);
			await saveButton().click();
			expect((await savePut).status()).toBe(200);
			await expect(admin.page.getByText("Failed to save")).not.toBeVisible();

			await admin.page.reload();
			await admin.waitForShell();
			await admin.waitForLoading();
			await expect(savedButton()).toBeDisabled();

			await toggleLabel.click();
			await expect(saveButton()).toBeEnabled();
			const restorePut = admin.page.waitForResponse(
				(res) =>
					res.url().includes("/api/schema/collections/posts") && res.request().method() === "PUT",
				{ timeout: 10000 },
			);
			await saveButton().click();
			expect((await restorePut).status()).toBe(200);
			await expect(admin.page.getByText("Failed to save")).not.toBeVisible();
			await admin.page.reload();
			await admin.waitForShell();
			await admin.waitForLoading();
			await expect(savedButton()).toBeDisabled();
		});
	});

	test.describe("Create Content Type", () => {
		test("creates a new content type and redirects to editor", async ({ admin }) => {
			await admin.goto("/content-types/new");
			await admin.waitForShell();
			await admin.waitForLoading();

			await admin.expectPageTitle("New Content Type");

			const singularInput = admin.page.getByLabel("Label (Singular)");
			await singularInput.fill(TEST_LABEL_SINGULAR);

			const pluralInput = admin.page.getByLabel("Label (Plural)");
			await expect(pluralInput).toHaveValue(TEST_LABEL_PLURAL);

			const slugInput = admin.page.getByLabel("Slug", { exact: true });
			await slugInput.fill(TEST_SLUG);

			await admin.page.getByRole("button", { name: "Create Content Type" }).click();

			await expect(admin.page).toHaveURL(new RegExp(`/content-types/${TEST_SLUG}$`), {
				timeout: 15000,
			});

			await admin.expectPageTitle(TEST_LABEL_PLURAL);
		});

		test("new collection appears in the content types list", async ({ admin }) => {
			await admin.goto("/content-types");
			await admin.waitForLoading();

			await expect(
				admin.page.locator("table").getByRole("link", { name: TEST_LABEL_PLURAL, exact: true }),
			).toBeVisible({ timeout: 10000 });

			await expect(admin.page.locator("table code", { hasText: TEST_SLUG })).toBeVisible();
		});
	});

	test.describe("Add Field to Content Type", () => {
		test("adds a text field to the test collection", async ({ admin }) => {
			await admin.goto(`/content-types/${TEST_SLUG}`);
			await admin.waitForShell();
			await admin.waitForLoading();

			await admin.expectPageTitle(TEST_LABEL_PLURAL);

			await admin.page.getByRole("button", { name: "Add Field" }).first().click();

			const dialog = admin.page.locator('[role="dialog"]');
			await expect(dialog).toBeVisible({ timeout: 5000 });

			await dialog.getByText("Short Text").click();

			await dialog.getByLabel("Label").fill("Summary");

			await expect(dialog.getByLabel("Slug")).toHaveValue("summary");

			await dialog.getByRole("button", { name: "Add Field" }).click();

			await expect(dialog).not.toBeVisible({ timeout: 10000 });

			await admin.waitForLoading();
			await expect(admin.page.getByText("Summary", { exact: true })).toBeVisible({
				timeout: 10000,
			});
			await expect(admin.page.locator("code", { hasText: "summary" })).toBeVisible();
		});
	});

	test.describe("Delete Content Type", () => {
		test("deletes the test-created collection", async ({ admin }) => {
			await admin.goto("/content-types");
			await admin.waitForLoading();

			await expect(admin.page.locator("table code", { hasText: TEST_SLUG })).toBeVisible({
				timeout: 10000,
			});

			const row = admin.page.locator("tr").filter({ hasText: TEST_LABEL_PLURAL });
			await row.getByRole("button", { name: `Delete ${TEST_LABEL_PLURAL}` }).click();

			const dialog = admin.page.locator('[role="dialog"]');
			await expect(dialog).toBeVisible({ timeout: 5000 });
			await dialog.getByRole("button", { name: "Delete" }).click();

			await admin.waitForLoading();
			await expect(admin.page.locator("table code", { hasText: TEST_SLUG })).not.toBeVisible({
				timeout: 10000,
			});
		});
	});
});
