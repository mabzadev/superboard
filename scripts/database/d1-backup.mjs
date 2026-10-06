#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, chmod, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";

import {
	cloudflareEnv,
	environmentFromArgs,
	loadTarget,
	parseArgs,
	root,
	targetNameFromArgs,
} from "../cloudflare/target.mjs";
import { quoteSqlIdentifier, rewriteFtsExport } from "./d1-export-sql.mjs";
import { d1Descriptor } from "./d1-registry.mjs";

export function assertProtectedBackupDirectory(value) {
	if (typeof value !== "string" || !isAbsolute(value)) {
		throw new Error("--output-directory must be an absolute path outside the Git repository");
	}
	const destination = resolve(value);
	const fromRepository = relative(root, destination);
	if (fromRepository === "" || (!fromRepository.startsWith("..") && !isAbsolute(fromRepository))) {
		throw new Error("Refusing to store a D1 backup inside the Git repository");
	}
	return destination;
}

export function backupPaths(outputDirectory, descriptor, now = new Date()) {
	const rootDirectory = assertProtectedBackupDirectory(outputDirectory);
	const stamp = now.toISOString().replaceAll(":", "-");
	const safeDatabase = descriptor.databaseName.replace(/[^a-zA-Z0-9._-]+/gu, "-");
	const directory = join(
		rootDirectory,
		descriptor.target,
		descriptor.environment,
		descriptor.service,
	);
	const prefix = `${stamp}-${safeDatabase}`;
	return {
		directory,
		sql: join(directory, `${prefix}.sql`),
		receipt: join(directory, `${prefix}.receipt.json`),
	};
}

export async function createD1Backup({
	descriptor,
	outputDirectory,
	env,
	now = new Date(),
	execute = executeWranglerExport,
}) {
	if (!descriptor?.databaseId) {
		throw new Error(
			`${descriptor?.service || "D1"} database is not provisioned in the target manifest`,
		);
	}
	const paths = backupPaths(outputDirectory, descriptor, now);
	await mkdir(paths.directory, { recursive: true, mode: 0o700 });
	await chmod(paths.directory, 0o700);
	await execute({ descriptor, output: paths.sql, env });
	await chmod(paths.sql, 0o600);
	const exported = await stat(paths.sql);
	if (!exported.isFile() || exported.size === 0) throw new Error("D1 backup export is empty");
	const receipt = {
		schema_version: 1,
		kind: "cloudflare-d1-export",
		target: descriptor.target,
		environment: descriptor.environment,
		service: descriptor.service,
		database: { name: descriptor.databaseName, id: descriptor.databaseId },
		created_at: now.toISOString(),
		artifact: {
			path: basename(paths.sql),
			bytes: exported.size,
			sha256: await sha256File(paths.sql),
		},
	};
	await writeFile(paths.receipt, `${JSON.stringify(receipt, null, 2)}\n`, {
		mode: 0o600,
		flag: "wx",
	});
	return { paths, receipt };
}

export async function sha256File(path) {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest("hex");
}

