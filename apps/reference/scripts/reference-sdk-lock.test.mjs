import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  candidateSdkLocks,
  immutableSdkLocks,
  parseLockedPathDependencies,
  resolveRemoteTag,
  verifyRemoteImmutableSdkTags,
} from "./reference-sdk-lock.mjs";

const root = new URL("../", import.meta.url);
const project = JSON.parse(
  await readFile(new URL("reference.project.json", root), "utf8"),
);
const lockSource = await readFile(new URL("pubspec.lock", root), "utf8");

test("the application lockfile resolves only the coordinated native candidates", () => {
  assert.deepEqual(immutableSdkLocks(project, lockSource), []);
  assert.deepEqual(candidateSdkLocks(project, lockSource), [
    {
      packageName: "superboard_flutterflow",
      sourceVersion: "3.0.0",
      path: "../../sdks/flutterflow",
    },
  ]);
  const paths = parseLockedPathDependencies(lockSource);
  assert.equal(paths.get("superboard_flutter")?.version, "3.0.0");
  assert.equal(paths.get("superboard_flutterflow")?.version, "3.0.0");
  assert.doesNotMatch(lockSource, /opengrow_flutterflow_messaging:/u);
});

test("candidate lock validation rejects path and version drift", () => {
  const movedPathLock = lockSource.replace(
    'path: "../../sdks/flutterflow"',
    'path: "../../sdks/flutterflow-drift"',
  );
  assert.throws(
    () => candidateSdkLocks(project, movedPathLock),
    /lock path must be/u,
  );
  const movedVersionLock = lockSource.replace(
    /(^  superboard_flutterflow:[\s\S]*?^    version: )"3\.0\.0"/mu,
    '$1"3.0.1"',
  );
  assert.throws(
    () => candidateSdkLocks(project, movedVersionLock),
    /lock version must be 3\.0\.0/u,
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
  const publishedProject = {
    platformRepository: "https://github.com/mabzadev/superboard",
    libraries: {
      superboard_sample: {
        path: "sdks/sample",
        sourceVersion: "1.0.0",
        releaseVersion: "1.0.0",
        releaseRef: "sdk-sample-v1.0.0",
      },
    },
  };
  const publishedLock = `packages:\n  superboard_sample:\n    dependency: "direct main"\n    description:\n      path: sdks/sample\n      ref: sdk-sample-v1.0.0\n      resolved-ref: ${"a".repeat(40)}\n      url: "https://github.com/mabzadev/superboard.git"\n    source: git\n    version: "1.0.0"\n`;
  const entries = immutableSdkLocks(publishedProject, publishedLock);
  await assert.rejects(
    verifyRemoteImmutableSdkTags({
      project: publishedProject,
      lockSource: publishedLock,
      listRemote: async (_repository, releaseRef) =>
        `${"f".repeat(40)}\trefs/tags/${releaseRef}\n`,
    }),
    new RegExp(`pubspec\\.lock pins ${entries[0].resolvedRef}`, "u"),
  );
});
