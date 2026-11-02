import { describe, it, expect } from "vitest";

import { renderSiteIdentity } from "../../../../../../packages/core/src/page/site-identity.js";

describe("renderSiteIdentity", () => {
	it("returns empty string when no input provided", () => {
		expect(renderSiteIdentity(undefined)).toBe("");
	});

	it("returns empty string when input has no favicon", () => {
		expect(renderSiteIdentity({})).toBe("");
	});

	it("returns empty string when favicon has no resolved URL", () => {
		expect(
			renderSiteIdentity({
				favicon: { mediaId: "med_123" },
			}),
		).toBe("");
	});

	it("emits link tag for favicon with URL", () => {
		const html = renderSiteIdentity({
			favicon: {
				mediaId: "med_123",
				url: "/_emdash/api/media/file/abc.png",
				contentType: "image/png",
			},
		});
		expect(html).toBe('<link rel="icon" href="/_emdash/api/media/file/abc.png" type="image/png">');
	});

	it("includes type attribute for SVG favicons (the #831 bug)", () => {
		const html = renderSiteIdentity({
			favicon: {
				mediaId: "med_svg",
				url: "/_emdash/api/media/file/01KNTC51CKNJG1RFP3YV93BR17",
				contentType: "image/svg+xml",
			},
		});
		expect(html).toContain('type="image/svg+xml"');
	});

	it("omits type attribute when contentType is not set", () => {
		const html = renderSiteIdentity({
			favicon: {
				mediaId: "med_legacy",
				url: "/_emdash/api/media/file/legacy.ico",
			},
		});
		expect(html).toBe('<link rel="icon" href="/_emdash/api/media/file/legacy.ico">');
		expect(html).not.toContain("type=");
	});

	it("escapes hostile content in href and type", () => {
		const html = renderSiteIdentity({
			favicon: {
				mediaId: "med_x",
				url: '/path"><script>alert(1)</script>',
				contentType: 'image/png"><x',
			},
		});
		expect(html).not.toContain("<script>");
		expect(html).toContain("&quot;");
		expect(html).toContain("&lt;");
	});
});
