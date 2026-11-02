import { is, safeParse } from "@atcute/lexicons/validations";
import { describe, expect, it } from "vitest";

import {
	getDelegatedReleasePermission,
	NSID,
	PackageProfile,
	PackageProfileExtension,
	PackageRelease,
	PackageReleaseExtension,
	PublisherProfile,
} from "../../../../packages/registry-lexicons/src/index.js";

describe("delegated release permission", () => {
	it("exposes only the active release collection's create scope", () => {
		const permission = getDelegatedReleasePermission();

		expect(permission).toEqual({
			collection: NSID.packageRelease,
			scope: "atproto repo:com.emdashcms.experimental.package.release?action=create",
		});
		expect(Object.isFrozen(permission)).toBe(true);
		expect(permission.scope).not.toContain("transition:generic");
	});
});

describe("PackageProfile", () => {
	it("validates a minimal valid profile", () => {
		const profile: PackageProfile.Main = {
			$type: NSID.packageProfile,
			id: "at://did:plc:abc123/com.emdashcms.experimental.package.profile/gallery",
			type: "emdash-plugin",
			license: "MIT",
			authors: [{ name: "Alice Example", url: "https://alice.example.com" }],
			security: [{ email: "security@example.com" }],
		};

		const result = safeParse(PackageProfile.mainSchema, profile);
		expect(result.ok).toBe(true);
	});

	it("rejects a profile missing required authors", () => {
		const bad = {
			$type: NSID.packageProfile,
			id: "at://did:plc:abc123/com.emdashcms.experimental.package.profile/gallery",
			type: "emdash-plugin",
			license: "MIT",
			security: [{ email: "security@example.com" }],
		};

		expect(is(PackageProfile.mainSchema, bad)).toBe(false);
	});

	it("rejects a profile with empty authors array", () => {
		const bad = {
			$type: NSID.packageProfile,
			id: "at://did:plc:abc123/com.emdashcms.experimental.package.profile/gallery",
			type: "emdash-plugin",
			license: "MIT",
			authors: [],
			security: [{ email: "security@example.com" }],
		};

		expect(is(PackageProfile.mainSchema, bad)).toBe(false);
	});

	it("rejects a profile with a non-AT-URI id", () => {
		const bad = {
			$type: NSID.packageProfile,
			id: "https://example.com/not-an-at-uri",
			type: "emdash-plugin",
			license: "MIT",
			authors: [{ name: "Alice" }],
			security: [{ email: "security@example.com" }],
		};

		expect(is(PackageProfile.mainSchema, bad)).toBe(false);
	});

	it("accepts known package types and arbitrary x- types", () => {
		const known: PackageProfile.Main = {
			$type: NSID.packageProfile,
			id: "at://did:plc:abc/com.emdashcms.experimental.package.profile/p1",
			type: "emdash-plugin",
			license: "MIT",
			authors: [{ name: "A" }],
			security: [{ email: "security@example.com" }],
		};

		const custom: PackageProfile.Main = {
			...known,
			type: "x-custom-host",
		};

		expect(is(PackageProfile.mainSchema, known)).toBe(true);
		expect(is(PackageProfile.mainSchema, custom)).toBe(true);
	});

	it("intentionally treats extension entries as opaque until consumers dispatch them", () => {
		const profile: PackageProfile.Main = {
			$type: NSID.packageProfile,
			id: "at://did:plc:abc123/com.emdashcms.experimental.package.profile/gallery",
			type: "emdash-plugin",
			license: "MIT",
			authors: [{ name: "Alice Example" }],
			security: [{ email: "security@example.com" }],
			extensions: {
				[NSID.packageProfileExtension]: "not validated by the base profile schema",
			},
		};

		expect(safeParse(PackageProfile.mainSchema, profile)).toMatchObject({ ok: true });
		expect(
			is(PackageProfileExtension.mainSchema, {
				$type: NSID.packageProfileExtension,
				repository: "https://github.com/example/gallery",
			}),
		).toBe(true);
	});
});

describe("PackageProfileExtension", () => {
	it("round-trips a release policy", () => {
		const extension: PackageProfileExtension.Main = {
			$type: NSID.packageProfileExtension,
			repository: "https://github.com/example/gallery",
			releasePolicy: {
				requireProvenance: true,
				confirmation: "always",
				approvers: ["did:plc:abc123"],
			},
		};

		expect(safeParse(PackageProfileExtension.mainSchema, extension)).toMatchObject({ ok: true });
	});

	it("accepts an absent policy", () => {
		expect(
			is(PackageProfileExtension.mainSchema, {
				$type: NSID.packageProfileExtension,
				repository: "https://github.com/example/gallery",
			}),
		).toBe(true);
	});

	it("rejects invalid repository URIs, approver DIDs, and oversized approver lists", () => {
		expect(
			is(PackageProfileExtension.mainSchema, {
				$type: NSID.packageProfileExtension,
				repository: "not-a-uri",
			}),
		).toBe(false);
		expect(
			is(PackageProfileExtension.mainSchema, {
				$type: NSID.packageProfileExtension,
				repository: "https://github.com/example/gallery",
				releasePolicy: { approvers: ["not-a-did"] },
			}),
		).toBe(false);
		expect(
			is(PackageProfileExtension.mainSchema, {
				$type: NSID.packageProfileExtension,
				repository: "https://github.com/example/gallery",
				releasePolicy: {
					approvers: Array.from({ length: 33 }, (_, index) => `did:plc:${index}`),
				},
			}),
		).toBe(false);
	});

	it("intentionally defers unknown confirmation values and duplicate approvers to consumers", () => {
		expect(
			is(PackageProfileExtension.mainSchema, {
				$type: NSID.packageProfileExtension,
				repository: "https://github.com/example/gallery",
				releasePolicy: {
					confirmation: "manual-review",
					approvers: ["did:plc:abc123", "did:plc:abc123"],
				},
			}),
		).toBe(true);
	});
});

