import { Toasty } from "@cloudflare/kumo";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import * as React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { ThemeProvider } from "../../../../packages/admin/src/components/ThemeProvider";
import type { AdminManifest } from "../../../../packages/admin/src/lib/api";
import { createAdminRouter } from "../../../../packages/admin/src/router";
import { render } from "./utils/render.tsx";
import { createTestQueryClient, createMockFetch, waitFor } from "./utils/test-helpers";

const MANIFEST: AdminManifest = {
	version: "1.0.0",
	hash: "abc123",
	authMode: "passkey",
	collections: {
		posts: {
			label: "Posts",
			labelSingular: "Post",
			supports: ["drafts"],
			hasSeo: false,
			fields: {
				title: { kind: "string", label: "Title" },
			},
		},
	},
	plugins: {},
	taxonomies: [],
	i18n: undefined,
};

function publishedWithChanges() {
	return {
		id: "post_1",
		type: "posts",
		slug: "published-slug",
		status: "published",
		locale: "en",
		translationGroup: null,
		data: { title: "Published Title" },
		authorId: null,
		primaryBylineId: null,
		createdAt: "2025-01-01T00:00:00Z",
		updatedAt: "2025-01-01T00:00:00Z",
		publishedAt: "2025-01-01T00:00:00Z",
		scheduledAt: null,
		liveRevisionId: "rev_live",
		draftRevisionId: "rev_draft",
	};
}

function publishedNoChanges() {
	return {
		...publishedWithChanges(),
		updatedAt: "2025-01-02T00:00:00Z",
		publishedAt: "2025-01-02T00:00:00Z",
		liveRevisionId: "rev_draft",
		draftRevisionId: "rev_draft",
	};
}

function buildRouter() {
	const queryClient = createTestQueryClient();
	const router = createAdminRouter(queryClient);
	if (!i18n.locale) {
		i18n.loadAndActivate({ locale: "en", messages: {} });
	}
	function TestApp() {
		return (
			<I18nProvider i18n={i18n}>
				<ThemeProvider defaultTheme="light">
					<Toasty>
						<QueryClientProvider client={queryClient}>
							<RouterProvider router={router} />
						</QueryClientProvider>
					</Toasty>
				</ThemeProvider>
			</I18nProvider>
		);
	}
	return { router, queryClient, TestApp };
}

describe("ContentEditPage – publish button stays in sync after publishing (#1557)", () => {
	let mockFetch: ReturnType<typeof createMockFetch>;

	beforeEach(() => {
		mockFetch = createMockFetch();

		mockFetch
			.on("GET", "/_emdash/api/manifest", { data: MANIFEST })
			.on("GET", "/_emdash/api/auth/me", { data: { id: "user_01", role: 30 } })
			.on("GET", "/_emdash/api/bylines", { data: { items: [] } })
			.on("GET", "/_emdash/api/users", { data: { items: [] } })
			.on("GET", "/_emdash/api/content/posts/post_1", { data: { item: publishedWithChanges() } })
			.on("GET", "/_emdash/api/revisions/rev_draft", {
				data: {
					item: {
						id: "rev_draft",
						collection: "posts",
						entryId: "post_1",
						data: { title: "Draft Title" },
						authorId: null,
						createdAt: "2025-01-01T00:00:00Z",
					},
				},
			})
			.on("POST", "/_emdash/api/content/posts/post_1/publish", {
				data: { item: publishedNoChanges() },
			});
	});

	afterEach(() => {
		mockFetch.restore();
	});

	it("flips 'Publish' to 'Unpublish Post' after a successful publish", async () => {
		const { router, TestApp } = buildRouter();

		await router.navigate({
			to: "/content/$collection/$id",
			params: { collection: "posts", id: "post_1" },
		});

		const screen = await render(<TestApp />);

		const publishBtn = screen.getByRole("button", { name: "Publish", exact: true });
		await expect.element(publishBtn).toBeInTheDocument();

		mockFetch.on("GET", "/_emdash/api/content/posts/post_1", {
			data: { item: publishedNoChanges() },
		});

		await publishBtn.click();

		await waitFor(() => {
			expect(document.body.textContent).toContain("Content is now live");
		});

		await expect
			.element(screen.getByRole("button", { name: "Unpublish Post" }))
			.toBeInTheDocument();
	});
});

function publishedClean() {
	return {
		id: "post_1",
		type: "posts",
		slug: "published-slug",
		status: "published",
		locale: "en",
		translationGroup: null,
		data: { title: "Published Title" },
		authorId: null,
		primaryBylineId: null,
		createdAt: "2025-01-01T00:00:00Z",
		updatedAt: "2025-01-01T00:00:00Z",
		publishedAt: "2025-01-01T00:00:00Z",
		scheduledAt: null,
		liveRevisionId: "rev_1",
		draftRevisionId: "rev_1",
	};
}

