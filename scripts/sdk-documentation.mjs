import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSdkCatalog, validateSdkCatalog } from "./sdk-catalog.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

export const sdkDocumentationContracts = Object.freeze([
  { id: "flutter", path: "sdks/flutter/README.md" },
  { id: "flutterflow", path: "sdks/flutterflow/README.md" },
  {
    id: "flutterflow-support",
    path: "sdks/flutterflow_messaging/README.md",
  },
  { id: "ios", path: "sdks/ios/README.md" },
  { id: "android", path: "sdks/android/README.md" },
  { id: "javascript", path: "sdks/javascript/README.md" },
  { id: "react-native", path: "sdks/react-native/README.md" },
]);

export const sdkDocumentationAuditPaths = Object.freeze([
  "sdks/ios/CLAUDE.md",
  "docs/VOCOSTAR_CLOUDFLARE_ARCHITECTURE.md",
]);

function marker(id, boundary) {
  return `<!-- opengrow-sdk-documentation:${id}:${boundary} -->`;
}

function libraryMap(catalog) {
  if (!catalog || !Array.isArray(catalog.libraries)) {
    throw new Error("SDK catalogue must contain a libraries array");
  }
  const libraries = new Map();
  for (const library of catalog.libraries) {
    if (!library?.id || libraries.has(library.id)) {
      throw new Error(
        `SDK catalogue contains an invalid or duplicate id: ${String(library?.id)}`,
      );
    }
    libraries.set(library.id, library);
  }
  for (const { id } of sdkDocumentationContracts) {
    if (!libraries.has(id)) {
      throw new Error(`SDK catalogue is missing documentation library ${id}`);
    }
  }
  return libraries;
}

function published(libraries, id) {
  const library = libraries.get(id);
  for (const field of [
    "packageName",
    "latestReleaseVersion",
    "releaseRef",
    "install",
  ]) {
    if (!String(library?.[field] ?? "").trim()) {
      throw new Error(`SDK catalogue library ${id} is missing ${field}`);
    }
  }
  return library;
}

function fenced(language, value) {
  return `\`\`\`${language}\n${value}\n\`\`\``;
}

function flutterInstallation(library, label = "Flutter") {
  return [
    "## Installation",
    "",
    `Add the published ${label} package \`${library.packageName}\``,
    `at the immutable release \`${library.releaseRef}\`:`,
    "",
    fenced("yaml", library.install),
    "",
    "No repository read token is required. Runtime credentials must never be",
    "placed in the Git dependency or exported application source.",
    "",
    "Then resolve the immutable dependency:",
    "",
    fenced("bash", "flutter pub get"),
  ].join("\n");
}

function githubRawUrl(repository, ref, path) {
  const url = new URL(repository);
  if (url.protocol !== "https:" || url.hostname !== "github.com") {
    throw new Error(
      "SDK documentation requires the canonical public GitHub repository",
    );
  }
  const repositoryPath = url.pathname
    .replace(/\/\.git$/u, "")
    .replace(/\/$/u, "");
  return `https://raw.githubusercontent.com${repositoryPath}/${ref}/${path}`;
}

function repositoryGitUrl(repository) {
  return `${String(repository).replace(/\.git$/u, "")}.git`;
}

