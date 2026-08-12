import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryRoot = new URL("../", import.meta.url);
const canonicalRepository = "https://github.com/mabzadev/superboard";
const retiredRepositoryPattern =
  /(?:https:\/\/github\.com\/mabzadev\/|git@github\.com:mabzadev\/)(?:superboard-platform|superboard-reference)(?:\.git)?/u;

const activeMetadataFiles = [
  "apps/dashboard/package.json",
  "apps/mcp/package.json",
  "apps/mcp/server.json",
  "deploy/targets/mbza-development.json",
  "deploy/targets/vocostar.json",
  "sdks/flutter/pubspec.yaml",
  "sdks/flutter/ios/superboard_flutter.podspec",
  "sdks/ios/OpenGrow.podspec",
  "sdks/javascript/package.json",
  "sdks/react-native/package.json",
  "sdks/react-native/opengrow-react-native.podspec",
  "tools/flutterflow-applications/vocostar/dsl/migration.dart",
  "tools/flutterflow-library/dsl/edit.dart",
  "workers/custom/vocostar/orchestrators/PROVENANCE.json",
];

test("active source and deployment metadata only reference the canonical repository", async () => {
  for (const relativePath of activeMetadataFiles) {
    const content = await readFile(new URL(relativePath, repositoryRoot), "utf8");
    assert.match(
      content,
      /github\.com\/mabzadev\/superboard/u,
      `${relativePath} must reference ${canonicalRepository}`,
    );
    assert.doesNotMatch(
      content,
      retiredRepositoryPattern,
      `${relativePath} must not direct active development to an archived repository`,
    );
  }
});

test("historical package coordinates remain explicitly frozen on the archived package repository", async () => {
  const catalog = JSON.parse(
    await readFile(new URL("config/sdk-libraries.json", repositoryRoot), "utf8"),
  );
  assert.equal(catalog.repository, canonicalRepository);

  const historicalIds = ["android", "javascript", "react-native"];
  for (const id of historicalIds) {
    const library = catalog.libraries.find((entry) => entry.id === id);
    assert.ok(library, `missing historical SDK ${id}`);
    assert.ok(
      ["internal", "archived"].includes(library.lifecycle),
      `${id} must not be an active SDK`,
    );
    assert.equal(
      library.distribution.repository,
      "mabzadev/superboard-platform",
      `${id} must preserve its immutable GitHub Packages coordinate`,
    );
  }
});
