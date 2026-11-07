import { describe, expect, it } from "vitest";

import {
	parseEmailMessage,
	secretsEqual,
} from "../../../../../../packages/plugins/superboard-communication/email/src/validation";

describe("email validation", () => {
	it("normalizes and deduplicates recipients", () => {
		expect(
			parseEmailMessage({
				kind: "transactional",
				to: [" User@example.com ", "user@example.com"],
				subject: "Welcome",
				text: "Hello",
			}).to,
		).toEqual(["user@example.com"]);
	});

	it("rejects header injection", () => {
		expect(() =>
			parseEmailMessage({
				to: "user@example.com",
				subject: "Hello\r\nBcc: attacker@example.com",
				text: "Hello",
			}),
		).toThrow(/subject invalid/);
	});

	it("accepts an optional sender name and rejects line breaks or control characters in it", () => {
		const message = { to: "user@example.com", subject: "Hello", text: "Hello" };
		expect(parseEmailMessage({ ...message, fromName: "  Acme Care  " }).fromName).toBe("Acme Care");
		expect("fromName" in parseEmailMessage(message)).toBe(false);
		expect("fromName" in parseEmailMessage({ ...message, fromName: null })).toBe(false);
		for (const fromName of ["Acme\r\nBcc: attacker@example.com", "Acme\nCare", "Acme\u0000", 42])
			expect(() => parseEmailMessage({ ...message, fromName })).toThrow(/from name invalid/);
		expect(() => parseEmailMessage({ ...message, fromName: "a".repeat(321) })).toThrow(
			/from name invalid/,
		);
	});

	it("rejects transport-owned headers even when their values are sanitized", () => {
		expect(() =>
			parseEmailMessage({
				to: "user@example.com",
				subject: "Hello",
				text: "Hello",
				headers: { From: "attacker@example.com" },
			}),
		).toThrow(/headers invalid/);
	});

	it("accepts bounded portable idempotency keys", () => {
		expect(
			parseEmailMessage({
				to: "user@example.com",
				subject: "Hello",
				text: "Hello",
				idempotencyKey: "identity.verify_email:token-123",
			}).idempotencyKey,
		).toBe("identity.verify_email:token-123");
		expect(() =>
			parseEmailMessage({
				to: "user@example.com",
				subject: "Hello",
				text: "Hello",
				idempotencyKey: "contains spaces",
			}),
		).toThrow(/idempotency key invalid/);
	});

	it("compares internal secrets without early string equality", async () => {
		await expect(secretsEqual("same", "same")).resolves.toBe(true);
		await expect(secretsEqual("same", "different")).resolves.toBe(false);
	});
});
