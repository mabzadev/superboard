import { createHash } from "node:crypto";

export const WORKER_DEPLOYMENT_GROUPS = Object.freeze([
	{ id: "console", label: "Console", services: ["site"] },
	{
		id: "api",
		label: "API",
		services: ["api", "app", "products", "paywalls", "onboardings", "dynamic-links", "mcp"],
	},
	{ id: "auth", label: "Authentification", services: ["identity"] },
	{ id: "files", label: "Fichiers", services: ["files"] },
	{ id: "payments", label: "Paiements", services: ["billing"] },
	{ id: "communications", label: "Communication", services: ["email", "marketing", "push"] },
	{ id: "automations", label: "Automatisations", services: ["flows"] },
	{ id: "support", label: "Service client", services: ["support"] },
	{ id: "analytics", label: "Statistiques", services: ["analytics"] },
	{ id: "monitoring", label: "Supervision", services: ["observability"] },
]);

const bindingLists = [
	"d1_databases",
	"kv_namespaces",
	"r2_buckets",
	"services",
	"analytics_engine_datasets",
	"vectorize",
	"hyperdrive",
	"secrets_store_secrets",
];
const namePattern = /^[a-z][a-z0-9-]*$/u;
const identifierSeparators = /-([a-z])/gu;
const scopePrefix = (service) => `${service.replaceAll("-", "_").toUpperCase()}__`;
export const deploymentEntrypoint = (service) =>
	`Superboard${service[0].toUpperCase()}${service.slice(1).replace(identifierSeparators, (_, letter) => letter.toUpperCase())}`;

export function deploymentGroups(services) {
	const pending = new Set(services);
	const result = [];
	for (const definition of WORKER_DEPLOYMENT_GROUPS) {
		const members = definition.services.filter((service) => pending.has(service));
		if (!members.length) continue;
		members.forEach((service) => pending.delete(service));
		result.push({ ...definition, services: members });
	}
	for (const service of pending) result.push({ id: service, label: service, services: [service] });
	return result;
}

