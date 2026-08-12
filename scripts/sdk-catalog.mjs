import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  assertSdkReleaseCandidateNotFailed,
  loadSdkReleaseHistory,
  validateSdkReleaseHistory,
} from "./sdk-release-history.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const catalogPath = resolve(root, "config/sdk-libraries.json");
const catalogSchemaPath = resolve(root, "config/sdk-libraries.schema.json");
const catalogSchemaVersion = 4;
const canonicalRepository =
  "https://github.com/mabzadev/superboard";
const semver = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/;
const commitSha = /^[0-9a-f]{40}$/;
const lifecycles = new Set(["active", "internal", "archived"]);
const githubPackagesTokenEnvironmentVariable =
  "OPENGROW_GITHUB_PACKAGES_TOKEN";
const githubPackagesUserEnvironmentVariable =
  "OPENGROW_GITHUB_PACKAGES_USER";
const registryDistributionIds = new Set([
  "android",
  "javascript",
  "react-native",
]);
const tagPrefixes = Object.freeze({
  flutter: "sdk-flutter-v",
  flutterflow: "sdk-flutterflow-v",
  "flutterflow-support": "sdk-flutterflow-messaging-v",
  ios: "sdk-ios-v",
  android: "sdk-android-v",
  javascript: "sdk-js-v",
  "react-native": "sdk-react-native-v",
});

