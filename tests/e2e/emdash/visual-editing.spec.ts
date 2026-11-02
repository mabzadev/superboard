import { test, expect } from "../../fixtures/emdash-browser";

const MEDIA_FILE_PATTERN = /\/_emdash\/api\/media\/file\/.+\.\w+/;
const IMAGE_BUTTON_PATTERN = /Image/;

const POST_WITH_IMAGE_PATH = "/posts/post-with-image";

async function gotoWithRetry(
	page: import("@playwright/test").Page,
	url: string,
	maxRetries = 3,
): Promise<void> {
	for (let i = 0; i < maxRetries; i++) {
		await page.goto(url);
		await page.waitForLoadState("domcontentloaded");

		const hasError = await page.locator("text=An error occurred").count();
		if (hasError === 0) return;

		await page.waitForTimeout(2000);
	}
}

async function enableEditMode(page: import("@playwright/test").Page): Promise<void> {
	await page.goto("/_emdash/api/setup/dev-bypass?redirect=/");
	await page.waitForLoadState("networkidle");

	await page.context().addCookies([
		{
			name: "emdash-edit-mode",
			value: "true",
			domain: "localhost",
			path: "/",
		},
	]);
}

test.describe("Image Rendering (Static)", () => {
	test("renders image block with correct src URL", async ({ page }) => {
		await gotoWithRetry(page, POST_WITH_IMAGE_PATH);

		const figure = page.locator("figure.emdash-image");
		await expect(figure).toBeVisible({ timeout: 10000 });

		const img = figure.locator("img");
		await expect(img).toBeVisible();

		const src = await img.getAttribute("src");
		expect(src).toBeTruthy();
		expect(decodeURIComponent(src!)).toMatch(MEDIA_FILE_PATTERN);

		const alt = await img.getAttribute("alt");
		expect(alt).toBe("Test image");
	});

	test("renders text blocks around the image", async ({ page }) => {
		await gotoWithRetry(page, POST_WITH_IMAGE_PATH);

		const body = page.locator("#body");
		await expect(body).toBeVisible({ timeout: 10000 });

		await expect(body.locator("text=Text before image.")).toBeVisible();
		await expect(body.locator("text=Text after image.")).toBeVisible();
	});
});

