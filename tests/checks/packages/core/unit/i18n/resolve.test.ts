import { afterEach, describe, expect, it } from "vitest";

import { setI18nConfig } from "../../../../../../packages/core/src/i18n/config.js";
import {
	_resetAstroI18nCacheForTests,
	interpolateUrlPattern,
	localizePath,
} from "../../../../../../packages/core/src/i18n/resolve.js";

describe("interpolateUrlPattern", () => {
	it("substitutes {slug} and {id}", () => {
		expect(
			interpolateUrlPattern({
				pattern: "/blog/{slug}",
				collection: "post",
				slug: "hello",
				id: "abc",
			}),
		).toBe("/blog/hello");

		expect(
			interpolateUrlPattern({
				pattern: "/p/{id}",
				collection: "post",
				slug: "hello",
				id: "abc",
			}),
		).toBe("/p/abc");
	});

	it("falls back to /{collection}/{slug} when no pattern is configured", () => {
		expect(
			interpolateUrlPattern({
				pattern: null,
				collection: "post",
				slug: "hello",
				id: "abc",
			}),
		).toBe("/post/hello");
	});

	it("URL-encodes slug and id segments", () => {
		expect(
			interpolateUrlPattern({
				pattern: "/blog/{slug}",
				collection: "post",
				slug: "hello world",
				id: "abc",
			}),
		).toBe("/blog/hello%20world");
	});

	it("collapses repeated slashes and trims trailing slash", () => {
		expect(
			interpolateUrlPattern({
				pattern: "//blog//{slug}/",
				collection: "post",
				slug: "hello",
				id: "abc",
			}),
		).toBe("/blog/hello");
	});

	it("ensures a leading slash", () => {
		expect(
			interpolateUrlPattern({
				pattern: "blog/{slug}",
				collection: "post",
				slug: "hello",
				id: "abc",
			}),
		).toBe("/blog/hello");
	});
});

describe("localizePath", () => {
	afterEach(() => {
		setI18nConfig(null);
		_resetAstroI18nCacheForTests();
	});

	it("returns path unchanged when i18n is disabled", async () => {
		setI18nConfig(null);
		expect(await localizePath("/blog/hello", "en")).toBe("/blog/hello");
	});

	it("returns path unchanged when only one locale is configured", async () => {
		setI18nConfig({ defaultLocale: "en", locales: ["en"] });
		expect(await localizePath("/blog/hello", "en")).toBe("/blog/hello");
	});

	it("does not prefix the default locale when prefixDefaultLocale is false", async () => {
		setI18nConfig({
			defaultLocale: "en",
			locales: ["en", "fr"],
			prefixDefaultLocale: false,
		});
		expect(await localizePath("/blog/hello", "en")).toBe("/blog/hello");
	});

	it("prefixes non-default locales when prefixDefaultLocale is false", async () => {
		setI18nConfig({
			defaultLocale: "en",
			locales: ["en", "fr"],
			prefixDefaultLocale: false,
		});
		expect(await localizePath("/blog/hello", "fr")).toBe("/fr/blog/hello");
	});

	it("prefixes every locale when prefixDefaultLocale is true", async () => {
		setI18nConfig({
			defaultLocale: "en",
			locales: ["en", "fr"],
			prefixDefaultLocale: true,
		});
		expect(await localizePath("/blog/hello", "en")).toBe("/en/blog/hello");
		expect(await localizePath("/blog/hello", "fr")).toBe("/fr/blog/hello");
	});

	it("normalises adjacent slashes and trailing slash from the result", async () => {
		setI18nConfig({
			defaultLocale: "en",
			locales: ["en", "fr"],
			prefixDefaultLocale: false,
		});
		expect(await localizePath("//blog/hello/", "fr")).toBe("/fr/blog/hello");
	});

	it("returns null for drifted/legacy locales not in the configured list", async () => {
		setI18nConfig({
			defaultLocale: "en",
			locales: ["en", "fr"],
			prefixDefaultLocale: false,
		});
		expect(await localizePath("/blog/hello", "de")).toBeNull();
	});
});
