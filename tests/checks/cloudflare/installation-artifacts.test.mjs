import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const checkout = process.env.SUPERBOARD_INSTALLATION_ARTIFACT_CHECKOUT;

test(
	"a fresh checkout prepares every installation Worker and its browser assets",
	{ skip: !checkout },
	() => {
		assert.equal(
			existsSync(resolve(checkout, "packages/plugins/superboard-authentification/worker/dist")),
			false,
			"Use an isolated checkout without previously built login assets",
		);
		const result = spawnSync(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				`
const {installationTarget}=await import('./scripts/cloudflare/installation-target.mjs');
const {prepareConsolidatedDeployment,runConsolidatedDeployment}=await import('./scripts/cloudflare/consolidate.mjs');
const {generateDevelopmentSecretAssignments,fetchAppleRootG3}=await import('./scripts/cloudflare/development-secrets.mjs');
const {installationDeploymentEnvironment}=await import('./scripts/cloudflare/initialize-instance.mjs');
const target=installationTarget({name:'artifact-test',domain:'example.com',email:'owner@example.com',workersDevSubdomain:'example',installationId:'12345678-1234-1234-1234-123456789abc',hostPrefix:'artifact-test'});
process.env.SUPERBOARD_TARGET_MANIFEST=JSON.stringify(target);
const manifest=await prepareConsolidatedDeployment({targetName:target.target,environment:'production',allowUnprovisioned:true});
const keys=await generateDevelopmentSecretAssignments({target,environment:'production',accountId:'0'.repeat(32),appleRootBase64:await fetchAppleRootG3()});
await installationDeploymentEnvironment({SUPERBOARD_INITIAL_INSTALL:'1',SUPERBOARD_INSTALLATION_KEYS:JSON.stringify(keys)},manifest.manifestPath);
await runConsolidatedDeployment({targetName:target.target,environment:'production',manifest,dryRun:true,allowUnprovisioned:true});
console.log('INSTALLATION_ARTIFACTS_VERIFIED');
`,
			],
			{
				cwd: checkout,
				env: Object.fromEntries(
					Object.entries(process.env).filter(
						([name]) => !/^(?:CLOUDFLARE_|SUPERBOARD_|WRANGLER_)/u.test(name),
					),
				),
				encoding: "utf8",
				maxBuffer: 16 * 1024 * 1024,
				timeout: 300_000,
			},
		);
		assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`.slice(-5000));
		assert.match(result.stdout, /INSTALLATION_ARTIFACTS_VERIFIED/u);
	},
);
