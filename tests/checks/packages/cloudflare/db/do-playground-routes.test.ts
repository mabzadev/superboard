import { describe, it, expect } from "vitest";

import { isBlockedInPlayground } from "../../../../../packages/cloudflare/src/db/do-playground-routes.js";

describe("isBlockedInPlayground", () => {
	describe("blocked routes", () => {
		it.each([
			"/_emdash/api/auth/",
			"/_emdash/api/auth/passkey/options",
			"/_emdash/api/auth/passkey/verify",
			"/_emdash/api/auth/dev-bypass",
			"/_emdash/api/auth/magic-link/send",
			"/_emdash/api/auth/logout",
			"/_emdash/api/setup/",
			"/_emdash/api/setup/status",
			"/_emdash/api/setup/admin",
			"/_emdash/api/setup/dev-bypass",
			"/_emdash/api/oauth/",
			"/_emdash/api/oauth/authorize",
			"/_emdash/api/oauth/token",
			"/_emdash/api/tokens/",
			"/_emdash/api/tokens/abc123",
			"/_emdash/api/users/invite",
			"/_emdash/api/plugins/install",
			"/_emdash/api/plugins/marketplace",
			"/_emdash/api/plugins/marketplace/featured",
			"/_emdash/api/media/upload",
			"/_emdash/api/snapshot",
			"/_emdash/api/snapshot?drafts=true",
		])("blocks %s", (path: string) => {
			expect(isBlockedInPlayground(path)).toBe(true);
		});
	});

	describe("allowed routes", () => {
		it.each([
			"/",
			"/blog/my-post",
			"/about",
			"/sitemap.xml",
			"/_emdash/admin",
			"/_emdash/admin/content",
			"/_emdash/admin/content/posts",
			"/_emdash/admin/settings",
			"/_emdash/admin/media",
			"/_emdash/admin/schema",
			"/_emdash/api/auth/me",
			"/_emdash/api/content/posts",
			"/_emdash/api/content/posts/abc123",
			"/_emdash/api/schema",
			"/_emdash/api/schema/collections",
			"/_emdash/api/schema/collections/posts/fields",
			"/_emdash/api/taxonomies",
			"/_emdash/api/taxonomies/category/terms",
			"/_emdash/api/menus",
			"/_emdash/api/menus/primary/items",
			"/_emdash/api/widgets",
			"/_emdash/api/search",
			"/_emdash/api/search/suggest",
			"/_emdash/api/settings",
			"/_emdash/api/dashboard",
			"/_emdash/api/manifest",
			"/_emdash/api/media",
			"/_emdash/api/media/abc123",
			"/_emdash/api/media/file/image.jpg",
			"/_emdash/api/users",
			"/_emdash/api/users/abc123",
			"/_emdash/api/plugins",
			"/_emdash/api/plugins/my-plugin",
		])("allows %s", (path: string) => {
			expect(isBlockedInPlayground(path)).toBe(false);
		});
	});
});
