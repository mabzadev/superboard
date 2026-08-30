import type {
	ActiveFrontReleasePointer,
	CompiledFrontRelease,
	FrontReleaseActivationResult,
	FrontReleaseCandidateRecord,
	FrontReleaseRepository,
	ReleaseApproval,
} from "@superboard/supbrd-core";
import {
	canonicalizeReleasePayload,
	parseCompiledFrontReleaseJson,
	parseReleaseApprovalJson,
} from "@superboard/supbrd-core";

interface CandidateRow {
	release_json: string;
	status: FrontReleaseCandidateRecord["status"];
	approval_json: string | null;
}

interface ActiveRow {
	instance_id: string;
	active_release_id: string;
	previous_release_id: string | null;
	pointer_revision: number;
	activation_id: string;
	activated_at: string;
}

export function createD1FrontReleaseRepository(db: D1Database): FrontReleaseRepository {
	return {
		async getCandidate(candidateId) {
			const row = await db
				.prepare(
					`SELECT release_json, status, approval_json
					 FROM superboard_front_release_candidates
					 WHERE candidate_id = ?`,
				)
				.bind(candidateId)
				.first<CandidateRow>();
			return row ? candidateFromRow(row) : null;
		},
		async getActive(instanceId) {
			const row = await db
				.prepare(
					`SELECT instance_id, active_release_id, previous_release_id,
					        pointer_revision, activation_id, activated_at
					 FROM superboard_front_active_releases
					 WHERE instance_id = ?`,
				)
				.bind(instanceId)
				.first<ActiveRow>();
			return row ? activeFromRow(row) : null;
		},
		async compareAndSwapActive({ candidate, command }) {
			const before = await this.getActive(command.instance_id);
			if ((before?.active_release_id ?? null) !== command.expected_active_release_id) {
				return {
					status: "conflict",
					active_release_id: before?.active_release_id ?? null,
					pointer_revision: before?.pointer_revision ?? 0,
				};
			}
			const receipt = command.reauthentication;
			const [, activationResult] = await db.batch([
				db
					.prepare(
						`INSERT INTO superboard_operator_reauthentication_receipts (
						   receipt_id, operator_id, instance_id, action, candidate_id,
						   reauthenticated_at, expires_at, receipt_checksum, created_at
						 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					)
					.bind(
						receipt.receipt_id,
						receipt.operator_id,
						receipt.instance_id,
						receipt.action,
						receipt.candidate_id,
						receipt.reauthenticated_at,
						receipt.expires_at,
						receipt.receipt_checksum,
						command.activated_at,
					),
				db
					.prepare(
						`INSERT INTO superboard_front_active_releases (
						   instance_id, active_release_id, previous_release_id,
						   pointer_revision, activation_id, activated_at
						 ) VALUES (?, ?, NULL, 1, ?, ?)
						 ON CONFLICT(instance_id) DO UPDATE SET
						   previous_release_id = superboard_front_active_releases.active_release_id,
						   active_release_id = excluded.active_release_id,
						   pointer_revision = superboard_front_active_releases.pointer_revision + 1,
						   activation_id = excluded.activation_id,
						   activated_at = excluded.activated_at
						 WHERE superboard_front_active_releases.active_release_id IS ?
						 RETURNING instance_id, active_release_id, previous_release_id,
						           pointer_revision, activation_id, activated_at`,
					)
					.bind(
						command.instance_id,
						candidate.release.payload.release_id,
						command.activation_id,
						command.activated_at,
						command.expected_active_release_id,
					),
				db
					.prepare(
						`INSERT INTO superboard_front_activation_reauthentication (
						   activation_id, receipt_id, linked_at
						 ) SELECT activation_id, ?, ?
						 FROM superboard_front_activations
						 WHERE activation_id = ?`,
					)
					.bind(receipt.receipt_id, command.activated_at, command.activation_id),
			]);
			const row = activationResult.results[0] as ActiveRow | undefined;
			if (!row) {
				const current = await this.getActive(command.instance_id);
				return {
					status: "conflict",
					active_release_id: current?.active_release_id ?? null,
					pointer_revision: current?.pointer_revision ?? 0,
				};
			}
			return activationFromRow(row);
		},
	};
}

export async function stageCompiledFrontRelease(
	db: D1Database,
	release: CompiledFrontRelease,
	publicJwk: JsonWebKey,
	createdAt: string,
): Promise<void> {
	const normalizedPublicJwk: JsonWebKey = JSON.parse(JSON.stringify(publicJwk));
	const existingKey = await db
		.prepare("SELECT public_jwk FROM superboard_release_signing_keys WHERE kid = ?")
		.bind(release.signature.kid)
		.first<{ public_jwk: string }>();
	if (
		existingKey &&
		canonicalizeReleasePayload(JSON.parse(existingKey.public_jwk)) !==
			canonicalizeReleasePayload(normalizedPublicJwk)
	) {
		throw new Error("Release signing kid is already bound to another public key");
	}
	await db.batch([
		db
			.prepare(
				`UPDATE superboard_front_release_candidates
				 SET status = 'superseded'
				 WHERE instance_id = ? AND status = 'validated' AND candidate_id <> ?`,
			)
			.bind(release.payload.instance_id, release.payload.candidate_id),
		db
			.prepare(
				`INSERT INTO superboard_release_signing_keys (kid, public_jwk, status, created_at)
				 VALUES (?, ?, 'active', ?)
				 ON CONFLICT(kid) DO NOTHING`,
			)
			.bind(release.signature.kid, JSON.stringify(normalizedPublicJwk), createdAt),
		db
			.prepare(
				`INSERT INTO superboard_front_release_candidates (
				   candidate_id, instance_id, release_id, release_json, content_checksum,
				   validation_set_checksum, signing_kid, status, created_at
				 ) VALUES (?, ?, ?, ?, ?, ?, ?, 'validated', ?)`,
			)
			.bind(
				release.payload.candidate_id,
				release.payload.instance_id,
				release.payload.release_id,
				JSON.stringify(release),
				release.content_checksum,
				release.validation_set_checksum,
				release.signature.kid,
				createdAt,
			),
	]);
}

export async function persistReleaseApproval(
	db: D1Database,
	approval: ReleaseApproval,
	reauthenticationReceiptId?: string,
): Promise<boolean> {
	const update = db
		.prepare(
			`UPDATE superboard_front_release_candidates
			 SET status = 'approved', approval_json = ?, approved_at = ?
			 WHERE candidate_id = ? AND release_id = ? AND content_checksum = ?
			   AND validation_set_checksum = ? AND status = 'validated'`,
		)
		.bind(
			JSON.stringify(approval),
			approval.approved_at,
			approval.candidate_id,
			approval.release_id,
			approval.content_checksum,
			approval.validation_set_checksum,
		);
	if (!reauthenticationReceiptId) {
		const result = await update.run();
		return (result.meta.changes ?? 0) === 1;
	}
	const [result] = await db.batch([
		update,
		db
			.prepare(
				`INSERT INTO superboard_front_approval_reauthentication (
				   candidate_id, receipt_id, linked_at
				 ) SELECT candidate_id, ?, ?
				 FROM superboard_front_release_candidates
				 WHERE candidate_id = ? AND status = 'approved'
				   AND NOT EXISTS (
				     SELECT 1 FROM superboard_front_approval_reauthentication AS linked
				     WHERE linked.candidate_id = superboard_front_release_candidates.candidate_id
				   )`,
			)
			.bind(reauthenticationReceiptId, approval.approved_at, approval.candidate_id),
	]);
	return (result.meta.changes ?? 0) === 1;
}

export async function verifyActivationReceipts(
	db: D1Database,
	input: {
		activation_id: string;
		instance_id: string;
		active_release_id: string;
		pointer_revision: number;
	},
): Promise<boolean> {
	const row = await db
		.prepare(
			`SELECT
			   EXISTS(
			     SELECT 1 FROM superboard_front_activations
			     WHERE activation_id = ? AND instance_id = ?
			       AND active_release_id = ? AND pointer_revision = ?
			   ) AS history_exists,
			   EXISTS(
			     SELECT 1 FROM superboard_front_outbox
			     WHERE event_type = 'front_release.activated' AND instance_id = ?
			       AND release_id = ? AND pointer_revision = ?
			       AND json_extract(payload_json, '$.activation_id') = ?
			   ) AS outbox_exists,
			   EXISTS(
			     SELECT 1 FROM superboard_front_activation_reauthentication linked
			     JOIN superboard_operator_reauthentication_receipts receipt
			       ON receipt.receipt_id = linked.receipt_id
			     WHERE linked.activation_id = ?
			       AND receipt.action = 'front_release.activate'
			   ) AS reauthentication_exists`,
		)
		.bind(
			input.activation_id,
			input.instance_id,
			input.active_release_id,
			input.pointer_revision,
			input.instance_id,
			input.active_release_id,
			input.pointer_revision,
			input.activation_id,
			input.activation_id,
		)
		.first<{ history_exists: number; outbox_exists: number; reauthentication_exists: number }>();
	return (
		row?.history_exists === 1 && row.outbox_exists === 1 && row.reauthentication_exists === 1
	);
}

function candidateFromRow(row: CandidateRow): FrontReleaseCandidateRecord {
	return {
		release: parseCompiledFrontReleaseJson(row.release_json),
		status: row.status,
		approval: row.approval_json ? parseReleaseApprovalJson(row.approval_json) : null,
	};
}

function activeFromRow(row: ActiveRow): ActiveFrontReleasePointer {
	return { ...row };
}

function activationFromRow(row: ActiveRow): FrontReleaseActivationResult {
	return {
		status: "activated",
		active_release_id: row.active_release_id,
		previous_release_id: row.previous_release_id,
		pointer_revision: row.pointer_revision,
		activation_id: row.activation_id,
	};
}
