import { parseRouteDestinations } from "./route-manifest.js";
import type { RouteDestination } from "./route-registry.js";
export interface DeploymentEndpoint {
	surface: string;
	url: string;
	worker: string;
	clients: string[];
}
export interface DeploymentConfiguration {
	schemaVersion: 1;
	target: string;
	environment: string;
	profile: string;
	source: string;
	checksum: string;
	publicRouting: string;
	endpoints: DeploymentEndpoint[];
	workers: Array<{ id: string; name: string | null; modules: string[] }>;
	aliases: Array<{ surface: string; hostname: string }>;
	webOrigins: string[];
	customCapabilities: string[];
	authIssuer: string;
}
export interface DeploymentRoute {
	transport?: "http" | "websocket" | "fallback";
	executionScope?: string;
	destinations?: readonly RouteDestination[];
	id?: string;
	routeId?: string;
	kind?: "canonical" | "alias";
	access?: string;
	availability?: "current" | "stale";
	buildId?: string;
	observedAt?: string;
	pluginId?: string;
	origin?: "cms" | "superboard";
	method: string;
	path: string;
	surface: string;
	url?: string;
	worker: string;
	clients: string[];
}
function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function object(value: unknown): Record<string, unknown> {
	if (!record(value)) throw new Error("DEPLOYMENT_CONFIGURATION_INVALID");
	return value;
}
function text(value: unknown): string {
	if (typeof value !== "string" || value.length > 2048)
		throw new Error("DEPLOYMENT_CONFIGURATION_INVALID");
	return value;
}
function list(value: unknown, maximum = 5000): unknown[] {
	if (!Array.isArray(value) || value.length > maximum)
		throw new Error("DEPLOYMENT_CONFIGURATION_INVALID");
	return value;
}
function strings(value: unknown): string[] {
	return list(value).map(text);
}
function url(value: unknown): string {
	const result = new URL(text(value));
	if (
		result.protocol !== "https:" ||
		result.username ||
		result.password ||
		result.search ||
		result.hash
	)
		throw new Error("DEPLOYMENT_CONFIGURATION_INVALID");
	return result.href.replace(/\/$/u, "");
}
export function parseDeploymentConfiguration(raw: string): DeploymentConfiguration {
	const value = object(JSON.parse(raw));
	if (value.schemaVersion !== 1) throw new Error("DEPLOYMENT_CONFIGURATION_VERSION_INVALID");
	return {
		schemaVersion: 1,
		target: text(value.target),
		environment: text(value.environment),
		profile: text(value.profile),
		source: text(value.source),
		checksum: text(value.checksum),
		publicRouting: text(value.publicRouting),
		authIssuer: url(value.authIssuer),
		endpoints: list(value.endpoints).map((item) => {
			const row = object(item);
			return {
				surface: text(row.surface),
				url: url(row.url),
				worker: text(row.worker),
				clients: strings(row.clients),
			};
		}),
		workers: list(value.workers).map((item) => {
			const row = object(item);
			return {
				id: text(row.id),
				name: row.name === null ? null : text(row.name),
				modules: strings(row.modules),
			};
		}),
		aliases: list(value.aliases).map((item) => {
			const row = object(item);
			return { surface: text(row.surface), hostname: text(row.hostname) };
		}),
		webOrigins: strings(value.webOrigins).map(url),
		customCapabilities: strings(value.customCapabilities),
	};
}
export function parseDeploymentRoutes(value: unknown): DeploymentRoute[] {
	return list(value, 20000).map((item) => {
		const row = object(item);
		return {
			...(row.pluginId === undefined ? {} : { pluginId: text(row.pluginId) }),
			...(row.executionScope === undefined ? {} : { executionScope: text(row.executionScope) }),
			...(row.destinations === undefined
				? {}
				: { destinations: parseRouteDestinations(row.destinations) }),
			method: text(row.method),
			path: text(row.path),
			surface: text(row.surface),
			...(row.surface === "internal" && row.url === undefined ? {} : { url: url(row.url) }),
			...(row.id === undefined ? {} : { id: text(row.id) }),
			...(row.routeId === undefined ? {} : { routeId: text(row.routeId) }),
			...(row.access === undefined ? {} : { access: text(row.access) }),
			...(row.transport === "http" || row.transport === "websocket" || row.transport === "fallback"
				? { transport: row.transport }
				: {}),
			...(row.buildId === undefined ? {} : { buildId: text(row.buildId) }),
			...(row.observedAt === undefined ? {} : { observedAt: text(row.observedAt) }),
			...(row.kind === "alias" || row.kind === "canonical" ? { kind: row.kind } : {}),
			...(row.origin === "cms" || row.origin === "superboard" ? { origin: row.origin } : {}),
			...(row.availability === "current" || row.availability === "stale"
				? { availability: row.availability }
				: {}),
			worker: text(row.worker),
			clients: strings(row.clients),
		};
	});
}
