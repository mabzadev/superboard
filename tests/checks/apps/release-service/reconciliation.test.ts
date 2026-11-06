import type { PackageRelease } from "@emdash-cms/registry-lexicons";
import { NSID } from "@emdash-cms/registry-lexicons";
import { describe, expect, it } from "vitest";

import { reconcileReleaseRecord } from "../../../../apps/release-service/src/publishing/reconcile.js";
import releaseFixture from "../../../fixtures/registry-verification/records/release.json";

const DID = "did:plc:publisher";
const PACKAGE = "gallery";
const VERSION = "1.2.3";
const URI = `at://${DID}/${NSID.packageRelease}/${PACKAGE}:${VERSION}`;

describe("release reconciliation", () => {
	it("distinguishes absence, exact semantic replay, and conflict", () => {
		const expected = structuredClone(releaseFixture) as PackageRelease.Main;
		expect(reconcileReleaseRecord(DID, PACKAGE, VERSION, expected, null)).toEqual({
			outcome: "absent",
		});
		expect(
			reconcileReleaseRecord(DID, PACKAGE, VERSION, expected, {
				uri: URI,
				cid: "bafyexact",
				value: { ...structuredClone(expected) },
			}),
		).toEqual({ outcome: "exact", uri: URI, cid: "bafyexact" });
		expect(
			reconcileReleaseRecord(DID, PACKAGE, VERSION, expected, {
				uri: URI,
				cid: "bafyconflict",
				value: { ...structuredClone(expected), version: "9.9.9" },
			}),
		).toEqual({ outcome: "conflict" });
	});
});
