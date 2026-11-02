import { describe, it, expect, beforeAll, afterAll } from "vitest";

import type { TestServerContext } from "../server.js";
import { assertNodeVersion, createTestServer } from "../server.js";

const PORT = 4396;

async function adminFetch(
	ctx: TestServerContext,
	path: string,
	init?: RequestInit,
): Promise<Response> {
	return fetch(`${ctx.baseUrl}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${ctx.token}`,
			"X-EmDash-Request": "1",
			"Content-Type": "application/json",
			...(init?.headers as Record<string, string>),
		},
	});
}

async function fetchHtml(ctx: TestServerContext, path: string): Promise<string> {
	const res = await fetch(`${ctx.baseUrl}${path}`);
	return res.text();
}

async function submitComment(
	ctx: TestServerContext,
	collection: string,
	contentId: string,
	data: {
		authorName: string;
		authorEmail: string;
		body: string;
		parentId?: string;
		website_url?: string;
	},
): Promise<Response> {
	return fetch(
		`${ctx.baseUrl}/_emdash/api/comments/${encodeURIComponent(collection)}/${encodeURIComponent(contentId)}`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: ctx.baseUrl,
			},
			body: JSON.stringify(data),
		},
	);
}

const COMMENT_COUNT_RE = /\d+ Comments/;