export async function loadSdkCatalog(path = catalogPath) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function validateSdkCatalog(catalog, options = {}) {
  const errors = await sdkCatalogSchemaErrors(catalog);
  const releaseHistory =
    options.releaseHistory ?? (await loadSdkReleaseHistory());
  if (catalog?.schemaVersion !== catalogSchemaVersion)
    errors.push(`schemaVersion must be ${catalogSchemaVersion}`);
  if (catalog?.repository !== canonicalRepository)
    errors.push(`repository must be ${canonicalRepository}`);
  if (catalog?.releasePolicy !== "immutable-tag")
    errors.push("releasePolicy must be immutable-tag");
  if (!Array.isArray(catalog?.libraries) || catalog.libraries.length === 0)
    errors.push("libraries must be a non-empty array");
  const ids = new Set();
  const packages = new Set();
  const candidatePackages = new Set();
  for (const library of catalog?.libraries ?? []) {
    const prefix = `libraries.${String(library?.id ?? "unknown")}`;
    if (!/^[a-z0-9-]+$/.test(library?.id ?? ""))
      errors.push(`${prefix}.id is invalid`);
    if (ids.has(library.id)) errors.push(`${prefix}.id is duplicated`);
    ids.add(library.id);
    if (!lifecycles.has(library.lifecycle))
      errors.push(`${prefix}.lifecycle is invalid`);
    const active = library.lifecycle === "active";
    if (!library.packageName || packages.has(library.packageName))
      errors.push(`${prefix}.packageName is missing or duplicated`);
    packages.add(library.packageName);
    const hasCandidatePackage = Object.hasOwn(library, "candidatePackageName");
    const hasCandidateInstall = Object.hasOwn(library, "candidateInstall");
    if (hasCandidatePackage !== hasCandidateInstall) {
      errors.push(
        `${prefix}.candidatePackageName and candidateInstall must be declared together`,
      );
    }
    if (hasCandidatePackage) {
      if (!active) {
        errors.push(
          `${prefix}.candidate package migration is only allowed for active libraries`,
        );
      }
      if (library.releaseStatus !== "pending-release") {
        errors.push(
          `${prefix}.candidate package migration requires a pending release`,
        );
      }
      if (
        !library.candidatePackageName ||
        library.candidatePackageName === library.packageName ||
        candidatePackages.has(library.candidatePackageName)
      ) {
        errors.push(`${prefix}.candidatePackageName is invalid or duplicated`);
      }
      candidatePackages.add(library.candidatePackageName);
      if (!/^superboard(?:[_-]|$)/u.test(library.candidatePackageName)) {
        errors.push(
          `${prefix}.candidatePackageName must use the SuperBoard namespace`,
        );
      }
      if (
        !String(library.candidateInstall ?? "").includes(
          library.candidatePackageName,
        ) ||
        !String(library.candidateInstall ?? "").includes(library.sourceVersion)
      ) {
        errors.push(
          `${prefix}.candidateInstall must pin candidatePackageName at sourceVersion`,
        );
      }
      if (!String(library.candidateInstall).includes(canonicalRepository)) {
        errors.push(
          `${prefix}.candidateInstall must use the canonical SuperBoard repository`,
        );
      }
    }
    if (active && !/^SuperBoard\b/u.test(library.displayName ?? "")) {
      errors.push(`${prefix}.displayName must use the SuperBoard brand`);
    }
    if (
      active &&
      /opengrow/iu.test(library.packageName ?? "") &&
      !hasCandidatePackage
    ) {
      errors.push(
        `${prefix} must stage a SuperBoard package coordinate before release`,
      );
    }
    for (const key of ["sourceVersion", "latestReleaseVersion"]) {
      if (!semver.test(library[key] ?? ""))
        errors.push(`${prefix}.${key} is not SemVer`);
    }
    const expectedStatus = active
      ? library.sourceVersion === library.latestReleaseVersion
        ? "released"
        : "pending-release"
      : "released";
    if (library.releaseStatus !== expectedStatus)
      errors.push(`${prefix}.releaseStatus must be ${expectedStatus}`);
    if (!active && library.sourceVersion !== library.latestReleaseVersion) {
      errors.push(
        `${prefix}.sourceVersion must stay frozen at latestReleaseVersion for ${library.lifecycle} libraries`,
      );
    }
    if (!commitSha.test(library.releaseSha ?? "")) {
      errors.push(
        `${prefix}.releaseSha must identify the latest published commit`,
      );
    }
    if (!library.releaseRef || /^(?:dev|main)$/.test(library.releaseRef))
      errors.push(`${prefix}.releaseRef must be immutable`);
    const canonicalTag = tagPrefixes[library.id]
      ? `${tagPrefixes[library.id]}${library.latestReleaseVersion}`
      : null;
    if (library.id === "ios") {
      if (library.releaseRef !== library.latestReleaseVersion)
        errors.push(`${prefix}.releaseRef must be the SwiftPM SemVer tag`);
    } else if (canonicalTag && library.releaseRef !== canonicalTag) {
      errors.push(`${prefix}.releaseRef must be ${canonicalTag}`);
    }
    if (!String(library.install ?? "").includes(library.latestReleaseVersion))
      errors.push(`${prefix}.install must pin latestReleaseVersion`);
    validateDistributionContract(catalog, library, prefix, errors);
    const sourcePath = protectedRepoPath(
      library.sourcePath,
      `${prefix}.sourcePath`,
      errors,
    );
    if (library.license !== "MIT") errors.push(`${prefix}.license must be MIT`);
    const licensePath = protectedRepoPath(
      library.licensePath,
      `${prefix}.licensePath`,
      errors,
    );
    const versionPath = protectedRepoPath(
      library.versionSource,
      `${prefix}.versionSource`,
      errors,
    );
    if (sourcePath && !(await exists(sourcePath)))
      errors.push(`${prefix}.sourcePath does not exist`);
    if (licensePath && !(await exists(licensePath))) {
      errors.push(`${prefix}.licensePath does not exist`);
    } else if (licensePath) {
      const license = await readFile(licensePath, "utf8");
      if (!license.startsWith("MIT License\n"))
        errors.push(`${prefix}.licensePath is not an MIT licence`);
    }
    if (versionPath && !(await exists(versionPath)))
      errors.push(`${prefix}.versionSource does not exist`);
    if (versionPath && (await exists(versionPath))) {
      const observed = await sourceVersion(versionPath);
      if (observed !== library.sourceVersion)
        errors.push(
          `${prefix}.sourceVersion is ${library.sourceVersion}, source declares ${observed}`,
        );
      if (library.ecosystem === "npm" && versionPath.endsWith("package.json")) {
        const manifest = JSON.parse(await readFile(versionPath, "utf8"));
        const expectedPackageName =
          library.candidatePackageName ?? library.packageName;
        if (manifest.name !== expectedPackageName) {
          errors.push(
            `${prefix}.source package name is ${String(manifest.name)}, expected ${expectedPackageName}`,
          );
        }
      }
      if (
        options.releaseCandidateTag ===
          `${tagPrefixes[library.id] ?? ""}${library.sourceVersion}` &&
        versionPath.endsWith("pubspec.yaml")
      ) {
        const manifest = await readFile(versionPath, "utf8");
        const observedPackageName =
          manifest.match(/^name:\s*([^\s]+)/mu)?.[1] ?? null;
        const expectedPackageName =
          library.candidatePackageName ?? library.packageName;
        if (observedPackageName !== expectedPackageName) {
          errors.push(
            `${prefix}.source package name is ${String(observedPackageName)}, expected ${expectedPackageName} before candidate publication`,
          );
        }
      }
    }
    if (library.surfaceManifest) {
      const manifestPath = protectedRepoPath(
        library.surfaceManifest,
        `${prefix}.surfaceManifest`,
        errors,
      );
      if (manifestPath && !(await exists(manifestPath)))
        errors.push(`${prefix}.surfaceManifest does not exist`);
    }
  }
  for (const candidatePackage of candidatePackages) {
    if (packages.has(candidatePackage)) {
      errors.push(
        `candidate package ${candidatePackage} duplicates a released packageName`,
      );
    }
  }
  if (Object.keys(tagPrefixes).some((id) => !ids.has(id)))
    errors.push("catalogue is missing one or more governed libraries");
  const historyResult = await validateSdkReleaseHistory(
    releaseHistory,
    catalog,
  );
  errors.push(...historyResult.errors);
  await validateFlutterFlowSurface(
    catalog,
    errors,
    options.flutterFlowManifest,
  );
  if (options.releaseTag)
    validateReleaseTag(catalog, options.releaseTag, options.releaseSha, errors);
  else if (options.releaseSha) {
    errors.push("releaseSha validation requires a releaseTag");
  }
  if (options.releaseCandidateTag)
    validateReleaseCandidateTag(
      catalog,
      releaseHistory,
      options.releaseCandidateTag,
      errors,
    );
  return {
    ok: errors.length === 0,
    errors,
    libraries: catalog?.libraries?.length ?? 0,
  };
}