export function consolidateWorkerConfigurations(entries) {
	const legacyConfigurations = new Map(entries.map(({ service, config }) => [service, config]));
	const originalQueueOwners = new Map(
		entries.flatMap(({ config }) =>
			(config.queues?.consumers ?? []).map(({ queue }) => [queue, config.name]),
		),
	);
	const queueCount = entries.reduce(
		(count, { config }) => count + (config.queues?.consumers?.length ?? 0),
		0,
	);
	if (originalQueueOwners.size !== queueCount) throw new Error("MULTIPLE_QUEUE_CONSUMERS");
	entries = entries.map((entry) => ({ ...entry, config: structuredClone(entry.config) }));
	const api = entries.find(({ service }) => service === "api");
	if (
		api &&
		entries.some(({ service }) => service === "email") &&
		api.config.vars?.PUSH_QUEUE_NAME
	) {
		const queueNames = [api.config.vars.PUSH_QUEUE_NAME, api.config.vars.PUSH_DLQ_NAME];
		const consumers = (api.config.queues?.consumers ?? []).filter(({ queue }) =>
			queueNames.includes(queue),
		);
		if (api.config.queues?.consumers)
			api.config.queues.consumers = api.config.queues.consumers.filter(
				({ queue }) => !queueNames.includes(queue),
			);
		const keys = [
			"STORE_CREDENTIALS_ENCRYPTION_KEY",
			"STORE_CREDENTIALS_ENCRYPTION_KEYS",
			"STORE_CREDENTIALS_ACTIVE_KEY_VERSION",
			"CREDENTIAL_KEY_SCOPE",
		];
		entries.push({
			service: "push",
			synthetic: true,
			config: {
				name: `${api.config.name}-push-transport`,
				sourceWorkerName: api.config.name,
				main: "../../workers/email/src/push-consumer.ts",
				compatibility_date: api.config.compatibility_date,
				compatibility_flags: api.config.compatibility_flags,
				vars: Object.fromEntries(
					Object.entries(api.config.vars).filter(
						([key]) => keys.includes(key) || key === "PUSH_DLQ_NAME",
					),
				),
				d1_databases: api.config.d1_databases.filter(({ binding }) => binding === "DB"),
				secrets: {
					required: (api.config.secrets?.required ?? []).filter((name) => keys.includes(name)),
				},
				queues: { consumers },
			},
		});
	}

	const byService = new Map(
		entries.map(({ service, config }) => [service, structuredClone(config)]),
	);
	if (byService.size !== entries.length) throw new Error("DUPLICATE_LOGICAL_SERVICE");
	const groups = deploymentGroups([...byService.keys()]);
	const destinations = new Map();
	for (const group of groups) {
		const name = byService.get(group.services[0]).name;
		for (const service of group.services) {
			if (!namePattern.test(service)) throw new Error(`INVALID_SERVICE:${service}`);
			const originalName = byService.get(service).name;
			if (destinations.has(originalName)) throw new Error(`DUPLICATE_WORKER_NAME:${originalName}`);
			destinations.set(originalName, {
				name,
				service,
				group: group.id,
				entrypoint: group.services.length > 1 ? deploymentEntrypoint(service) : undefined,
			});
		}
	}
	const result = groups.map((group) => {
		const originals = group.services.map((service) => ({
			service,
			config: byService.get(service),
		}));
		const merged =
			originals.length > 1
				? mergeGroup(group, originals, legacyConfigurations.get(group.services[0]))
				: {
						config: originals[0].config,
						source: null,
						secrets: (originals[0].config.secrets?.required ?? []).map((name) => ({
							name,
							sourceName: name,
							sourceWorker: originals[0].config.name,
							service: originals[0].service,
						})),
					};
		const compatibilityConfig = structuredClone(merged.config);
		const legacy = legacyConfigurations.get(group.services[0]);
		compatibilityConfig.routes = structuredClone(legacy.routes ?? []);
		compatibilityConfig.triggers = structuredClone(legacy.triggers ?? { crons: [] });
		compatibilityConfig.queues = {
			...compatibilityConfig.queues,
			consumers: structuredClone(legacy.queues?.consumers ?? []),
		};
		merged.config.vars = { ...merged.config.vars, SUPERBOARD_DEPLOYMENT_LAYOUT: "consolidated" };
		compatibilityConfig.vars = {
			...compatibilityConfig.vars,
			SUPERBOARD_DEPLOYMENT_LAYOUT: "preparing",
		};
		for (const serviceBinding of merged.config.services ?? []) {
			const destination = destinations.get(serviceBinding.service);
			if (!destination) continue;
			if (serviceBinding.entrypoint && destination.entrypoint)
				throw new Error(`NAMED_ENTRYPOINT_REQUIRES_MIGRATION:${serviceBinding.entrypoint}`);
			serviceBinding.service = destination.name;
			if (destination.entrypoint) serviceBinding.entrypoint = destination.entrypoint;
		}
		for (const [name, value] of Object.entries(merged.config.vars ?? {})) {
			if (!name.endsWith("PLATFORM_WORKERS_JSON")) continue;
			const catalog = JSON.parse(value);
			for (const worker of catalog.workers ?? []) {
				const destination = destinations.get(worker.workerName);
				if (destination) {
					worker.workerName = destination.name;
					worker.deploymentGroup = destination.group;
				}
			}
			for (const dependency of catalog.customDependencies ?? []) {
				const destination = destinations.get(dependency.workerName);
				if (destination) dependency.workerName = destination.name;
			}
			merged.config.vars[name] = JSON.stringify(catalog);
		}
		return {
			...group,
			...merged,
			compatibilityConfig,
			originalWorkers: originals.map(({ config }) => config.name),
		};
	});
	return {
		groups: result,
		cronTransfers: entries.flatMap(({ service, config, synthetic }) => {
			const to = destinations.get(config.name).name;
			const crons = config.triggers?.crons ?? [];
			return !synthetic && config.name !== to && crons.length
				? [{ service, from: config.name, to, crons: [...crons] }]
				: [];
		}),
		queueTransfers: result.flatMap(({ config }) =>
			(config.queues?.consumers ?? []).flatMap(({ queue }) => {
				const from = originalQueueOwners.get(queue);
				return from && from !== config.name ? [{ queue, from, to: config.name }] : [];
			}),
		),
		retiredWorkers: entries
			.filter(
				({ config, synthetic }) => !synthetic && destinations.get(config.name).name !== config.name,
			)
			.map(({ config }) => config.name),
		checksum: `sha256:${createHash("sha256").update(JSON.stringify(result)).digest("hex")}`,
	};
}

