import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  immutableSdkLocks,
  resolveRemoteTag,
  verifyRemoteImmutableSdkTags,
} from "./reference-sdk-lock.mjs";

const root = new URL("../", import.meta.url);
const project = JSON.parse(
  await readFile(new URL("reference.project.json", root), "utf8"),
);
const lockSource = await readFile(new URL("pubspec.lock", root), "utf8");

test("the application lockfile pins every released SDK tag to a commit", () => {
  const entries = immutableSdkLocks(project, lockSource).sort((left, right) =>
    left.packageName.localeCompare(right.packageName),
  );
  const expected = Object.entries(project.libraries)
    .filter(
      ([, library]) => library.sourceVersion === library.releaseVersion,
    )
    .map(([packageName, library]) => ({
      packageName,
      releaseRef: library.releaseRef,
    }))
    .sort((left, right) => left.packageName.localeCompare(right.packageName));

  assert.deepEqual(
    entries.map(({ packageName, releaseRef }) => ({ packageName, releaseRef })),
    expected,
  );
  for (const entry of entries) assert.match(entry.resolvedRef, /^[0-9a-f]{40}$/u);
  assert.doesNotMatch(lockSource, /\/Users\/|source:\s+path/u);
});

test("lock validation rejects a moved dependency ref and a local path", () => {
  const [first] = immutableSdkLocks(project, lockSource);
  const movedRefLock = lockSource.replace(
    `ref: "${first.releaseRef}"`,
    'ref: "sdk-invalid-v9.9.9"',
  );
  assert.notEqual(movedRefLock, lockSource, "the fixture must move one ref");
  assert.throws(
    () => immutableSdkLocks(project, movedRefLock),
    /lock ref must be/u,
  );
  const packageStart = lockSource.indexOf(`  ${first.packageName}:\n`);
  const packageBodyStart = packageStart + `  ${first.packageName}:\n`.length;
  const nextPackage = lockSource
    .slice(packageBodyStart)
    .match(/^  [a-z0-9_]+:\s*$/mu);
  const packageEnd = nextPackage
    ? packageBodyStart + nextPackage.index
    : lockSource.length;
  const sourceStart = lockSource.indexOf("    source: git", packageStart);
  assert.ok(packageStart >= 0, "the locked package fixture must exist");
  assert.ok(
    sourceStart >= packageStart &&
      sourceStart < packageEnd,
    "the locked package fixture must use a Git source",
  );
  const localPathLock =
    lockSource.slice(0, sourceStart) +
    "    source: path" +
    lockSource.slice(sourceStart + "    source: git".length);
  assert.notEqual(
    localPathLock,
    lockSource,
    "the fixture must replace one Git source",
  );
  assert.throws(
    () => immutableSdkLocks(project, localPathLock),
    /missing from pubspec\.lock as a Git dependency/u,
  );
});

test("remote tag resolution supports annotated and lightweight tags", () => {
  const tag = "sdk-sample-v1.0.0";
  assert.equal(
    resolveRemoteTag(
      `${"a".repeat(40)}\trefs/tags/${tag}\n${"b".repeat(40)}\trefs/tags/${tag}^{}\n`,
      tag,
    ),
    "b".repeat(40),
  );
  assert.equal(
    resolveRemoteTag(`${"c".repeat(40)}\trefs/tags/${tag}\n`, tag),
    "c".repeat(40),
  );
});

test("remote verification fails closed when an immutable tag moves", async () => {
  const entries = immutableSdkLocks(project, lockSource);
  await assert.rejects(
    verifyRemoteImmutableSdkTags({
      project,
      lockSource,
      listRemote: async (_repository, releaseRef) =>
        `${"f".repeat(40)}\trefs/tags/${releaseRef}\n`,
    }),
    new RegExp(`pubspec\\.lock pins ${entries[0].resolvedRef}`, "u"),
  );
});