function validateDistributionContract(catalog, library, prefix, errors) {
  const distribution = library?.distribution;
  if (!registryDistributionIds.has(library?.id)) {
    if (distribution !== undefined) {
      errors.push(
        `${prefix}.distribution is only supported for registry-distributed SDKs`,
      );
    }
    return;
  }
  if (!distribution || typeof distribution !== "object") {
    errors.push(`${prefix}.distribution is required`);
    return;
  }

  const isNpm = new Set(["javascript", "react-native"]).has(library.id);
  const expectedKind = isNpm
    ? "github-packages-npm"
    : "github-packages-maven";
  const expectedRegistry = isNpm
    ? "https://npm.pkg.github.com"
    : githubMavenRegistry(`https://github.com/${distribution.repository}`);
  const expectedInstall = isNpm
    ? `npm install ${library.packageName}@${library.latestReleaseVersion}`
    : `implementation("${library.packageName}:${library.latestReleaseVersion}")`;

  if (distribution.registryKind !== expectedKind) {
    errors.push(`${prefix}.distribution.registryKind must be ${expectedKind}`);
  }
  if (distribution.repository !== "mabzadev/superboard-platform") {
    errors.push(
      `${prefix}.distribution.repository must preserve the historical package owner mabzadev/superboard-platform`,
    );
  }
  if (distribution.registry !== expectedRegistry) {
    errors.push(`${prefix}.distribution.registry must be ${expectedRegistry}`);
  }
  if (distribution.publicMetadata !== true) {
    errors.push(`${prefix}.distribution.publicMetadata must be true`);
  }
  if (distribution.anonymousInstallable !== false) {
    errors.push(`${prefix}.distribution.anonymousInstallable must be false`);
  }
  if (distribution.authentication?.required !== true) {
    errors.push(`${prefix}.distribution.authentication.required must be true`);
  }
  if (
    distribution.authentication?.tokenEnvironmentVariable !==
    githubPackagesTokenEnvironmentVariable
  ) {
    errors.push(
      `${prefix}.distribution.authentication.tokenEnvironmentVariable must be ${githubPackagesTokenEnvironmentVariable}`,
    );
  }
  if (isNpm) {
    if (
      Object.hasOwn(
        distribution.authentication ?? {},
        "usernameEnvironmentVariable",
      )
    ) {
      errors.push(
        `${prefix}.distribution.authentication.usernameEnvironmentVariable is not used by npm`,
      );
    }
  } else if (
    distribution.authentication?.usernameEnvironmentVariable !==
    githubPackagesUserEnvironmentVariable
  ) {
    errors.push(
      `${prefix}.distribution.authentication.usernameEnvironmentVariable must be ${githubPackagesUserEnvironmentVariable}`,
    );
  }
  if (library.install !== expectedInstall) {
    errors.push(`${prefix}.install must be ${expectedInstall}`);
  }
}