describe("PackageRelease", () => {
	it("validates a minimal valid release", () => {
		const release: PackageRelease.Main = {
			$type: NSID.packageRelease,
			package: "gallery",
			version: "1.0.0",
			artifacts: {
				package: {
					url: "https://github.com/example/gallery/releases/download/v1.0.0/gallery.tar.gz",
					checksum: "bciqkkpvkbtfcwq6kjkbq3kgjxe5j6ihzkxlfxkzqhwzaaaa3wkbq3a",
				},
			},
		};

		const result = safeParse(PackageRelease.mainSchema, release);
		expect(result.ok).toBe(true);
	});

	it("rejects a release without a package artifact", () => {
		const bad = {
			$type: NSID.packageRelease,
			package: "gallery",
			version: "1.0.0",
			artifacts: {
				icon: {
					url: "https://example.com/icon.png",
					checksum: "bcixyz",
				},
			},
		};

		expect(is(PackageRelease.mainSchema, bad)).toBe(false);
	});
});

describe("PackageReleaseExtension", () => {
	it("intentionally leaves unknown provenance predicates for consumer verification", () => {
		const extension: PackageReleaseExtension.Main = {
			$type: NSID.packageReleaseExtension,
			declaredAccess: {},
			provenance: {
				predicateType: "https://example.com/provenance/v2",
				url: "https://github.com/example/gallery/attestation.json",
				checksum: "bciqkkpvkbtfcwq6kjkbq3kgjxe5j6ihzkxlfxkzqhwzaaaa3wkbq3a",
				sourceRepository: "https://github.com/example/gallery",
				builderId:
					"https://github.com/example/gallery/.github/workflows/release.yml@refs/heads/main",
			},
		};

		expect(safeParse(PackageReleaseExtension.mainSchema, extension)).toMatchObject({ ok: true });
	});

	it("rejects incomplete provenance", () => {
		expect(
			is(PackageReleaseExtension.mainSchema, {
				$type: NSID.packageReleaseExtension,
				declaredAccess: {},
				provenance: {
					predicateType: "https://slsa.dev/provenance/v1",
					url: "https://github.com/example/gallery/attestation.json",
				},
			}),
		).toBe(false);
	});

	it("does not enforce profile policy across records", () => {
		expect(
			is(PackageProfileExtension.mainSchema, {
				$type: NSID.packageProfileExtension,
				repository: "https://github.com/example/gallery",
				releasePolicy: { requireProvenance: true },
			}),
		).toBe(true);
		expect(
			is(PackageReleaseExtension.mainSchema, {
				$type: NSID.packageReleaseExtension,
				declaredAccess: {},
			}),
		).toBe(true);
	});
});

describe("PublisherProfile", () => {
	it("validates a publisher profile with only required fields", () => {
		const profile: PublisherProfile.Main = {
			$type: NSID.publisherProfile,
			displayName: "Acme Plugin Co.",
		};

		expect(is(PublisherProfile.mainSchema, profile)).toBe(true);
	});

	it("rejects a publisher profile missing displayName", () => {
		const bad = {
			$type: NSID.publisherProfile,
			description: "Plugins for the cool kids",
		};

		expect(is(PublisherProfile.mainSchema, bad)).toBe(false);
	});
});

describe("NSID map", () => {
	it("has every NSID we generated a module for", () => {
		const expected = [
			"com.emdashcms.experimental.package.profile",
			"com.emdashcms.experimental.package.profileExtension",
			"com.emdashcms.experimental.package.release",
			"com.emdashcms.experimental.package.releaseExtension",
			"com.emdashcms.experimental.publisher.profile",
			"com.emdashcms.experimental.publisher.verification",
			"com.emdashcms.experimental.aggregator.defs",
			"com.emdashcms.experimental.aggregator.getLatestRelease",
			"com.emdashcms.experimental.aggregator.getPackage",
			"com.emdashcms.experimental.aggregator.listReleases",
			"com.emdashcms.experimental.aggregator.resolvePackage",
			"com.emdashcms.experimental.aggregator.searchPackages",
			"com.emdashcms.experimental.labeler.defs",
			"com.emdashcms.experimental.labeler.getAssessment",
			"com.emdashcms.experimental.labeler.getCurrentAssessment",
			"com.emdashcms.experimental.labeler.getPolicy",
			"com.emdashcms.experimental.labeler.listAssessments",
		].toSorted();

		const actual = Object.values(NSID).toSorted();
		expect(actual).toEqual(expected);
	});
});
