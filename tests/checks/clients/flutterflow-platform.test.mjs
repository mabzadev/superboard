import assert from "node:assert/strict";
import test from "node:test";

import { resolveFlutterFlowApplications } from "../../../scripts/clients/flutterflow-application-config.mjs";
import { validateFlutterFlowApplicationWorkspaces } from "../../../scripts/clients/flutterflow-application-dsl.mjs";

void test("the standalone platform has no implicit application dependency", async () => {
	const output = await resolveFlutterFlowApplications({
		loadApplicationTarget: () => {
			throw new Error("An application must not be loaded by the standalone platform");
		},
	});
	assert.deepEqual(output.applications, []);
	const validation = await validateFlutterFlowApplicationWorkspaces({ output });
	assert.equal(validation.errors.length, 0);
});
