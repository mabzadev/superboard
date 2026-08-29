import type {
	DraftSnapshot,
	FrontDraft,
	FrontReleaseCandidateEvidence,
	FrontReleaseCandidateRecord,
	OperatorReauthenticationReceipt,
} from "@superboard/supbrd-core";
import {
	canonicalizeReleasePayload,
	parseCompiledFrontReleaseJson,
	verifyFrontRelease,
} from "@superboard/supbrd-core";

import { createD1FrontReleaseRepository } from "./release-repository.js";

interface DraftRow {
	front_draft_id: string;
	instance_id: string;
	revision: number;
	input_json: string;
	updated_at: string;
}

interface SnapshotRow {
	draft_snapshot_id: string;
	front_draft_id: string;
	instance_id: string;
	draft_revision: number;
	input_json: string;
	created_at: string;
}

interface PreviewReleaseRow {
	release_json: string;
	candidate_id: string;
	release_id: string;
	content_checksum: string;
	expires_at: string;
}

export async function saveFrontDraft(
	db: D1Database,
	input: {
		front_draft_id: string;
		instance_id: string;
		expected_draft_revision: number;
		value: unknown;
		updated_at: string;
	},
): Promise<{ status: "updated"; draft: FrontDraft } | { status: "conflict"; current_revision: number }> {
	const valueJson = canonicalizeReleasePayload(input.value);
	if (input.expected_draft_revision === 0) {
		const inserted = await db
			.prepare(
				`INSERT INTO superboard_front_drafts (
				   front_draft_id, instance_id, revision, input_json, updated_at
				 ) VALUES (?, ?, 1, ?, ?)
				 ON CONFLICT(front_draft_id) DO NOTHING
				 RETURNING front_draft_id, instance_id, revision, input_json, updated_at`,
			)
			.bind(input.front_draft_id, input.instance_id, valueJson, input.updated_at)
			.first<DraftRow>();
		if (inserted) return { status: "updated", draft: draftFromRow(inserted) };
	} else {
		const updated = await db
			.prepare(
				`UPDATE superboard_front_drafts
				 SET revision = revision + 1, input_json = ?, updated_at = ?
				 WHERE front_draft_id = ? AND instance_id = ? AND revision = ?
				 RETURNING front_draft_id, instance_id, revision, input_json, updated_at`,
			)
			.bind(
				valueJson,
				input.updated_at,
				input.front_draft_id,
				input.instance_id,
				input.expected_draft_revision,
			)
			.first<DraftRow>();
		if (updated) return { status: "updated", draft: draftFromRow(updated) };
	}
	const current = await loadFrontDraft(db, input.front_draft_id);
	return { status: "conflict", current_revision: current?.revision ?? 0 };
}

export async function loadFrontDraft(db: D1Database, frontDraftId: string): Promise<FrontDraft | null> {
	const row = await db
		.prepare(
			`SELECT front_draft_id, instance_id, revision, input_json, updated_at
			 FROM superboard_front_drafts WHERE front_draft_id = ?`,
		)
		.bind(frontDraftId)
		.first<DraftRow>();
	return row ? draftFromRow(row) : null;
}

export async function createDraftSnapshotCas(
	db: D1Database,
	input: {
		draft_snapshot_id: string;
		front_draft_id: string;
		instance_id: string;
		expected_draft_revision: number;
		created_at: string;
	},
): Promise<
	| { status: "created"; snapshot: DraftSnapshot }
	| { status: "conflict"; current_revision: number }
> {
	const row = await db
		.prepare(
			`INSERT INTO superboard_front_draft_snapshots (
			   draft_snapshot_id, front_draft_id, instance_id, draft_revision, input_json, created_at
			 )
			 SELECT ?, front_draft_id, instance_id, revision, input_json, ?
			 FROM superboard_front_drafts
			 WHERE front_draft_id = ? AND instance_id = ? AND revision = ?
			 RETURNING draft_snapshot_id, front_draft_id, instance_id, draft_revision,
			           input_json, created_at`,
		)
		.bind(
			input.draft_snapshot_id,
			input.created_at,
			input.front_draft_id,
			input.instance_id,
			input.expected_draft_revision,
		)
		.first<SnapshotRow>();
	if (row) return { status: "created", snapshot: snapshotFromRow(row) };
	const draft = await loadFrontDraft(db, input.front_draft_id);
	return { status: "conflict", current_revision: draft?.revision ?? 0 };
}

