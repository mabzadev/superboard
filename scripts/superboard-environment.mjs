export const SUPERBOARD_ENVIRONMENT_ALIASES = Object.freeze({
  SUPERBOARD_TARGET: "OPENGROW_TARGET",
  SUPERBOARD_ENVIRONMENT: "OPENGROW_ENVIRONMENT",
  SUPERBOARD_RELEASE: "OPENGROW_RELEASE",
  SUPERBOARD_REFERENCE_REPOSITORY: "OPENGROW_REFERENCE_REPOSITORY",
  SUPERBOARD_REFERENCE_ROOT: "OPENGROW_REFERENCE_ROOT",
  SUPERBOARD_REFERENCE_DISPATCH_TOKEN: "OPENGROW_REFERENCE_DISPATCH_TOKEN",
  SUPERBOARD_BACKUP_ENCRYPTION_KEY: "OPENGROW_BACKUP_ENCRYPTION_KEY",
});

export function superboardEnvironmentValue(canonicalName, env = process.env) {
  const legacyName = SUPERBOARD_ENVIRONMENT_ALIASES[canonicalName];
  if (!legacyName) {
    throw new Error(`Unknown SuperBoard environment variable ${canonicalName}`);
  }
  const canonicalValue = String(env[canonicalName] ?? "").trim();
  if (canonicalValue) return canonicalValue;
  const legacyValue = String(env[legacyName] ?? "").trim();
  return legacyValue || undefined;
}

export function superboardEnvironmentContract(env = process.env) {
  return Object.fromEntries(
    Object.entries(SUPERBOARD_ENVIRONMENT_ALIASES).map(
      ([canonicalName, legacyName]) => [
        canonicalName,
        {
          value: superboardEnvironmentValue(canonicalName, env),
          source: String(env[canonicalName] ?? "").trim()
            ? canonicalName
            : String(env[legacyName] ?? "").trim()
              ? legacyName
              : null,
          fallback: legacyName,
        },
      ],
    ),
  );
}
