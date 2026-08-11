import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkSuperBoardBrand, validateSuperBoardBrand } from "./superboard-brand.mjs";

test("canonical SuperBoard brand contract is strict and valid", async () => {
  const manifest = await checkSuperBoardBrand();
  assert.equal(manifest.brand.name, "SuperBoard");
  assert.equal(manifest.repositories.canonical, "mbzadev/superboard");
  assert.deepEqual(manifest.repositories.layout, {
    platform: ".",
    reference: "apps/reference",
  });
  assert.equal(manifest.developmentDomains.dashboard, "board.mbza.dev");
  assert.equal(manifest.developmentDomains.shortLinks, "in.mbza.dev");
  assert.deepEqual(manifest.sdkStrategy.active, ["flutter", "flutterflow"]);
});

test("schema rejects an unreviewed product name", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "superboard-brand-"));
  await mkdir(join(fixture, "config"), { recursive: true });
  await mkdir(join(fixture, "schemas"), { recursive: true });
  const schema = await readFile(
    new URL("../schemas/superboard-brand.schema.json", import.meta.url),
    "utf8",
  );
  const manifest = JSON.parse(
    await readFile(new URL("../config/superboard-brand.json", import.meta.url), "utf8"),
  );
  manifest.brand.name = "OpenGrow";
  await writeFile(join(fixture, "schemas/superboard-brand.schema.json"), schema);
  await writeFile(
    join(fixture, "config/superboard-brand.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await assert.rejects(
    validateSuperBoardBrand({ repositoryRoot: fixture }),
    /invalid SuperBoard brand contract/u,
  );
});