function githubMavenRegistry(repository) {
  try {
    const url = new URL(repository);
    const repositoryPath = url.pathname
      .replace(/^\//u, "")
      .replace(/\.git$/u, "")
      .replace(/\/$/u, "");
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      repositoryPath.split("/").length !== 2
    ) {
      return "the GitHub Packages Maven URL derived from repository";
    }
    return `https://maven.pkg.github.com/${repositoryPath}`;
  } catch {
    return "the GitHub Packages Maven URL derived from repository";
  }
}

let catalogSchemaValidator;

async function sdkCatalogSchemaErrors(catalog) {
  if (!catalogSchemaValidator) {
    const schema = JSON.parse(await readFile(catalogSchemaPath, "utf8"));
    catalogSchemaValidator = new Ajv2020({
      allErrors: true,
      strict: true,
      formats: {
        uri: (value) => {
          try {
            return Boolean(new URL(value));
          } catch {
            return false;
          }
        },
      },
    }).compile(schema);
  }
  if (catalogSchemaValidator(catalog)) return [];
  return (catalogSchemaValidator.errors ?? []).map(
    (error) => `catalogue${error.instancePath || "/"} ${error.message}`,
  );
}

function releaseTagEntry(catalog, tag, errors) {
  const entry = Object.entries(tagPrefixes).find(([, prefix]) =>
    tag.startsWith(prefix),
  );
  if (!entry) {
    errors.push(`Unsupported SDK release tag: ${tag}`);
    return null;
  }
  const [id, prefix] = entry;
  const version = tag.slice(prefix.length);
  if (!semver.test(version)) {
    errors.push(`Invalid SDK release version: ${version}`);
    return null;
  }
  const library = catalog.libraries.find((item) => item.id === id);
  if (!library) {
    errors.push(`SDK release ${id} is absent from the catalogue`);
    return null;
  }
  return { id, library, version };
}

function validateReleaseTag(catalog, tag, expectedSha, errors) {
  const entry = releaseTagEntry(catalog, tag, errors);
  if (!entry) return;
  const { library, version } = entry;
  if (library.lifecycle !== "active") {
    errors.push(
      `${tag} cannot publish ${library.lifecycle} library ${library.id}`,
    );
  }
  if (library.sourceVersion !== version)
    errors.push(
      `${tag} does not match source version ${library.sourceVersion}`,
    );
  if (
    library.latestReleaseVersion !== version ||
    library.releaseStatus !== "released"
  )
    errors.push(
      `${tag} requires latestReleaseVersion ${version} and releaseStatus released`,
    );
  if (expectedSha !== undefined) {
    if (!commitSha.test(expectedSha)) {
      errors.push(`${tag} expected release SHA is invalid`);
    } else if (library.releaseSha !== expectedSha) {
      errors.push(
        `${tag} resolves to ${expectedSha}, catalogue records ${String(library.releaseSha)}`,
      );
    }
  }
}

