import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	_resetTrustedProxyHeadersCache,
	getTrustedProxyHeaders,
} from "../../../../../../packages/core/src/auth/trusted-proxy.js";

describe("getTrustedProxyHeaders", () => {
	const ORIGINAL_ENV = process.env.EMDASH_TRUSTED_PROXY_HEADERS;

	beforeEach(() => {
		_resetTrustedProxyHeadersCache();
	});

	afterEach(() => {
		if (ORIGINAL_ENV === undefined) {
			delete process.env.EMDASH_TRUSTED_PROXY_HEADERS;
		} else {
			process.env.EMDASH_TRUSTED_PROXY_HEADERS = ORIGINAL_ENV;
		}
		_resetTrustedProxyHeadersCache();
	});

	it("returns config value when set", () => {
		expect(getTrustedProxyHeaders({ trustedProxyHeaders: ["x-real-ip"] })).toEqual(["x-real-ip"]);
	});

	it("prefers config over env", () => {
		process.env.EMDASH_TRUSTED_PROXY_HEADERS = "fly-client-ip";
		expect(getTrustedProxyHeaders({ trustedProxyHeaders: ["x-real-ip"] })).toEqual(["x-real-ip"]);
	});

	it("falls back to env when config is absent", () => {
		process.env.EMDASH_TRUSTED_PROXY_HEADERS = "x-real-ip,fly-client-ip";
		expect(getTrustedProxyHeaders(undefined)).toEqual(["x-real-ip", "fly-client-ip"]);
	});

	it("trims whitespace and drops empty entries from env", () => {
		process.env.EMDASH_TRUSTED_PROXY_HEADERS = " x-real-ip , , fly-client-ip ";
		expect(getTrustedProxyHeaders(undefined)).toEqual(["x-real-ip", "fly-client-ip"]);
	});

	it("lowercases header names for consistent matching", () => {
		expect(getTrustedProxyHeaders({ trustedProxyHeaders: ["X-Real-IP", "Fly-Client-IP"] })).toEqual(
			["x-real-ip", "fly-client-ip"],
		);
	});

	it("returns empty array when neither config nor env is set", () => {
		delete process.env.EMDASH_TRUSTED_PROXY_HEADERS;
		expect(getTrustedProxyHeaders(undefined)).toEqual([]);
	});

	it("returns empty array when config has empty list", () => {
		process.env.EMDASH_TRUSTED_PROXY_HEADERS = "x-real-ip";
		expect(getTrustedProxyHeaders({ trustedProxyHeaders: [] })).toEqual([]);
	});

	it("drops invalid header names from config", () => {
		expect(
			getTrustedProxyHeaders({
				trustedProxyHeaders: ["x-real-ip", "", "invalid name", "bad:colon", "ok-name"],
			}),
		).toEqual(["x-real-ip", "ok-name"]);
	});

	it("drops invalid header names from env", () => {
		process.env.EMDASH_TRUSTED_PROXY_HEADERS = "x-real-ip, x y z , bad:one, ok-name";
		expect(getTrustedProxyHeaders(undefined)).toEqual(["x-real-ip", "ok-name"]);
	});

	it("trims whitespace from config entries before matching", () => {
		expect(
			getTrustedProxyHeaders({ trustedProxyHeaders: [" x-real-ip ", "fly-client-ip"] }),
		).toEqual(["x-real-ip", "fly-client-ip"]);
	});
});
