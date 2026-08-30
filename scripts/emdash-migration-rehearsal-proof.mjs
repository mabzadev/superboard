import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { FixtureAdapter } from "./module-cutover/adapters.mjs";
import {
	applyPlan,
	buildPlan,
	buildReverseDelta,
	canonicalJson,
	createRollbackPlan,
	verifyShadowRead,
} from "./module-cutover/core.mjs";

const entity = {
	id: "user.application_users",
	module: "app",
	columns: ["id", "project_id", "payload_json", "updated_at"],
	jsonColumns: ["payload_json"],
	keys: ["id"],
	projectColumn: "project_id",
	source: { database: "api", table: "application_users", query: "" },
	target: { table: "application_users", query: "" },
	reverse: (row) => row,
	reverseColumns: ["id", "project_id", "payload_json", "updated_at"],
	reverseKeys: ["id"],
};

const rows = [
	{ id: "user-a", project_id: "12", payload_json: '{"active":true}', updated_at: "2026-08-30T00:00:00Z" },
	{ id: "user-b", project_id: "12", payload_json: '{"active":false}', updated_at: "2026-08-30T00:00:01Z" },
];

export async function buildMigrationRehearsalProof() {
	const fixture = {
		project: { project_ref: "10-test", project_id: 12, instance_id: 10, environment: "test" },
		source_rows: { [entity.id]: rows },
		target_rows: { [entity.id]: [] },
		maintenance: { "10-test": { enabled: true, window_id: "emdash-rehearsal" } },
	};
	const adapter = new FixtureAdapter(fixture);
	const plan = await buildPlan({ adapter, registry: [entity], projectRef: "10-test", modules: ["app"] });
	const safety = { project_ref: "10-test", project_id: 12, instance_id: 10, environment: "test", window_id: "emdash-rehearsal" };
	let checkpoint;
	await applyPlan({ adapter, registry: [entity], plan, safety, onCheckpoint: async (value) => { checkpoint = structuredClone(value); } });
	const repeated = await applyPlan({ adapter, registry: [entity], plan, safety, checkpoint });
	const targetRows = await adapter.readTarget(entity, fixture.project);
	const metrics = [];
	const shadow = verifyShadowRead({ entity, sourceRows: rows, targetRows, emitMetric: (metric) => metrics.push(metric) });
	const baseline = { project: fixture.project, entities: [{ id: entity.id, module: entity.module, rows }] };
	const reverseDelta = buildReverseDelta({ baseline, currentRowsByEntity: { [entity.id]: targetRows }, registry: [entity] });
	const rollback = createRollbackPlan({
		backupPlan: { target: "local", project_ref: "10-test", worker_versions: [{ service: "api" }], database_exports: [{ name: "legacy-api" }] },
		backupReceipt: { artifacts: [{ name: "legacy-api", bytes: 100, sha256: "a".repeat(64) }] },
		versions: { api: "version-before-rehearsal" },
		reverseDelta,
	});
	const payload = {
		schema_version: 1,
		environment: "isolated_fixture",
		entity_id: entity.id,
		source: shadow.evidence.expected,
		target: shadow.evidence.actual,
		deterministic_sample: JSON.parse(canonicalJson(rows[0])),
		sample_checksum: hash(rows[0]),
		double_import_upsert_calls: adapter.upsertCalls.length,
		resumed_without_write: repeated.entities[0].resumed,
		checkpoint_revision: checkpoint.entities[entity.id].checksum,
		shadow_metric: metrics[0],
		reverse_delta_replayable: reverseDelta.replayable,
		rollback_blocked: rollback.blocked,
		deletes: [],
		public_cutover: false,
	};
	return { ...payload, receipt_checksum: hash(payload) };
}

function hash(value) {
	return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const proof = await buildMigrationRehearsalProof();
	if (process.argv.includes("--write")) {
		const path = resolve(dirname(fileURLToPath(import.meta.url)), "../docs/evidence/issue-54/store-migration-rehearsal.receipt.json");
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(proof, null, 2)}\n`);
	}
	console.log(JSON.stringify(proof));
}
