import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import OpenGrowAPIService from "../src/opengrow_api_service.js";
import OpenGrowContext from "../src/opengrow_context.js";

const fixture = JSON.parse(
  readFileSync(new URL("../../../packages/contracts/fixtures/emdash-store-parity/v1.json", import.meta.url), "utf8"),
);

test("JavaScript sends the shared fixture through the real SDK encoder", () => {
  const calls = [];
  const service = new OpenGrowAPIService();
  service.apiService = { POST: (path, body) => calls.push({ path, body }) };
  OpenGrowContext.USER_IDENTIFIER = fixture.application_user.identifier;
  OpenGrowContext.USER_ATTRIBUTES = fixture.application_user.attributes;
  service.setUserAttributes(() => undefined, () => undefined);
  assert.deepEqual(calls, [{
    path: OpenGrowAPIService.ENDPOINTS.USER_ATTRIBUTES,
    body: { sdk_identifier: "user-1", sdk_attributes: { active: true } },
  }]);
  assert.equal(fixture.aliases.projectId, fixture.instance_id);
  assert.equal(fixture.aliases.pid, fixture.instance_id);
});
