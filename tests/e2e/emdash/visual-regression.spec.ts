import type { Locator } from "@playwright/test";

import { test, expect, type AdminPage, type ServerInfo } from "../../fixtures/emdash-browser";

const VISUAL_ENABLED = process.env.EMDASH_VISUAL === "1";

const FREEZE_CSS = `
	*, *::before, *::after {
		animation-duration: 0s !important;
		animation-delay: 0s !important;
		transition-duration: 0s !important;
		transition-delay: 0s !important;
		caret-color: transparent !important;
		scroll-behavior: auto !important;
	}
	[data-testid="activity-time"] {
		inline-size: 6rem !important;
		overflow: hidden !important;
	}
`;

const LOCALES = [
	{ name: "ltr", code: "en", dir: "ltr" },
	{ name: "rtl", code: "ar", dir: "rtl" },
] as const;

interface PageCase {
	name: string;
	path: (info: ServerInfo) => string;
	viewport?: { width: number; height: number };
	fixedTime?: string;
	extraMasks?: (admin: AdminPage) => Locator[];
	prepare?: (admin: AdminPage) => Promise<void>;
}

function openFilter(trigger: string, popup: string): (admin: AdminPage) => Promise<void> {
	return async (admin) => {
		await admin.page.locator(trigger).click();
		await admin.page.locator(popup).waitFor({ state: "visible" });
	};
}

const PAGES: PageCase[] = [
	{
		name: "dashboard",
		path: () => "/",
		extraMasks: (admin) => [admin.page.getByTestId("activity-time")],
	},
	{
		name: "content-list",
		path: () => "/content/posts",
		extraMasks: (admin) => [admin.page.getByTestId("content-updated")],
	},
	{
		name: "content-list-status-filter",
		path: () => "/content/posts",
		prepare: openFilter(".emdash-status-filter-trigger", '[role="listbox"]:visible'),
		extraMasks: (admin) => [admin.page.getByTestId("content-updated")],
	},
	{
		name: "content-list-date-field-filter",
		path: () => "/content/posts",
		prepare: openFilter(".emdash-date-field-filter-trigger", '[role="listbox"]:visible'),
		extraMasks: (admin) => [admin.page.getByTestId("content-updated")],
	},
	{
		name: "content-list-byline-filter",
		path: () => "/content/posts",
		prepare: openFilter(".emdash-byline-filter-trigger", ".kumo-popover-popup:visible"),
		extraMasks: (admin) => [admin.page.getByTestId("content-updated")],
	},
	{
		name: "content-list-date-range-filter",
		path: () => "/content/posts",
		fixedTime: "2026-08-27T12:00:00",
		prepare: openFilter(".emdash-date-range-trigger", ".kumo-popover-popup:visible"),
		extraMasks: (admin) => [admin.page.getByTestId("content-updated")],
	},
	{
		name: "content-editor",
		path: (info) => `/content/posts/${info.contentIds.posts[0]}`,
		extraMasks: (admin) => [
			admin.page.locator('input[type="datetime-local"]'),
			admin.page.getByTestId("content-timestamps"),
		],
	},
	{ name: "content-new", path: () => "/content/posts/new" },
	{ name: "media", path: () => "/media" },
	{ name: "media-mobile", path: () => "/media", viewport: { width: 320, height: 800 } },
	{ name: "menus", path: () => "/menus" },
	{ name: "settings", path: () => "/settings" },
];

async function setLocale(admin: AdminPage, code: string): Promise<void> {
	await admin.page
		.context()
		.addCookies([{ name: "emdash-locale", value: code, domain: "localhost", path: "/_emdash" }]);
}

async function openAdmin(admin: AdminPage, path: string, dir: string): Promise<void> {
	await admin.goto(path);
	await admin.page.waitForSelector("astro-island:not([ssr])", { timeout: 30000 });
	await admin.page.locator("main").first().waitFor({ state: "visible", timeout: 30000 });
	await expect(admin.page.locator("html")).toHaveAttribute("dir", dir);
	await admin.waitForLoading();
}

async function stabilize(admin: AdminPage): Promise<void> {
	await admin.page.addStyleTag({ content: FREEZE_CSS });
	await admin.page.evaluate(() => {
		const active = document.activeElement;
		if (active instanceof HTMLElement && active !== document.body) {
			active.blur();
		}
	});
	await admin.page.evaluate(async () => {
		await document.fonts.ready;
	});
}

test.describe("visual regression", () => {
	test.skip(!VISUAL_ENABLED, "Set EMDASH_VISUAL=1 to run visual regression snapshots");

	test.use({ reducedMotion: "reduce" });

	test.beforeEach(async ({ admin }) => {
		await admin.devBypassAuth();
	});

	for (const locale of LOCALES) {
		for (const pageCase of PAGES) {
			test(`${pageCase.name} @${locale.name}`, async ({ admin, serverInfo }) => {
				await setLocale(admin, locale.code);
				if (pageCase.viewport) await admin.page.setViewportSize(pageCase.viewport);
				if (pageCase.fixedTime) await admin.page.clock.setFixedTime(pageCase.fixedTime);
				await openAdmin(admin, pageCase.path(serverInfo), locale.dir);
				await stabilize(admin);
				await pageCase.prepare?.(admin);

				await expect(admin.page).toHaveScreenshot(`${pageCase.name}-${locale.name}.png`, {
					fullPage: true,
					animations: "disabled",
					mask: [admin.page.getByTestId("admin-version"), ...(pageCase.extraMasks?.(admin) ?? [])],
				});
			});
		}
	}
});
