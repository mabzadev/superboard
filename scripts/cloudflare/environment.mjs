export const SUPERBOARD_ENVIRONMENT_VARIABLES = Object.freeze([
	"SUPERBOARD_TARGET",
	"SUPERBOARD_ENVIRONMENT",
	"SUPERBOARD_RELEASE",
	"SUPERBOARD_REFERENCE_REPOSITORY",
	"SUPERBOARD_REFERENCE_ROOT",
	"SUPERBOARD_REFERENCE_DISPATCH_TOKEN",
	"SUPERBOARD_BACKUP_ENCRYPTION_KEY",
]);

export function superboardEnvironmentValue(name, env = process.env) {
	if (!SUPERBOARD_ENVIRONMENT_VARIABLES.includes(name)) {
		throw new Error(`Unknown SuperBoard environment variable ${name}`);
	}
	return String(env[name] ?? "").trim() || undefined;
}

export function superboardEnvironmentContract(env = process.env) {
	return Object.fromEntries(
		SUPERBOARD_ENVIRONMENT_VARIABLES.map((name) => {
			const value = superboardEnvironmentValue(name, env);
			return [name, { value, source: value ? name : null }];
		}),
	);
}
