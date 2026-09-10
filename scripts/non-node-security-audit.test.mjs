import assert from "node:assert/strict";
import test from "node:test";

import {
	nonNodeSecurityAuditContract,
	nonNodeSecurityAuditPlan,
	runNonNodeSecurityAudit,
} from "./non-node-security-audit.mjs";

test("non-Node audits pin tools and target the committed dependency inputs", () => {
	const plan = nonNodeSecurityAuditPlan("/repository");
	assert.deepEqual(nonNodeSecurityAuditContract, {
		ruby: {
			runtimeVersion: "3.4.9",
			bundlerVersion: "2.7.2",
			tool: "bundler-audit",
			toolVersion: "0.9.3",
			lockfile: "sdks/react-native/example/Gemfile.lock",
		},
	});
	assert.deepEqual(
		plan.versionChecks.map(({ expected }) => expected),
		["bundler-audit 0.9.3"],
	);
	assert.deepEqual(plan.audits[0].args, ["check", "--update"]);
	assert.equal(plan.audits[0].cwd, "/repository/sdks/react-native/example");
});

test("non-Node audit refuses an unpinned tool before scanning", () => {
	const calls = [];
	assert.throws(
		() =>
			runNonNodeSecurityAudit((command, args) => {
				calls.push([command, ...args]);
				return "bundler-audit 0.9.2\n";
			}),
		/expected bundler-audit 0\.9\.3/u,
	);
	assert.equal(calls.length, 1);
});

test("non-Node audit runs the platform scan only after exact version checks", () => {
	const calls = [];
	const result = runNonNodeSecurityAudit((command, args, options = {}) => {
		calls.push({ command, args, options });
		if (!options.capture) return "";
		return "bundler-audit 0.9.3\n";
	});
	assert.equal(calls.length, 2);
	assert.equal(calls.filter(({ options }) => options.capture).length, 1);
	assert.deepEqual(result, {
		status: "ok",
		audits: 1,
		tools: { ruby: "0.9.3" },
	});
});
