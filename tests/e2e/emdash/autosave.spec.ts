import { test, expect } from "../../fixtures/emdash-browser";

test.describe("Autosave", () => {
	let collectionSlug: string;
	let postId: string;
	let headers: Record<string, string>;
	let baseUrl: string;

	test.beforeEach(async ({ admin, serverInfo }) => {
		await admin.devBypassAuth();

		baseUrl = serverInfo.baseUrl;
		headers = {
			"Content-Type": "application/json",
			Authorization: `Bearer ${serverInfo.token}`,
			"X-EmDash-Request": "1",
			Origin: baseUrl,
		};

		collectionSlug = `autosave_${Date.now()}`;
		await fetch(`${baseUrl}/_emdash/api/schema/collections`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				slug: collectionSlug,
				label: "Autosave Test",
				labelSingular: "Autosave Test",
				supports: ["revisions", "drafts"],
			}),
		});

		await fetch(`${baseUrl}/_emdash/api/schema/collections/${collectionSlug}/fields`, {
			method: "POST",
			headers,
			body: JSON.stringify({ slug: "title", type: "string", label: "Title", required: true }),
		});

		const createRes = await fetch(`${baseUrl}/_emdash/api/content/${collectionSlug}`, {
			method: "POST",
			headers,
			body: JSON.stringify({ data: { title: "Original" }, slug: "autosave-test" }),
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

	test("multiple autosaves update draft in place instead of creating new revisions", async ({
		admin,
	}) => {
		const contentUrl = `/_emdash/api/content/${collectionSlug}/${postId}`;
		const isPut = (res: any) => res.url().includes(contentUrl) && res.request().method() === "PUT";
		const isGet = (res: any) =>
			res.url().includes(contentUrl) &&
			!res.url().includes("/revisions") &&
			res.request().method() === "GET";

		await admin.goToEditContent(collectionSlug, postId);
		await admin.waitForLoading();

		const titleInput = admin.page.locator("#field-title");
		await expect(titleInput).toHaveValue("Original");

		const firstPut = admin.page.waitForResponse(isPut, { timeout: 10000 });
		await titleInput.fill("Edit One");
		await firstPut;

		const refetchGet = admin.page.waitForResponse(isGet, { timeout: 5000 }).catch(() => {});
		await refetchGet;
		await admin.page.waitForTimeout(500);

		const res1 = await fetch(
			`${baseUrl}/_emdash/api/content/${collectionSlug}/${postId}/revisions`,
			{ headers },
		);
		const data1: any = await res1.json();
		const countAfterFirst = data1.data.total;

		const secondPut = admin.page.waitForResponse(isPut, { timeout: 10000 });
		await titleInput.fill("Edit Two");
		await secondPut;

		const res2 = await fetch(
			`${baseUrl}/_emdash/api/content/${collectionSlug}/${postId}/revisions`,
			{ headers },
		);
		const data2: any = await res2.json();
		const countAfterSecond = data2.data.total;

		expect(countAfterSecond).toBe(countAfterFirst);

		const latestRevision = data2.data.items?.[0];
		expect(latestRevision?.data?.title).toBe("Edit Two");
	});
});
