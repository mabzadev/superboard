import { parseArgs } from "node:util";

import { VERSION, createApi } from "./api.js";
import { dbCommands } from "./commands/db.js";
import { functionCommands } from "./commands/functions.js";
import { MULTIPART_THRESHOLD, PART_SIZE, storageCommands } from "./commands/storage.js";
import { vectorCommands } from "./commands/vectors.js";
import { credentials, normalizeUrl, removeConfig, validateKey, writeConfig } from "./config.js";
import { ApiError, UsageError } from "./errors.js";

const GLOBAL_OPTIONS = {
	json: { type: "boolean", description: "Print machine-readable JSON" },
	help: { type: "boolean", short: "h", description: "Show help" },
};

const accountCommands = {
	login: {
		summary: "Save the SDK origin and a server key for the next commands",
		usage: "superboard login --url https://sdk.example.com --key sb_secret_…",
		options: {
			url: { type: "string", description: "SDK origin of the SuperBoard instance" },
			key: {
				type: "string",
				description: "Server key; SUPERBOARD_SECRET_KEY is used when omitted",
			},
		},
		async run(ctx, values) {
			const url = normalizeUrl(values.url ?? ctx.env.SUPERBOARD_URL ?? "");
			const secretKey = validateKey(values.key ?? ctx.env.SUPERBOARD_SECRET_KEY);
			const status = await createApi({ url, secretKey, fetch: ctx.fetch }).request(
				"GET",
				"/manage/status",
			);
			const path = await writeConfig(ctx.env, { url, secretKey });
			ctx.print(
				{ url, project_id: status.project_id, config: path },
				() => `Logged in to project ${status.project_id} at ${url}\nCredentials saved to ${path}`,
			);
		},
	},
	logout: {
		summary: "Forget the saved credentials",
		usage: "superboard logout",
		async run(ctx) {
			const path = await removeConfig(ctx.env);
			ctx.print({ config: path, removed: true }, () => `Removed ${path}`);
		},
	},
	status: {
		summary: "Show the project, its features and resource counts",
		usage: "superboard status",
		async run(ctx) {
			const api = ctx.api();
			const status = await api.request("GET", "/manage/status");
			ctx.print({ url: api.url, ...status }, (result) =>
				[
					`URL        ${result.url}`,
					`Project    ${result.project_id}`,
					`Tables     ${result.counts.tables}`,
					`Buckets    ${result.counts.buckets}`,
					`Functions  ${result.counts.functions}`,
					`Features   ${Object.entries(result.features)
						.map(([name, enabled]) => `${name}: ${enabled ? "on" : "off"}`)
						.join(", ")}`,
				].join("\n"),
			);
		},
	},
};

const COMMANDS = {
	...accountCommands,
	...dbCommands,
	...functionCommands,
	...storageCommands,
	...vectorCommands,
};
const GROUPS = {
	db: "Tables, schema and migrations",
	gen: "Code generation",
	functions: "Server functions",
	storage: "Buckets and objects",
	vectors: "Vector collections and similarity search",
};

function optionHelp(options) {
	const entries = Object.entries({ ...options, ...GLOBAL_OPTIONS });
	const labels = entries.map(
		([name, option]) =>
			`${option.short ? `-${option.short}, ` : ""}--${name}${option.type === "string" ? " <value>" : ""}`,
	);
	const width = Math.max(...labels.map((label) => label.length));
	return entries.map(
		([, option], index) => `  ${labels[index].padEnd(width)}  ${option.description}`,
	);
}

function commandHelp(name) {
	const command = COMMANDS[name];
	return [
		`${command.summary}.`,
		"",
		`Usage: ${command.usage}`,
		"",
		"Options:",
		...optionHelp(command.options ?? {}),
	].join("\n");
}

function listing(names) {
	const width = Math.max(...names.map((name) => name.length));
	return names.map((name) => `  ${name.padEnd(width)}  ${COMMANDS[name]?.summary ?? GROUPS[name]}`);
}

function groupHelp(group) {
	const names = Object.keys(COMMANDS).filter((name) => name.startsWith(`${group} `));
	return [
		`${GROUPS[group]}.`,
		"",
		`Usage: superboard ${group} <command>`,
		"",
		"Commands:",
		...listing(names),
	].join("\n");
}

function mainHelp() {
	return [
		`superboard ${VERSION} — manage a SuperBoard project with a server key.`,
		"",
		"Usage: superboard <command> [options]",
		"",
		"Commands:",
		...listing([...Object.keys(accountCommands), ...Object.keys(GROUPS)]),
		"",
		"Options:",
		...optionHelp({ version: { type: "boolean", description: "Print the version" } }),
		"",
		"Credentials come from superboard login, or from SUPERBOARD_URL and SUPERBOARD_SECRET_KEY.",
		"Run superboard <command> --help for the options of a command.",
	].join("\n");
}