describe("Comments Integration", () => {
	let ctx: TestServerContext;

	beforeAll(async () => {
		assertNodeVersion();
		ctx = await createTestServer({ port: PORT });

		const res = await adminFetch(ctx, "/_emdash/api/schema/collections/posts", {
			method: "PUT",
			body: JSON.stringify({
				commentsEnabled: true,
				commentsModeration: "none",
			}),
		});
		if (!res.ok) {
			const body = await res.text().catch(() => "");
			throw new Error(`Failed to enable comments on posts (${res.status}): ${body}`);
		}
	});

	afterAll(async () => {
		await ctx?.cleanup();
	});

	it("renders 'No comments yet' for a post with no comments", async () => {
		const html = await fetchHtml(ctx, "/posts/first-post");
		expect(html).toContain("No comments yet");
		expect(html).toContain("ec-comments");
		expect(html).toContain("ec-comment-form");
	});

	it("renders the comment form with correct fields", async () => {
		const html = await fetchHtml(ctx, "/posts/first-post");
		expect(html).toContain('name="authorName"');
		expect(html).toContain('name="authorEmail"');
		expect(html).toContain('name="body"');
		expect(html).toContain('name="website_url"');
		expect(html).toContain("Post Comment");
	});

	it("submits a comment and renders it with auto-linked URLs and escaped HTML", async () => {
		const postId = ctx.contentIds["posts"]![0]!;

		const res = await submitComment(ctx, "posts", postId, {
			authorName: "Test User",
			authorEmail: "test@example.com",
			body: 'Check https://example.com and <script>alert("xss")</script>',
		});

		expect(res.status).toBe(201);
		const json = (await res.json()) as { data: { id: string; status: string; message: string } };
		expect(json.data.id).toBeDefined();
		expect(json.data.status).toBe("approved");
		expect(json.data.message).toBe("Comment published");

		const html = await fetchHtml(ctx, "/posts/first-post");
		expect(html).toContain("Test User");
		expect(html).not.toContain("No comments yet");

		expect(html).toContain('href="https://example.com"');
		expect(html).toContain('rel="nofollow ugc noopener"');

		expect(html).toContain("&lt;script&gt;");
		expect(html).not.toContain('<script>alert("xss")</script>');
	});

	it("silently accepts honeypot submissions", async () => {
		const postId = ctx.contentIds["posts"]![0]!;
		const res = await submitComment(ctx, "posts", postId, {
			authorName: "Bot",
			authorEmail: "bot@spam.com",
			body: "Buy cheap pills",
			website_url: "http://spam.com",
		});

		expect(res.status).toBe(200);
		const json = (await res.json()) as { data: { status: string; message: string } };
		expect(json.data.status).toBe("pending");
	});

	it("rejects comments when collection has comments disabled", async () => {
		const pageId = ctx.contentIds["pages"]![0]!;
		const res = await submitComment(ctx, "pages", pageId, {
			authorName: "Test",
			authorEmail: "test@example.com",
			body: "Should fail",
		});

		expect(res.status).toBe(403);
		const data = (await res.json()) as { error: { code: string } };
		expect(data.error.code).toBe("COMMENTS_DISABLED");
	});

	it("returns validation error for missing required fields", async () => {
		const postId = ctx.contentIds["posts"]![0]!;
		const res = await fetch(`${ctx.baseUrl}/_emdash/api/comments/posts/${postId}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: ctx.baseUrl,
			},
			body: JSON.stringify({ authorName: "Test" }),
		});

		expect(res.status).toBe(400);
	});

	it("lists approved comments via the public GET API", async () => {
		const postId = ctx.contentIds["posts"]![0]!;
		const res = await fetch(`${ctx.baseUrl}/_emdash/api/comments/posts/${postId}`);

		expect(res.ok).toBe(true);
		const json = (await res.json()) as { data: { items: { authorName: string; body: string }[] } };
		expect(Array.isArray(json.data.items)).toBe(true);
		expect(json.data.items.length).toBeGreaterThan(0);
	});

	it("submits and renders threaded replies", async () => {
		const postId = ctx.contentIds["posts"]![1]!;

		const rootRes = await submitComment(ctx, "posts", postId, {
			authorName: "Thread Root",
			authorEmail: "root@example.com",
			body: "Root comment for threading test",
		});
		expect(rootRes.status).toBe(201);
		const rootJson = (await rootRes.json()) as { data: { id: string } };

		const replyRes = await submitComment(ctx, "posts", postId, {
			authorName: "Thread Reply",
			authorEmail: "reply@example.com",
			body: "Reply to root comment",
			parentId: rootJson.data.id,
		});
		expect(replyRes.status).toBe(201);

		const html = await fetchHtml(ctx, "/posts/second-post");
		expect(html).toContain("Thread Root");
		expect(html).toContain("Thread Reply");
		expect(html).toContain("ec-comment-replies");
	});

	it("holds comments for moderation and allows admin approval", async () => {
		const updateRes = await adminFetch(ctx, "/_emdash/api/schema/collections/posts", {
			method: "PUT",
			body: JSON.stringify({ commentsModeration: "all" }),
		});
		expect(updateRes.ok).toBe(true);

		const postId = ctx.contentIds["posts"]![1]!;

		const submitRes = await submitComment(ctx, "posts", postId, {
			authorName: "Pending Author",
			authorEmail: "pending@example.com",
			body: "This needs approval",
		});
		expect(submitRes.status).toBe(201);
		const submitJson = (await submitRes.json()) as { data: { id: string; status: string } };
		expect(submitJson.data.status).toBe("pending");

		const htmlBefore = await fetchHtml(ctx, "/posts/second-post");
		expect(htmlBefore).not.toContain("This needs approval");

		const approveRes = await adminFetch(
			ctx,
			`/_emdash/api/admin/comments/${submitJson.data.id}/status`,
			{
				method: "PUT",
				body: JSON.stringify({ status: "approved" }),
			},
		);
		expect(approveRes.ok).toBe(true);

		const htmlAfter = await fetchHtml(ctx, "/posts/second-post");
		expect(htmlAfter).toContain("This needs approval");
		expect(htmlAfter).toContain("Pending Author");

		await adminFetch(ctx, "/_emdash/api/schema/collections/posts", {
			method: "PUT",
			body: JSON.stringify({ commentsModeration: "none" }),
		});
	});

	it("updates the comment count heading as comments are added", async () => {
		const html = await fetchHtml(ctx, "/posts/second-post");
		expect(html).toMatch(COMMENT_COUNT_RE);
	});

	it("lists comments in the admin inbox", async () => {
		const res = await adminFetch(ctx, "/_emdash/api/admin/comments?status=approved");
		expect(res.ok).toBe(true);
		const json = (await res.json()) as { data: { items: { id: string; status: string }[] } };
		expect(Array.isArray(json.data.items)).toBe(true);
		expect(json.data.items.length).toBeGreaterThan(0);
	});

	it("filters admin inbox by status", async () => {
		const res = await adminFetch(ctx, "/_emdash/api/admin/comments?status=approved");
		expect(res.ok).toBe(true);
		const json = (await res.json()) as { data: { items: { status: string }[] } };
		for (const item of json.data.items) {
			expect(item.status).toBe("approved");
		}
	});

	it("returns 404 for comments on nonexistent collection", async () => {
		const res = await fetch(`${ctx.baseUrl}/_emdash/api/comments/nonexistent/some-id`);
		expect(res.status).toBe(404);
	});

	it("returns 404 for comments on nonexistent content", async () => {
		const res = await submitComment(ctx, "posts", "nonexistent-id", {
			authorName: "Test",
			authorEmail: "test@example.com",
			body: "Should fail",
		});
		expect([404, 429]).toContain(res.status);
	});

	it("returns 400 for reply to nonexistent parent", async () => {
		const postId = ctx.contentIds["posts"]![0]!;
		const res = await submitComment(ctx, "posts", postId, {
			authorName: "Test",
			authorEmail: "test@example.com",
			body: "Orphan reply",
			parentId: "nonexistent-parent-id",
		});
		expect([400, 429]).toContain(res.status);
	});
});