function validateReleaseCandidateTag(catalog, history, tag, errors) {
  const entry = releaseTagEntry(catalog, tag, errors);
  if (!entry) return;
  const { library, version } = entry;
  if (library.lifecycle !== "active") {
    errors.push(
      `${tag} cannot publish ${library.lifecycle} library ${library.id}`,
    );
  }
  try {
    assertSdkReleaseCandidateNotFailed(history, entry.id, version);
  } catch (error) {
    errors.push(error.message);
  }
  if (library.sourceVersion !== version) {
    errors.push(
      `${tag} does not match source version ${library.sourceVersion}`,
    );
  }
  const alreadyPublished =
    library.latestReleaseVersion === version &&
    library.releaseStatus === "released";
  const pending =
    library.latestReleaseVersion !== version &&
    library.releaseStatus === "pending-release";
  if (!alreadyPublished && !pending) {
    errors.push(
      `${tag} must identify either the declared pending source or its idempotent published release`,
    );
  }
}

async function validateFlutterFlowSurface(catalog, errors, manifestOverride) {
  const manifest =
    manifestOverride ??
    JSON.parse(
      await readFile(
        resolve(root, "config/flutterflow-custom-code.json"),
        "utf8",
      ),
    );
  if (manifest.schemaVersion !== 1 || manifest.owner !== "superboard")
    errors.push("FlutterFlow custom code manifest ownership is invalid");
  const sourceFiles = [
    ...(await readTree(resolve(root, "sdks/flutterflow/lib"))),
  ];
  const source = sourceFiles.map((file) => file.source).join("\n");
  const declaredSourceFiles = Object.values(manifest.sourceFiles ?? {}).flat();
  const expectedSourceFiles = sourceFiles.map((file) =>
    relative(root, file.path).split(sep).join("/"),
  );
  validateExactSet(
    declaredSourceFiles,
    expectedSourceFiles,
    "FlutterFlow source file",
    errors,
  );
  for (const [group, paths] of Object.entries(manifest.sourceFiles ?? {})) {
    for (const value of paths) {
      const path = protectedRepoPath(
        value,
        `FlutterFlow sourceFiles.${group}`,
        errors,
      );
      if (path && !(await exists(path)))
        errors.push(`FlutterFlow source file ${value} does not exist`);
    }
  }
  for (const name of manifest.widgets ?? [])
    if (!new RegExp(`\\bclass\\s+${escapeRegex(name)}\\b`).test(source))
      errors.push(`FlutterFlow widget ${name} is not exported by source`);
  for (const [group, names] of Object.entries(manifest.actions ?? {})) {
    for (const name of names)
      if (!new RegExp(`\\b${escapeRegex(name)}\\s*\\(`).test(source))
        errors.push(`FlutterFlow action ${group}.${name} is not implemented`);
  }
  for (const [group, names] of Object.entries(manifest.streams ?? {})) {
    for (const name of names)
      if (!new RegExp(`\\b${escapeRegex(name)}\\b`).test(source))
        errors.push(`FlutterFlow stream ${group}.${name} is not implemented`);
  }
  const implementedSymbols = [
    ...source.matchAll(
      /^(?:Future<[^\n=]+>|Stream<[^\n=]+>)\s+(?:get\s+)?(superboard\w+)\s*(?:\(|=>)/gm,
    ),
  ].map((match) => match[1]);
  const declaredSymbols = [
    ...Object.values(manifest.actions ?? {}).flat(),
    ...Object.values(manifest.streams ?? {}).flat(),
  ];
  validateExactSet(
    declaredSymbols,
    implementedSymbols,
    "FlutterFlow public symbol",
    errors,
  );
  if (/chatwoot/i.test(JSON.stringify(manifest)))
    errors.push("FlutterFlow canonical manifest must not reference Chatwoot");
  const surfaceUsers = catalog.libraries
    .filter(
      (item) =>
        item.lifecycle === "active" && item.ecosystem === "FlutterFlow",
    )
    .map((item) => item.id);
  if (!surfaceUsers.includes("flutterflow"))
    errors.push(
      "The active FlutterFlow library must declare the canonical surface manifest",
    );
}

async function readTree(directory) {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(directory, { withFileTypes: true });
  const values = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) values.push(...(await readTree(path)));
    else if (entry.isFile() && entry.name.endsWith(".dart"))
      values.push({ path, source: await readFile(path, "utf8") });
  }
  return values;
}

