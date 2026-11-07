import { describe, expect, it, vi } from "vitest";

import {
	checkDomainVerification,
	domainVerificationRecord,
} from "../../../../../../packages/plugins/superboard-acquisition/dynamic-links/src/domain-verification";

const record = domainVerificationRecord("links.example.com", "token-1");

describe("domain verification lookup", () => {
	it("joins TXT values split into several strings", async () => {
		const lookup = vi.fn(async () =>
			Response.json({ Status: 0, Answer: [{ type: 16, data: '"tok" "en-1"' }] }),
		);
		await expect(checkDomainVerification(record, lookup)).resolves.toMatchObject({
			result: "verified",
		});
	});

	it("ignores answers that are not TXT records", async () => {
		const lookup = vi.fn(async () =>
			Response.json({
				Status: 0,
				Answer: [{ type: 5, data: "token-1." }],
			}),
		);
		await expect(checkDomainVerification(record, lookup)).resolves.toEqual({
			result: "not_found",
			record,
			found: [],
		});
	});

	it("reports a failed lookup instead of a missing record", async () => {
		const unreachable = vi.fn(async () => {
			throw new TypeError("network down");
		});
		const failing = vi.fn(async () => Response.json({ Status: 2 }));
		const rejected = vi.fn(async () => new Response("busy", { status: 503 }));
		for (const lookup of [unreachable, failing, rejected])
			await expect(checkDomainVerification(record, lookup)).resolves.toMatchObject({
				result: "lookup_failed",
			});
	});
});
