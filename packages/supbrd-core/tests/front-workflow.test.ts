import { describe, expect, test } from "vitest";

import {
	approveFrontReleaseCandidate,
	createFrontPreview,
	createOperatorReauthenticationReceipt,
	planPointerRollback,
	snapshotFrontDraft,
	updateFrontDraft,
	validateFrontReleaseCandidate,
	type CompiledFrontRelease,
	type FrontDraft,
	type FrontReleaseCandidateRecord,
} from "../src/index.js";

function release(): CompiledFrontRelease {
	return {
		payload: {
			instance_id: "vocostar",
			front_draft_id: "01J00000000000000000000001",
			draft_snapshot_id: "01J00000000000000000000002",
			candidate_id: "01J00000000000000000000003",
			release_id: "01J00000000000000000000004",
			previous_release_id: "01J00000000000000000000000",
			rollback: { classification: "pointer_only", restore_point_id: null, conditions: [] },
		} as CompiledFrontRelease["payload"],
		content_checksum: `sha256:${"1".repeat(64)}`,
		signature: { algorithm: "ES256", kid: "release-key", value: "signature" },
		validation_receipts: [],
		validation_set_checksum: `sha256:${"2".repeat(64)}`,
		verification_status: "verified",
	};
}

function candidate(): FrontReleaseCandidateRecord {
	return { release: release(), status: "validated", approval: null };
}

function draft(): FrontDraft {
	return {
		front_draft_id: "01J00000000000000000000001",
		instance_id: "vocostar",
		revision: 4,
		input: { title: "Draft four" },
		updated_at: "2026-08-29T18:00:00.000Z",
	};
}

