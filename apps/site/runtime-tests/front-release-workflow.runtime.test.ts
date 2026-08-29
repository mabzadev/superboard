import type { CompiledFrontRelease, ReleaseApproval } from "@superboard/supbrd-core";
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";

import {
	loadDraftSnapshot,
	persistDraftSnapshot,
	saveFrontDraft,
} from "../src/lib/front-workflow-repository.js";
import {
	createD1FrontReleaseRepository,
	persistReleaseApproval,
	stageCompiledFrontRelease,
} from "../src/lib/release-repository.js";

function release(): CompiledFrontRelease {
	return {
		payload: {
			instance_id: "vocostar",
			candidate_id: "candidate-runtime",
			release_id: "release-runtime",
			previous_release_id: null,
		} as CompiledFrontRelease["payload"],
		content_checksum: `sha256:${"1".repeat(64)}`,
		signature: { algorithm: "ES256", kid: "runtime-key", value: "signature" },
		validation_receipts: [],
		validation_set_checksum: `sha256:${"2".repeat(64)}`,
		verification_status: "verified",
	};
}

describe("Site Front Release D1 workflow", () => {
	test("persists one immutable snapshot behind draft revision CAS", async () => {
		const created = await saveFrontDraft(env.DB, {
			front_draft_id: "draft-runtime",
			instance_id: "vocostar",
			expected_draft_revision: 0,
			value: { title: "First" },
			updated_at: "2026-08-30T00:00:00.000Z",
		});
		expect(created.status).toBe("updated");
		const conflict = await saveFrontDraft(env.DB, {
			front_draft_id: "draft-runtime",
			instance_id: "vocostar",
			expected_draft_revision: 0,
			value: { title: "Stale" },
			updated_at: "2026-08-30T00:01:00.000Z",
		});
		expect(conflict).toEqual({ status: "conflict", current_revision: 1 });
		await persistDraftSnapshot(env.DB, {
			draft_snapshot_id: "snapshot-runtime",
			front_draft_id: "draft-runtime",
			instance_id: "vocostar",
			draft_revision: 1,
			input: { title: "First" },
			created_at: "2026-08-30T00:02:00.000Z",
		});
		expect(await loadDraftSnapshot(env.DB, "snapshot-runtime")).toMatchObject({
			draft_revision: 1,
			input: { title: "First" },
		});
	});

	test("activates atomically and rejects a stale active pointer", async () => {
		const candidate = release();
		await stageCompiledFrontRelease(
			env.DB,
			candidate,
			{ kty: "EC", crv: "P-256", x: "x", y: "y", kid: "runtime-key" },
			"2026-08-30T00:00:00.000Z",
		);
		const approval: ReleaseApproval = {
			operator_id: "operator-runtime",
			candidate_id: candidate.payload.candidate_id,
			release_id: candidate.payload.release_id,
			content_checksum: candidate.content_checksum,
			signature: candidate.signature,
			validation_set_checksum: candidate.validation_set_checksum,
			warnings_acknowledged: [],
			approved_at: "2026-08-30T00:01:00.000Z",
			reauthenticated_at: "2026-08-30T00:00:30.000Z",
		};
		expect(await persistReleaseApproval(env.DB, approval)).toBe(true);
		const repository = createD1FrontReleaseRepository(env.DB);
		const stored = await repository.getCandidate(candidate.payload.candidate_id);
		if (!stored) throw new Error("candidate was not persisted");
		expect(
			await repository.compareAndSwapActive({
				candidate: stored,
				command: {
					instance_id: "vocostar",
					candidate_id: candidate.payload.candidate_id,
					activation_id: "activation-runtime",
					expected_active_release_id: null,
					approval,
					activated_at: "2026-08-30T00:02:00.000Z",
				},
			}),
		).toMatchObject({ status: "activated", pointer_revision: 1 });
		expect(
			await repository.compareAndSwapActive({
				candidate: stored,
				command: {
					instance_id: "vocostar",
					candidate_id: candidate.payload.candidate_id,
					activation_id: "activation-stale",
					expected_active_release_id: null,
					approval,
					activated_at: "2026-08-30T00:03:00.000Z",
				},
			}),
		).toMatchObject({ status: "conflict", active_release_id: "release-runtime" });
		const outbox = await env.DB.prepare(
			"SELECT COUNT(*) AS count FROM superboard_front_outbox WHERE event_type = 'front_release.activated'",
		).first<{ count: number }>();
		expect(outbox?.count).toBe(1);
	});
});
