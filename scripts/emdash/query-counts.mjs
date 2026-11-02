#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const fixtureDir = resolve(repoRoot, "tests/fixtures/performance-site");

const HOST = "127.0.0.1";
const PORT = 14321;
const BASE = `http://${HOST}:${PORT}`;

const ROUTES = [
	["GET", "/"],
	["GET", "/posts"],
	["GET", "/posts/building-for-the-long-term"],
	["GET", "/pages/about"],
	["GET", "/category/development"],
	["GET", "/tag/webdev"],
	["GET", "/rss.xml"],
	["GET", "/search?q=static"],
	["GET", "/contributors"],
	["GET", "/contributors-naive"],
];

const TRACKED_PHASES = new Set(["cold", "warm"]);
const VALID_TARGETS = new Set(["sqlite", "d1"]);
const QUERY_LOG_PREFIX = "[emdash-query-log] ";
const STREAM_END_PREFIX = "[emdash-stream-end] ";

function waitForPort(host, port, timeoutMs = 120_000) {
	const deadline = Date.now() + timeoutMs;
	return new Promise((resolveReady, rejectReady) => {
		const attempt = () => {
			if (Date.now() > deadline) {
				rejectReady(new Error(`port ${host}:${port} did not open within ${timeoutMs}ms`));
				return;
			}
			const socket = createConnection({ host, port });
			socket.once("connect", () => {
				socket.destroy();
				resolveReady();
			});
			socket.once("error", () => {
				socket.destroy();
				setTimeout(attempt, 100);
			});
		};
		attempt();
	});
}

function parseArgs(argv) {
	const out = { target: "sqlite", update: false, skipBuild: false, skipSeed: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--update") out.update = true;
		else if (a === "--skip-build") out.skipBuild = true;
		else if (a === "--skip-seed") out.skipSeed = true;
		else if (a === "--target") {
			out.target = argv[++i];
		} else if (a.startsWith("--target=")) {
			out.target = a.slice("--target=".length);
		} else {
			throw new Error(`Unknown argument: ${a}`);
		}
	}
	if (!VALID_TARGETS.has(out.target)) {
		throw new Error(`--target must be one of: ${[...VALID_TARGETS].join(", ")}`);
	}
	return out;
}

const { target, update, skipBuild, skipSeed } = parseArgs(process.argv.slice(2));
const snapshotPath = resolve(__dirname, `query-counts.snapshot.${target}.json`);
const querySnapshotPath = resolve(__dirname, `query-counts.queries.${target}.json`);

function resetSqliteState() {
	for (const f of ["data.db", "data.db-wal", "data.db-shm"]) {
		rmSync(resolve(fixtureDir, f), { force: true });
	}
	rmSync(resolve(fixtureDir, "uploads"), { recursive: true, force: true });
}

function resetD1State() {
	rmSync(resolve(fixtureDir, ".wrangler"), { recursive: true, force: true });
}

const buildMarkerPath = resolve(fixtureDir, "dist/.perf-target");

function buildFixture() {
	process.stdout.write(`$ (cd ${fixtureDir}) astro build\n`);
	const r = spawnSync("pnpm", ["exec", "astro", "build"], {
		cwd: fixtureDir,
		stdio: "inherit",
		env: { ...process.env, EMDASH_FIXTURE_TARGET: target },
	});
	if (r.status !== 0) throw new Error("astro build failed");
	writeFileSync(buildMarkerPath, target + "\n");
}

function assertExistingBuildMatchesTarget() {
	if (!existsSync(buildMarkerPath)) {
		throw new Error(
			`--skip-build was passed but dist/.perf-target is missing. Run without --skip-build to produce a build for target "${target}".`,
		);
	}
	const built = readFileSync(buildMarkerPath, "utf8").trim();
	if (built !== target) {
		throw new Error(
			`--skip-build was passed but existing build is for target "${built}", not "${target}". Drop --skip-build (or rebuild) to switch targets.`,
		);
	}
}

const emdashCliPath = resolve(repoRoot, "packages/core/dist/cli/index.mjs");