function publishedDirty() {
	return {
		...publishedClean(),
		updatedAt: "2025-01-02T00:00:00Z",
		draftRevisionId: "rev_2",
	};
}

describe("ContentEditPage – publish button appears after saving an edit (#1557)", () => {
	let mockFetch: ReturnType<typeof createMockFetch>;

	beforeEach(() => {
		mockFetch = createMockFetch();

		mockFetch
			.on("GET", "/_emdash/api/manifest", { data: MANIFEST })
			.on("GET", "/_emdash/api/auth/me", { data: { id: "user_01", role: 30 } })
			.on("GET", "/_emdash/api/bylines", { data: { items: [] } })
			.on("GET", "/_emdash/api/users", { data: { items: [] } })
			.on("GET", "/_emdash/api/content/posts/post_1", { data: { item: publishedClean() } })
			.on("GET", "/_emdash/api/revisions/rev_1", {
				data: {
					item: {
						id: "rev_1",
						collection: "posts",
						entryId: "post_1",
						data: { title: "Published Title" },
						authorId: null,
						createdAt: "2025-01-01T00:00:00Z",
					},
				},
			})
			.on("GET", "/_emdash/api/revisions/rev_2", {
				data: {
					item: {
						id: "rev_2",
						collection: "posts",
						entryId: "post_1",
						data: { title: "Published Title edited" },
						authorId: null,
						createdAt: "2025-01-02T00:00:00Z",
					},
				},
			})
			.on("PUT", "/_emdash/api/content/posts/post_1", { data: { item: publishedClean() } });
	});

	afterEach(() => {
		mockFetch.restore();
	});

	it("shows 'Publish' after editing the title and saving", async () => {
		const { router, TestApp } = buildRouter();

		await router.navigate({
			to: "/content/$collection/$id",
			params: { collection: "posts", id: "post_1" },
		});

		const screen = await render(<TestApp />);

		await expect
			.element(screen.getByRole("button", { name: "Unpublish Post" }))
			.toBeInTheDocument();

		const titleInput = screen.getByRole("textbox", { name: "Title" });
		await titleInput.fill("Published Title edited");

		mockFetch.on("GET", "/_emdash/api/content/posts/post_1", { data: { item: publishedDirty() } });

		await screen.getByRole("button", { name: "Save", exact: true }).first().click();

		await expect
			.element(screen.getByRole("button", { name: "Publish", exact: true }))
			.toBeInTheDocument();
	});
});

describe("ContentEditPage – publish button appears after an autosave", () => {
	let mockFetch: ReturnType<typeof createMockFetch>;

	beforeEach(() => {
		mockFetch = createMockFetch();

		mockFetch
			.on("GET", "/_emdash/api/manifest", { data: MANIFEST })
			.on("GET", "/_emdash/api/auth/me", { data: { id: "user_01", role: 30 } })
			.on("GET", "/_emdash/api/bylines", { data: { items: [] } })
			.on("GET", "/_emdash/api/users", { data: { items: [] } })
			.on("GET", "/_emdash/api/content/posts/post_1", { data: { item: publishedClean() } })
			.on("GET", "/_emdash/api/revisions/rev_1", {
				data: {
					item: {
						id: "rev_1",
						collection: "posts",
						entryId: "post_1",
						data: { title: "Published Title" },
						authorId: null,
						createdAt: "2025-01-01T00:00:00Z",
					},
				},
			})
			.on("GET", "/_emdash/api/revisions/rev_2", {
				data: {
					item: {
						id: "rev_2",
						collection: "posts",
						entryId: "post_1",
						data: { title: "Published Title edited" },
						authorId: null,
						createdAt: "2025-01-02T00:00:00Z",
					},
				},
			})
			.on("PUT", "/_emdash/api/content/posts/post_1?locale=en", {
				data: { item: publishedDirty() },
			});
	});

	afterEach(() => {
		mockFetch.restore();
	});

	it("shows 'Publish' after editing the title and letting autosave fire", async () => {
		const { router, TestApp } = buildRouter();

		await router.navigate({
			to: "/content/$collection/$id",
			params: { collection: "posts", id: "post_1" },
		});

		const screen = await render(<TestApp />);

		await expect
			.element(screen.getByRole("button", { name: "Unpublish Post" }))
			.toBeInTheDocument();

		const titleInput = screen.getByRole("textbox", { name: "Title" });
		await titleInput.fill("Published Title edited");

		await expect
			.element(screen.getByRole("button", { name: "Publish", exact: true }), { timeout: 8000 })
			.toBeInTheDocument();
	});
});
