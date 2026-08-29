import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { compileFrontRelease } from "../packages/supbrd-core/dist/index.js";
import { composeUserFrontReleaseInput } from "../apps/site/src/lib/user-front-release.js";

const root = resolve(import.meta.dirname, "..");
const previewId = "user-slice-preview";
const keys = await crypto.subtle.generateKey(
	{ name: "ECDSA", namedCurve: "P-256" },
	true,
	["sign", "verify"],
);
const publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
const release = await compileFrontRelease(
	await composeUserFrontReleaseInput({
		instance_id: "local",
		front_draft_id: "01J00000000000000000000301",
		draft_snapshot_id: "01J00000000000000000000302",
		compilation_id: "01J00000000000000000000303",
		candidate_id: "01J00000000000000000000304",
		release_id: "01J00000000000000000000305",
		created_at: "2026-08-30T00:45:00.000Z",
	}),
	{ kid: "user-slice-local-key", private_key: keys.privateKey },
);
const issuedAt = new Date().toISOString();
const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
const sql = `
INSERT OR REPLACE INTO superboard_release_signing_keys
  (kid, public_jwk, status, created_at, retired_at)
VALUES
  ('user-slice-local-key', '${escapeSql(JSON.stringify({ ...publicJwk, kid: "user-slice-local-key" }))}', 'active', '${issuedAt}', NULL);
INSERT OR REPLACE INTO superboard_front_release_candidates
  (candidate_id, instance_id, release_id, release_json, content_checksum,
   validation_set_checksum, signing_kid, status, created_at)
VALUES
  ('${release.payload.candidate_id}', 'local', '${release.payload.release_id}',
   '${escapeSql(JSON.stringify(release))}', '${release.content_checksum}',
   '${release.validation_set_checksum}', 'user-slice-local-key', 'validated', '${issuedAt}');
INSERT OR REPLACE INTO superboard_front_previews
  (preview_id, candidate_id, release_id, content_checksum, audience,
   mutation_mode, issued_at, expires_at)
VALUES
  ('${previewId}', '${release.payload.candidate_id}', '${release.payload.release_id}',
   '${release.content_checksum}', 'front_preview', 'dry_run', '${issuedAt}', '${expiresAt}');
INSERT OR REPLACE INTO superboard_dependency_health
  (instance_id, dependency_id, status, evidence_checksum, checked_at, expires_at)
VALUES
  ('local', 'dependency.supbrd_plug_user', 'ready', 'sha256:${"a".repeat(64)}',
   '${issuedAt}', '${expiresAt}');
UPDATE superboard_front_release_candidates
SET status = 'approved', approval_json = '{"local_visual_proof":true}', approved_at = '${issuedAt}'
WHERE candidate_id = '${release.payload.candidate_id}';
INSERT INTO superboard_front_active_releases
  (instance_id, active_release_id, previous_release_id, pointer_revision, activation_id, activated_at)
VALUES
  ('local', '${release.payload.release_id}', NULL, 1, 'user-slice-local-visual-activation', '${issuedAt}')
ON CONFLICT(instance_id) DO UPDATE SET
  active_release_id = excluded.active_release_id,
  previous_release_id = superboard_front_active_releases.active_release_id,
  pointer_revision = superboard_front_active_releases.pointer_revision + 1,
  activation_id = 'user-slice-local-visual-activation-${Date.now()}',
  activated_at = excluded.activated_at;
`;

run("pnpm", [
	"--dir",
	"apps/site",
	"exec",
	"wrangler",
	"d1",
	"execute",
	"DB",
	"--local",
	"--command",
	sql,
]);
process.stdout.write(
	`${JSON.stringify({ preview_url: `http://127.0.0.1:4325/superboard-preview/${previewId}/login` })}\n`,
);

function escapeSql(value: string): string {
	return value.replaceAll("'", "''");
}

function run(command: string, args: string[]): void {
	const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false });
	if (result.status !== 0) process.exit(result.status ?? 1);
}
