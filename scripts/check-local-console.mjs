import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { parseArgs, root } from "./cloudflare-target.mjs";
import { verifyLocalTargetHealth } from "./target-orchestrator.mjs";

const args = parseArgs();
const origins = { site: localOrigin(args.site), api: localOrigin(args.api) };
const healthChecks = Object.entries(origins).map(([service, origin]) => ({
	id: `health.${service}`,
	service,
	kind: "worker",
	url: new URL(service === "site" ? "/superboard-system/health" : "/health", origin).href,
}));
if (args.typecheck) {
	const result = spawnSync("pnpm", ["--dir", resolve(root, "apps/site"), "run", "typecheck"], {
		cwd: root,
		stdio: "inherit",
		shell: false,
	});
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(`Site typecheck failed: ${result.status ?? result.signal}`);
}
const receipts = await verifyLocalTargetHealth({ healthChecks }, {}, { attempts: 1 });
for (const { service, url } of receipts) process.stdout.write(`${service}: ready (${url})\n`);

function localOrigin(value) {
	if (typeof value !== "string")
		throw new Error("Provide --site and --api with their local origins");
	const url = new URL(value);
	if (
		!["http:", "https:"].includes(url.protocol) ||
		!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
		url.username ||
		url.password ||
		url.pathname !== "/" ||
		url.search ||
		url.hash
	)
		throw new Error("Console checks require localhost origins without a path or credentials");
	return url.origin;
}