export function renderSdkDocumentationSections(catalog) {
  const libraries = libraryMap(catalog);
  const flutter = published(libraries, "flutter");
  const flutterflow = published(libraries, "flutterflow");
  const support = published(libraries, "flutterflow-support");
  const ios = published(libraries, "ios");
  const android = published(libraries, "android");
  const javascript = published(libraries, "javascript");
  const reactNative = published(libraries, "react-native");
  const iosSourceTag = `sdk-ios-v${ios.latestReleaseVersion}`;
  const iosPodspec = githubRawUrl(
    catalog.repository,
    iosSourceTag,
    `${ios.sourcePath}/OpenGrow.podspec`,
  );

  return new Map([
    ["flutter", flutterInstallation(flutter)],
    ["flutterflow", flutterInstallation(flutterflow, "FlutterFlow")],
    [
      "flutterflow-support",
      flutterInstallation(support, "FlutterFlow Support"),
    ],
    [
      "ios",
      [
        "## Installation",
        "",
        "### Swift Package Manager",
        "",
        "The published iOS SDK is distributed from public Git with Swift Package",
        `Manager at the exact release \`${ios.latestReleaseVersion}\`:`,
        "",
        fenced("swift", ios.install),
        "",
        "In Xcode, use **File → Add Package Dependencies**, enter",
        `\`${repositoryGitUrl(catalog.repository)}\`, and select exact version`,
        `\`${ios.latestReleaseVersion}\`. CocoaPods Trunk is not a published or supported`,
        "distribution channel for this SDK.",
      ].join("\n"),
    ],
    [
      "android",
      [
        "## Installation",
        "",
        "Add the published OpenGrow dependency to the application module:",
        "",
        fenced("kotlin", android.install),
      ].join("\n"),
    ],
    [
      "javascript",
      [
        "## Installation",
        "",
        `Install the published package \`${javascript.packageName}\` at the exact`,
        `release \`${javascript.latestReleaseVersion}\`:`,
        "",
        fenced("bash", javascript.install),
        "",
        "Then import the package by its catalogue-owned name:",
        "",
        fenced(
          "javascript",
          `import OpenGrow from "${javascript.packageName}";`,
        ),
      ].join("\n"),
    ],
    [
      "react-native",
      [
        "## Installation",
        "",
        fenced(
          "bash",
          [
            "# npm",
            reactNative.install,
            "",
            "# yarn",
            `yarn add ${reactNative.packageName}@${reactNative.latestReleaseVersion}`,
          ].join("\n"),
        ),
        "",
        "### Android dependency",
        "",
        "Add the released native Android SDK to `android/app/build.gradle`:",
        "",
        fenced("kotlin", android.install),
        "",
        "### iOS dependency",
        "",
        "The React Native pod consumes the native OpenGrow podspec directly from its",
        "reviewed immutable Git tag; it does not claim a CocoaPods Trunk release:",
        "",
        fenced("ruby", `pod '${ios.packageName}', :podspec => '${iosPodspec}'`),
        "",
        `The URL is pinned to \`${iosSourceTag}\`. Run \`pod install\` after updating`,
        "the dependency.",
      ].join("\n"),
    ],
  ]);
}

function markerMatches(source, value) {
  return source.split(value).length - 1;
}

export function applySdkDocumentationSections(catalog, documents) {
  const sections = renderSdkDocumentationSections(catalog);
  const output = new Map();
  const errors = [];

  for (const contract of sdkDocumentationContracts) {
    const source = documents.get(contract.path);
    if (typeof source !== "string") {
      errors.push(`${contract.path}: documentation file is missing`);
      continue;
    }
    const start = marker(contract.id, "start");
    const end = marker(contract.id, "end");
    if (
      markerMatches(source, start) !== 1 ||
      markerMatches(source, end) !== 1
    ) {
      errors.push(
        `${contract.path}: expected exactly one ${contract.id} documentation section`,
      );
      continue;
    }
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex + start.length);
    if (endIndex < startIndex) {
      errors.push(
        `${contract.path}: documentation section markers are reversed`,
      );
      continue;
    }
    const rendered = `${start}\n\n${sections.get(contract.id)}\n\n${end}`;
    output.set(
      contract.path,
      `${source.slice(0, startIndex)}${rendered}${source.slice(endIndex + end.length)}`,
    );
  }

  return { documents: output, errors };
}

