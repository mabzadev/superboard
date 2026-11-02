import { describe, it, expect } from "vitest";

import {
	CAPABILITY_RENAMES,
	isDeprecatedCapability,
	normalizeCapabilities,
	normalizeCapability,
} from "../../../../../../packages/core/src/plugins/types.js";
import type { DeprecatedPluginCapability } from "../../../../../../packages/core/src/plugins/types.js";

describe("CAPABILITY_RENAMES", () => {
	it("maps every deprecated name to its current replacement", () => {
		expect(CAPABILITY_RENAMES).toEqual({
			"network:fetch": "network:request",
			"network:fetch:any": "network:request:unrestricted",
			"read:content": "content:read",
			"write:content": "content:write",
			"read:media": "media:read",
			"write:media": "media:write",
			"read:users": "users:read",
			"email:provide": "hooks.email-transport:register",
			"email:intercept": "hooks.email-events:register",
			"page:inject": "hooks.page-fragments:register",
		});
	});

	it("is frozen — cannot be mutated at runtime", () => {
		expect(Object.isFrozen(CAPABILITY_RENAMES)).toBe(true);
	});
});

describe("isDeprecatedCapability", () => {
	it("returns true for every deprecated name in the rename table", () => {
		for (const cap of Object.keys(CAPABILITY_RENAMES) as DeprecatedPluginCapability[]) {
			expect(isDeprecatedCapability(cap)).toBe(true);
		}
	});

	it("returns false for current capability names", () => {
		const current = [
			"content:read",
			"content:write",
			"media:read",
			"media:write",
			"users:read",
			"network:request",
			"network:request:unrestricted",
			"email:send",
			"hooks.email-transport:register",
			"hooks.email-events:register",
			"hooks.page-fragments:register",
		];
		for (const cap of current) {
			expect(isDeprecatedCapability(cap)).toBe(false);
		}
	});

	it("returns false for unknown strings", () => {
		expect(isDeprecatedCapability("not:a:capability")).toBe(false);
		expect(isDeprecatedCapability("")).toBe(false);
		expect(isDeprecatedCapability("content")).toBe(false);
	});

	it("does not match Object.prototype keys", () => {
		expect(isDeprecatedCapability("toString")).toBe(false);
		expect(isDeprecatedCapability("constructor")).toBe(false);
		expect(isDeprecatedCapability("hasOwnProperty")).toBe(false);
		expect(isDeprecatedCapability("__proto__")).toBe(false);
		expect(isDeprecatedCapability("valueOf")).toBe(false);
	});
});

describe("normalizeCapability", () => {
	it("rewrites deprecated names to current names", () => {
		expect(normalizeCapability("read:content")).toBe("content:read");
		expect(normalizeCapability("write:content")).toBe("content:write");
		expect(normalizeCapability("read:media")).toBe("media:read");
		expect(normalizeCapability("write:media")).toBe("media:write");
		expect(normalizeCapability("read:users")).toBe("users:read");
		expect(normalizeCapability("network:fetch")).toBe("network:request");
		expect(normalizeCapability("network:fetch:any")).toBe("network:request:unrestricted");
		expect(normalizeCapability("email:provide")).toBe("hooks.email-transport:register");
		expect(normalizeCapability("email:intercept")).toBe("hooks.email-events:register");
		expect(normalizeCapability("page:inject")).toBe("hooks.page-fragments:register");
	});

	it("leaves current names unchanged", () => {
		expect(normalizeCapability("content:read")).toBe("content:read");
		expect(normalizeCapability("network:request")).toBe("network:request");
		expect(normalizeCapability("hooks.email-transport:register")).toBe(
			"hooks.email-transport:register",
		);
	});

	it("passes through unknown strings unchanged", () => {
		expect(normalizeCapability("invalid:capability")).toBe("invalid:capability");
		expect(normalizeCapability("")).toBe("");
	});

	it("returns Object.prototype keys as-is (does not return prototype values)", () => {
		expect(normalizeCapability("toString")).toBe("toString");
		expect(normalizeCapability("constructor")).toBe("constructor");
		expect(normalizeCapability("__proto__")).toBe("__proto__");
	});
});

describe("normalizeCapabilities", () => {
	it("rewrites every deprecated name in an array", () => {
		const input = ["read:content", "write:content", "network:fetch"];
		const result = normalizeCapabilities(input);

		expect(result).toEqual(["content:read", "content:write", "network:request"]);
	});

	it("preserves order of first occurrence", () => {
		const result = normalizeCapabilities(["network:request", "read:content", "write:media"]);

		expect(result).toEqual(["network:request", "content:read", "media:write"]);
	});

	it("deduplicates by canonical name when both old and new are present", () => {
		const result = normalizeCapabilities(["read:content", "content:read"]);

		expect(result).toEqual(["content:read"]);
	});

	it("deduplicates two deprecated names that map to the same current name", () => {
		const result = normalizeCapabilities(["read:content", "read:content"]);

		expect(result).toEqual(["content:read"]);
	});

	it("returns empty array for empty input", () => {
		expect(normalizeCapabilities([])).toEqual([]);
	});

	it("does not mutate the input array", () => {
		const input = ["read:content", "write:content"];
		const snapshot = [...input];
		normalizeCapabilities(input);

		expect(input).toEqual(snapshot);
	});

	it("is idempotent — normalizing twice gives the same result", () => {
		const input = ["read:content", "write:media", "page:inject"];
		const once = normalizeCapabilities(input);
		const twice = normalizeCapabilities(once);

		expect(twice).toEqual(once);
	});
});
