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
  const entries = immutableSdkLocks(project, lockSource);

  assert.deepEqual(
    entries.map(({ packageName, releaseRef }) => ({ packageName, releaseRef })),
    [
      {
        packageName: "opengrow_flutterflow",
        releaseRef: "sdk-flutterflow-v2.2.4",
      },
      {
        packageName: "opengrow_flutterflow_messaging",
        releaseRef: "sdk-flutterflow-messaging-v1.3.0",
      },
    ],
  );
  for (const entry of entries) assert.match(entry.resolvedRef, /^[0-9a-f]{40}$/u);
  assert.doesNotMatch(lockSource, /\/Users\/|source:\s+path/u);
});

test("lock validation rejects a moved dependency ref and a local path", () => {
  assert.throws(
    () =>
      immutableSdkLocks(
        project,
        lockSource.replace(
          'ref: "sdk-flutterflow-v2.2.4"',
          'ref: "sdk-flutterflow-v9.9.9"',
        ),
      ),
    /lock ref must be/u,
  );
  assert.throws(
    () =>
      immutableSdkLocks(
        project,
        lockSource.replace(
          "source: git\n    version: \"2.2.4\"",
          "source: path\n    version: \"2.2.4\"",
        ),
      ),
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
