import { describe, expect, test } from "vitest";

import { compileFrontRelease, verifyFrontRelease } from "../src/index.js";

const REQUIRED_STATES = [
	"loading",
	"empty",
	"forbidden",
	"not_found",
	"error",
	"unavailable",
	"maintenance",
] as const;

function validReleaseInput() {
	return {
		schema_version: "1.0.0",
		compiler_version: "0.1.0",
		instance_id: "vocostar",
		front_draft_id: "01J00000000000000000000001",
		draft_snapshot_id: "01J00000000000000000000002",
		compilation_id: "01J00000000000000000000003",
		candidate_id: "01J00000000000000000000004",
		release_id: "01J00000000000000000000005",
		release_sequence: 1,
		previous_release_id: null,
		created_at: "2026-08-29T18:00:00.000Z",
		front_route_manifest: {
			schema_version: "1.0.0",
			manifest_id: "01J00000000000000000000006",
				normalization: {
				unicode: "NFC",
				case_sensitive: true,
				trailing_slash: "strip",
					percent_decoding: "once",
				},
				auth_transitions: {
					login_route_id: "superboard.login",
					authenticated_home_route_id: "superboard.login",
				},
				system_routes: [
				{
					route_id: "system.superboard_health",
					path_pattern: "/superboard-system/health",
					route_kind: "system",
					audience: "system",
					auth_policy: "public",
					permission_expression: "allow",
					priority: 1_000,
					parameters: {},
					query: {},
					page_id: null,
					layout_ids: [],
					renderer_ids: [],
					state_policies: Object.fromEntries(
						REQUIRED_STATES.map((state) => [state, `emdash.core.state.${state}`]),
					),
					dependencies: [],
					redirect: null,
				},
			],
			routes: [
				{
					route_id: "superboard.login",
					path_pattern: "/login",
					route_kind: "page",
					audience: "superboard_front",
					auth_policy: "anonymous_only",
					permission_expression: "allow",
					priority: 100,
					parameters: {},
					query: {},
					page_id: "page.superboard_login",
					layout_ids: ["layout.superboard_public"],
					renderer_ids: ["supbrd-plug-user.renderer.login_form"],
					state_policies: Object.fromEntries(
						REQUIRED_STATES.map((state) => [state, `emdash.core.state.${state}`]),
					),
					dependencies: ["dependency.supbrd_plug_user"],
					redirect: null,
				},
			],
		},
		gateway_manifest: {
			schema_version: "1.0.0",
			gateway_manifest_id: "01J00000000000000000000007",
			routes: [
				{
					route_id: "gateway.health",
					method: "GET",
					path_pattern: "/superboard-system/health",
					destination: "site",
					auth_policy: "public",
					audience: "system",
					scopes: [],
					timeout_ms: 1_000,
				},
			],
		},
		presentation: {
			pages: [
				{
					page_id: "page.superboard_login",
					title: "Sign in",
					root_renderer_id: "supbrd-plug-user.renderer.login_form",
				},
			],
			layouts: [
				{
					layout_id: "layout.superboard_public",
					root_renderer_id: "emdash.core.renderer.public_shell",
				},
			],
			navigation: [],
			translations: [],
			media: [],
			theme: { theme_id: "theme.superboard", tokens: {} },
		},
		renderers: [
			{
				renderer_id: "supbrd-plug-user.renderer.login_form",
				plugin_id: "supbrd-plug-user",
				plugin_version: "1.0.0",
				build_id: "01J00000000000000000000008",
				build_checksum: `sha256:${"a".repeat(64)}`,
				abi_version: "1.0.0",
				runtime_range: ">=0.1.0 <0.2.0",
				props_schema: {
					schema_id: "supbrd-plug-user.schema.login-form-props",
					version: "1.0.0",
					checksum: `sha256:${"b".repeat(64)}`,
				},
				capabilities: [],
				slots: [],
				supported_states: [...REQUIRED_STATES],
			},
		],
		plugin_lock: [
			{
				plugin_id: "supbrd-core",
				version: "0.1.0",
				artifact_checksum: `sha256:${"c".repeat(64)}`,
				native: true,
			},
			{
				plugin_id: "supbrd-plug-user",
				version: "1.0.0",
				artifact_checksum: `sha256:${"d".repeat(64)}`,
				native: false,
			},
		],
		dependency_policies: [
			{
				dependency_id: "dependency.supbrd_plug_user",
				kind: "required",
				minimum_version: "1.0.0",
				activation_policy: "ready",
				runtime_failure_policy: "unavailable",
				fallback_dependency_id: null,
			},
		],
		rollback: {
			classification: "pointer_only",
			restore_point_id: null,
			conditions: [],
		},
		core_concrete_pages: [],
	};
}

describe("Front Release compiler", () => {
	test("binds the exact canonical payload to an ES256 signature", async () => {
		const keys = await crypto.subtle.generateKey(
			{ name: "ECDSA", namedCurve: "P-256" },
			true,
			["sign", "verify"],
		);
		const release = await compileFrontRelease(validReleaseInput(), {
			kid: "release-key-2026-08",
			private_key: keys.privateKey,
		});

		expect(release.content_checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(release.signature).toMatchObject({ algorithm: "ES256", kid: "release-key-2026-08" });
		expect(
			await verifyFrontRelease(release, {
				kid: "release-key-2026-08",
				public_key: keys.publicKey,
			}),
		).toEqual({ valid: true, errors: [] });

		const tampered = structuredClone(release);
		tampered.payload.presentation.pages[0]!.title = "Tampered";
		const verification = await verifyFrontRelease(tampered, {
			kid: "release-key-2026-08",
			public_key: keys.publicKey,
		});
		expect(verification.valid).toBe(false);
		expect(verification.errors).toContain("CONTENT_CHECKSUM_MISMATCH");

		const tamperedReceipt = structuredClone(release);
		tamperedReceipt.validation_receipts[0]!.message = "Tampered receipt";
		const receiptVerification = await verifyFrontRelease(tamperedReceipt, {
			kid: "release-key-2026-08",
			public_key: keys.publicKey,
		});
		expect(receiptVerification.valid).toBe(false);
		expect(receiptVerification.errors).toContain("VALIDATION_RECEIPT_CHECKSUM_MISMATCH");
	});

	test("rejects unknown fields instead of signing an open payload", async () => {
		const keys = await crypto.subtle.generateKey(
			{ name: "ECDSA", namedCurve: "P-256" },
			true,
			["sign", "verify"],
		);
		const input = validReleaseInput() as ReturnType<typeof validReleaseInput> & {
			unexpected?: boolean;
		};
		input.unexpected = true;

		await expect(
			compileFrontRelease(input, {
				kid: "release-key-2026-08",
				private_key: keys.privateKey,
			}),
		).rejects.toThrow(/unknown.*unexpected/i);
	});
});
