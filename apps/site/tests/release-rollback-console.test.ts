import { describe, expect, test } from "vitest";

import { renderReleaseRollbackConsole } from "../src/lib/release-rollback-console.js";

describe("Release Rollback console", () => {
	test("shows the exact pointer-only rollback without approval or activation controls", () => {
		const html = renderReleaseRollbackConsole({
			rollback_activation_id: "01M1919PWEV8TEKQ9PGKHYXM5M",
			current_release_id: "01M1919PWED5VBX5FK1VBHCTGS",
			target_candidate_id: "01M190CCWSG2XAX372WM488H6S",
			target_release_id: "01M190CCWS162J978MKGDEYS0Z",
			target_content_checksum:
				"sha256:85c1460b7db8540aa5cb4cebbd35734a6a4145c9ff8595595018a0b6c20e8bf4",
			target_validation_set_checksum:
				"sha256:0a5914ff8097ff9e8a714a93e7d3e859a1348471ebf19f2119283b2098240651",
			next_pointer_revision: 3,
			reauthentication_ready: true,
		});
		expect(html).toContain("01M1919PWED5VBX5FK1VBHCTGS");
		expect(html).toContain("01M190CCWS162J978MKGDEYS0Z");
		expect(html).toContain("Retourner vers cette Release");
		expect(html).toContain("/_emdash/api/superboard/releases/rollback");
		expect(html).not.toContain("/_emdash/api/superboard/releases/activate");
		expect(html).not.toContain("/_emdash/api/superboard/releases/approve");
	});
});