function seedSqliteCli() {
	for (const step of ["init", "seed"]) {
		process.stdout.write(`$ (cd ${fixtureDir}) node <emdash-cli> ${step}\n`);
		const r = spawnSync("node", [emdashCliPath, step], {
			cwd: fixtureDir,
			stdio: "inherit",
			env: { ...process.env, EMDASH_FIXTURE_TARGET: "sqlite" },
		});
		if (r.status !== 0) throw new Error(`emdash ${step} failed`);
	}
}

async function seedD1ViaDevBypass(events) {
	process.stdout.write(`--- seeding via astro dev + dev-bypass ---\n`);
	const child = spawn("pnpm", ["exec", "astro", "dev", "--host", HOST, "--port", String(PORT)], {
		cwd: fixtureDir,
		env: {
			...process.env,
			EMDASH_FIXTURE_TARGET: "d1",
			EMDASH_QUERY_LOG: "1",
		},
		stdio: ["ignore", "pipe", "inherit"],
	});

	const rl = createInterface({ input: child.stdout });
	rl.on("line", (line) => {
		const idx = line.indexOf(QUERY_LOG_PREFIX);
		if (idx !== -1) {
			const payload = line.slice(idx + QUERY_LOG_PREFIX.length);
			try {
				events.push(JSON.parse(payload));
			} catch {}
			return;
		}
		if (line.includes(STREAM_END_PREFIX)) return;
		process.stdout.write(line + "\n");
	});
	const exited = new Promise((res) => child.once("exit", res));

	try {
		await waitForPort(HOST, PORT);
		const r = await fetch(`${BASE}/_emdash/api/setup/dev-bypass`, {
			method: "POST",
			redirect: "manual",
		});
		if (!r.ok) {
			const body = await r.text();
			throw new Error(`dev-bypass failed: ${r.status} ${body.slice(0, 200)}`);
		}
		await r.arrayBuffer();
		process.stdout.write(`  seed via dev-bypass -> ${r.status}\n`);
	} finally {
		child.kill("SIGTERM");
		await Promise.race([
			exited,
			new Promise((r) => setTimeout(r, 5_000)).then(() => child.kill("SIGKILL")),
		]);
		await new Promise((r) => setTimeout(r, 250));
	}
}

function startServer({ collectedEvents, streamEndSnapshots = [] }) {
	let cmd;
	let args;
	if (target === "sqlite") {
		cmd = "node";
		args = ["./dist/server/entry.mjs"];
	} else {
		cmd = "pnpm";
		args = ["exec", "astro", "preview", "--host", HOST, "--port", String(PORT)];
	}

	const child = spawn(cmd, args, {
		cwd: fixtureDir,
		env: {
			...process.env,
			EMDASH_FIXTURE_TARGET: target,
			EMDASH_QUERY_LOG: "1",
			HOST,
			PORT: String(PORT),
		},
		stdio: ["ignore", "pipe", "inherit"],
	});

	const ready = waitForPort(HOST, PORT);

	const rl = createInterface({ input: child.stdout });
	rl.on("line", (line) => {
		const idx = line.indexOf(QUERY_LOG_PREFIX);
		if (idx !== -1) {
			const before = line.slice(0, idx);
			if (before.trim().length > 0) process.stdout.write(before + "\n");
			const payload = line.slice(idx + QUERY_LOG_PREFIX.length);
			try {
				collectedEvents.push(JSON.parse(payload));
			} catch {
				process.stderr.write(`bad query-log line: ${payload}\n`);
			}
			return;
		}
		const seIdx = line.indexOf(STREAM_END_PREFIX);
		if (seIdx !== -1) {
			const before = line.slice(0, seIdx);
			if (before.trim().length > 0) process.stdout.write(before + "\n");
			const payload = line.slice(seIdx + STREAM_END_PREFIX.length);
			try {
				streamEndSnapshots.push(JSON.parse(payload));
			} catch {
				process.stderr.write(`bad stream-end line: ${payload}\n`);
			}
			return;
		}
		process.stdout.write(line + "\n");
	});

	const exited = new Promise((res) => child.once("exit", res));
	child.once("error", (err) => {
		process.stderr.write(`server spawn error: ${err.message}\n`);
	});

	async function stop() {
		child.kill("SIGTERM");
		await Promise.race([
			exited,
			new Promise((r) => setTimeout(r, 5_000)).then(() => child.kill("SIGKILL")),
		]);
		await new Promise((r) => setTimeout(r, 250));
	}

	return { ready, stop };
}

