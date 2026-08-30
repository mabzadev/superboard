import { describe, expect, test } from "vitest";

import { renderReleaseActivationConsole } from "../src/lib/release-activation-console.js";

describe("Release Activation console", () => {
	test("shows the exact compare-and-swap command without approval controls", () => {
		const html = renderReleaseActivationConsole({
			activation_id: "01M18WDJPA7SH5K3YF5Q2M5AS9",
			candidate_id: "01M18WDJPA19S6D4EF76TP0TGF",
			release_id: "01M18WDJPAJN1F3P6FSZGFSVKD",
			content_checksum:
				"sha256:eb0ef00cebd27ca732bcdce17a0593ec8249292ff65eb0782266fcbbf18c86ed",
			validation_set_checksum:
				"sha256:2e23be73d51ba98a9c8b66f6583512b39cdc19c0f97fe021b5464f0abbcdd066",
			expected_active_release_id: null,
			next_pointer_revision: 1,
			status: "approved",
			reauthentication_ready: true,
		});

		expect(html).toContain("01M18WDJPA7SH5K3YF5Q2M5AS9");
		expect(html).toContain("01M18WDJPA19S6D4EF76TP0TGF");
		expect(html).toContain("01M18WDJPAJN1F3P6FSZGFSVKD");
		expect(html).toContain("Aucune Release active");
		expect(html).toContain("Révision du pointeur après activation");
		expect(html).toContain(">1<");
		expect(html).toContain("Activer cette Release");
		expect(html).toContain("/_emdash/api/superboard/releases/activate");
		expect(html).not.toContain("/_emdash/api/superboard/releases/approve");
		expect(html).not.toContain("Approuver cette Release");
	});
});
