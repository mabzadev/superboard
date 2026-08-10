import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const historyPath = resolve(root, "config/sdk-release-history.json");
const historySchemaPath = resolve(
  root,
  "config/sdk-release-history.schema.json",
);
const tagPrefixes = Object.freeze({
  flutter: "sdk-flutter-v",
  flutterflow: "sdk-flutterflow-v",
  "flutterflow-support": "sdk-flutterflow-messaging-v",
  ios: "sdk-ios-v",
  android: "sdk-android-v",
  javascript: "sdk-js-v",
  "react-native": "sdk-react-native-v",
});

export async function loadSdkReleaseHistory(path = historyPath) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function validateSdkReleaseHistory(history, catalogue) {
  const validate = await releaseHistorySchemaValidator();
  const errors = [];
  if (!validate(history)) {
    errors.push(
      ...(validate.errors ?? []).map(
        (error) =>
          `release history${error.instancePath || "/"} ${error.message}`,
      ),
    );
    return { ok: false, errors, failures: 0 };
  }

  const expectedRepository = catalogueRepository(catalogue?.repository);
  if (expectedRepository && history.repository !== expectedRepository) {
    errors.push(
      `release history repository is ${history.repository}, expected ${expectedRepository}`,
    );
  }

  const refs = new Set();
  const versions = new Set();
  for (const failure of history.immutableFailures) {
    const label = `release history ${failure.libraryId}@${failure.version}`;
    const expectedTag = canonicalReleaseTag(failure.libraryId, failure.version);
    if (failure.releaseTag !== expectedTag) {
      errors.push(`${label} releaseTag must be ${expectedTag}`);
    }
    const versionKey = `${failure.libraryId}@${failure.version}`;
    if (versions.has(versionKey)) {
      errors.push(`${label} is duplicated`);
    }
    versions.add(versionKey);

    const expectedPackageRefs =
      failure.libraryId === "ios" ? [failure.version] : [];
    if (
      failure.packageRefs.length !== expectedPackageRefs.length ||
      expectedPackageRefs.some(
        (reference, index) => failure.packageRefs[index] !== reference,
      )
    ) {
      errors.push(
        `${label} packageRefs must be ${JSON.stringify(expectedPackageRefs)}`,
      );
    }
    for (const reference of [failure.releaseTag, ...failure.packageRefs]) {
      if (refs.has(reference)) {
        errors.push(`release history ref ${reference} is duplicated`);
      }
      refs.add(reference);
    }

    const current = catalogue?.libraries?.find(
      (library) => library.id === failure.libraryId,
    );
    if (
      current?.releaseStatus === "released" &&
      current.latestReleaseVersion === failure.version
    ) {
      errors.push(`${label} conflicts with the current successful release`);
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    failures: history.immutableFailures.length,
  };
}

let historySchemaValidator;

async function releaseHistorySchemaValidator() {
  if (!historySchemaValidator) {
    const schema = JSON.parse(await readFile(historySchemaPath, "utf8"));
    historySchemaValidator = new Ajv2020({
      allErrors: true,
      strict: true,
    }).compile(schema);
  }
  return historySchemaValidator;
}

export function immutableFailureFor(history, libraryId, version) {
  return (
    history?.immutableFailures?.find(
      (failure) =>
        failure.libraryId === libraryId && failure.version === version,
    ) ?? null
  );
}

export function assertSdkReleaseCandidateNotFailed(
  history,
  libraryId,
  version,
) {
  const failure = immutableFailureFor(history, libraryId, version);
  if (!failure) return;
  throw new Error(
    `${failure.releaseTag} is an immutable failed release from workflow run ${failure.workflowRunId}; bump the SDK version before publishing`,
  );
}

export function canonicalReleaseTag(libraryId, version) {
  const prefix = tagPrefixes[libraryId];
  if (!prefix) throw new Error(`Unknown SDK library: ${libraryId}`);
  return `${prefix}${version}`;
}

function catalogueRepository(value) {
  if (!value) return null;
  try {
    return new URL(value).pathname.replace(/^\//u, "").replace(/\.git$/u, "");
  } catch {
    return null;
  }
}
