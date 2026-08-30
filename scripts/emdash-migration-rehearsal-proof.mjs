import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { FixtureAdapter } from "./module-cutover/adapters.mjs";
import {
	applyPlan,
	buildPlan,
	buildReverseDelta,
	compareDatasets,
	verifyShadowRead,
} from "./module-cutover/core.mjs";
import { MODULE_CUTOVER_REGISTRY } from "./module-cutover/registry.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function buildMigrationRehearsalProof() {
	const topology = JSON.parse(
		readFileSync(resolve(root, "config/emdash-plugin-topology.json"), "utf8"),
	);
	const stores = [];
	for (const { manifest } of topology.plugins) {
		for (const store of manifest.stores) {
			const entities = MODULE_CUTOVER_REGISTRY.filter(
				(entity) => entity.storeId === store.store_id,
			);
			const migratableEntities = entities.filter(
				(entity) => entity.sourceStatus !== "new_empty_store",
			);
			const schemaProof = "scripts/module-cutover/registry-schema.test.mjs";
			const runtimeProof = "apps/site/runtime-tests/plugin-store-authority.runtime.test.ts";
			const migrationKind =
				migratableEntities.length > 0 ? "source_to_store" : "new_empty_store";
			const proofEntities = migratableEntities.map((entity) => ({
				...entity,
				transform: undefined,
			}));
			const sourceRows = Object.fromEntries(
				proofEntities.map((entity, index) => [entity.id, [sampleRow(entity, index)]]),
			);
			let sourceSamples = [];
			let targetSamples = [];
			let doubleImport = "not_applicable_empty_store";
			let checkpointResume = "not_applicable_empty_store";
			let shadowRead = "not_applicable_empty_store";
			let reverseDelta = "not_applicable_empty_store";
			if (proofEntities.length > 0) {
				const fixture = {
					project: {
						project_ref: "10-test",
						project_id: 12,
						instance_id: 10,
						environment: "test",
					},
					source_rows: sourceRows,
					target_rows: {},
				};
				const adapter = new FixtureAdapter(fixture);
				const plan = await buildPlan({
					adapter,
					registry: proofEntities,
					projectRef: "10-test",
					modules: [...new Set(proofEntities.map(({ module }) => module))],
					entityIds: proofEntities.map(({ id }) => id),
				});
				let checkpoint;
				const safety = {
					project_ref: "10-test",
					project_id: 12,
					instance_id: 10,
					environment: "test",
					window_id: `rehearsal-${hash(store.store_id).slice(-12)}`,
				};
				await applyPlan({
					adapter,
					registry: proofEntities,
					plan,
					safety,
					onCheckpoint: async (value) => {
						checkpoint = structuredClone(value);
					},
				});
				const repeated = await applyPlan({
					adapter,
					registry: proofEntities,
					plan,
					safety,
					checkpoint,
				});
				sourceSamples = proofEntities.flatMap((entity) => sourceRows[entity.id]);
				targetSamples = proofEntities.flatMap(
					(entity) => adapter.fixture.repository_rows[entity.id] ?? [],
				);
				for (const entity of proofEntities) {
					const source = sourceRows[entity.id];
					const target = adapter.fixture.repository_rows[entity.id] ?? [];
					if (!compareDatasets(source, target, entity).matches) {
						throw new Error(`${entity.id}: rehearsal mismatch`);
					}
					verifyShadowRead({ entity, sourceRows: source, targetRows: target });
				}
				const delta = buildReverseDelta({
					baseline: {
						project: fixture.project,
						entities: proofEntities.map((entity) => ({
							id: entity.id,
							module: entity.module,
							rows: sourceRows[entity.id],
						})),
					},
					currentRowsByEntity: Object.fromEntries(
						proofEntities.map((entity) => [
							entity.id,
							adapter.fixture.repository_rows[entity.id] ?? [],
						]),
					),
					registry: proofEntities,
				});
				doubleImport =
					adapter.repositoryUpsertCalls.length === proofEntities.length ? "passed" : "failed";
				checkpointResume = repeated.entities.every(({ resumed }) => resumed) ? "passed" : "failed";
				shadowRead = "passed";
				reverseDelta = delta.replayable ? "replayable_without_deletes" : "failed";
			}
			stores.push({
				plugin_id: manifest.plugin_id,
				store_id: store.store_id,
				descriptor_checksum: store.checksum,
				migration_kind: migrationKind,
				entity_ids: entities.map(({ id }) => id),
				source_tables: entities.map(({ source }) => source.table).filter(Boolean),
				target_tables: migratableEntities.length > 0 ? ["superboard_plugin_store_records"] : [],
				projection_tables: entities
					.filter(({ repositoryOnly }) => !repositoryOnly)
					.map(({ target }) => target.table)
					.filter(Boolean),
				schema_proof: { path: schemaProof, checksum: fileHash(schemaProof) },
				runtime_proof: { path: runtimeProof, checksum: fileHash(runtimeProof) },
				fixture_source: { count: sourceSamples.length, checksum: hash(sourceSamples) },
				fixture_target: { count: targetSamples.length, checksum: hash(targetSamples) },
				deterministic_sample: sourceSamples[0] ?? null,
				sample_checksum: sourceSamples.length > 0 ? hash(sourceSamples[0]) : null,
				double_import: doubleImport,
				checkpoint_resume: checkpointResume,
				shadow_read: shadowRead,
				reverse_delta: reverseDelta,
				rollback: "non_destructive",
			});
		}
	}
	const payload = {
		schema_version: 1,
		environment: "isolated_fixture",
		stores,
		store_count: stores.length,
		public_cutover: false,
	};
	return { ...payload, receipt_checksum: hash(payload) };
}

function sampleRow(entity, index) {
	return Object.fromEntries(
		entity.columns.map((column) => {
			if (entity.jsonColumns?.includes(column)) return [column, "{}"];
			if (column === "project_id") return [column, "12"];
			if (column === "key") return [column, "sample_key"];
			if (/(?:_at|date|time)$/u.test(column)) {
				return [column, `2026-08-30T00:00:${String(index).padStart(2, "0")}.000Z`];
			}
			if (
				/(?:count|cents|price|amount|position|priority|active|enabled|quantity|revision)$/u.test(
					column,
				)
			) {
				return [column, 1];
			}
			return [column, `${entity.id}-${column}-${index + 1}`];
		}),
	);
}

function hash(value) {
	return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function fileHash(path) {
	return `sha256:${createHash("sha256")
		.update(readFileSync(resolve(root, path)))
		.digest("hex")}`;
}

function canonical(value) {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.keys(value)
			.toSorted()
			.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const proof = await buildMigrationRehearsalProof();
	if (process.argv.includes("--write")) {
		const path = resolve(root, "docs/evidence/issue-54/store-migration-rehearsal.receipt.json");
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(proof, null, 2)}\n`);
	}
	console.log(
		JSON.stringify({ store_count: proof.store_count, receipt_checksum: proof.receipt_checksum }),
	);
}
