import { describe, expect, it, vi } from "vitest";

vi.mock("virtual:emdash/wait-until", () => ({ waitUntil: undefined }));

import { resolveSessionUser } from "../../../../../../packages/core/src/astro/session-user.js";

describe("resolveSessionUser", () => {
	it("returns the session user when the read resolves", async () => {
		const session = { get: vi.fn(async () => ({ id: "user_1" })) };
		await expect(resolveSessionUser(session)).resolves.toEqual({ id: "user_1" });
		expect(session.get).toHaveBeenCalledWith("user");
	});

	it("returns undefined when there is no session", async () => {
		await expect(resolveSessionUser(undefined)).resolves.toBeUndefined();
	});

	it("falls back to undefined instead of hanging when the read never settles", async () => {
		const session = { get: () => new Promise<{ id: string }>(() => {}) };
		await expect(resolveSessionUser(session, 20)).resolves.toBeUndefined();
	});

	it("fails closed to undefined when the read rejects", async () => {
		const session = { get: () => Promise.reject(new Error("boom")) };
		await expect(resolveSessionUser(session, 20)).resolves.toBeUndefined();
	});
});