export async function executeWranglerExport({ descriptor, output, env }, run = spawnSync) {
	const execute = (args) =>
		run("npx", ["wrangler", "d1", ...args], {
			cwd: root,
			stdio: "pipe",
			encoding: "utf8",
			maxBuffer: 16 * 1024 * 1024,
			shell: false,
			env,
		});
	const result = execute(["export", descriptor.databaseId, "--remote", "--output", output]);
	if (result.status === 0) return;
	if (!/cannot export.*virtual tables/iu.test(`${result.stderr ?? ""}${result.stdout ?? ""}`))
		throw new Error(`D1 export failed for ${descriptor.service}`);
	const schema = () => {
		const response = execute([
			"execute",
			descriptor.databaseId,
			"--remote",
			"--json",
			"--command",
			"SELECT m.type,m.name,m.sql,coalesce(p.type,'') AS table_type,(SELECT json_group_array(name) FROM pragma_table_xinfo(m.name) WHERE hidden=0) AS columns FROM sqlite_schema AS m LEFT JOIN pragma_table_list AS p ON p.name=m.name AND p.schema='main' WHERE m.sql IS NOT NULL AND substr(m.name,1,4)!='_cf_' AND (substr(m.name,1,7)!='sqlite_' OR m.name='sqlite_sequence') ORDER BY m.rowid",
		]);
		if (response.status !== 0) throw new Error("D1_BACKUP_SCHEMA_UNAVAILABLE");
		const rows = JSON.parse(response.stdout)?.[0]?.results;
		if (!Array.isArray(rows) || !rows.length) throw new Error("D1_BACKUP_SCHEMA_INVALID");
		return rows;
	};
	const before = schema();
	const virtual = before.filter(({ table_type }) => table_type === "virtual");
	if (!virtual.length || virtual.some(({ sql }) => !/\bUSING\s+fts5\s*\(/iu.test(sql)))
		throw new Error("D1_BACKUP_VIRTUAL_TABLE_UNSUPPORTED");
	const tables = before.filter(
		({ type, table_type }) => type === "table" && table_type !== "virtual",
	);
	const dataPath = `${output}.data`;
	const verificationPath = `${output}.verification.sqlite`;
	let verification;
	try {
		const data = execute([
			"export",
			descriptor.databaseId,
			"--remote",
			"--no-schema",
			"--output",
			dataPath,
			...tables.flatMap(({ name }) => ["--table", name]),
		]);
		if (data.status !== 0) throw new Error("D1_BACKUP_FILTERED_EXPORT_FAILED");
		if (JSON.stringify(before) !== JSON.stringify(schema()))
			throw new Error("D1_BACKUP_SCHEMA_CHANGED");
		const definitions = before.filter(
			({ type, table_type, name }) =>
				(type === "table" && table_type !== "shadow" && name !== "sqlite_sequence") ||
				type === "index",
		);
		const reset = tables.filter(({ name }) => name === "sqlite_sequence");
		const header = [
			"PRAGMA defer_foreign_keys=ON;",
			...definitions.map(({ sql }) => `${sql};`),
			...reset.map(({ name }) => `DELETE FROM ${quoteSqlIdentifier(name)};`),
			"",
		].join("\n");
		verification = new DatabaseSync(verificationPath);
		await chmod(verificationPath, 0o600);
		verification.exec(`BEGIN;\n${header}`);
		await writeFile(output, header, { mode: 0o600 });
		async function* verifiedRows() {
			for await (const statement of rewriteFtsExport(createReadStream(dataPath), before)) {
				verification.exec(statement);
				yield statement;
			}
		}
		await pipeline(verifiedRows(), createWriteStream(output, { flags: "a" }));
		const footer = `\n${before
			.filter(({ type }) => type !== "table" && type !== "index")
			.map(({ sql }) => `${sql};`)
			.join("\n")}\n`;
		verification.exec(`${footer}\nCOMMIT;`);
		if (
			verification.prepare("PRAGMA quick_check").get().quick_check !== "ok" ||
			verification.prepare("PRAGMA foreign_key_check").all().length
		)
			throw new Error("D1_BACKUP_RESTORE_FAILED");
		for (const { name } of virtual) {
			const quoted = quoteSqlIdentifier(name);
			verification.exec(`INSERT INTO ${quoted}(${quoted}) VALUES('integrity-check')`);
		}
		await appendFile(output, footer);
	} finally {
		verification?.close();
		await rm(verificationPath, { force: true });
		await rm(dataPath, { force: true });
	}
}

async function main() {
	const args = parseArgs();
	const targetName = targetNameFromArgs(args);
	const environment = environmentFromArgs(args);
	const service = args.service || legacyDatabaseService(args.database) || "api";
	if (!args["output-directory"]) throw new Error("--output-directory is required");
	const { target } = await loadTarget(targetName);
	const descriptor = d1Descriptor(target, targetName, environment, service);
	if (!descriptor)
		throw new Error(`${service} is disabled or does not own a D1 schema for ${targetName}`);
	const result = await createD1Backup({
		descriptor,
		outputDirectory: args["output-directory"],
		env: cloudflareEnv(target),
	});
	process.stdout.write(
		`${JSON.stringify(
			{
				completed: true,
				backup: result.paths.sql,
				receipt: result.paths.receipt,
				bytes: result.receipt.artifact.bytes,
				sha256: result.receipt.artifact.sha256,
				offsite_retention_required: true,
			},
			null,
			2,
		)}\n`,
	);
}

function legacyDatabaseService(value) {
	if (!value) return null;
	if (value === "d1") return "api";
	if (value === "messagingD1") return "messaging";
	throw new Error("--database is deprecated; use --service with a D1 schema owner");
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	await main();
}