test.describe("Inline Editor", () => {
	test.beforeEach(async ({ page }) => {
		await enableEditMode(page);
	});

	test("loads without crashing on posts with image blocks", async ({ page }) => {
		await gotoWithRetry(page, POST_WITH_IMAGE_PATH);

		const editor = page.locator(".emdash-inline-editor");
		await expect(editor).toBeVisible({ timeout: 15000 });

		await expect(editor.locator("text=Text before image.")).toBeVisible();
		await expect(editor.locator("text=Text after image.")).toBeVisible();

		const img = editor.locator("img");
		await expect(img).toBeVisible();
	});

	test("shows slash menu on / keystroke", async ({ page }) => {
		await gotoWithRetry(page, POST_WITH_IMAGE_PATH);

		const editor = page.locator(".emdash-inline-editor");
		await expect(editor).toBeVisible({ timeout: 15000 });

		await editor.locator("p").first().click();
		await page.keyboard.press("End");
		await page.keyboard.press("Enter");
		await page.keyboard.type("/");

		const slashMenu = page.locator(".emdash-slash-menu");
		await expect(slashMenu).toBeVisible({ timeout: 5000 });

		await expect(slashMenu.getByRole("button", { name: IMAGE_BUTTON_PATTERN })).toBeVisible();
	});

	test.fixme("slash menu does not scroll page to top", async ({ page }) => {
		await gotoWithRetry(page, POST_WITH_IMAGE_PATH);

		const editor = page.locator(".emdash-inline-editor");
		await expect(editor).toBeVisible({ timeout: 15000 });

		await page.evaluate(() => {
			const spacer = document.createElement("div");
			spacer.style.height = "2000px";
			document.body.appendChild(spacer);
		});

		await page.evaluate(() => window.scrollTo(0, 200));
		await page.waitForTimeout(100);
		const scrollBefore = await page.evaluate(() => window.scrollY);
		expect(scrollBefore).toBeGreaterThan(0);

		await editor.locator("p").last().click();
		await page.keyboard.press("End");
		await page.keyboard.press("Enter");
		await page.keyboard.type("/");

		const slashMenu = page.locator(".emdash-slash-menu");
		await expect(slashMenu).toBeVisible({ timeout: 5000 });

		const scrollAfter = await page.evaluate(() => window.scrollY);
		expect(scrollAfter).toBeGreaterThan(scrollBefore - 20);
	});

	test("/image command opens media picker", async ({ page }) => {
		await gotoWithRetry(page, POST_WITH_IMAGE_PATH);

		const editor = page.locator(".emdash-inline-editor");
		await expect(editor).toBeVisible({ timeout: 15000 });

		await editor.locator("p").first().click();
		await page.keyboard.press("End");
		await page.keyboard.press("Enter");
		await page.keyboard.type("/image");

		const slashMenu = page.locator(".emdash-slash-menu");
		await expect(slashMenu).toBeVisible({ timeout: 5000 });

		await page.keyboard.press("Enter");

		const picker = page.locator(".emdash-media-picker");
		await expect(picker).toBeVisible({ timeout: 5000 });

		await expect(picker.locator("text=Insert Image")).toBeVisible();
	});

	test("refuses file drop and paste without losing edits or breaking image insertion", async ({
		page,
	}) => {
		await gotoWithRetry(page, POST_WITH_IMAGE_PATH);

		const editor = page.locator(".emdash-inline-editor");
		await expect(editor).toBeVisible({ timeout: 15000 });

		await editor.locator("p").last().click();
		await page.keyboard.press("End");
		await page.keyboard.type(" SafeTransferEdits");

		const dropResult = await editor.evaluate((element) => {
			const transfer = new DataTransfer();
			transfer.items.add(new File(["image"], "drop.png", { type: "image/png" }));
			const dragEnter = new DragEvent("dragenter", {
				bubbles: true,
				cancelable: true,
				dataTransfer: transfer,
			});
			const dragEnterDispatched = element.dispatchEvent(dragEnter);
			const dragOver = new DragEvent("dragover", {
				bubbles: true,
				cancelable: true,
				dataTransfer: transfer,
			});
			const dragOverDispatched = element.dispatchEvent(dragOver);
			const event = new DragEvent("drop", {
				bubbles: true,
				cancelable: true,
				dataTransfer: transfer,
			});
			const dispatched = element.dispatchEvent(event);
			return {
				dragEnterDefaultPrevented: dragEnter.defaultPrevented,
				dragEnterDispatched,
				dragOverDefaultPrevented: dragOver.defaultPrevented,
				dragOverDispatched,
				defaultPrevented: event.defaultPrevented,
				dispatched,
				fileCount: event.dataTransfer?.files.length,
				itemCount: event.dataTransfer?.items.length,
				itemKind: event.dataTransfer?.items[0]?.kind,
			};
		});

		expect(dropResult).toEqual({
			dragEnterDefaultPrevented: true,
			dragEnterDispatched: false,
			dragOverDefaultPrevented: true,
			dragOverDispatched: false,
			defaultPrevented: true,
			dispatched: false,
			fileCount: 1,
			itemCount: 1,
			itemKind: "file",
		});
		await expect(editor).toContainText("SafeTransferEdits");
		const guidance = page.getByRole("status");
		await expect(guidance).toContainText("Type /image");
		const firstGuidance = await guidance.elementHandle();
		expect(firstGuidance).not.toBeNull();

		const pasteResult = await editor.evaluate((element) => {
			const transfer = new DataTransfer();
			transfer.items.add(new File(["document"], "paste.pdf", { type: "application/pdf" }));
			const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
			Object.defineProperty(event, "clipboardData", { value: transfer });
			const dispatched = element.dispatchEvent(event);
			return { defaultPrevented: event.defaultPrevented, dispatched };
		});

		expect(pasteResult).toEqual({ defaultPrevented: true, dispatched: false });
		await expect(editor).toContainText("SafeTransferEdits");
		await expect(guidance).toContainText("Type /image");
		expect(await firstGuidance!.evaluate((element) => element.isConnected)).toBe(false);

		await editor.locator("p").last().click();
		await page.keyboard.press("End");
		await page.keyboard.press("Enter");
		await page.keyboard.type("/image");
		await page.keyboard.press("Enter");
		await expect(page.locator(".emdash-media-picker")).toBeVisible({ timeout: 5000 });
	});

	test("shows file-transfer guidance in Arabic with RTL direction", async ({ page }) => {
		await gotoWithRetry(page, POST_WITH_IMAGE_PATH);

		const editor = page.locator(".emdash-inline-editor");
		await expect(editor).toBeVisible({ timeout: 15000 });
		await page.evaluate(() => {
			document.documentElement.lang = "ar";
			document.documentElement.dir = "rtl";
		});

		await editor.evaluate((element) => {
			const transfer = new DataTransfer();
			transfer.items.add(new File(["image"], "drop.png", { type: "image/png" }));
			element.dispatchEvent(
				new DragEvent("drop", {
					bubbles: true,
					cancelable: true,
					dataTransfer: transfer,
				}),
			);
		});

		const guidance = page.locator(".emdash-inline-editor-guidance");
		await expect(guidance).toHaveText(
			"لا يمكن إفلات الملفات أو لصقها هنا. اكتب /image لاختيار صورة من مكتبة الوسائط.",
		);
		expect(await guidance.evaluate((element) => getComputedStyle(element).direction)).toBe("rtl");
	});

	test("media picker shows uploaded images", async ({ page }) => {
		await gotoWithRetry(page, POST_WITH_IMAGE_PATH);

		const editor = page.locator(".emdash-inline-editor");
		await expect(editor).toBeVisible({ timeout: 15000 });

		await editor.locator("p").first().click();
		await page.keyboard.press("End");
		await page.keyboard.press("Enter");
		await page.keyboard.type("/image");
		await page.keyboard.press("Enter");

		const picker = page.locator(".emdash-media-picker");
		await expect(picker).toBeVisible({ timeout: 5000 });

		await expect(picker.getByText("Loading…").first()).toBeHidden({ timeout: 10000 });

		const images = picker.locator("img");
		const count = await images.count();
		expect(count).toBeGreaterThan(0);
	});

	test("selecting image from picker inserts it and triggers save", async ({ page }) => {
		await gotoWithRetry(page, POST_WITH_IMAGE_PATH);

		const editor = page.locator(".emdash-inline-editor");
		await expect(editor).toBeVisible({ timeout: 15000 });

		const initialImageCount = await editor.locator("img").count();

		await editor.locator("p").first().click();
		await page.keyboard.press("End");
		await page.keyboard.press("Enter");
		await page.keyboard.type("/image");
		await page.keyboard.press("Enter");

		const picker = page.locator(".emdash-media-picker");
		await expect(picker).toBeVisible({ timeout: 5000 });

		await expect(picker.getByText("Loading…").first()).toBeHidden({ timeout: 10000 });

		const firstThumb = picker
			.locator("button")
			.filter({ has: page.locator("img") })
			.first();
		await firstThumb.click();

		const savePromise = page.waitForResponse(
			(res) => res.url().includes("/api/content/posts/") && res.request().method() === "PUT",
			{ timeout: 10000 },
		);

		const insertButton = picker.locator("button", { hasText: "Insert" });
		await expect(insertButton).toBeVisible();
		await insertButton.click();

		await expect(picker).toBeHidden({ timeout: 3000 });

		const newImageCount = await editor.locator("img").count();
		expect(newImageCount).toBeGreaterThan(initialImageCount);

		const saveResponse = await savePromise;
		expect(saveResponse.ok()).toBe(true);
	});

	test("media picker can be closed with cancel", async ({ page }) => {
		await gotoWithRetry(page, POST_WITH_IMAGE_PATH);

		const editor = page.locator(".emdash-inline-editor");
		await expect(editor).toBeVisible({ timeout: 15000 });

		await editor.locator("p").first().click();
		await page.keyboard.press("End");
		await page.keyboard.press("Enter");
		await page.keyboard.type("/image");
		await page.keyboard.press("Enter");

		const picker = page.locator(".emdash-media-picker");
		await expect(picker).toBeVisible({ timeout: 5000 });

		const cancelButton = picker.locator("button", { hasText: "Cancel" });
		await cancelButton.click();

		await expect(picker).toBeHidden({ timeout: 3000 });
	});

	test("preserves unsaved edits after browser back", async ({ page }) => {
		await gotoWithRetry(page, POST_WITH_IMAGE_PATH);

		const editor = page.locator(".emdash-inline-editor");
		await expect(editor).toBeVisible({ timeout: 15000 });
		const marker = `Navigation save ${crypto.randomUUID()}`;

		await editor.locator("p").last().click();
		await page.keyboard.press("End");
		await page.keyboard.type(` ${marker}`);
		await expect(editor).toContainText(marker);
		expect(await (await page.request.get(POST_WITH_IMAGE_PATH)).text()).not.toContain(marker);

		await page.goBack();
		expect(new URL(page.url()).pathname).not.toBe(POST_WITH_IMAGE_PATH);

		await expect
			.poll(async () => (await page.request.get(POST_WITH_IMAGE_PATH)).text(), {
				timeout: 10000,
			})
			.toContain(marker);

		await gotoWithRetry(page, POST_WITH_IMAGE_PATH);
		const reloadedEditor = page.locator(".emdash-inline-editor");
		await expect(reloadedEditor).toBeVisible({ timeout: 15000 });
		await expect(reloadedEditor.getByText(marker, { exact: false })).toBeVisible();
	});

	test("media picker can be closed with X button", async ({ page }) => {
		await gotoWithRetry(page, POST_WITH_IMAGE_PATH);

		const editor = page.locator(".emdash-inline-editor");
		await expect(editor).toBeVisible({ timeout: 15000 });

		await editor.locator("p").first().click();
		await page.keyboard.press("End");
		await page.keyboard.press("Enter");
		await page.keyboard.type("/image");
		await page.keyboard.press("Enter");

		const picker = page.locator(".emdash-media-picker");
		await expect(picker).toBeVisible({ timeout: 5000 });

		const closeButton = picker.locator('button[aria-label="Close"]');
		await closeButton.click();

		await expect(picker).toBeHidden({ timeout: 3000 });
	});
});
