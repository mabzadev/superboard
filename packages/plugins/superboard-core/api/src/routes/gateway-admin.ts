import { runPluginTask, PluginTaskUnavailable } from "@superboard/contracts/plugin-task";
import { readJsonObjectLimited } from "@superboard/contracts/request-body";
import {
	assertRouteCoverage,
	registerRouter,
	createFetchRouter,
	resolveRegisteredRoute,
	type RouteDescriptor,
} from "@superboard/contracts/route-registry";
import {
	signSiteOperatorRequest,
	type SiteOperatorIdentity,
} from "@superboard/contracts/site-operator";
import { Hono, type Context } from "hono";
import { z } from "zod";

import { getRequestAuthContext } from "../lib/auth.js";
import type { Env } from "../types.js";

const routeInput = z.object({
	method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
	enabled: z.boolean().default(true),
	path_pattern: z.string().startsWith("/"),
	target_path: z.string().startsWith("/"),
	target_route_id: z.string().min(1).optional(),
	rate_limit: z.number().int().min(1).max(10000).default(60),
	expected_revision: z.number().int().positive().nullable(),
});
type Route = z.infer<typeof routeInput> & { route_id: string };
const policyInput = z.object({
	allowed_operator_ids: z.array(z.string().min(1).max(128)).max(100),
});
const parameterPattern = /:([A-Za-z][A-Za-z0-9_]*)/gu;
const routeIdPattern = /^[a-z][a-z0-9_-]{0,79}$/u;
const unsafePathPattern = /[\\\s#]/u;
export const GATEWAY_ADMIN_PREFIX = "/api/v1/gateway";
type SourceRouter = Parameters<typeof resolveRegisteredRoute>[0];
function destinationRoute(
	router: SourceRouter,
	method: string,
	path: string,
): RouteDescriptor | null {
	if (
		unsafePathPattern.test(path) ||
		path.startsWith("//") ||
		new URL(path, "https://api.internal").pathname !== path
	)
		return null;
	if (
		path !== "/health" &&
		path !== "/up" &&
		!path.startsWith("/api/v1/") &&
		!path.startsWith("/api/v2/")
	)
		return null;
	const matched = resolveRegisteredRoute(router, method, "internal", path)?.route;
	return matched && matched.pluginId !== "superboard-gateway" ? matched : null;
}

type GatewayInvocation = {
	invoke(route: Route, parameters: Record<string, string> | null): Promise<Response>;
};
export function compileGatewayRoutes(routes: Route[]) {
	const router = createFetchRouter<GatewayInvocation>({
		service: "api",
		module: "gateway-published",
		pluginId: "superboard-gateway",
		surface: "internal",
		access: "operator",
	});
	for (const route of routes) {
		router
			.defineRoute({ id: `api:gateway:${route.route_id}:proxy` })
			.on(route.method, `${GATEWAY_ADMIN_PREFIX}/proxy${route.path_pattern}`, ({ env, params }) =>
				env.invoke(
					route,
					Object.fromEntries(
						Object.entries(params).map(([name, value]) => [name, decodeURIComponent(value)]),
					),
				),
			);
		router
			.defineRoute({ id: `api:gateway:${route.route_id}:invoke` })
			.post(`${GATEWAY_ADMIN_PREFIX}/invoke/${route.route_id}`, ({ env }) =>
				env.invoke(route, null),
			);
	}
	assertRouteCoverage(router);
	return router;
}

export async function publishedGatewayRoutes(db: D1Database, instance: string) {
	const manifest = await active(db, instance);
	return compileGatewayRoutes(manifest?.routes ?? []);
}

type GatewayContext = Context<{ Bindings: Env }>;
interface GatewayOperationContext {
	actor: SiteOperatorIdentity;
	instance: string;
	key: string;
	signal: AbortSignal;
}
type GatewayOperation = (
	context: GatewayContext,
	operation: GatewayOperationContext,
) => Promise<Response>;

function operatorAction(action: GatewayOperation) {
	return async (c: GatewayContext): Promise<Response> => {
		const auth = await getRequestAuthContext(c.env, c.req.raw.headers, { request: c.req.raw });
		if (!auth?.siteOperator) return fail(401, "OPERATOR_REQUIRED");
		const actor = auth.siteOperator;
		const instance = actor.instance_id;
		const key = c.req.header("Idempotency-Key") ?? "";
		if (c.req.method !== "GET" && (key.length < 8 || key.length > 200))
			return fail(400, "IDEMPOTENCY_KEY_REQUIRED");
		try {
			const task = await runPluginTask(
				c.env,
				"superboard-gateway",
				{ kind: "runtime", task_id: `gateway:${key || crypto.randomUUID()}`, duration_ms: 30000 },
				async (checkpoint, signal) => {
					await checkpoint();
					if (c.req.method === "HEAD") return fail(404, "NOT_FOUND");
					return action(c, { actor, instance, key, signal });
				},
			);
			return task.ran ? task.value : fail(404, "PLUGIN_NOT_ACTIVE");
		} catch (error) {
			if (error instanceof z.ZodError) return fail(422, "GATEWAY_INPUT_INVALID");
			if (error instanceof PluginTaskUnavailable) return fail(error.status, error.code);
			if (error instanceof Error && error.message === "GATEWAY_PARAMETER_REQUIRED")
				return fail(422, error.message);
			console.error("[gateway-operator] request failed", error);
			return fail(503, "GATEWAY_UNAVAILABLE");
		}
	};
}

export function gatewayAdmin(
	source: SourceRouter,
	dispatch: (context: GatewayContext, request: Request) => Promise<Response>,
) {
	const routes = registerRouter(new Hono<{ Bindings: Env }>(), {
		service: "api",
		module: "gateway-admin",
		pluginId: "superboard-gateway",
		surface: "internal",
		access: "operator",
	});
	routes.defineRoute({ id: "api:gateway:routes-list" }).get(
		"/routes",
		operatorAction(async (c, { instance }) => {
			const rows = await c.env.DB.prepare(
				"SELECT route_id,route_json,revision,updated_at FROM gateway_operator_routes WHERE instance_id=? ORDER BY route_id",
			)
				.bind(instance)
				.all<{ route_id: string; route_json: string; revision: number; updated_at: string }>();
			return json(
				rows.results.map(({ route_json, ...row }) => ({
					...routeInput.parse(JSON.parse(route_json)),
					...row,
				})),
			);
		}),
	);
	routes.defineRoute({ id: "api:gateway:route-update" }).put(
		"/routes/:id",
		operatorAction(async (c, { instance, key }) => {
			const id = c.req.param("id") ?? "";
			const body = routeInput.parse(await readJsonObjectLimited(c.req.raw, 65536));
			if (
				!routeIdPattern.test(id) ||
				!destinationRoute(source, body.method, body.target_path) ||
				body.path_pattern.startsWith("//") ||
				unsafePathPattern.test(body.path_pattern)
			)
				return fail(422, "GATEWAY_ROUTE_INVALID");
			body.target_route_id = destinationRoute(source, body.method, body.target_path)?.routeId;
			const encoded = JSON.stringify(body);
			const checksum = await hash(encoded);
			const prior = await c.env.DB.prepare(
				"SELECT operation_id,request_hash,revision FROM gateway_operator_routes WHERE instance_id=? AND route_id=?",
			)
				.bind(instance, id)
				.first<{ operation_id: string; request_hash: string; revision: number }>();
			if (prior?.operation_id === key)
				return prior.request_hash === checksum
					? json({ ...body, route_id: id, revision: prior.revision })
					: fail(409, "IDEMPOTENCY_CONFLICT");
			if ((prior?.revision ?? null) !== body.expected_revision)
				return fail(409, "GATEWAY_REVISION_CONFLICT");
			const changed = await c.env.DB.prepare(
				"INSERT INTO gateway_operator_routes(instance_id,route_id,route_json,revision,operation_id,request_hash,updated_at) VALUES (?,?,?,1,?,?,?) ON CONFLICT(instance_id,route_id) DO UPDATE SET route_json=excluded.route_json,revision=gateway_operator_routes.revision+1,operation_id=excluded.operation_id,request_hash=excluded.request_hash,updated_at=excluded.updated_at WHERE gateway_operator_routes.revision=? RETURNING revision",
			)
				.bind(
					instance,
					id,
					encoded,
					key,
					checksum,
					new Date().toISOString(),
					body.expected_revision,
				)
				.first<{ revision: number }>();
			return changed
				? json({ ...body, route_id: id, revision: changed.revision })
				: fail(409, "GATEWAY_REVISION_CONFLICT");
		}),
	);
	routes.defineRoute({ id: "api:gateway:manifest-publish" }).post(
		"/manifests",
		operatorAction(async (c, { instance, key }) => {
			const replay = await c.env.DB.prepare(
				"SELECT manifest_id,checksum FROM gateway_operator_manifests WHERE instance_id=? AND manifest_id=?",
			)
				.bind(instance, key)
				.first();
			if (replay) return json(replay, 201);
			const rows = await c.env.DB.prepare(
				"SELECT route_id,route_json FROM gateway_operator_routes WHERE instance_id=? ORDER BY route_id",
			)
				.bind(instance)
				.all<{ route_id: string; route_json: string }>();
			const routes = rows.results
				.map((row) => ({
					...routeInput.parse(JSON.parse(row.route_json)),
					route_id: row.route_id,
				}))
				.filter((route) => route.enabled);
			const aliases = routes.map(({ method, path_pattern }) => `${method}:${path_pattern}`);
			if (new Set(aliases).size !== aliases.length) return fail(409, "GATEWAY_ROUTE_CONFLICT");
			try {
				compileGatewayRoutes(routes);
			} catch {
				return fail(409, "GATEWAY_ROUTE_CONFLICT");
			}
			const encoded = JSON.stringify(routes);
			const checksum = await hash(encoded);
			await c.env.DB.batch([
				c.env.DB.prepare(
					"INSERT INTO gateway_operator_manifests(instance_id,manifest_id,routes_json,checksum,created_at) VALUES (?,?,?,?,?)",
				).bind(instance, key, encoded, checksum, new Date().toISOString()),
				c.env.DB.prepare(
					"INSERT INTO gateway_operator_active(instance_id,manifest_id) VALUES (?,?) ON CONFLICT(instance_id) DO UPDATE SET manifest_id=excluded.manifest_id",
				).bind(instance, key),
			]);
			return json({ manifest_id: key, checksum, routes }, 201);
		}),
	);
	routes.defineRoute({ id: "api:gateway:manifest-active" }).get(
		"/active-manifest",
		operatorAction(async (c, { instance }) => {
			return json(await active(c.env.DB, instance));
		}),
	);
	routes.defineRoute({ id: "api:gateway:access-policy-update" }).post(
		"/access-policy",
		operatorAction(async (c, { instance, key }) => {
			const body = policyInput.parse(await readJsonObjectLimited(c.req.raw, 65536));
			const row = await c.env.DB.prepare(
				"INSERT INTO gateway_operator_policies(instance_id,version,policy_json,operation_id,updated_at) VALUES (?,1,?,?,?) ON CONFLICT(instance_id) DO UPDATE SET version=gateway_operator_policies.version+1,policy_json=excluded.policy_json,operation_id=excluded.operation_id,updated_at=excluded.updated_at WHERE gateway_operator_policies.operation_id<>excluded.operation_id RETURNING version",
			)
				.bind(instance, JSON.stringify(body), key, new Date().toISOString())
				.first();
			return json(
				row ??
					(await c.env.DB.prepare(
						"SELECT version FROM gateway_operator_policies WHERE instance_id=?",
					)
						.bind(instance)
						.first()),
			);
		}),
	);
	routes.defineRoute({ id: "api:gateway:rate-limits-list" }).get(
		"/rate-limits",
		operatorAction(async (c, { instance }) => {
			return json(
				(
					await c.env.DB.prepare(
						"SELECT route_id,window_start,requests FROM gateway_operator_limits WHERE instance_id=? AND window_start>=? ORDER BY window_start DESC,route_id LIMIT 100",
					)
						.bind(instance, Math.floor(Date.now() / 60000) - 60)
						.all()
				).results,
			);
		}),
	);
	const invoke = operatorAction(async (c, { instance, key, actor, signal }) => {
		const manifest = await active(c.env.DB, instance);
		const published = compileGatewayRoutes(manifest?.routes ?? []);
		return published.fetch(c.req.raw, {
			invoke: async (route, parameters) => {
				const policy = await c.env.DB.prepare(
					"SELECT policy_json FROM gateway_operator_policies WHERE instance_id=?",
				)
					.bind(instance)
					.first<{ policy_json: string }>();
				const allowed = policy
					? policyInput.parse(JSON.parse(policy.policy_json)).allowed_operator_ids
					: [];
				if (allowed.length && !allowed.includes(actor.operator_id))
					return fail(403, "GATEWAY_ACCESS_DENIED");
				const window = Math.floor(Date.now() / 60000);
				const admitted = await c.env.DB.prepare(
					"INSERT INTO gateway_operator_limits(instance_id,route_id,window_start,requests) VALUES (?,?,?,1) ON CONFLICT(instance_id,route_id,window_start) DO UPDATE SET requests=gateway_operator_limits.requests+1 WHERE gateway_operator_limits.requests<? RETURNING requests",
				)
					.bind(instance, route.route_id, window, route.rate_limit)
					.first();
				if (!admitted) return fail(429, "GATEWAY_RATE_LIMITED");
				const input = z
					.object({
						parameters: z.record(z.string(), z.string()).default({}),
						query: z.record(z.string(), z.string()).default({}),
						body: z.unknown().optional(),
					})
					.parse(
						parameters
							? {
									parameters,
									query: Object.fromEntries(new URL(c.req.url).searchParams),
									...(c.req.method !== "GET"
										? { body: await readJsonObjectLimited(c.req.raw, 2 * 1024 * 1024) }
										: {}),
								}
							: await readJsonObjectLimited(c.req.raw, 2 * 1024 * 1024),
					);
				const targetPath = route.target_path.replace(parameterPattern, (_token, name: string) => {
					const value = input.parameters[name];
					if (!value || value === "." || value === "..")
						throw new Error("GATEWAY_PARAMETER_REQUIRED");
					return encodeURIComponent(value);
				});
				const destination = destinationRoute(source, route.method, targetPath);
				if (
					!destination ||
					(route.target_route_id && destination.routeId !== route.target_route_id)
				)
					return fail(422, "GATEWAY_TARGET_INVALID");
				const owner = destination.pluginId;
				const target = new URL(targetPath, "https://api.internal");
				for (const [name, value] of Object.entries(input.query))
					target.searchParams.set(name, value);
				const request = new Request(target, {
					method: route.method,
					signal,
					...(input.body !== undefined && route.method !== "GET"
						? { body: JSON.stringify(input.body) }
						: {}),
				});
				const signed = await signSiteOperatorRequest(
					request,
					actor,
					c.env.SITE_OPERATOR_BRIDGE_TOKEN,
				);
				signed.set("Idempotency-Key", key);
				signed.set("Content-Type", "application/json");
				const forwarded = new Request(request, { headers: signed });
				if (owner === "supbrd-core") return dispatch(c, forwarded);
				const result = await runPluginTask(
					c.env,
					owner,
					{ kind: "runtime", task_id: `gateway-target:${key}`, duration_ms: 30000 },
					() => dispatch(c, forwarded),
				);
				return result.ran ? result.value : fail(404, "PLUGIN_NOT_ACTIVE");
			},
		});
	});
	routes
		.defineRoute({ id: "api:gateway:invoke", transport: "fallback" })
		.post("/invoke/:id", invoke);
	routes.defineRoute({ id: "api:gateway:proxy", transport: "fallback" }).all("/proxy/*", invoke);
	routes.defineRoute({ transport: "fallback" }).all(
		"*",
		operatorAction(async () => fail(404, "NOT_FOUND")),
	);
	return routes;
}

async function active(db: D1Database, instance: string) {
	const row = await db
		.prepare(
			"SELECT manifest.manifest_id,manifest.routes_json,manifest.checksum FROM gateway_operator_active current JOIN gateway_operator_manifests manifest ON manifest.instance_id=current.instance_id AND manifest.manifest_id=current.manifest_id WHERE current.instance_id=?",
		)
		.bind(instance)
		.first<{ manifest_id: string; routes_json: string; checksum: string }>();
	return row
		? {
				manifest_id: row.manifest_id,
				checksum: row.checksum,
				routes: z
					.array(routeInput.extend({ route_id: z.string().regex(routeIdPattern) }))
					.parse(JSON.parse(row.routes_json)),
			}
		: null;
}
function json(data: unknown, status = 200) {
	return Response.json({ data }, { status, headers: { "Cache-Control": "private, no-store" } });
}
function fail(status: number, code: string) {
	return Response.json({ error: { code, message: code } }, { status });
}
async function hash(value: string) {
	return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}