export async function createFrontDraftWithSnapshot(
	db: D1Database,
	input: {
		front_draft_id: string;
		draft_snapshot_id: string;
		instance_id: string;
		value: unknown;
		created_at: string;
	},
): Promise<void> {
	await db.batch([
		db
			.prepare(
				`INSERT INTO superboard_front_drafts (
				   front_draft_id, instance_id, revision, input_json, updated_at
				 ) VALUES (?, ?, 1, ?, ?)`,
			)
			.bind(
				input.front_draft_id,
				input.instance_id,
				canonicalizeReleasePayload(input.value),
				input.created_at,
			),
		db
			.prepare(
				`INSERT INTO superboard_front_draft_snapshots (
				   draft_snapshot_id, front_draft_id, instance_id, draft_revision, input_json, created_at
				 ) SELECT ?, front_draft_id, instance_id, revision, input_json, ?
				 FROM superboard_front_drafts
				 WHERE front_draft_id = ? AND instance_id = ? AND revision = 1`,
			)
			.bind(
				input.draft_snapshot_id,
				input.created_at,
				input.front_draft_id,
				input.instance_id,
			),
	]);
}

export async function loadDraftSnapshot(
	db: D1Database,
	draftSnapshotId: string,
): Promise<DraftSnapshot | null> {
	const row = await db
		.prepare(
			`SELECT draft_snapshot_id, front_draft_id, instance_id, draft_revision, input_json, created_at
			 FROM superboard_front_draft_snapshots WHERE draft_snapshot_id = ?`,
		)
		.bind(draftSnapshotId)
		.first<SnapshotRow>();
	return row ? snapshotFromRow(row) : null;
}