function semanticErrors(catalog, documents) {
  const libraries = libraryMap(catalog);
  const errors = [];
  const checks = [
    {
      id: "android",
      pattern: /[a-z][a-z0-9_.-]*:opengrow-android(?:-sdk)?(?=[:'"`\s)])/giu,
      expected: published(libraries, "android").packageName,
    },
    {
      id: "javascript",
      pattern: /@[a-z0-9_.-]+\/opengrow-js(?:-sdk)?/giu,
      expected: published(libraries, "javascript").packageName,
    },
    {
      id: "react-native",
      pattern: /@[a-z0-9_.-]+\/opengrow-react-native(?:-sdk)?/giu,
      expected: published(libraries, "react-native").packageName,
    },
  ];

  for (const { id, pattern, expected } of checks) {
    for (const contract of sdkDocumentationContracts) {
      const source = documents.get(contract.path) ?? "";
      for (const match of source.matchAll(pattern)) {
        if (match[0] !== expected) {
          errors.push(
            `${contract.path}: retired ${id} coordinate ${match[0]}; expected ${expected}`,
          );
        }
      }
    }
  }

  const releaseRefChecks = [
    {
      path: "sdks/flutterflow/README.md",
      id: "flutterflow",
      pattern: /sdk-flutterflow-v[0-9]+\.[0-9]+\.[0-9]+/gu,
      expected: published(libraries, "flutterflow").releaseRef,
    },
    {
      path: "sdks/flutterflow_messaging/README.md",
      id: "flutterflow-support",
      pattern: /sdk-flutterflow-messaging-v[0-9]+\.[0-9]+\.[0-9]+/gu,
      expected: published(libraries, "flutterflow-support").releaseRef,
    },
    {
      path: "sdks/react-native/README.md",
      id: "ios",
      pattern: /sdk-ios-v[0-9]+\.[0-9]+\.[0-9]+/gu,
      expected: `sdk-ios-v${published(libraries, "ios").latestReleaseVersion}`,
    },
  ];
  for (const { path, id, pattern, expected } of releaseRefChecks) {
    for (const match of (documents.get(path) ?? "").matchAll(pattern)) {
      if (match[0] !== expected) {
        errors.push(
          `${path}: stale ${id} release reference ${match[0]}; expected ${expected}`,
        );
      }
    }
  }

  const iosReadme = documents.get("sdks/ios/README.md") ?? "";
  if (
    /cocoapods\.org\/pods\/OpenGrow/iu.test(iosReadme) ||
    /^\s*pod\s+['"]OpenGrow['"]\s*$/mu.test(iosReadme)
  ) {
    errors.push(
      "sdks/ios/README.md: CocoaPods Trunk is not a published SDK distribution channel",
    );
  }
  const iosGuide = documents.get("sdks/ios/CLAUDE.md") ?? "";
  if (
    /Distributed via[^\n]*CocoaPods/iu.test(iosGuide) ||
    /Package Managers:[^\n]*CocoaPods/iu.test(iosGuide)
  ) {
    errors.push(
      "sdks/ios/CLAUDE.md: CocoaPods must not be documented as a published package channel",
    );
  }
  const vocostarArchitecture =
    documents.get("docs/VOCOSTAR_CLOUDFLARE_ARCHITECTURE.md") ?? "";
  if (/sdk-flutterflow-v[0-9]+\.[0-9]+\.[0-9]+/u.test(vocostarArchitecture)) {
    errors.push(
      "docs/VOCOSTAR_CLOUDFLARE_ARCHITECTURE.md: architecture must reference the SDK catalogue instead of duplicating a FlutterFlow version",
    );
  }
  return errors;
}

export function validateSdkDocumentation(catalog, documents) {
  const applied = applySdkDocumentationSections(catalog, documents);
  const errors = [...applied.errors];
  for (const path of sdkDocumentationAuditPaths) {
    if (typeof documents.get(path) !== "string") {
      errors.push(`${path}: audited SDK documentation file is missing`);
    }
  }
  errors.push(...semanticErrors(catalog, documents));
  for (const contract of sdkDocumentationContracts) {
    const expected = applied.documents.get(contract.path);
    const observed = documents.get(contract.path);
    if (expected !== undefined && observed !== expected) {
      errors.push(
        `${contract.path}: generated SDK documentation is stale; run npm run sdk:documentation:write`,
      );
    }
  }
  return { ok: errors.length === 0, errors };
}

async function loadDocuments() {
  const paths = [
    ...sdkDocumentationContracts.map(({ path }) => path),
    ...sdkDocumentationAuditPaths,
  ];
  return new Map(
    await Promise.all(
      paths.map(async (path) => [
        path,
        await readFile(resolve(root, path), "utf8"),
      ]),
    ),
  );
}

async function main() {
  const command = process.argv[2] ?? "check";
  if (!new Set(["check", "write"]).has(command)) {
    throw new Error(`Unsupported SDK documentation command: ${command}`);
  }
  const catalog = await loadSdkCatalog();
  const catalogResult = await validateSdkCatalog(catalog);
  if (!catalogResult.ok) {
    throw new Error(
      `SDK documentation cannot use an invalid catalogue:\n${catalogResult.errors.join("\n")}`,
    );
  }
  const documents = await loadDocuments();
  const applied = applySdkDocumentationSections(catalog, documents);
  if (applied.errors.length > 0) {
    throw new Error(applied.errors.join("\n"));
  }
  if (command === "write") {
    await Promise.all(
      [...applied.documents].map(([path, source]) =>
        writeFile(resolve(root, path), source),
      ),
    );
  }
  const checkedDocuments =
    command === "write"
      ? new Map([...documents, ...applied.documents])
      : documents;
  const result = validateSdkDocumentation(catalog, checkedDocuments);
  if (!result.ok) {
    throw new Error(result.errors.join("\n"));
  }
  process.stdout.write(
    `${JSON.stringify({ status: "ok", generatedDocuments: sdkDocumentationContracts.length, auditedDocuments: sdkDocumentationAuditPaths.length }, null, 2)}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