describe("Front Release workflow", () => {
	test("rejects a stale draft revision and snapshots the exact accepted revision", () => {
		expect(
			updateFrontDraft(draft(), {
				expected_draft_revision: 3,
				input: { title: "stale" },
				updated_at: "2026-08-29T18:01:00.000Z",
			}),
		).toEqual({ status: "conflict", current_revision: 4 });

		const updated = updateFrontDraft(draft(), {
			expected_draft_revision: 4,
			input: { title: "Draft five" },
			updated_at: "2026-08-29T18:01:00.000Z",
		});
		expect(updated.status).toBe("updated");
		if (updated.status !== "updated") throw new Error("expected updated draft");
		const snapshot = snapshotFrontDraft(
			updated.draft,
			"01J00000000000000000000002",
			"2026-08-29T18:02:00.000Z",
		);
		expect(snapshot.draft_revision).toBe(5);
		expect(snapshot.input).toEqual({ title: "Draft five" });
		updated.draft.input = { title: "later mutation" };
		expect(snapshot.input).toEqual({ title: "Draft five" });
	});

	test("preview is candidate-exact, mutation-free and bounded to 24 hours", () => {
		const record = candidate();
		const preview = createFrontPreview(record, {
			preview_id: "01J00000000000000000000005",
			issued_at: "2026-08-29T18:00:00.000Z",
			expires_at: "2026-08-30T18:00:00.000Z",
		});
		expect(preview).toMatchObject({
			audience: "front_preview",
			candidate_id: record.release.payload.candidate_id,
			mutation_mode: "dry_run",
		});
		expect(() =>
			createFrontPreview(record, {
				preview_id: "01J00000000000000000000006",
				issued_at: "2026-08-29T18:00:00.000Z",
				expires_at: "2026-08-30T18:00:00.001Z",
			}),
		).toThrow(/24 hours/u);
	});

	test("approval is bound to strong reauthentication and exact candidate evidence", async () => {
		const record = candidate();
		const receipt = await createOperatorReauthenticationReceipt({
			receipt_id: "01J00000000000000000000007",
			operator_id: "operator-1",
			instance_id: "vocostar",
			action: "front_release.approve",
			candidate_id: record.release.payload.candidate_id,
			reauthenticated_at: "2026-08-29T18:00:00.000Z",
			expires_at: "2026-08-29T18:05:00.000Z",
		});
		const approved = await approveFrontReleaseCandidate(record, {
			reauthentication: receipt,
			approved_at: "2026-08-29T18:01:00.000Z",
			warnings_acknowledged: [],
		});
		expect(approved.status).toBe("approved");

		const expired = await approveFrontReleaseCandidate(record, {
			reauthentication: receipt,
			approved_at: "2026-08-29T18:06:00.000Z",
			warnings_acknowledged: [],
		});
		expect(expired).toEqual({ status: "rejected", code: "STRONG_REAUTH_EXPIRED" });

		const mismatch = structuredClone(receipt);
		mismatch.candidate_id = "01J00000000000000000000099";
		expect(
			await approveFrontReleaseCandidate(record, {
				reauthentication: mismatch,
				approved_at: "2026-08-29T18:01:00.000Z",
				warnings_acknowledged: [],
			}),
		).toEqual({ status: "rejected", code: "REAUTHENTICATION_RECEIPT_INVALID" });
	});

	test("approval requires every validation warning to be acknowledged", async () => {
		const record = candidate();
		record.release.validation_receipts = [
			{
				receipt_id: "warning-receipt",
				layer: "translations_media",
				level: "warning",
				status: "passed",
				candidate_id: record.release.payload.candidate_id,
				release_id: record.release.payload.release_id,
				content_checksum: record.release.content_checksum,
				message: "Media fallback acknowledged",
				receipt_checksum: `sha256:${"3".repeat(64)}`,
			},
		];
		const receipt = await createOperatorReauthenticationReceipt({
			receipt_id: "01J00000000000000000000017",
			operator_id: "operator-1",
			instance_id: "vocostar",
			action: "front_release.approve",
			candidate_id: record.release.payload.candidate_id,
			reauthenticated_at: "2026-08-29T18:00:00.000Z",
			expires_at: "2026-08-29T18:05:00.000Z",
		});
		expect(
			await approveFrontReleaseCandidate(record, {
				reauthentication: receipt,
				approved_at: "2026-08-29T18:01:00.000Z",
				warnings_acknowledged: [],
			}),
		).toEqual({ status: "rejected", code: "WARNINGS_NOT_ACKNOWLEDGED" });
	});

	test("activation preflight rejects retired keys and tampered validation receipts", () => {
		const record = candidate();
		expect(
			validateFrontReleaseCandidate(record, {
				signing_key_status: "retired",
				verification: { valid: true, errors: [] },
				dependencies_ready: true,
				renderers_ready: true,
				gateway_ready: true,
				stores_ready: true,
				migrations_ready: true,
				workers_ready: true,
				secrets_ready: true,
				media_ready: true,
				rollback_ready: true,
			}),
		).toEqual({ valid: false, errors: ["SIGNING_KEY_RETIRED"] });
		expect(
			validateFrontReleaseCandidate(record, {
				signing_key_status: "active",
				verification: { valid: false, errors: ["VALIDATION_RECEIPT_CHECKSUM_MISMATCH"] },
				dependencies_ready: true,
				renderers_ready: true,
				gateway_ready: true,
				stores_ready: true,
				migrations_ready: true,
				workers_ready: true,
				secrets_ready: true,
				media_ready: true,
				rollback_ready: true,
			}),
		).toEqual({ valid: false, errors: ["VALIDATION_RECEIPT_CHECKSUM_MISMATCH"] });
	});

	test("rollback is pointer-only and refuses an incompatible previous release", async () => {
		const record = candidate();
		const reauthentication = await createOperatorReauthenticationReceipt({
			receipt_id: "01J00000000000000000000008",
			operator_id: "operator-1",
			instance_id: "vocostar",
			action: "front_release.rollback",
			candidate_id: record.release.payload.candidate_id,
			reauthenticated_at: "2026-08-29T18:00:00.000Z",
			expires_at: "2026-08-29T18:05:00.000Z",
		});
		expect(
			await planPointerRollback(
				{
					instance_id: "vocostar",
					active_release_id: "01J00000000000000000000009",
					previous_release_id: record.release.payload.release_id,
					pointer_revision: 2,
					activation_id: "01J00000000000000000000010",
					activated_at: "2026-08-29T17:00:00.000Z",
				},
				record,
				reauthentication,
				"2026-08-29T18:01:00.000Z",
			),
		).toMatchObject({ status: "ready", target_release_id: record.release.payload.release_id });

		const incompatible = structuredClone(record);
		incompatible.release.payload.rollback.classification = "restore_required";
		expect(
			await planPointerRollback(
				{
					instance_id: "vocostar",
					active_release_id: "01J00000000000000000000009",
					previous_release_id: incompatible.release.payload.release_id,
					pointer_revision: 2,
					activation_id: "01J00000000000000000000010",
					activated_at: "2026-08-29T17:00:00.000Z",
				},
				incompatible,
				reauthentication,
				"2026-08-29T18:01:00.000Z",
			),
		).toEqual({ status: "rejected", code: "ROLLBACK_RESTORE_REQUIRED" });
	});
});
