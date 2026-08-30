import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const fixture = JSON.parse(
  readFileSync(new URL("../../../packages/contracts/fixtures/emdash-store-parity/v1.json", import.meta.url), "utf8"),
);

test("JavaScript preserves the public Store contract before and after EmDash authority", () => {
  assert.deepEqual(fixture.after, fixture.before);
  assert.equal(fixture.aliases.projectId, fixture.instance_id);
  assert.equal(fixture.aliases.pid, fixture.instance_id);
});
