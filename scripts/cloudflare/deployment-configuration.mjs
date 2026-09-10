import { createHash } from "node:crypto";

import { deploymentOrder } from "./deploy-plan.mjs";
import { deploymentGroups } from "./deployment-groups.mjs";
import { targetForEnvironment } from "./target-environments.mjs";
import { publicMcpUrl } from "./target.mjs";

export function deploymentWebOrigins(target) {
	return [
		...new Set([
			`https://${target.domains.dashboard ?? target.domains.site}`,
			`https://${target.domains.site}`,
			`https://${target.domains.auth}`,
			...(target.applicationIdentity?.webOrigins ?? []),
			...(target.domainAliases ?? [])
				.filter((alias) => alias.surface === "console")
				.map((alias) => `https://${alias.hostname}`),
		]),
	];
}

export function deploymentConfiguration(input, environment) {
	const target = targetForEnvironment(input, environment);
	const domains = target.domains;
	const groups = deploymentGroups(deploymentOrder(target));
	const endpoint = (surface, host, worker, clients, path = "") => ({
		surface,
		url: `https://${host}${path}`,
		worker,
		clients,
	});
	const value = {
		schemaVersion: 1,
		target: target.target,
		environment,
		profile: target.deploymentProfile ?? "legacy",
		source: `infra/targets/${target.target}.json`,
		publicRouting: target.environments[environment].publicRouting,
		endpoints: [
			endpoint("console", domains.site, "console", ["operator"]),
			endpoint("custom-api", domains.api, "api → custom", ["mobile", "web"]),
			endpoint("auth", domains.auth, "api → auth", ["mobile", "web"]),
			endpoint("files", domains.files, "api → files", ["mobile", "web"]),
			endpoint("links", domains.shortlinks, "api", ["mobile", "web"]),
			endpoint("sdk", domains.sdk, "api", ["mobile", "web"]),
			{
				surface: "mcp",
				url: publicMcpUrl(target),
				worker:
					domains.mcp === domains.site
						? `console → ${target.deploymentProfile === "consolidated" ? "api (MCP)" : "mcp"}`
						: "mcp",
				clients: ["assistant"],
			},
		],
		workers: groups.map((group) => ({
			id: group.id,
			name:
				target.workers[group.services[0]]?.[environment] ??
				(group.id.startsWith("managed-")
					? target.customWorker?.managedWorkers?.find(
							(worker) => `managed-${worker.id}` === group.id,
						)?.workers[environment]
					: null) ??
				null,
			modules: group.services,
		})),
		aliases: (target.domainAliases ?? []).map((alias) => ({
			surface: alias.surface,
			hostname: alias.hostname,
		})),
		webOrigins: deploymentWebOrigins(target),
		customCapabilities: [...(target.customWorker?.capabilities ?? [])],
		authIssuer: target.authGateway.issuer,
	};
	return {
		...value,
		checksum: `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`,
	};
}
