#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

const ENDPOINT = process.env.PERF_ENDPOINT ?? "https://perf.emdashcms.com/api/trigger";

function die(msg, code = 1) {
	console.error(`trigger: ${msg}`);
	process.exit(code);
}

const argv = process.argv.slice(2).filter((a) => a !== "--");

if (argv.includes("-h") || argv.includes("--help")) {
	console.log(
		"Usage: pnpm trigger [-- --store] [--note <string>] [--sha <sha>] [--pr <number>] [--site <id>]\n" +
			"\n" +
			"Runs an ad-hoc perf measurement against every registered demo site.\n" +
			"Pass --site <id> (e.g. blog, cache) to target a single site.\n" +
			"\n" +
			"Default is ephemeral: probes run for real but nothing is written to\n" +
			"the database. Pass --store to persist the run as source=manual\n" +
			"(excluded from the graph and summary cards, visible in the results\n" +
			"table). --note/--sha/--pr only take effect together with --store.",
	);
	process.exit(0);
}

const { values } = parseArgs({
	args: argv,
	options: {
		store: { type: "boolean" },
		note: { type: "string" },
		sha: { type: "string" },
		pr: { type: "string" },
		site: { type: "string" },
	},
	allowPositionals: false,
	strict: true,
});

const ephemeral = !values.store;

const body = {};
if (ephemeral) body.ephemeral = true;
if (values.note) body.note = values.note;
if (values.sha) body.sha = values.sha;
if (values.pr) {
	const n = Number.parseInt(values.pr, 10);
	if (!Number.isInteger(n) || n <= 0) die(`--pr must be a positive integer, got ${values.pr}`);
	body.prNumber = n;
}
if (values.site) body.site = values.site;

if (ephemeral && (values.note || values.sha || values.pr)) {
	console.warn(
		"trigger: warning: --note/--sha/--pr have no effect without --store (ephemeral mode discards everything)",
	);
}

const label = values.note ? ` (${values.note})` : "";
const mode = ephemeral ? " [ephemeral, not recorded]" : "";
console.log(`trigger: firing against ${ENDPOINT}${label}${mode}`);
console.log("trigger: this typically takes 20-40s while probes run...");

const result = spawnSync(
	"cloudflared",
	[
		"access",
		"curl",
		ENDPOINT,
		"-sS",
		"-X",
		"POST",
		"-H",
		"content-type: application/json",
		"--data",
		JSON.stringify(body),
	],
	{ encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] },
);

if (result.error) {
	if (result.error.code === "ENOENT") {
		die(
			"cloudflared is not installed or not on PATH.\n" +
				"       Install: brew install cloudflared   (or see https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/)\n" +
				"       Then run this command again to complete first-time browser login.",
		);
	}
	die(`cloudflared failed: ${result.error.message}`);
}
if (result.status !== 0) die(`cloudflared exited ${result.status}`);

let parsed;
try {
	parsed = JSON.parse(result.stdout);
} catch {
	die(`unexpected non-JSON response:\n${result.stdout}`);
}

if (parsed.error) die(`server error: ${parsed.error}`);

if (parsed.ephemeral) {
	console.log(
		`trigger: measured ${parsed.results?.length ?? 0} samples in ${parsed.durationMs}ms (ephemeral, nothing recorded)`,
	);
} else {
	console.log(
		`trigger: recorded ${parsed.inserted} samples in ${parsed.durationMs}ms (source=manual)`,
	);
}

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const dim = (s) => (useColor ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s) => (useColor ? `\x1b[1m${s}\x1b[0m` : s);

const formatMs = (n) => (n == null ? "-" : `${Math.round(n)}ms`);

const bySite = new Map();
for (const r of parsed.results ?? []) {
	const siteId = r.site ?? "blog";
	if (!bySite.has(siteId)) bySite.set(siteId, new Map());
	const byRoute = bySite.get(siteId);
	if (!byRoute.has(r.route)) byRoute.set(r.route, []);
	byRoute.get(r.route).push(r);
}

for (const [siteId, byRoute] of bySite) {
	for (const [route, rows] of byRoute) {
		console.log(`\n  ${bold(`[${siteId}] ${route}`)}`);

		const coldNames = [];
		const warmNames = [];
		const seenCold = new Set();
		const seenWarm = new Set();
		for (const r of rows) {
			if (r.coldServerTimings) {
				for (const name of Object.keys(r.coldServerTimings)) {
					if (!seenCold.has(name)) {
						seenCold.add(name);
						coldNames.push(name);
					}
				}
			}
			if (r.warmServerTimings) {
				for (const name of Object.keys(r.warmServerTimings)) {
					if (!seenWarm.has(name)) {
						seenWarm.add(name);
						warmNames.push(name);
					}
				}
			}
		}

		const warmHeaders = warmNames.map((n) => `w.${n}`);
		const header = ["region", "cold", "warm", "p95", "colo", ...coldNames, ...warmHeaders];
		const tableRows = rows.map((r) => {
			const cells = [
				r.region,
				formatMs(r.coldTtfbMs),
				formatMs(r.warmTtfbMs),
				formatMs(r.p95TtfbMs),
				r.cfColo ?? "-",
			];
			for (const name of coldNames) {
				const t = r.coldServerTimings?.[name];
				cells.push(t ? formatMs(t.dur) : "-");
			}
			for (const name of warmNames) {
				const t = r.warmServerTimings?.[name];
				cells.push(t ? formatMs(t.dur) : "-");
			}
			return cells;
		});

		const widths = header.map((h, col) =>
			Math.max(h.length, ...tableRows.map((cells) => cells[col].length)),
		);

		const padCell = (s, col) => s.padEnd(widths[col]);
		const joinRow = (cells) => cells.map(padCell).join("  ");

		console.log(`    ${dim(joinRow(header))}`);
		for (const cells of tableRows) {
			console.log(`    ${joinRow(cells)}`);
		}
	}
}
