import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";

import {
	assertRendererCompatibility,
	compileFrontRelease,
	resolveFrontRequest,
} from "@superboard/supbrd-core";
import { expect, test } from "vitest";

import {
	CORE_ADMIN_SHELL_DESCRIPTOR,
	SUPBRD_CORE_ARTIFACT_CHECKSUM,
	composeUserFrontReleaseInput,
	visibleUserNavigation,
} from "../src/lib/user-front-release.js";

const identifiers = {
	instance_id: "vocostar",
	front_draft_id: "01J00000000000000000000201",
	draft_snapshot_id: "01J00000000000000000000202",
	compilation_id: "01J00000000000000000000203",
	candidate_id: "01J00000000000000000000204",
	release_id: "01J00000000000000000000205",
	release_sequence: 1,
	previous_release_id: null,
	created_at: "2026-08-30T00:30:00.000Z",
};

test("composes the next release against the exact active predecessor", async () => {
	const input = await composeUserFrontReleaseInput({
		...identifiers,
		candidate_id: "01J00000000000000000000206",
		release_id: "01J00000000000000000000207",
		release_sequence: 2,
		previous_release_id: identifiers.release_id,
	});
	expect(input.release_sequence).toBe(2);
	expect(input.previous_release_id).toBe(identifiers.release_id);
});

test("the Site composes a permission-filtered user slice from plugin contributions", async () => {
	const input = await composeUserFrontReleaseInput(identifiers);
	const runtime = {
		front_route_manifest: { ...input.front_route_manifest, route_manifest_checksum: "checksum" },
		dependency_policies: input.dependency_policies,
	};
	expect(
		resolveFrontRequest({
			last_verified_release: runtime,
			requested_path: "/login",
			admin_session: "absent",
			permissions: [],
			dependency_health: { "dependency.supbrd_plug_user": "ready" },
		}).result,
	).toBe("rendered");
	expect(
		resolveFrontRequest({
			last_verified_release: runtime,
			requested_path: "/app/users",
			admin_session: "absent",
			application_token_audience: "vocostar.application",
			permissions: ["users.read"],
			dependency_health: { "dependency.supbrd_plug_user": "ready" },
		}).result,
	).toBe("redirect");
	expect(visibleUserNavigation(input, [])).toHaveLength(0);
	expect(visibleUserNavigation(input, ["users.read"])).toHaveLength(2);
});

test("compiles the complete Site composition with every validation receipt passing", async () => {
	const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
		"sign",
		"verify",
	]);
	const release = await compileFrontRelease(await composeUserFrontReleaseInput(identifiers), {
		kid: "user-slice-test-key",
		private_key: keys.privateKey,
	});
	expect(release.validation_receipts.every(({ status }) => status === "passed")).toBe(true);
});

test("rejects an ABI-incompatible EmDash admin root descriptor", () => {
	expect(() =>
		assertRendererCompatibility(
			{ ...CORE_ADMIN_SHELL_DESCRIPTOR, abi_version: "2.0.0" },
			{ abi_version: "1.0.0", runtime_version: "0.1.0" },
		),
	).toThrow(/compatibility rejected/u);
});

test("pins the real admin shell and Core source artifacts", async () => {
	const shellSource = await readFile(new URL("../src/components/FrontPage.astro", import.meta.url));
	expect(`sha256:${createHash("sha256").update(shellSource).digest("hex")}`).toBe(
		CORE_ADMIN_SHELL_DESCRIPTOR.build_checksum,
	);

	const coreDirectory = new URL("../../../packages/supbrd-core/src/", import.meta.url);
	const names = (await readdir(coreDirectory))
		.filter((name) => name.endsWith(".ts") || name.endsWith(".js"))
		.toSorted();
	const coreHash = createHash("sha256");
	for (const name of names) {
		coreHash.update(name);
		coreHash.update("\0");
		coreHash.update(await readFile(new URL(name, coreDirectory)));
		coreHash.update("\0");
	}
	expect(`sha256:${coreHash.digest("hex")}`).toBe(SUPBRD_CORE_ARTIFACT_CHECKSUM);
});
