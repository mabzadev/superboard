import assert from "node:assert/strict";
import test from "node:test";

import { checkReferenceBrand } from "../../../../apps/reference/scripts/reference-brand.mjs";

test("Reference exposes only the canonical SuperBoard brand and MABZA domains", () => {
	const result = checkReferenceBrand();
	assert.equal(result.name, "SuperBoard Reference");
	assert.equal(result.repository, "mabzadev/superboard");
	assert.equal(result.platformRepository, "mabzadev/superboard");
	assert.equal(result.dashboard, "board.mabza.dev");
	assert.equal(result.shortLinks, "in.mabza.dev");
});