async function hit(method, path, phase) {
	let lastErr;
	for (let i = 0; i < 10; i++) {
		try {
			const r = await fetch(`${BASE}${path}`, {
				method,
				headers: { "x-perf-phase": phase },
				redirect: "manual",
			});
			await r.arrayBuffer();
			process.stdout.write(`  ${phase.padEnd(5)} ${method} ${path} -> ${r.status}\n`);
			return r.status;
		} catch (err) {
			lastErr = err;
			await new Promise((r) => setTimeout(r, 200));
		}
	}
	throw lastErr;
}

async function warmup() {
	const r = await fetch(BASE, { redirect: "manual" });
	await r.arrayBuffer();
	process.stdout.write(`  warmup GET / -> ${r.status}\n`);
}

function aggregate(events) {
	const counts = {};
	for (const e of events) {
		if (!TRACKED_PHASES.has(e.phase)) continue;
		const key = `${e.method} ${e.route} (${e.phase})`;
		counts[key] = (counts[key] ?? 0) + 1;
	}
	return Object.fromEntries(Object.entries(counts).toSorted(([a], [b]) => a.localeCompare(b)));
}

function normalizeSql(sql) {
	return sql
		.replace(/\s+/g, " ")
		.replace(/\bin\s*\(\s*\?(?:\s*,\s*\?)*\s*\)/gi, "in (...)")
		.trim();
}

function aggregateQueries(events) {
	const byRoute = {};
	for (const e of events) {
		if (!TRACKED_PHASES.has(e.phase)) continue;
		const key = `${e.method} ${e.route} (${e.phase})`;
		const sql = normalizeSql(e.sql);
		(byRoute[key] ??= {})[sql] = (byRoute[key][sql] ?? 0) + 1;
	}
	return Object.fromEntries(
		Object.entries(byRoute)
			.toSorted(([a], [b]) => a.localeCompare(b))
			.map(([route, sqls]) => [
				route,
				Object.fromEntries(Object.entries(sqls).toSorted(([a], [b]) => a.localeCompare(b))),
			]),
	);
}

function diffSnapshot(actual) {
	if (!existsSync(snapshotPath)) {
		process.stderr.write(`No snapshot at ${snapshotPath}. Run with --update to create one.\n`);
		return 1;
	}
	const expected = JSON.parse(readFileSync(snapshotPath, "utf8"));
	const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].toSorted();
	const diffs = [];
	for (const k of keys) {
		if (expected[k] !== actual[k]) {
			diffs.push({ key: k, expected: expected[k], actual: actual[k] });
		}
	}
	if (diffs.length === 0) {
		process.stdout.write(`OK: query counts match ${snapshotPath}\n`);
		return 0;
	}
	process.stderr.write(`Query counts differ from ${snapshotPath}:\n`);
	for (const d of diffs) {
		const e = d.expected ?? "(missing)";
		const a = d.actual ?? "(missing)";
		process.stderr.write(`  ${d.key}: expected=${e} actual=${a}\n`);
	}
	process.stderr.write(
		`\nIf the change is intentional, run: node scripts/emdash/query-counts.mjs --target ${target} --update\n`,
	);
	return 1;
}

