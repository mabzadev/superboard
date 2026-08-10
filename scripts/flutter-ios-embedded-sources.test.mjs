import assert from "node:assert/strict";
import {
  lstat,
  readFile,
  readdir,
  readlink,
  realpath,
} from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const canonicalRoot = join(repositoryRoot, "sdks/ios/Sources/OpenGrow");
const embeddedRoot = join(
  repositoryRoot,
  "sdks/flutter/ios/EmbeddedOpenGrow",
);
const podspecUrl = new URL(
  "../sdks/flutter/ios/superboard_flutter.podspec",
  import.meta.url,
);

async function filesBelow(root) {
  const files = [];

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else {
        files.push(relative(root, path));
      }
    }
  }

  await visit(root);
  return files.sort();
}

test("the Flutter pod embeds every internal iOS source as a repository-relative link", async () => {
  const canonicalFiles = await filesBelow(canonicalRoot);
  const embeddedFiles = await filesBelow(embeddedRoot);

  assert.ok(canonicalFiles.length > 0, "the canonical iOS SDK cannot be empty");
  assert.deepEqual(
    embeddedFiles,
    canonicalFiles,
    "the Flutter pod source links must exactly mirror the internal iOS SDK",
  );

  for (const path of canonicalFiles) {
    assert.ok(
      new Set([".swift", ".xib"]).has(extname(path)),
      `declare how CocoaPods should package the new internal iOS file: ${path}`,
    );

    const canonicalPath = join(canonicalRoot, path);
    const embeddedPath = join(embeddedRoot, path);
    const embeddedStat = await lstat(embeddedPath);
    assert.ok(
      embeddedStat.isSymbolicLink(),
      `${path} must remain a link, not a divergent source copy`,
    );
    assert.equal(
      await readlink(embeddedPath),
      relative(dirname(embeddedPath), canonicalPath),
      `${path} must point directly to its canonical monorepo source`,
    );
    assert.equal(await realpath(embeddedPath), await realpath(canonicalPath));
  }
});

test("the Flutter podspec consumes only the embedded monorepo links", async () => {
  const podspec = await readFile(podspecUrl, "utf8");

  assert.match(podspec, /'EmbeddedOpenGrow\/\*\*\/\*\.swift'/u);
  assert.match(podspec, /'EmbeddedOpenGrow\/\*\*\/\*\.\{xib\}'/u);
  assert.doesNotMatch(podspec, /\.\.\/\.\.\/ios\/Sources\/OpenGrow/u);
  assert.doesNotMatch(podspec, /s\.dependency\s+['"]OpenGrow/u);
});
