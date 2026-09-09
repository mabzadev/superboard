import type { ConsoleEnvironment } from "@superboard/front-ui/context";

const identifierPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const localhostNames = new Set(["localhost", "127.0.0.1", "[::1]"]);

function origin(value: unknown): string {
	if (typeof value !== "string") throw new Error("DEPLOYMENT_ORIGIN_INVALID");
	const url = new URL(value);
	if (
		(url.protocol !== "https:" &&
			!(url.protocol === "http:" && localhostNames.has(url.hostname))) ||
		url.username ||
		url.password ||
		url.pathname !== "/" ||
		url.search ||
		url.hash
	)
		throw new Error("DEPLOYMENT_ORIGIN_INVALID");
	return url.origin;
}

export function parseConsoleEnvironments(raw: string | undefined): ConsoleEnvironment[] {
	if (!raw) return [];
	const parsed: unknown = JSON.parse(raw);
	if (!Array.isArray(parsed) || parsed.length > 100) throw new Error("DEPLOYMENT_CATALOG_INVALID");
	const seen = new Set<string>();
	return parsed.map((entry: unknown) => {
		if (!entry || typeof entry !== "object" || Array.isArray(entry))
			throw new Error("DEPLOYMENT_ENTRY_INVALID");
		if (
			!("id" in entry) ||
			typeof entry.id !== "string" ||
			!identifierPattern.test(entry.id) ||
			seen.has(entry.id)
		)
			throw new Error("DEPLOYMENT_ID_INVALID");
		seen.add(entry.id);
		if (
			!("application" in entry) ||
			typeof entry.application !== "string" ||
			!entry.application.trim() ||
			!("label" in entry) ||
			typeof entry.label !== "string" ||
			!entry.label.trim() ||
			!("environment" in entry) ||
			typeof entry.environment !== "string" ||
			!identifierPattern.test(entry.environment) ||
			!("apiUrl" in entry) ||
			!("consoleUrl" in entry)
		)
			throw new Error("DEPLOYMENT_ENTRY_INVALID");
		return {
			id: entry.id,
			application: entry.application,
			label: entry.label,
			environment: entry.environment,
			apiUrl: origin(entry.apiUrl),
			consoleUrl: origin(entry.consoleUrl),
		};
	});
}

export function resolveConsoleDeployment(input: {
	catalog?: string;
	instanceId: string;
	environment: string;
	apiUrl?: string;
	consoleUrl?: string;
}) {
	const environments = parseConsoleEnvironments(input.catalog);
	const current = environments.find(
		(entry) => entry.id === `${input.instanceId}.${input.environment}`,
	);
	if (
		current &&
		((input.apiUrl && current.apiUrl !== origin(input.apiUrl)) ||
			(input.consoleUrl && current.consoleUrl !== origin(input.consoleUrl)) ||
			current.environment !== input.environment)
	)
		throw new Error("DEPLOYMENT_CONTEXT_MISMATCH");
	if (environments.length && !current) throw new Error("DEPLOYMENT_CONTEXT_MISSING");
	const deployment =
		current ??
		(input.apiUrl && input.consoleUrl
			? {
					id: `${input.instanceId}.${input.environment}`,
					application: input.instanceId,
					label: input.environment,
					environment: input.environment,
					apiUrl: origin(input.apiUrl),
					consoleUrl: origin(input.consoleUrl),
				}
			: null);
	return {
		deployment,
		environments: environments.length ? environments : deployment ? [deployment] : [],
	};
}
