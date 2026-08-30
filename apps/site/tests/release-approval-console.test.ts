import { describe, expect, test } from "vitest";

import { renderReleaseApprovalConsole } from "../src/lib/release-approval-console.js";

describe("Release Approval console", () => {
	test("shows exact candidate evidence and exposes approval without activation", () => {
		const html = renderReleaseApprovalConsole({
			candidate_id: "01M18WDJPA19S6D4EF76TP0TGF",
			release_id: "01M18WDJPAJN1F3P6FSZGFSVKD",
			content_checksum:
				"sha256:eb0ef00cebd27ca732bcdce17a0593ec8249292ff65eb0782266fcbbf18c86ed",
			validation_set_checksum:
				"sha256:2e23be73d51ba98a9c8b66f6583512b39cdc19c0f97fe021b5464f0abbcdd066",
			validation_receipt_count: 13,
			warnings_acknowledged: [],
			status: "validated",
			reauthentication_ready: true,
		});

		expect(html).toContain("01M18WDJPA19S6D4EF76TP0TGF");
		expect(html).toContain("01M18WDJPAJN1F3P6FSZGFSVKD");
		expect(html).toContain(
			"sha256:eb0ef00cebd27ca732bcdce17a0593ec8249292ff65eb0782266fcbbf18c86ed",
		);
		expect(html).toContain(
			"sha256:2e23be73d51ba98a9c8b66f6583512b39cdc19c0f97fe021b5464f0abbcdd066",
		);
		expect(html).toContain("13 reçus de validation");
		expect(html).toContain("Approuver cette Release");
		expect(html).toContain("/_emdash/api/superboard/releases/approve");
		expect(html).not.toContain("/_emdash/api/superboard/releases/activate");
		expect(html).not.toContain("Activer cette Release");
	});
});
