import assert from "node:assert/strict";
import test from "node:test";
import { checkReferenceBrand } from "./reference-brand.mjs";

test("Reference exposes only the canonical SuperBoard brand and MBZA domains", () => {
  const result = checkReferenceBrand();
  assert.equal(result.name, "SuperBoard Reference");
  assert.equal(result.repository, "mbzadev/superboard");
  assert.equal(result.platformRepository, "mbzadev/superboard");
  assert.equal(result.dashboard, "board.mbza.dev");
  assert.equal(result.shortLinks, "in.mbza.dev");
});
