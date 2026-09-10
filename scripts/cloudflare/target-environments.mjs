const configurable = [
	"domains",
	"domainAliases",
	"applicationIdentity",
	"oauth",
	"authGateway",
	"mail",
	"filePolicy",
	"operator",
];

export function targetForEnvironment(target, environment) {
	const configuration = target.environments?.[environment];
	if (!configuration) throw new Error(`Unknown environment: ${environment}`);
	return {
		...target,
		...Object.fromEntries(
			configurable.flatMap((key) => (configuration[key] ? [[key, configuration[key]]] : [])),
		),
	};
}

export function validateEnvironmentIsolation(target) {
	const hosts = new Map();
	const stores = new Map();
	const workers = new Map();
	for (const [environment, resources] of Object.entries(target.environments ?? {})) {
		if (environment === "local") continue;
		const configured = targetForEnvironment(target, environment);
		for (const names of Object.values(target.workers ?? {})) {
			const name = names[environment];
			if (!name) continue;
			const previous = workers.get(name);
			if (previous && previous !== environment)
				throw new Error(`ENVIRONMENT_WORKER_SHARED:${previous}:${environment}`);
			workers.set(name, environment);
		}
		for (const key of ["api", "auth", "site"]) {
			const hostname = configured.domains?.[key]?.toLowerCase();
			if (!hostname) continue;
			const previous = hosts.get(`${key}:${hostname}`);
			if (previous) throw new Error(`ENVIRONMENT_DOMAIN_SHARED:${key}:${previous}:${environment}`);
			hosts.set(`${key}:${hostname}`, environment);
		}
		const databases = [
			resources.d1,
			resources.siteD1,
			resources.identityD1,
			resources.filesD1,
			resources.siteSessionKv,
			resources.kv,
			...Object.values(resources.moduleD1 ?? {}),
		];
		for (const resource of databases) {
			if (!resource?.id) continue;
			const previous = stores.get(resource.id);
			if (previous && previous !== environment)
				throw new Error(`ENVIRONMENT_STORE_SHARED:${previous}:${environment}`);
			stores.set(resource.id, environment);
		}
	}
}

export function consoleEnvironmentCatalog(target, currentEnvironment) {
	return Object.entries(target.environments).flatMap(([environment, configuration]) => {
		if (environment === "local" && currentEnvironment !== "local") return [];
		const selected = targetForEnvironment(target, environment);
		return [
			{
				id: `${target.target}.${environment}`,
				application: target.displayName ?? target.target,
				label: configuration.displayName ?? environment,
				environment,
				apiUrl: `https://${selected.domains.api}`,
				consoleUrl: `https://${selected.domains.site}`,
			},
		];
	});
}
