import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { UsageError } from "../errors.js";
import { table, truncate } from "../format.js";

function pairs(values, flag) {
	if (!values?.length) return undefined;
	const result = {};
	for (const value of values) {
		const separator = value.indexOf("=");
		if (separator < 1) throw new UsageError(`--${flag} expects KEY=VALUE, got ${value}.`);
		result[value.slice(0, separator)] = value.slice(separator + 1);
	}
	return result;
}

function integer(value, flag) {
	if (value === undefined) return undefined;
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 1)
		throw new UsageError(`--${flag} expects a positive integer.`);
	return number;
}

const path = (name) => `/manage/functions/${encodeURIComponent(name)}`;

export const functionCommands = {
	"functions list": {
		summary: "List the deployed functions",
		usage: "superboard functions list",
		async run(ctx) {
			const result = await ctx.api().request("GET", "/manage/functions");
			ctx.print(result, ({ items }) =>
				table(
					items,
					[
						["NAME", (row) => row.name],
						["ACCESS", (row) => row.access],
						["VERSION", (row) => row.active_version ?? "-"],
						["TIMEOUT", (row) => `${row.timeout_ms} ms`],
						["SCHEDULE", (row) => (row.schedule ? row.schedule.cron : "-")],
						["UPDATED", (row) => row.updated_at],
					],
					"No functions yet. Deploy one with superboard functions deploy <name> <file>.",
				),
			);
		},
	},
	"functions deploy": {
		summary: "Deploy a new version of a function from an ES module file",
		usage:
			"superboard functions deploy <name> <file> [--access public|authenticated|service] [--timeout-ms n] [--var KEY=VALUE]… [--secret KEY=VALUE]…",
		positionals: ["name", "file"],
		options: {
			access: { type: "string", description: "Who may call it: public, authenticated or service" },
			"timeout-ms": { type: "string", description: "Execution limit, 1000 to 300000 ms" },
			var: { type: "string", multiple: true, description: "Replace the variables (repeatable)" },
			secret: {
				type: "string",
				multiple: true,
				description: "Set an encrypted secret (repeatable)",
			},
		},
		async run(ctx, values, [name, file]) {
			let source;
			try {
				source = await readFile(resolve(ctx.cwd, file), "utf8");
			} catch {
				throw new UsageError(`Cannot read ${file}.`);
			}
			const body = { source };
			if (values.access) body.access = values.access;
			const timeout = integer(values["timeout-ms"], "timeout-ms");
			if (timeout !== undefined) body.timeout_ms = timeout;
			const vars = pairs(values.var, "var");
			if (vars) body.vars = vars;
			const secrets = pairs(values.secret, "secret");
			if (secrets) body.secrets = secrets;
			const result = await ctx.api().request("PUT", path(name), { json: body });
			ctx.print(
				result,
				(fn) =>
					`Deployed ${fn.name} version ${fn.active_version} (access ${fn.access}, timeout ${fn.timeout_ms} ms)`,
			);
		},
	},
	"functions invoke": {
		summary: "Run a function once and print its response and logs",
		usage: "superboard functions invoke <name> [--method POST] [--path /] [--data json]",
		positionals: ["name"],
		options: {
			method: { type: "string", description: "HTTP method, POST by default" },
			path: { type: "string", description: "Path inside the function, / by default" },
			data: { type: "string", description: "Request body; JSON is sent as JSON" },
		},
		async run(ctx, values, [name]) {
			const body = {};
			if (values.method) body.method = values.method.toUpperCase();
			if (values.path) {
				if (!values.path.startsWith("/")) throw new UsageError("--path starts with /.");
				body.path = values.path;
			}
			if (values.data !== undefined) {
				try {
					body.body = JSON.parse(values.data);
				} catch {
					body.body = values.data;
				}
			}
			const result = await ctx.api().request("POST", `${path(name)}/invoke`, { json: body });
			if (ctx.json) ctx.print(result);
			else {
				for (const entry of result.logs ?? [])
					ctx.err(`[${entry.level ?? "log"}] ${entry.message ?? JSON.stringify(entry)}\n`);
				ctx.err(`HTTP ${result.status} in ${result.duration_ms} ms (run ${result.run_id})\n`);
				ctx.out(
					result.body.endsWith("\n") || result.body === "" ? result.body : `${result.body}\n`,
				);
			}
			if (result.status >= 400) return 1;
		},
	},
	"functions runs": {
		summary: "Show the latest executions of a function",
		usage: "superboard functions runs <name> [--limit 20]",
		positionals: ["name"],
		options: { limit: { type: "string", description: "Number of runs, 50 by default" } },
		async run(ctx, values, [name]) {
			const result = await ctx.api().request("GET", `${path(name)}/runs`, {
				query: [["limit", integer(values.limit, "limit")]],
			});
			ctx.print(result, ({ items }) =>
				table(
					items,
					[
						["STARTED", (run) => run.started_at],
						["TRIGGER", (run) => run.trigger],
						["STATUS", (run) => run.status ?? ""],
						["OUTCOME", (run) => run.outcome ?? ""],
						["VERSION", (run) => run.version ?? ""],
						[
							"DURATION",
							(run) =>
								run.duration_ms === null || run.duration_ms === undefined
									? ""
									: `${run.duration_ms} ms`,
						],
						["ERROR", (run) => truncate(run.error ?? "", 50)],
					],
					"No runs yet.",
				),
			);
		},
	},
	"functions schedule": {
		summary: "Run a function on a cron schedule (UTC)",
		usage: 'superboard functions schedule <name> "<cron>"',
		positionals: ["name", "cron"],
		async run(ctx, values, [name, cron]) {
			const result = await ctx.api().request("PUT", `${path(name)}/schedule`, { json: { cron } });
			ctx.print(
				result,
				(schedule) => `Scheduled ${name}: ${schedule.cron} (next run ${schedule.next_run_at})`,
			);
		},
	},
	"functions unschedule": {
		summary: "Remove the schedule of a function",
		usage: "superboard functions unschedule <name>",
		positionals: ["name"],
		async run(ctx, values, [name]) {
			const result = await ctx.api().request("DELETE", `${path(name)}/schedule`);
			ctx.print(result, () => `Removed the schedule of ${name}`);
		},
	},
	"functions delete": {
		summary: "Delete a function, its versions, runs and schedule",
		usage: "superboard functions delete <name>",
		positionals: ["name"],
		async run(ctx, values, [name]) {
			const result = await ctx.api().request("DELETE", path(name), { query: [["confirm", name]] });
			ctx.print(result, () => `Deleted ${name}`);
		},
	},
};
