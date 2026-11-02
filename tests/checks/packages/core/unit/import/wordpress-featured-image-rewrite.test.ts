import { describe, expect, it } from "vitest";

import {
	buildBaseUrlMap,
	extractMediaUrl,
	findMatchingUrl,
} from "../../../../../../packages/core/src/astro/routes/api/import/wordpress/rewrite-url-helpers.js";

describe("WordPress import — featured_image rewrite", () => {
	const wpUrl = "https://wp-domain.example/wp-content/uploads/2026/01/hero.jpg";
	const localUrl = "/_emdash/api/media/file/01KRNQM2P18GQD1TKDWEPHC9VG.jpg";
	const urlMap = { [wpUrl]: localUrl };
	const baseMap = buildBaseUrlMap(urlMap);

	const storedFeaturedImage = JSON.stringify({
		provider: "external",
		id: "",
		src: wpUrl,
	});

	it("extracts the inner src from a stored MediaValue JSON", () => {
		expect(extractMediaUrl(storedFeaturedImage)).toBe(wpUrl);
	});

	it("returns a bare URL string unchanged (legacy rows)", () => {
		expect(extractMediaUrl(wpUrl)).toBe(wpUrl);
	});

	it("leaves a non-MediaValue JSON string untouched", () => {
		expect(extractMediaUrl('{"foo":"bar"}')).toBe('{"foo":"bar"}');
	});

	it("rewrites a stored featured_image MediaValue to the local URL", () => {
		const match = findMatchingUrl(extractMediaUrl(storedFeaturedImage), urlMap, baseMap);
		expect(match).toBe(localUrl);
	});

	it("still rewrites a WordPress size-suffixed variant inside a stored MediaValue", () => {
		const variant = JSON.stringify({
			provider: "external",
			id: "",
			src: "https://wp-domain.example/wp-content/uploads/2026/01/hero-1024x695.jpg",
		});
		const match = findMatchingUrl(extractMediaUrl(variant), urlMap, baseMap);
		expect(match).toBe(localUrl);
	});
});
