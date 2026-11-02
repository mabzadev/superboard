import { test, expect } from "../../fixtures/emdash-browser";

const MEDIA_URL_PATTERN = /\/media/;
const CONTENT_POSTS_URL_PATTERN = /\/content\/posts\//;

const MOD_KEY = process.platform === "darwin" ? "Meta" : "Control";

async function apiRequest(
	serverInfo: { baseUrl: string; token: string },
	method: string,
	path: string,
	body?: unknown,
): Promise<Response> {
	const headers: Record<string, string> = {
		Authorization: `Bearer ${serverInfo.token}`,
		"X-EmDash-Request": "1",
		Origin: serverInfo.baseUrl,
	};
	if (body !== undefined) {
		headers["Content-Type"] = "application/json";
	}
	return fetch(`${serverInfo.baseUrl}${path}`, {
		method,
		headers,
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
}

async function markFieldSearchable(
	serverInfo: { baseUrl: string; token: string },
	collection: string,
	fieldSlug: string,
): Promise<void> {
	await apiRequest(
		serverInfo,
		"PUT",
		`/_emdash/api/schema/collections/${collection}/fields/${fieldSlug}`,
		{ searchable: true },
	);
}

async function enableSearch(
	serverInfo: { baseUrl: string; token: string },
	collection: string,
): Promise<void> {
	await markFieldSearchable(serverInfo, collection, "title");

	const res = await apiRequest(serverInfo, "POST", "/_emdash/api/search/enable", {
		collection,
		enabled: true,
	});
	if (!res.ok && res.status !== 400 && res.status !== 409) {
		const text = await res.text().catch(() => "");
		throw new Error(`Failed to enable search for ${collection} (${res.status}): ${text}`);
	}
}

test.describe("Search", () => {
	test.beforeEach(async ({ admin }) => {
		await admin.devBypassAuth();
	});

	test.describe("Command Palette", () => {
		test("opens with Cmd+K keyboard shortcut", async ({ admin, page }) => {
			await admin.goToDashboard();

			await page.keyboard.press(`${MOD_KEY}+k`);

			const input = page.getByPlaceholder("Search pages and content...");
			await expect(input).toBeVisible({ timeout: 5000 });
		});

		test("closes with Escape", async ({ admin, page }) => {
			await admin.goToDashboard();

			await page.keyboard.press(`${MOD_KEY}+k`);
			const input = page.getByPlaceholder("Search pages and content...");
			await expect(input).toBeVisible({ timeout: 5000 });

			await page.keyboard.press("Escape");
			await expect(input).not.toBeVisible({ timeout: 3000 });
		});

		test("shows navigation items by default", async ({ admin, page }) => {
			await admin.goToDashboard();

			await page.keyboard.press(`${MOD_KEY}+k`);
			const input = page.getByPlaceholder("Search pages and content...");
			await expect(input).toBeVisible({ timeout: 5000 });

			const dialog = page.locator('[role="dialog"]');
			await expect(dialog.getByText("Dashboard")).toBeVisible({ timeout: 5000 });
			await expect(dialog.getByText("Media")).toBeVisible();
		});

		test("filters navigation items when typing", async ({ admin, page }) => {
			await admin.goToDashboard();

			await page.keyboard.press(`${MOD_KEY}+k`);
			const input = page.getByPlaceholder("Search pages and content...");
			await expect(input).toBeVisible({ timeout: 5000 });

			await input.fill("sett");

			await expect(page.getByText("Settings")).toBeVisible({ timeout: 5000 });
		});

		test("shows empty state for no matches", async ({ admin, page }) => {
			await admin.goToDashboard();

			await page.keyboard.press(`${MOD_KEY}+k`);
			const input = page.getByPlaceholder("Search pages and content...");
			await expect(input).toBeVisible({ timeout: 5000 });

			await input.fill("zzzznonexistentxyzzy");

			await expect(page.getByText("No results found")).toBeVisible({ timeout: 10000 });
		});

		test("navigates to a page when selecting a nav item", async ({ admin, page }) => {
			await admin.goToDashboard();

			await page.keyboard.press(`${MOD_KEY}+k`);
			const input = page.getByPlaceholder("Search pages and content...");
			await expect(input).toBeVisible({ timeout: 5000 });

			await input.fill("media");

			const mediaItem = page.getByText("Media Library");
			await expect(mediaItem).toBeVisible({ timeout: 5000 });
			await mediaItem.click();

			await expect(page).toHaveURL(MEDIA_URL_PATTERN, { timeout: 10000 });
		});
	});

	test.describe("Search API", () => {
		test("search endpoint is publicly accessible", async ({ serverInfo }) => {
			const res = await fetch(`${serverInfo.baseUrl}/_emdash/api/search?q=test`);
			expect(res.status).toBe(200);
		});

		test("search admin endpoints still require authentication", async ({ serverInfo }) => {
			const stats = await fetch(`${serverInfo.baseUrl}/_emdash/api/search/stats`);
			expect([401, 403]).toContain(stats.status);

			const enable = await fetch(`${serverInfo.baseUrl}/_emdash/api/search/enable`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ collection: "posts" }),
			});
			expect([401, 403]).toContain(enable.status);
		});

		test("search endpoint requires a query parameter", async ({ serverInfo }) => {
			const res = await apiRequest(serverInfo, "GET", "/_emdash/api/search");
			expect(res.status).toBe(400);
		});

		test("search returns results after enabling search", async ({ serverInfo }) => {
			await enableSearch(serverInfo, "posts");

			await apiRequest(serverInfo, "POST", "/_emdash/api/search/rebuild", {
				collection: "posts",
			});

			const res = await apiRequest(serverInfo, "GET", "/_emdash/api/search?q=First&limit=10");
			expect(res.status).toBe(200);

			const body = await res.json();
			expect(body.data).toBeDefined();
			expect(body.data.items).toBeInstanceOf(Array);

			const titles = body.data.items.map((item: any) => item.title);
			expect(titles).toContain("First Post");
		});

		test("search filters by collection", async ({ serverInfo }) => {
			await enableSearch(serverInfo, "posts");

			const res = await apiRequest(
				serverInfo,
				"GET",
				"/_emdash/api/search?q=Post&collections=posts&limit=20",
			);
			expect(res.status).toBe(200);

			const body = await res.json();
			const items = body.data.items;

			for (const item of items) {
				expect(item.collection).toBe("posts");
			}
		});

		test("search returns empty for non-matching query", async ({ serverInfo }) => {
			await enableSearch(serverInfo, "posts");

			const res = await apiRequest(
				serverInfo,
				"GET",
				"/_emdash/api/search?q=zzzznonexistentxyzzy&limit=10",
			);
			expect(res.status).toBe(200);

			const body = await res.json();
			expect(body.data.items).toHaveLength(0);
		});

		test("search respects limit parameter", async ({ serverInfo }) => {
			await enableSearch(serverInfo, "posts");

			const res = await apiRequest(serverInfo, "GET", "/_emdash/api/search?q=Post&limit=2");
			expect(res.status).toBe(200);

			const body = await res.json();
			expect(body.data.items.length).toBeLessThanOrEqual(2);
		});
	});

	test.describe("Search Suggestions API", () => {
		test.fixme("returns suggestions for partial queries", async ({ serverInfo }) => {
			await enableSearch(serverInfo, "posts");

			const res = await apiRequest(serverInfo, "GET", "/_emdash/api/search/suggest?q=Fir&limit=5");
			expect(res.status).toBe(200);

			const body = await res.json();
			expect(body.data).toBeDefined();
			expect(body.data.items).toBeInstanceOf(Array);
		});

		test("suggestions require a query parameter", async ({ serverInfo }) => {
			const res = await apiRequest(serverInfo, "GET", "/_emdash/api/search/suggest");
			expect(res.status).toBe(400);
		});
	});

	test.describe("Search Stats API", () => {
		test("returns search index statistics", async ({ serverInfo }) => {
			await enableSearch(serverInfo, "posts");

			const res = await apiRequest(serverInfo, "GET", "/_emdash/api/search/stats");
			expect(res.status).toBe(200);

			const body = await res.json();
			expect(body.data).toBeDefined();
		});
	});

	test.describe("Search Enable/Disable API", () => {
		test("enables search for a collection", async ({ serverInfo }) => {
			const res = await apiRequest(serverInfo, "POST", "/_emdash/api/search/enable", {
				collection: "pages",
				enabled: true,
			});
			expect(res.status).toBeLessThan(500);
		});

		test("disables search for a collection", async ({ serverInfo }) => {
			await enableSearch(serverInfo, "pages");

			const res = await apiRequest(serverInfo, "POST", "/_emdash/api/search/enable", {
				collection: "pages",
				enabled: false,
			});
			expect(res.status).toBe(200);

			const body = await res.json();
			expect(body.data.enabled).toBe(false);
		});

		test("enable requires collection name", async ({ serverInfo }) => {
			const res = await apiRequest(serverInfo, "POST", "/_emdash/api/search/enable", {
				enabled: true,
			});
			expect(res.status).toBe(400);
		});
	});

	test.describe("Search Rebuild API", () => {
		test("rebuilds the index for a collection", async ({ serverInfo }) => {
			await enableSearch(serverInfo, "posts");

			const res = await apiRequest(serverInfo, "POST", "/_emdash/api/search/rebuild", {
				collection: "posts",
			});
			expect(res.status).toBe(200);

			const body = await res.json();
			expect(typeof body.data.indexed).toBe("number");
		});

		test("rebuild fails for collection without search enabled", async ({ serverInfo }) => {
			await apiRequest(serverInfo, "POST", "/_emdash/api/search/enable", {
				collection: "pages",
				enabled: false,
			});

			const res = await apiRequest(serverInfo, "POST", "/_emdash/api/search/rebuild", {
				collection: "pages",
			});
			expect(res.status).toBe(400);

			const body = await res.json();
			expect(body.error).toBeDefined();
		});
	});

	test.describe("Command Palette Content Search", () => {
		test.fixme("shows content results when searching with enabled collections", async ({
			admin,
			page,
			serverInfo,
		}) => {
			await enableSearch(serverInfo, "posts");
			await apiRequest(serverInfo, "POST", "/_emdash/api/search/rebuild", {
				collection: "posts",
			});

			await admin.goToDashboard();

			await page.keyboard.press(`${MOD_KEY}+k`);
			const input = page.getByPlaceholder("Search pages and content...");
			await expect(input).toBeVisible({ timeout: 5000 });

			await input.fill("First Post");

			await expect(page.getByText("Content")).toBeVisible({ timeout: 10000 });

			const contentResult = page
				.locator("[class*='ResultItem']", { hasText: "First Post" })
				.or(page.getByText("First Post").last());
			await expect(contentResult).toBeVisible({ timeout: 5000 });
		});

		test.fixme("navigates to content editor when selecting a content result", async ({
			admin,
			page,
			serverInfo,
		}) => {
			await enableSearch(serverInfo, "posts");
			await apiRequest(serverInfo, "POST", "/_emdash/api/search/rebuild", {
				collection: "posts",
			});

			await admin.goToDashboard();

			await page.keyboard.press(`${MOD_KEY}+k`);
			const input = page.getByPlaceholder("Search pages and content...");
			await expect(input).toBeVisible({ timeout: 5000 });

			await input.fill("Second Post");

			await expect(page.getByText("Content")).toBeVisible({ timeout: 10000 });

			await page.waitForTimeout(500);

			const secondPost = page.getByText("Second Post").last();
			await expect(secondPost).toBeVisible({ timeout: 5000 });
			await secondPost.click();

			await expect(page).toHaveURL(CONTENT_POSTS_URL_PATTERN, { timeout: 10000 });
		});
	});
});
