import { describe, it, expect } from "vitest";

import { addMemberSchema } from "../../../../../supbrd-runtime-plugins/src/front/client/plugins/supbrd-plug-settings/source/schemas/member.js";

describe("addMemberSchema", () => {
	it("accepts valid member", () => {
		const result = addMemberSchema.safeParse({
			email: "user@example.com",
			role: "admin",
		});
		expect(result.success).toBe(true);
	});

	it("rejects invalid email", () => {
		const result = addMemberSchema.safeParse({
			email: "bad-email",
			role: "admin",
		});
		expect(result.success).toBe(false);
	});

	it("rejects empty email", () => {
		const result = addMemberSchema.safeParse({ email: "", role: "admin" });
		expect(result.success).toBe(false);
	});

	it("rejects empty role", () => {
		const result = addMemberSchema.safeParse({
			email: "user@example.com",
			role: "",
		});
		expect(result.success).toBe(false);
	});
});
