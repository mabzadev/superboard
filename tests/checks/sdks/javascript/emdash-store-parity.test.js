import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import SuperBoardAPIService from "../../../../sdks/javascript/src/superboard_api_service.js";
import SuperBoardContext from "../../../../sdks/javascript/src/superboard_context.js";

const fixture = JSON.parse(
	readFileSync(
		new URL("../../../fixtures/contracts/emdash-store-parity/v1.json", import.meta.url),
		"utf8",
	),
);

test("JavaScript sends the shared fixture through the real SDK encoder", () => {
	const calls = [];
	const service = new SuperBoardAPIService();
	service.apiService = { POST: (path, body) => calls.push({ path, body }) };
	SuperBoardContext.USER_IDENTIFIER = fixture.application_user.identifier;
	SuperBoardContext.USER_ATTRIBUTES = fixture.application_user.attributes;
	service.setUserAttributes(
		() => undefined,
		() => undefined,
	);
	assert.deepEqual(calls, [
		{
			path: SuperBoardAPIService.ENDPOINTS.USER_ATTRIBUTES,
			body: { sdk_identifier: "user-1", sdk_attributes: { active: true } },
		},
	]);
	assert.equal(fixture.aliases.projectId, fixture.instance_id);
	assert.equal(fixture.aliases.pid, fixture.instance_id);
});
