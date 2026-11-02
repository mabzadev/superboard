import { createReadStream, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { gutenbergToPortableText } from "@emdash-cms/gutenberg-to-portable-text";
import { describe, it, expect, beforeAll } from "vitest";

import { parseWxr } from "../../../../../../packages/core/src/cli/wxr/parser.js";

const PARAGRAPH_WITH_TEXT_REGEX = /<p[^>]*>[^<]+<\/p>/;

const TEST_DATA_PATH = join(tmpdir(), "emdash-theme-unit-test", "themeunittestdata.wordpress.xml");

const TEST_DATA_URL =
	"https://raw.githubusercontent.com/WordPress/theme-test-data/master/themeunittestdata.wordpress.xml";

async function ensureTestData(): Promise<void> {
	if (existsSync(TEST_DATA_PATH)) return;

	console.log(`Downloading WordPress theme unit test data from ${TEST_DATA_URL}...`);
	const response = await fetch(TEST_DATA_URL);
	if (!response.ok) {
		throw new Error(`Failed to download test data: ${response.status} ${response.statusText}`);
	}
	const data = await response.text();
	await mkdir(dirname(TEST_DATA_PATH), { recursive: true });
	await writeFile(TEST_DATA_PATH, data, "utf-8");
	console.log(`Downloaded to ${TEST_DATA_PATH}`);
}

describe("WordPress Theme Unit Test Migration", () => {
	let wxrData: Awaited<ReturnType<typeof parseWxr>>;

	beforeAll(async () => {
		await ensureTestData();
		const stream = createReadStream(TEST_DATA_PATH, { encoding: "utf-8" });
		wxrData = await parseWxr(stream);
	});

	describe("WXR Parsing", () => {
		it("parses site metadata", () => {
			expect(wxrData.site.title).toBe("Theme Unit Test Data");
			expect(wxrData.site.link).toBe("https://wpthemetestdata.wordpress.com");
			expect(wxrData.site.language).toBe("en");
		});

		it("parses all posts", () => {
			expect(wxrData.posts.length).toBeGreaterThan(50);
		});

		it("parses all pages", () => {
			const pages = wxrData.posts.filter((p) => p.postType === "page");
			expect(pages.length).toBeGreaterThan(10);
		});

		it("parses categories with hierarchy", () => {
			expect(wxrData.categories.length).toBeGreaterThan(20);

			const parentCategory = wxrData.categories.find((c) => c.nicename === "parent-category");
			expect(parentCategory).toBeDefined();

			const childCategory = wxrData.categories.find((c) => c.nicename === "child-category-01");
			expect(childCategory).toBeDefined();
			expect(childCategory?.parent).toBe("parent-category");
		});

		it("parses tags", () => {
			expect(wxrData.tags.length).toBeGreaterThan(50);

			const wpTag = wxrData.tags.find((t) => t.slug === "wordpress");
			expect(wpTag).toBeDefined();
			expect(wpTag?.name).toBe("WordPress");
		});

		it("parses authors", () => {
			expect(wxrData.authors.length).toBeGreaterThanOrEqual(1);

			const author = wxrData.authors.find((a) => a.login === "themereviewteam");
			expect(author).toBeDefined();
			expect(author?.displayName).toBe("Theme Reviewer");
		});

		it("parses attachments", () => {
			expect(wxrData.attachments.length).toBeGreaterThan(0);
		});

		it("parses post categories and tags", () => {
			const postsWithTaxonomies = wxrData.posts.filter(
				(p) => p.categories.length > 0 || p.tags.length > 0,
			);
			expect(postsWithTaxonomies.length).toBeGreaterThan(0);
		});
	});

	describe("Gutenberg Block Conversion", () => {
		it("converts paragraph blocks", () => {
			const post = wxrData.posts.find((p) => p.content?.includes("wp:paragraph"));
			expect(post).toBeDefined();

			const result = gutenbergToPortableText(post!.content || "");
			expect(result.length).toBeGreaterThan(0);

			const block = result.find((b) => b._type === "block");
			expect(block).toBeDefined();
		});

		it("converts heading blocks with different levels", () => {
			const post = wxrData.posts.find((p) => p.title === "WP 6.1 Font size scale");
			expect(post).toBeDefined();

			const result = gutenbergToPortableText(post!.content || "");

			const headings = result.filter(
				(b) => b._type === "block" && (b as any).style?.startsWith("h"),
			);
			expect(headings.length).toBeGreaterThan(0);
		});

		it("converts list blocks", () => {
			const post = wxrData.posts.find((p) => p.content?.includes("wp:list"));
			expect(post).toBeDefined();

			const result = gutenbergToPortableText(post!.content || "");
			const listItems = result.filter((b) => b._type === "block" && (b as any).listItem);
			expect(listItems.length).toBeGreaterThan(0);
		});

		it("converts image blocks", () => {
			const post = wxrData.posts.find((p) => p.content?.includes("wp:image"));
			expect(post).toBeDefined();

			const result = gutenbergToPortableText(post!.content || "");
			const images = result.filter((b) => b._type === "image");
			expect(images.length).toBeGreaterThan(0);
		});

		it("converts quote blocks", () => {
			const post = wxrData.posts.find((p) => p.content?.includes("wp:quote"));
			expect(post).toBeDefined();

			const result = gutenbergToPortableText(post!.content || "");
			const quotes = result.filter((b) => b._type === "block" && (b as any).style === "blockquote");
			expect(quotes.length).toBeGreaterThan(0);
		});

		it("converts code blocks", () => {
			const post = wxrData.posts.find((p) => p.content?.includes("wp:code"));
			expect(post).toBeDefined();

			const result = gutenbergToPortableText(post!.content || "");
			const codeBlocks = result.filter((b) => b._type === "code");
			expect(codeBlocks.length).toBeGreaterThan(0);
		});

		it("converts group blocks by flattening", () => {
			const post = wxrData.posts.find((p) => p.content?.includes("wp:group"));
			expect(post).toBeDefined();

			const result = gutenbergToPortableText(post!.content || "");
			const groups = result.filter((b) => b._type === "group");
			expect(groups.length).toBe(0);

			expect(result.length).toBeGreaterThan(0);
		});

		it("handles classic editor content (no block markers)", () => {
			const classicPost = wxrData.posts.find(
				(p) =>
					p.categories.includes("classic") &&
					!!p.content?.trim() &&
					!p.content.includes("<!-- wp:"),
			);
			expect(classicPost).toBeDefined();

			const result = gutenbergToPortableText(classicPost!.content);
			expect(result.length).toBeGreaterThan(0);
		});

		it("preserves inline formatting", () => {
			const post = wxrData.posts.find(
				(p) => p.content?.includes("<strong>") || p.content?.includes("<em>"),
			);
			expect(post).toBeDefined();

			const result = gutenbergToPortableText(post!.content || "");
			const blocksWithMarks = result.filter(
				(b) => b._type === "block" && (b as any).children?.some((c: any) => c.marks?.length > 0),
			);
			expect(blocksWithMarks.length).toBeGreaterThan(0);
		});

		it("handles empty content gracefully", () => {
			const result = gutenbergToPortableText("");
			expect(result).toEqual([]);
		});

		it("handles malformed blocks gracefully", () => {
			const malformed = "<!-- wp:paragraph --><p>Test<!-- /wp:paragraph";
			const result = gutenbergToPortableText(malformed);
			expect(Array.isArray(result)).toBe(true);
		});
	});

	describe("Edge Cases", () => {
		it("handles posts with special characters in title", () => {
			const specialPosts = wxrData.posts.filter(
				(p) => p.title?.includes("&") || p.title?.includes("<") || p.title?.includes('"'),
			);
			expect(specialPosts.length).toBeGreaterThan(0);
		});

		it("handles posts with very long content", () => {
			const longestPost = wxrData.posts.reduce((longest, current) => {
				const currentLength = current.content?.length || 0;
				const longestLength = longest?.content?.length || 0;
				return currentLength > longestLength ? current : longest;
			}, wxrData.posts[0]);

			expect(longestPost?.content).toBeTruthy();

			const result = gutenbergToPortableText(longestPost!.content!);
			expect(result.length).toBeGreaterThan(0);
		});

		it("handles deeply nested blocks", () => {
			const nestedPost = wxrData.posts.find(
				(p) => p.content?.includes("wp:columns") || p.content?.includes("wp:group"),
			);
			expect(nestedPost).toBeDefined();

			const result = gutenbergToPortableText(nestedPost!.content || "");
			expect(result.length).toBeGreaterThan(0);
		});

		it("handles posts with embeds", () => {
			const content = `<!-- wp:embed {"url":"https://www.youtube.com/watch?v=abc123","type":"video","providerNameSlug":"youtube"} -->
<figure class="wp-block-embed is-type-video is-provider-youtube wp-block-embed-youtube"><div class="wp-block-embed__wrapper">
https://www.youtube.com/watch?v=abc123
</div></figure>
<!-- /wp:embed -->`;

			const result = gutenbergToPortableText(content);
			const embeds = result.filter((b) => b._type === "embed");
			expect(embeds.length).toBeGreaterThan(0);
		});
	});

	describe("Content Integrity", () => {
		it("preserves all text content through conversion", () => {
			const samplePosts = wxrData.posts.slice(0, 10);
			let assertedCount = 0;

			for (const post of samplePosts) {
				if (!post.content) continue;

				const result = gutenbergToPortableText(post.content);

				const extractedText = result
					.map((block) => {
						if (block._type === "block" && (block as any).children) {
							return (block as any).children.map((c: any) => c.text || "").join("");
						}
						if (block._type === "code") {
							return (block as any).code || "";
						}
						return "";
					})
					.join(" ")
					.trim();

				if (post.content.includes("<p>") || post.content.includes("wp:paragraph")) {
					const hasTextContent = PARAGRAPH_WITH_TEXT_REGEX.test(post.content);
					if (hasTextContent) {
						expect(extractedText.length).toBeGreaterThan(0);
						assertedCount++;
					}
				}
			}

			expect(assertedCount).toBeGreaterThan(0);
		});
	});

	describe("Statistics", () => {
		it("reports conversion statistics", () => {
			let totalPosts = 0;
			let successfulConversions = 0;
			let failedConversions = 0;
			let totalBlocks = 0;
			const blockTypes = new Map<string, number>();

			for (const post of wxrData.posts) {
				totalPosts++;
				try {
					const result = gutenbergToPortableText(post.content || "");
					successfulConversions++;
					totalBlocks += result.length;

					for (const block of result) {
						const type = block._type;
						blockTypes.set(type, (blockTypes.get(type) || 0) + 1);
					}
				} catch {
					failedConversions++;
				}
			}

			console.log("\n=== WordPress Migration Statistics ===");
			console.log(`Total posts: ${totalPosts}`);
			console.log(`Successful: ${successfulConversions}`);
			console.log(`Failed: ${failedConversions}`);
			console.log(`Total blocks generated: ${totalBlocks}`);
			console.log("\nBlock types:");
			for (const [type, count] of blockTypes.entries()) {
				console.log(`  ${type}: ${count}`);
			}
			console.log("=====================================\n");

			expect(failedConversions).toBe(0);
			expect(successfulConversions).toBe(totalPosts);
		});
	});
});
