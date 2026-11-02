import { describe, expect, it } from "vitest";

import {
	CAPABILITY_RENAMES,
	capabilitiesToDeclaredAccess,
	declaredAccessToCapabilities,
	isDeprecatedCapability,
	normalizeCapabilities,
	normalizeCapability,
	pluginManifestSchema,
} from "../../../../packages/plugin-types/src/index.js";

describe("isDeprecatedCapability", () => {
	it("recognises every key of CAPABILITY_RENAMES as deprecated", () => {
		for (const legacy of Object.keys(CAPABILITY_RENAMES)) {
			expect(isDeprecatedCapability(legacy)).toBe(true);
		}
	});

	it("does not flag any rename target as deprecated (renames must be terminal)", () => {
		for (const target of Object.values(CAPABILITY_RENAMES)) {
			expect(isDeprecatedCapability(target)).toBe(false);
		}
	});

	it("does not flag prototype property names as deprecated", () => {
		expect(isDeprecatedCapability("toString")).toBe(false);
		expect(isDeprecatedCapability("constructor")).toBe(false);
		expect(isDeprecatedCapability("__proto__")).toBe(false);
	});
});

describe("normalizeCapability", () => {
	it("rewrites every legacy name to its replacement", () => {
		for (const [legacy, replacement] of Object.entries(CAPABILITY_RENAMES)) {
			expect(normalizeCapability(legacy)).toBe(replacement);
		}
	});

	it("passes current names through unchanged", () => {
		expect(normalizeCapability("network:request")).toBe("network:request");
		expect(normalizeCapability("content:read")).toBe("content:read");
	});

	it("passes unknown strings through unchanged for downstream validators", () => {
		expect(normalizeCapability("not:a:real:cap")).toBe("not:a:real:cap");
	});
});

describe("normalizeCapabilities", () => {
	it("preserves order of first appearance", () => {
		expect(normalizeCapabilities(["content:read", "network:request", "media:read"])).toEqual([
			"content:read",
			"network:request",
			"media:read",
		]);
	});

	it("collapses a legacy name into its canonical equivalent", () => {
		expect(normalizeCapabilities(["read:content"])).toEqual(["content:read"]);
	});

	it("deduplicates when a manifest declares both the legacy and canonical forms", () => {
		expect(normalizeCapabilities(["network:fetch", "network:request"])).toEqual([
			"network:request",
		]);
		expect(normalizeCapabilities(["network:request", "network:fetch"])).toEqual([
			"network:request",
		]);
	});

	it("handles an empty array", () => {
		expect(normalizeCapabilities([])).toEqual([]);
	});
});

describe("declaredAccess facet mapping", () => {
	it("validates taxonomy access in plugin manifests", () => {
		expect(
			pluginManifestSchema.safeParse({
				id: "taxonomy-reader",
				version: "1.0.0",
				declaredAccess: { taxonomies: { read: {} } },
				capabilities: ["taxonomies:read"],
				allowedHosts: [],
				storage: {},
				hooks: [],
				routes: [],
				admin: {},
			}).success,
		).toBe(true);
	});

	it("maps each hook-registration capability to its participation facet", () => {
		expect(capabilitiesToDeclaredAccess(["hooks.email-transport:register"], [])).toEqual({
			email: { transport: {} },
		});
		expect(capabilitiesToDeclaredAccess(["hooks.email-events:register"], [])).toEqual({
			email: { events: {} },
		});
		expect(capabilitiesToDeclaredAccess(["hooks.page-fragments:register"], [])).toEqual({
			page: { fragments: {} },
		});
		expect(capabilitiesToDeclaredAccess(["users:read"], [])).toEqual({ users: { read: {} } });
		expect(capabilitiesToDeclaredAccess(["taxonomies:read"], [])).toEqual({
			taxonomies: { read: {} },
		});
	});

	it("distinguishes host-restricted from unrestricted network", () => {
		expect(capabilitiesToDeclaredAccess(["network:request"], ["api.example.com"])).toEqual({
			network: { request: { allowedHosts: ["api.example.com"] } },
		});
		expect(
			capabilitiesToDeclaredAccess(["network:request:unrestricted", "network:request"], []),
		).toEqual({ network: { request: {} } });
	});

	it("never widens an empty allowedHosts (deny-all) to unrestricted", () => {
		expect(capabilitiesToDeclaredAccess(["network:request"], [])).toEqual({
			network: { request: { allowedHosts: [] } },
		});
		const decoded = declaredAccessToCapabilities({ network: { request: { allowedHosts: [] } } });
		expect(decoded.capabilities).not.toContain("network:request:unrestricted");
		expect(decoded).toEqual({ capabilities: ["network:request"], allowedHosts: [] });
	});

	it("carries every facet of an email transport that also calls out and observes events", () => {
		const da = capabilitiesToDeclaredAccess(
			["hooks.email-transport:register", "network:request", "hooks.email-events:register"],
			["api.cloudflare.com"],
		);
		expect(da).toEqual({
			network: { request: { allowedHosts: ["api.cloudflare.com"] } },
			email: { transport: {}, events: {} },
		});
		expect(new Set(declaredAccessToCapabilities(da).capabilities)).toEqual(
			new Set(["hooks.email-transport:register", "network:request", "hooks.email-events:register"]),
		);
	});
});

describe("declaredAccess <-> capabilities round-trip (total over the vocabulary)", () => {
	const contentChoices = [[], ["content:read"], ["content:read", "content:write"]];
	const mediaChoices = [[], ["media:read"], ["media:read", "media:write"]];
	const networkChoices: { caps: string[]; hosts: string[] }[] = [
		{ caps: [], hosts: [] },
		{ caps: ["network:request", "network:request:unrestricted"], hosts: [] },
		{ caps: ["network:request"], hosts: [] },
		{ caps: ["network:request"], hosts: ["api.example.com"] },
		{ caps: ["network:request"], hosts: ["api.example.com", "*.cdn.example.com"] },
	];
	const singletonFacets = [
		"email:send",
		"hooks.email-events:register",
		"hooks.email-transport:register",
		"hooks.page-fragments:register",
		"users:read",
		"taxonomies:read",
	];

	function* states() {
		for (const content of contentChoices) {
			for (const media of mediaChoices) {
				for (const network of networkChoices) {
					for (let mask = 0; mask < 1 << singletonFacets.length; mask++) {
						const extra = singletonFacets.filter((_, i) => mask & (1 << i));
						yield {
							capabilities: [...content, ...media, ...network.caps, ...extra],
							allowedHosts: network.hosts,
						};
					}
				}
			}
		}
	}

	it("recovers every implication-closed valid state exactly", () => {
		let count = 0;
		for (const input of states()) {
			const back = declaredAccessToCapabilities(
				capabilitiesToDeclaredAccess(input.capabilities, input.allowedHosts),
			);
			expect(new Set(back.capabilities)).toEqual(new Set(input.capabilities));
			expect(new Set(back.allowedHosts)).toEqual(new Set(input.allowedHosts));
			count++;
		}
		expect(count).toBe(2880);
	});
});
