#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { requiredSecretInventory } from "./cloudflare-secret-inventory.mjs";
import { workerNameForService } from "./cloudflare-services.mjs";
import {
	cloudflareEnv,
	environmentFromArgs,
	loadTarget,
	parseArgs,
	root,
	targetNameFromArgs,
} from "./cloudflare-target.mjs";

export function parseSecretNames(output) {
	const candidates = [];
	for (const match of output.matchAll(/^[ \t]*\[/gm)) {
		const start = match.index + match[0].length - 1;
		let depth = 0,
			quoted = false,
			escaped = false;
		for (let index = start; index < output.length; index++) {
			const character = output[index];
			if (quoted) {
				if (escaped) escaped = false;
				else if (character === "\\") escaped = true;
				else if (character === '"') quoted = false;
				continue;
			}
			if (character === '"') quoted = true;
			else if (character === "[") depth++;
			else if (character === "]" && --depth === 0) {
				try {
					const rows = JSON.parse(output.slice(start, index + 1));
					if (
						Array.isArray(rows) &&
						rows.every((row) => typeof row?.name === "string" && row.name.trim())
					) {
						candidates.push(rows.map((row) => row.name));
					}
				} catch {
					/* Ignore non-JSON status lines surrounding the inventory. */
				}
				break;
			}
		}
	}
	if (candidates.length !== 1) throw new Error("Unable to parse Wrangler secret list");
	return candidates[0];
}

export function evaluateSecretReadiness(
	requirements,
	configuredByService,
	inspectionErrorsByService = {},
) {
	const services = requirements.map((requirement) => {
		const configured = new Set(configuredByService[requirement.service] || []);
		const inspectionError = inspectionErrorsByService[requirement.service] || null;
		const missing = requirement.names.filter((name) => !configured.has(name));
		const unsatisfiedAlternatives = requirement.alternatives
			.filter(({ oneOf }) => !oneOf.some((name) => configured.has(name)))
			.map(({ oneOf }) => ({ oneOf }));
		return {
			service: requirement.service,
			ready: !inspectionError && missing.length === 0 && unsatisfiedAlternatives.length === 0,
			inspectionError,
			configuredNames: [...configured].sort(),
			missing,
			unsatisfiedAlternatives,
		};
	});
	return {
		schema_version: 1,
		values_included: false,
		ready: services.every((service) => service.ready),
		services,
	};
}

async function main() {
	const args = parseArgs();
	const targetName = targetNameFromArgs(args);
	const environment = environmentFromArgs(args);
	const { target } = await loadTarget(targetName);
	const requirements = requiredSecretInventory(target, environment);
	const childEnv = { ...cloudflareEnv(target), NO_COLOR: "1" };
	const configuredByService = {};
	const inspectionErrorsByService = {};

	for (const { service } of requirements) {
		const workerName = workerNameForService(target, service, environment);
		configuredByService[service] = [];
		if (!workerName) {
			inspectionErrorsByService[service] =
				`Worker name is not configured for ${service}/${environment}`;
			continue;
		}

		const inspection = captureResult(
			"npx",
			["wrangler", "secret", "list", "--name", workerName, "--format", "json"],
			childEnv,
		);
		if (!inspection.ok) {
			inspectionErrorsByService[service] = `Secret inventory unavailable for Worker ${workerName}`;
			continue;
		}

		try {
			configuredByService[service] = parseSecretNames(inspection.output);
		} catch {
			inspectionErrorsByService[service] =
				`Secret inventory response is invalid for Worker ${workerName}`;
		}
	}

	const report = {
		...evaluateSecretReadiness(requirements, configuredByService, inspectionErrorsByService),
		target: targetName,
		environment,
	};
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	if (!report.ready) process.exitCode = 1;
}

function captureResult(command, args, env) {
	const result = spawnSync(command, args, {
		cwd: root,
		env,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		shell: false,
	});
	return {
		ok: result.status === 0 && !result.error,
		output: `${result.stdout || ""}\n${result.stderr || ""}`,
	};
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) await main();