function diffQuerySnapshot(actual) {
	if (!existsSync(querySnapshotPath)) {
		process.stderr.write(
			`No query snapshot at ${querySnapshotPath}. Run with --update to create one.\n`,
		);
		return 1;
	}
	const expected = JSON.parse(readFileSync(querySnapshotPath, "utf8"));
	const routes = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].toSorted();
	const lines = [];
	for (const route of routes) {
		const exp = expected[route] ?? {};
		const act = actual[route] ?? {};
		const sqls = [...new Set([...Object.keys(exp), ...Object.keys(act)])].toSorted();
		for (const sql of sqls) {
			if (exp[sql] !== act[sql]) {
				const e = exp[sql] ?? 0;
				const a = act[sql] ?? 0;
				const sign = a > e ? "+" : "-";
				lines.push(`  ${route}\n    ${sign} [${e}->${a}] ${sql}`);
			}
		}
	}
	if (lines.length === 0) {
		process.stdout.write(`OK: query text matches ${querySnapshotPath}\n`);
		return 0;
	}
	process.stderr.write(`Query text differs from ${querySnapshotPath}:\n`);
	for (const l of lines) process.stderr.write(l + "\n");
	process.stderr.write(
		`\nIf the change is intentional, run: node scripts/emdash/query-counts.mjs --target ${target} --update\n`,
	);
	return 1;
}

async function runSqlite(events, streamEndSnapshots) {
	if (!skipSeed) {
		resetSqliteState();
		seedSqliteCli();
	}
	if (skipBuild) assertExistingBuildMatchesTarget();
	else buildFixture();
	const server = startServer({ collectedEvents: events, streamEndSnapshots });
	try {
		await server.ready;
		await warmup();
		for (const [m, p] of ROUTES) await hit(m, p, "cold");
		for (const [m, p] of ROUTES) await hit(m, p, "warm");
	} finally {
		await server.stop();
	}
}

async function runD1(events, streamEndSnapshots) {
	if (!skipSeed) {
		resetD1State();
		await seedD1ViaDevBypass([]);
	}
	if (skipBuild) assertExistingBuildMatchesTarget();
	else buildFixture();

	for (const [m, p] of ROUTES) {
		process.stdout.write(`--- fresh isolate for ${m} ${p} ---\n`);
		const server = startServer({ collectedEvents: events, streamEndSnapshots });
		try {
			await server.ready;
			await hit(m, p, "cold");
			await hit(m, p, "warm");
		} finally {
			await server.stop();
		}
	}
}

function reportStreamEnd(snapshots) {
	const tracked = snapshots
		.filter((s) => TRACKED_PHASES.has(s.phase))
		.toSorted((a, b) =>
			`${a.method} ${a.route} ${a.phase}`.localeCompare(`${b.method} ${b.route} ${b.phase}`),
		);
	if (tracked.length === 0) return;
	process.stdout.write("\nStream-end metrics (full request, incl. post-header queries):\n");
	for (const s of tracked) {
		const dbMs = typeof s.dbTotalMs === "number" ? s.dbTotalMs.toFixed(1) : "?";
		const totalMs = typeof s.totalMs === "number" ? s.totalMs.toFixed(1) : "?";
		process.stdout.write(
			`  ${s.method} ${s.route} (${s.phase}): db.count=${s.dbCount} db.total=${dbMs}ms total=${totalMs}ms cache=${s.cacheHits}/${s.cacheHits + s.cacheMisses}\n`,
		);
	}
}

async function main() {
	const events = [];
	const streamEndSnapshots = [];
	if (target === "sqlite") await runSqlite(events, streamEndSnapshots);
	else await runD1(events, streamEndSnapshots);

	reportStreamEnd(streamEndSnapshots);

	const counts = aggregate(events);
	const queries = aggregateQueries(events);
	if (update) {
		writeFileSync(snapshotPath, JSON.stringify(counts, null, "\t") + "\n");
		process.stdout.write(`Wrote ${Object.keys(counts).length} entries to ${snapshotPath}\n`);
		writeFileSync(querySnapshotPath, JSON.stringify(queries, null, "\t") + "\n");
		process.stdout.write(`Wrote ${Object.keys(queries).length} entries to ${querySnapshotPath}\n`);
		return 0;
	}
	const countCode = diffSnapshot(counts);
	const queryCode = diffQuerySnapshot(queries);
	return countCode || queryCode;
}

main()
	.then((code) => process.exit(code ?? 0))
	.catch((err) => {
		process.stderr.write(`${err.stack ?? err.message ?? err}\n`);
		process.exit(1);
	});
