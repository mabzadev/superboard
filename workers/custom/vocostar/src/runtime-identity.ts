import type { CustomWorkerScope } from "@superboard/contracts/custom-worker";

import { VocoStarJobError } from "./validation.js";

export interface RuntimeIdentity {
	legacy_user_id: string;
	project_ref: string;
	subject: string;
}

export async function registerRuntimeIdentity(
	db: D1Database,
	identity: RuntimeIdentity,
): Promise<RuntimeIdentity> {
	try {
		await db
			.prepare(
				`INSERT OR IGNORE INTO vocostar_runtime_identities (legacy_user_id, project_ref, subject)
			 SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)`,
			)
			.bind(
				identity.legacy_user_id,
				identity.project_ref,
				identity.subject,
				identity.legacy_user_id,
			)
			.run();
	} catch (error) {
		if (String(error).includes("runtime_identity_project_conflict"))
			throw new VocoStarJobError("runtime_identity_project_conflict", 409);
		throw error;
	}
	const stored = await byLegacyUser(db, identity.legacy_user_id);
	if (!stored) throw new VocoStarJobError("runtime_identity_unavailable", 409);
	if (stored.project_ref !== identity.project_ref || stored.subject !== identity.subject)
		throw new VocoStarJobError("runtime_identity_conflict", 409);
	await assertExclusiveProject(db, stored);
	return stored;
}

export async function runtimeIdentityForLegacyUser(
	db: D1Database,
	legacyUserId: string,
): Promise<RuntimeIdentity> {
	let identity = await byLegacyUser(db, legacyUserId);
	if (!identity) {
		const projects = await db
			.prepare("SELECT DISTINCT project_ref FROM opengrow_custom_jobs WHERE user_id = ? LIMIT 2")
			.bind(legacyUserId)
			.all<{ project_ref: string }>();
		if (projects.results.length !== 1) throw new VocoStarJobError("runtime_identity_required", 403);
		identity = await registerRuntimeIdentity(db, {
			legacy_user_id: legacyUserId,
			project_ref: projects.results[0].project_ref,
			subject: legacyUserId,
		});
	}
	await assertExclusiveProject(db, identity);
	return identity;
}

export async function runtimeIdentityForScope(
	db: D1Database,
	scope: CustomWorkerScope,
): Promise<RuntimeIdentity> {
	const identity = await byScope(db, scope);
	const resolved = identity ?? (await runtimeIdentityForLegacyUser(db, scope.subject));
	if (resolved.project_ref !== scope.projectRef || resolved.subject !== scope.subject)
		throw new VocoStarJobError("runtime_identity_required", 403);
	await assertExclusiveProject(db, resolved);
	return resolved;
}

export async function runtimeJobScope(
	db: D1Database,
	scope: CustomWorkerScope,
): Promise<CustomWorkerScope> {
	const identity = await byScope(db, scope);
	if (identity) return { projectRef: scope.projectRef, subject: identity.legacy_user_id };
	const legacy = await byLegacyUser(db, scope.subject);
	if (legacy) throw new VocoStarJobError("runtime_identity_project_conflict", 403);
	return scope;
}

async function byLegacyUser(db: D1Database, legacyUserId: string) {
	return db
		.prepare(
			"SELECT legacy_user_id, project_ref, subject FROM vocostar_runtime_identities WHERE legacy_user_id = ?",
		)
		.bind(legacyUserId)
		.first<RuntimeIdentity>();
}

async function byScope(db: D1Database, scope: CustomWorkerScope) {
	return db
		.prepare(
			"SELECT legacy_user_id, project_ref, subject FROM vocostar_runtime_identities WHERE project_ref = ? AND subject = ?",
		)
		.bind(scope.projectRef, scope.subject)
		.first<RuntimeIdentity>();
}

async function assertExclusiveProject(db: D1Database, identity: RuntimeIdentity) {
	const conflicting = await db
		.prepare("SELECT id FROM opengrow_custom_jobs WHERE user_id = ? AND project_ref <> ? LIMIT 1")
		.bind(identity.legacy_user_id, identity.project_ref)
		.first();
	if (conflicting) throw new VocoStarJobError("runtime_identity_project_conflict", 409);
}