function resolveCommand(argv) {
	let index = 0;
	while (index < argv.length && argv[index].startsWith("-")) index += 1;
	const leading = argv.slice(0, index);
	const group = argv[index];
	if (group === undefined || group === "help") {
		const topic = argv.slice(index + 1).filter((token) => !token.startsWith("-"));
		return { help: topic.length ? topic.join(" ") : "", leading };
	}
	if (COMMANDS[group]) return { name: group, rest: [...leading, ...argv.slice(index + 1)] };
	if (!GROUPS[group]) throw new UsageError(`Unknown command ${group}. Run superboard --help.`);
	const sub = argv[index + 1];
	if (sub === undefined || sub.startsWith("-"))
		return { help: group, leading: argv.slice(index + 1) };
	const name = `${group} ${sub}`;
	if (!COMMANDS[name])
		throw new UsageError(`Unknown command ${name}. Run superboard ${group} --help.`);
	return { name, rest: [...leading, ...argv.slice(index + 2)] };
}

function helpFor(topic) {
	if (!topic) return mainHelp();
	if (COMMANDS[topic]) return commandHelp(topic);
	if (GROUPS[topic]) return groupHelp(topic);
	throw new UsageError(`Unknown command ${topic}. Run superboard --help.`);
}

function reportError(ctx, error) {
	if (ctx.json) {
		ctx.err(
			`${JSON.stringify({
				error:
					error instanceof ApiError
						? {
								code: error.code,
								message: error.message,
								status: error.status,
								details: error.details,
							}
						: { code: error instanceof UsageError ? "usage" : "error", message: error.message },
			})}\n`,
		);
	} else if (error instanceof ApiError) {
		ctx.err(
			`Error: ${error.message} [${error.code}${error.status ? `, HTTP ${error.status}` : ""}]\n`,
		);
	} else if (error?.name === "TypeError" && error.cause) {
		ctx.err(`Error: cannot reach the server (${error.cause.message ?? error.message})\n`);
	} else {
		ctx.err(`Error: ${error?.message ?? String(error)}\n`);
	}
	if (error.hint && !ctx.json) ctx.err(`${error.hint}\n`);
	return error instanceof UsageError ? 2 : 1;
}

export async function main(argv, io = {}) {
	const stdout = io.stdout ?? process.stdout;
	const stderr = io.stderr ?? process.stderr;
	const env = io.env ?? process.env;
	let api;
	const ctx = {
		env,
		cwd: io.cwd ?? process.cwd(),
		fetch: io.fetch ?? globalThis.fetch,
		stdout,
		json: argv.includes("--json"),
		limits: { multipartThreshold: MULTIPART_THRESHOLD, partSize: PART_SIZE, ...io.limits },
		out: (text) => stdout.write(text),
		err: (text) => stderr.write(text),
		print(value, render) {
			if (ctx.json || !render) stdout.write(`${JSON.stringify(value, null, 2)}\n`);
			else stdout.write(`${render(value)}\n`);
		},
		api() {
			if (!api) throw new UsageError("Internal error: credentials were not loaded.");
			return api;
		},
	};
	try {
		if (argv.length === 1 && argv[0] === "--version") {
			stdout.write(`${VERSION}\n`);
			return 0;
		}
		const resolved = resolveCommand(argv);
		if (resolved.help !== undefined) {
			const unknown = resolved.leading.filter(
				(token) => !["--help", "-h", "--json"].includes(token),
			);
			if (unknown.length)
				throw new UsageError(`Unknown option ${unknown[0]}. Run superboard --help.`);
			stdout.write(`${helpFor(resolved.help)}\n`);
			return 0;
		}
		const command = COMMANDS[resolved.name];
		let parsed;
		try {
			parsed = parseArgs({
				args: resolved.rest,
				options: Object.fromEntries(
					Object.entries({ ...command.options, ...GLOBAL_OPTIONS }).map(([name, option]) => [
						name,
						{
							type: option.type,
							...(option.short ? { short: option.short } : {}),
							...(option.multiple ? { multiple: true } : {}),
						},
					]),
				),
				allowPositionals: true,
				strict: true,
			});
		} catch (error) {
			throw new UsageError(`${error.message}. Run superboard ${resolved.name} --help.`);
		}
		if (parsed.values.help) {
			stdout.write(`${commandHelp(resolved.name)}\n`);
			return 0;
		}
		const expected = command.positionals ?? [];
		if (parsed.positionals.length !== expected.length)
			throw new UsageError(`Usage: ${command.usage}`);
		if (resolved.name !== "login" && resolved.name !== "logout")
			api = createApi({ ...(await credentials(env)), fetch: ctx.fetch });
		return (await command.run(ctx, parsed.values, parsed.positionals)) ?? 0;
	} catch (error) {
		return reportError(ctx, error);
	}
}