function validateExactSet(declaredValues, expectedValues, label, errors) {
  const declared = new Set(declaredValues);
  const expected = new Set(expectedValues);
  if (declared.size !== declaredValues.length)
    errors.push(`${label} declarations contain duplicates`);
  for (const value of expected)
    if (!declared.has(value)) errors.push(`${label} ${value} is not declared`);
  for (const value of declared)
    if (!expected.has(value)) errors.push(`${label} ${value} is not exported`);
}

async function sourceVersion(path) {
  const source = await readFile(path, "utf8");
  if (path.endsWith("package.json")) return JSON.parse(source).version;
  if (path.endsWith("pubspec.yaml"))
    return source.match(/^version:\s*([^\s]+)/m)?.[1] ?? null;
  if (path.endsWith(".podspec"))
    return source.match(/\.version\s*=\s*['\"]([^'\"]+)/)?.[1] ?? null;
  if (path.endsWith(".kts"))
    return (
      source.match(
        /private val libraryVersion[\s\S]*?else\s*\{\s*"([^"]+)"/,
      )?.[1] ?? null
    );
  return null;
}

function protectedRepoPath(value, label, errors) {
  if (
    typeof value !== "string" ||
    !value ||
    value.startsWith("/") ||
    value.split(/[\\/]/).includes("..")
  ) {
    errors.push(`${label} must stay inside the repository`);
    return null;
  }
  const path = resolve(root, value);
  const rel = relative(root, path);
  if (!rel || rel.startsWith(`..${sep}`) || rel === "..") {
    errors.push(`${label} must identify a repository child`);
    return null;
  }
  return path;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function releaseTagFor(catalog, id) {
  const library = catalog.libraries.find((item) => item.id === id);
  const prefix = tagPrefixes[id];
  if (!library || !prefix) throw new Error(`Unknown SDK library: ${id}`);
  if (
    library.releaseStatus !== "released" ||
    library.sourceVersion !== library.latestReleaseVersion
  )
    throw new Error(`${id} is not marked ready for an immutable release`);
  return `${prefix}${library.sourceVersion}`;
}

export function releaseRefFor(catalog, id) {
  const library = catalog.libraries.find((item) => item.id === id);
  if (!library) throw new Error(`Unknown SDK library: ${id}`);
  if (
    library.releaseStatus !== "released" ||
    library.sourceVersion !== library.latestReleaseVersion
  )
    throw new Error(`${id} is not marked ready for an immutable release`);
  return library.releaseRef;
}

export function releaseCandidateTagFor(catalog, id) {
  const library = catalog.libraries.find((item) => item.id === id);
  const prefix = tagPrefixes[id];
  if (!library || !prefix) throw new Error(`Unknown SDK library: ${id}`);
  if (library.lifecycle !== "active")
    throw new Error(`${id} is ${library.lifecycle} and cannot be published`);
  const pending =
    library.releaseStatus === "pending-release" &&
    library.sourceVersion !== library.latestReleaseVersion;
  const catalogueRecovery =
    library.releaseStatus === "released" &&
    library.sourceVersion === library.latestReleaseVersion;
  if (!pending && !catalogueRecovery)
    throw new Error(`${id} has no valid immutable release candidate`);
  return `${prefix}${library.sourceVersion}`;
}

export function releaseCandidateRefFor(catalog, id) {
  const library = catalog.libraries.find((item) => item.id === id);
  if (!library) throw new Error(`Unknown SDK library: ${id}`);
  releaseCandidateTagFor(catalog, id);
  return id === "ios"
    ? library.sourceVersion
    : `${tagPrefixes[id]}${library.sourceVersion}`;
}

export function promoteSdkRelease(catalog, id, version, releaseSha) {
  const library = catalog.libraries.find((item) => item.id === id);
  if (!library || !tagPrefixes[id])
    throw new Error(`Unknown SDK library: ${id}`);
  if (library.lifecycle !== "active")
    throw new Error(`${id} is ${library.lifecycle} and cannot be published`);
  if (!semver.test(version ?? ""))
    throw new Error(`Invalid SDK release version: ${version}`);
  if (!commitSha.test(releaseSha ?? ""))
    throw new Error(`Invalid SDK release SHA: ${String(releaseSha)}`);
  if (library.sourceVersion !== version) {
    throw new Error(
      `${id} source version ${library.sourceVersion} does not match ${version}`,
    );
  }
  if (
    library.releaseStatus === "released" &&
    library.latestReleaseVersion === version
  ) {
    if (library.releaseSha !== releaseSha) {
      throw new Error(
        `${id}@${version} is already published from ${String(library.releaseSha)}, not ${releaseSha}`,
      );
    }
    return structuredClone(catalog);
  }
  if (library.releaseStatus !== "pending-release") {
    throw new Error(`${id} is not pending release`);
  }
  const promoted = structuredClone(catalog);
  const target = promoted.libraries.find((item) => item.id === id);
  const previousVersion = target.latestReleaseVersion;
  target.latestReleaseVersion = version;
  target.releaseRef = id === "ios" ? version : `${tagPrefixes[id]}${version}`;
  target.releaseStatus = "released";
  target.releaseSha = releaseSha;
  if (target.candidatePackageName && target.candidateInstall) {
    target.packageName = target.candidatePackageName;
    target.install = target.candidateInstall;
    delete target.candidatePackageName;
    delete target.candidateInstall;
  } else {
    target.install = target.install.replaceAll(previousVersion, version);
  }
  return promoted;
}

async function main() {
  const [command = "check", ...values] = process.argv.slice(2);
  const args = Object.fromEntries(
    values.reduce((pairs, value, index) => {
      if (value.startsWith("--"))
        pairs.push([value.slice(2), values[index + 1]]);
      return pairs;
    }, []),
  );
  const catalog = await loadSdkCatalog();
  if (command === "release-tag") {
    console.log(releaseTagFor(catalog, args.library));
    return;
  }
  if (command === "release-ref") {
    console.log(releaseRefFor(catalog, args.library));
    return;
  }
  if (command === "candidate-tag") {
    const tag = releaseCandidateTagFor(catalog, args.library);
    const library = catalog.libraries.find((item) => item.id === args.library);
    assertSdkReleaseCandidateNotFailed(
      await loadSdkReleaseHistory(),
      args.library,
      library.sourceVersion,
    );
    console.log(tag);
    return;
  }
  if (command === "candidate-ref") {
    const reference = releaseCandidateRefFor(catalog, args.library);
    const library = catalog.libraries.find((item) => item.id === args.library);
    assertSdkReleaseCandidateNotFailed(
      await loadSdkReleaseHistory(),
      args.library,
      library.sourceVersion,
    );
    console.log(reference);
    return;
  }
  if (command === "promote") {
    const promoted = promoteSdkRelease(
      catalog,
      args.library,
      args.version,
      args.sha,
    );
    const result = await validateSdkCatalog(promoted, {
      releaseTag: releaseTagFor(promoted, args.library),
      releaseSha: args.sha,
    });
    if (!result.ok) {
      throw new Error(result.errors.join("\n"));
    }
    if (!Object.hasOwn(args, "write")) {
      console.log(JSON.stringify(promoted, null, 2));
      return;
    }
    await writeFile(catalogPath, `${JSON.stringify(promoted, null, 2)}\n`);
    return;
  }
  if (command !== "check")
    throw new Error(
      "Usage: sdk-catalog.mjs check [--release-tag <tag> --release-sha <sha> | --candidate-release-tag <tag>] | candidate-tag --library <id> | candidate-ref --library <id> | release-tag --library <id> | release-ref --library <id> | promote --library <id> --version <version> --sha <sha> [--write]",
    );
  const result = await validateSdkCatalog(catalog, {
    releaseTag: args["release-tag"],
    releaseSha: args["release-sha"],
    releaseCandidateTag: args["candidate-release-tag"],
  });
  if (!result.ok) {
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    JSON.stringify(
      { schema_version: 1, status: "ok", libraries: result.libraries },
      null,
      2,
    ),
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
