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

export async function buildMigrationRehearsalProof({ pluginIds } = {}) {
	const topology = JSON.parse(
		readFileSync(resolve(root, "config/emdash-plugin-topology.json"), "utf8"),
	);
	const selectedPluginIds = pluginIds ? new Set(pluginIds) : null;
	const stores = [];
	for (const { manifest } of topology.plugins) {
		if (selectedPluginIds && !selectedPluginIds.has(manifest.plugin_id)) continue;
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
	if (
		selectedPluginIds &&
		canonical([...new Set(stores.map(({ plugin_id: pluginId }) => pluginId))].toSorted()) !==
			canonical([...selectedPluginIds].toSorted())
	) {
		throw new Error("The Store rehearsal selection contains an unknown or Store-less plugin");
	}
	return { ...payload, receipt_checksum: hash(payload) };
}

export function summarizeMigrationRehearsalProof(proof) {
	const stores = proof.stores.map((store) => {
		const converged =
			store.migration_kind === "source_to_store" &&
			store.double_import === "passed" &&
			store.checkpoint_resume === "passed" &&
			store.shadow_read === "passed" &&
			store.reverse_delta === "replayable_without_deletes" &&
			canonical(store.fixture_source) === canonical(store.fixture_target);
		return {
			plugin_id: store.plugin_id,
			store_id: store.store_id,
			descriptor_checksum: store.descriptor_checksum,
			migration_kind: store.migration_kind,
			status:
				store.migration_kind === "new_empty_store"
					? "requires_schema_and_runtime"
					: converged
						? "converged"
						: "failed",
		};
	});
	return {
		store_count: stores.length,
		converged_count: stores.filter(({ status }) => status === "converged").length,
		requires_schema_and_runtime_count: stores.filter(
			({ status }) => status === "requires_schema_and_runtime",
		).length,
		source_to_store_count: stores.filter(({ migration_kind: kind }) => kind === "source_to_store")
			.length,
		new_empty_store_count: stores.filter(({ migration_kind: kind }) => kind === "new_empty_store")
			.length,
		plugin_ids: [...new Set(stores.map(({ plugin_id: pluginId }) => pluginId))].toSorted(),
		stores,
		receipt_checksum: proof.receipt_checksum,
	};
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
	const pluginIdsIndex = process.argv.indexOf("--plugin-ids");
	const pluginIds =
		pluginIdsIndex === -1 ? undefined : JSON.parse(process.argv[pluginIdsIndex + 1] ?? "null");
	if (pluginIds !== undefined && !Array.isArray(pluginIds)) {
		throw new TypeError("--plugin-ids must be a JSON array");
	}
	const proof = await buildMigrationRehearsalProof({ pluginIds });
	if (process.argv.includes("--write")) {
		const path = resolve(root, "docs/evidence/issue-54/store-migration-rehearsal.receipt.json");
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(proof, null, 2)}\n`);
	}
	console.log(
		`SUPERBOARD_FRESH_INSTANCE_STORES=${JSON.stringify(summarizeMigrationRehearsalProof(proof))}`,
	);
	console.log(
		JSON.stringify({ store_count: proof.store_count, receipt_checksum: proof.receipt_checksum }),
	);
}