export async function recordCompilation(
	db: D1Database,
	input: {
		compilation_id: string;
		draft_snapshot_id: string;
		candidate_id: string | null;
		status: "compiled" | "failed" | "rejected" | "superseded";
		error_code: string | null;
		created_at: string;
	},
): Promise<void> {
	const insert = db.prepare(
			`INSERT INTO superboard_front_compilations (
			   compilation_id, draft_snapshot_id, candidate_id, status, error_code, created_at
			 ) VALUES (?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			input.compilation_id,
			input.draft_snapshot_id,
			input.candidate_id,
			input.status,
			input.error_code,
			input.created_at,
		)
	if (input.status === "compiled") {
		await db.batch([
			db
				.prepare(
					`UPDATE superboard_front_compilations
					 SET status = 'superseded'
					 WHERE draft_snapshot_id = ? AND status = 'compiled'`,
				)
				.bind(input.draft_snapshot_id),
			insert,
		]);
		return;
	}
	await insert.run();
}

export async function persistFrontPreview(
	db: D1Database,
	preview: {
		preview_id: string;
		candidate_id: string;
		release_id: string;
		content_checksum: string;
		audience: "front_preview";
		mutation_mode: "dry_run";
		issued_at: string;
		expires_at: string;
	},
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO superboard_front_previews (
			   preview_id, candidate_id, release_id, content_checksum,
			   audience, mutation_mode, issued_at, expires_at
			 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			preview.preview_id,
			preview.candidate_id,
			preview.release_id,
			preview.content_checksum,
			preview.audience,
			preview.mutation_mode,
			preview.issued_at,
			preview.expires_at,
		)
		.run();
}

export async function loadFrontPreview(
	db: D1Database,
	previewId: string,
	now: string,
): Promise<{ candidate: FrontReleaseCandidateRecord; expires_at: string } | null> {
	const row = await db
		.prepare(
			`SELECT candidate.release_json, preview.candidate_id, preview.release_id,
			        preview.content_checksum, preview.expires_at
			 FROM superboard_front_previews AS preview
			 JOIN superboard_front_release_candidates AS candidate
			   ON candidate.candidate_id = preview.candidate_id
			 WHERE preview.preview_id = ?
			   AND preview.audience = 'front_preview'
			   AND preview.mutation_mode = 'dry_run'
			   AND preview.expires_at >= ?`,
		)
		.bind(previewId, now)
		.first<PreviewReleaseRow>();
	if (!row) return null;
	const release = parseCompiledFrontReleaseJson(row.release_json);
	if (
		release.payload.candidate_id !== row.candidate_id ||
		release.payload.release_id !== row.release_id ||
		release.content_checksum !== row.content_checksum
	) {
		throw new Error("Front preview identity mismatch");
	}
	const stored = await getFrontReleaseCandidate(db, row.candidate_id);
	return stored ? { candidate: stored, expires_at: row.expires_at } : null;
}

export async function persistReauthenticationReceipt(
	db: D1Database,
	receipt: OperatorReauthenticationReceipt,
	createdAt: string,
): Promise<void> {
	await db
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
			createdAt,
		)
		.run();
}

export async function candidateEvidence(
	db: D1Database,
	candidate: FrontReleaseCandidateRecord,
): Promise<FrontReleaseCandidateEvidence> {
	const key = await db
		.prepare("SELECT public_jwk, status FROM superboard_release_signing_keys WHERE kid = ?")
		.bind(candidate.release.signature.kid)
		.first<{ public_jwk: string; status: "active" | "retired" }>();
	let verification = { valid: false, errors: ["SIGNING_KEY_MISSING"] };
	if (key) {
		const publicKey = await crypto.subtle.importKey(
			"jwk",
			JSON.parse(key.public_jwk),
			{ name: "ECDSA", namedCurve: "P-256" },
			true,
			["verify"],
		);
		verification = await verifyFrontRelease(candidate.release, {
			kid: candidate.release.signature.kid,
			public_key: publicKey,
		});
	}
	const passedLayers = new Set(
		candidate.release.validation_receipts
			.filter(({ status }) => status === "passed")
			.map(({ layer }) => layer),
	);
	const healthRows = await db
		.prepare(
			`SELECT dependency_id, status FROM superboard_dependency_health
			 WHERE instance_id = ? AND expires_at > ?`,
		)
		.bind(candidate.release.payload.instance_id, new Date().toISOString())
		.all<{ dependency_id: string; status: "ready" | "unavailable" }>();
	const health = new Map(healthRows.results.map((row) => [row.dependency_id, row.status]));
	const dependenciesReady = candidate.release.payload.dependency_policies
		.filter(({ kind }) => kind === "required")
		.every(({ dependency_id: dependencyId }) => health.get(dependencyId) === "ready");
	return {
		signing_key_status: key?.status ?? "missing",
		verification,
		dependencies_ready: passedLayers.has("reference_graph") && dependenciesReady,
		renderers_ready: passedLayers.has("renderer_compatibility"),
		gateway_ready: passedLayers.has("routing") && passedLayers.has("actions_data_sources"),
		stores_ready: passedLayers.has("plugins_stores_workers"),
		migrations_ready: passedLayers.has("migrations"),
		workers_ready: passedLayers.has("plugins_stores_workers"),
		secrets_ready: passedLayers.has("permissions_security"),
		media_ready: passedLayers.has("translations_media"),
		rollback_ready: passedLayers.has("rollback_readiness"),
	};
}

export async function getFrontReleaseCandidate(
	db: D1Database,
	candidateId: string,
): Promise<FrontReleaseCandidateRecord | null> {
	return createD1FrontReleaseRepository(db).getCandidate(candidateId);
}

export async function getCandidateByReleaseId(
	db: D1Database,
	releaseId: string,
): Promise<FrontReleaseCandidateRecord | null> {
	const row = await db
		.prepare(
			`SELECT candidate_id FROM superboard_front_release_candidates
			 WHERE release_id = ?`,
		)
		.bind(releaseId)
		.first<{ candidate_id: string }>();
	return row ? getFrontReleaseCandidate(db, row.candidate_id) : null;
}

function draftFromRow(row: DraftRow): FrontDraft {
	return {
		front_draft_id: row.front_draft_id,
		instance_id: row.instance_id,
		revision: row.revision,
		input: JSON.parse(row.input_json),
		updated_at: row.updated_at,
	};
}

function snapshotFromRow(row: SnapshotRow): DraftSnapshot {
	return {
		draft_snapshot_id: row.draft_snapshot_id,
		front_draft_id: row.front_draft_id,
		instance_id: row.instance_id,
		draft_revision: row.draft_revision,
		input: JSON.parse(row.input_json),
		created_at: row.created_at,
	};
}