function mergeGroup(group, entries, legacyPrimary) {
	const first = entries[0].config;
	const config = {
		...first,
		main: `./${group.id}-runtime.mjs`,
		vars: {},
		services: [],
		routes: [],
		queues: { producers: [], consumers: [] },
		triggers: { crons: [] },
		secrets: { required: [] },
	};
	delete config.no_bundle;
	for (const key of bindingLists) config[key] = [];
	const secrets = [];
	const queues = {};
	const publicHosts = {};
	const schedules = {};
	for (const { service, config: original } of entries) {
		if (
			original.assets ||
			original.durable_objects ||
			original.workflows?.length ||
			original.containers?.length ||
			original.migrations?.length
		)
			throw new Error(`STATEFUL_WORKER_REQUIRES_DEDICATED_DEPLOYMENT:${service}`);
		if (
			original.compatibility_date !== first.compatibility_date ||
			JSON.stringify(original.compatibility_flags) !== JSON.stringify(first.compatibility_flags)
		)
			throw new Error(`INCOMPATIBLE_WORKER_RUNTIME:${service}`);
		const prefix = scopePrefix(service);
		for (const [key, value] of Object.entries(original.vars ?? {}))
			config.vars[`${prefix}${key}`] = value;
		for (const key of bindingLists)
			config[key].push(
				...(original[key] ?? []).map((binding) => ({
					...binding,
					binding: `${prefix}${binding.binding}`,
				})),
			);
		for (const name of original.secrets?.required ?? []) {
			config.secrets.required.push(`${prefix}${name}`);
			secrets.push({
				name: `${prefix}${name}`,
				sourceWorker: original.sourceWorkerName ?? original.name,
				sourceName: name,
				service,
			});
		}
		for (const key of ["ai", "images", "version_metadata", "browser"]) {
			if (original[key]) throw new Error(`UNSUPPORTED_SHARED_BINDING:${service}:${key}`);
		}
		config.queues.producers.push(
			...(original.queues?.producers ?? []).map((producer) => ({
				...producer,
				binding: `${prefix}${producer.binding}`,
			})),
		);
		for (const consumer of original.queues?.consumers ?? []) {
			if (queues[consumer.queue]) throw new Error(`MULTIPLE_QUEUE_CONSUMERS:${consumer.queue}`);
			queues[consumer.queue] = service;
			config.queues.consumers.push(consumer);
		}
		for (const route of original.routes ?? []) {
			if (!route.custom_domain) throw new Error(`PUBLIC_ROUTE_REQUIRES_EXPLICIT_HOST:${service}`);
			if (publicHosts[route.pattern]) throw new Error(`PUBLIC_HOST_COLLISION:${route.pattern}`);
			publicHosts[route.pattern] = service;
			config.routes.push(route);
		}
		for (const cron of original.triggers?.crons ?? []) {
			(schedules[cron] ??= []).push(service);
			if (!config.triggers.crons.includes(cron)) config.triggers.crons.push(cron);
		}
	}
	for (const key of bindingLists) if (!config[key].length) delete config[key];
	for (const { queue } of legacyPrimary.queues?.consumers ?? [])
		queues[queue] ??= entries[0].service;
	if (!config.routes.length) delete config.routes;
	if (!config.triggers.crons.length) delete config.triggers;
	if (!config.queues.producers.length) delete config.queues.producers;
	if (!config.queues.consumers.length) delete config.queues.consumers;
	if (!Object.keys(config.queues).length) delete config.queues;
	if (!config.secrets.required.length) delete config.secrets;
	const imports = entries
		.map(
			({ service, config: original }) =>
				`import ${deploymentEntrypoint(service)}Handler from ${JSON.stringify(original.main)};`,
		)
		.join("\n");
	const source = `import { WorkerEntrypoint } from "cloudflare:workers";
${imports}
const handlers = { ${entries.map(({ service }) => `${JSON.stringify(service)}: ${deploymentEntrypoint(service)}Handler`).join(", ")} };
const scopes = ${JSON.stringify(Object.fromEntries(entries.map(({ service }) => [service, scopePrefix(service)])))};
const hosts = ${JSON.stringify(publicHosts)};
const queues = ${JSON.stringify(queues)};
const schedules = ${JSON.stringify(schedules)};
function scope(service, env) {
	const prefix = scopes[service];
	return Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key.slice(prefix.length), value]));
}
${entries
	.map(
		({ service }) => `export class ${deploymentEntrypoint(service)} extends WorkerEntrypoint {
	fetch(request) { return handlers[${JSON.stringify(service)}].fetch(request, scope(${JSON.stringify(service)}, this.env), this.ctx); }
}`,
	)
	.join("\n")}
export default {
	fetch(request, env, ctx) {
		const service = hosts[new URL(request.url).hostname] ?? ${JSON.stringify(entries[0].service)};
		return handlers[service].fetch(request, scope(service, env), ctx);
	},
	async queue(batch, env, ctx) {
		const service = queues[batch.queue];
		if (!service || !handlers[service].queue) throw new Error("QUEUE_OWNER_UNAVAILABLE");
		await handlers[service].queue(batch, scope(service, env), ctx);
	},
	async scheduled(controller, env, ctx) {
		const services = (schedules[controller.cron] ?? []).filter(service => env.SUPERBOARD_DEPLOYMENT_LAYOUT !== "preparing" || service === ${JSON.stringify(entries[0].service)});
		await Promise.all(services.map(service => handlers[service].scheduled(controller, scope(service, env), ctx)));
	}
};
`;
	return { config, source, secrets };
}
