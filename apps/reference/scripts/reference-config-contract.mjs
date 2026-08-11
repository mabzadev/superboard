export const referenceEndpointContract = Object.freeze({
  referenceWeb: "https://reference.mbza.dev",
  dashboard: "https://board.mbza.dev",
  api: "https://api.mbza.dev",
  sdk: "https://sdk.mbza.dev",
  shortLinks: "https://in.mbza.dev",
  files: "https://files.mbza.dev",
  mailPreview: "https://mail.mbza.dev",
  support: "https://api.mbza.dev/api/v1/support-client",
});

export const developmentDartDefineContract = Object.freeze({
  SUPERBOARD_ENVIRONMENT: "development",
  SUPERBOARD_TARGET: "mbza-development",
  SUPERBOARD_API_URL: "https://api.mbza.dev",
  SUPERBOARD_SDK_URL: "https://sdk.mbza.dev",
  SUPERBOARD_SUPPORT_URL: "https://api.mbza.dev/api/v1/support-client",
  SUPERBOARD_SHORT_LINKS_URL: "https://in.mbza.dev",
  SUPERBOARD_FILES_URL: "https://files.mbza.dev",
  SUPERBOARD_MAIL_PREVIEW_URL: "https://mail.mbza.dev",
  SUPERBOARD_PROJECT_KEY: "",
  SUPERBOARD_PROJECT_ID: "0",
  SUPERBOARD_SDK_PLATFORM: "web",
  SUPERBOARD_SDK_IDENTIFIER: "reference.mbza.dev",
  SUPERBOARD_PROJECT_ENVIRONMENT: "test",
  SUPERBOARD_LIVE_MODE: "false",
  SUPERBOARD_PLATFORM_REVISION: "local",
  SUPERBOARD_REFERENCE_REVISION: "local",
});

export const developmentDartDefineKeys = Object.freeze(
  Object.keys(developmentDartDefineContract),
);

const developmentEndpointMapping = Object.freeze({
  SUPERBOARD_API_URL: "api",
  SUPERBOARD_SDK_URL: "sdk",
  SUPERBOARD_SUPPORT_URL: "support",
  SUPERBOARD_SHORT_LINKS_URL: "shortLinks",
  SUPERBOARD_FILES_URL: "files",
  SUPERBOARD_MAIL_PREVIEW_URL: "mailPreview",
});

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function requireExactKeys(value, expected, label) {
  requireRecord(value, label);
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = Object.keys(expected).sort();
  const missing = expectedKeys.filter((key) => !actualKeys.includes(key));
  const unexpected = actualKeys.filter((key) => !expectedKeys.includes(key));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `${label} keys must match the allowlist ` +
        `(missing: ${missing.join(", ") || "none"}; ` +
        `unexpected: ${unexpected.join(", ") || "none"})`,
    );
  }
}

function requireExactValues(value, expected, label) {
  requireExactKeys(value, expected, label);
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (typeof value[key] !== "string") {
      throw new Error(`${label}.${key} must be a string`);
    }
    if (value[key] !== expectedValue) {
      throw new Error(`${label}.${key} must be ${JSON.stringify(expectedValue)}`);
    }
  }
}

export function assertReferenceEndpointContract(endpoints) {
  requireExactValues(
    endpoints,
    referenceEndpointContract,
    "reference.project.json endpoints",
  );
  return endpoints;
}

export function assertDevelopmentDartDefineContract(development) {
  requireExactValues(
    development,
    developmentDartDefineContract,
    "config/development.json",
  );
  return development;
}

export function assertCoordinatedReferenceConfig(project, development) {
  requireRecord(project, "reference.project.json");
  assertReferenceEndpointContract(project.endpoints);
  assertDevelopmentDartDefineContract(development);

  if (project.environment !== development.SUPERBOARD_ENVIRONMENT) {
    throw new Error("Project and development environment values must match");
  }
  if (project.target !== development.SUPERBOARD_TARGET) {
    throw new Error("Project and development target values must match");
  }
  if (project.sdkApplication?.platform !== development.SUPERBOARD_SDK_PLATFORM) {
    throw new Error("Project and development SDK platform values must match");
  }
  if (
    project.sdkApplication?.identifier !== development.SUPERBOARD_SDK_IDENTIFIER
  ) {
    throw new Error("Project and development SDK identifier values must match");
  }
  if (
    project.sdkApplication?.projectEnvironment !==
    development.SUPERBOARD_PROJECT_ENVIRONMENT
  ) {
    throw new Error(
      "Project and development SDK project-environment values must match",
    );
  }
  for (const [define, endpoint] of Object.entries(developmentEndpointMapping)) {
    if (development[define] !== project.endpoints[endpoint]) {
      throw new Error(`${define} must match project endpoint ${endpoint}`);
    }
  }
  return { project, development };
}
