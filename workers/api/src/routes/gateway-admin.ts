import { runPluginTask, PluginTaskUnavailable } from "@superboard/contracts/plugin-task";
import { readJsonObjectLimited } from "@superboard/contracts/request-body";
import { signSiteOperatorRequest } from "@superboard/contracts/site-operator";
import type { Context } from "hono";
import { z } from "zod";

import { getRequestAuthContext } from "../lib/auth.js";
import type { Env } from "../types.js";

const routeInput = z.object({
	method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
	path_pattern: z.string().startsWith("/"),
	target_path: z.string().startsWith("/"),
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
const ownerByPrefix: Record<string, string> = {
	app: "supbrd-plug-user",
	products: "supbrd-plug-products",
	"dynamic-links": "supbrd-plugmod-dynamic-links",
	billing: "supbrd-plugmod-billing",
	purchases: "supbrd-plugmod-billing",
	paywalls: "supbrd-plugmod-paywalls",
	onboardings: "supbrd-plugmod-onboardings",
	flows: "supbrd-plugmod-flows",
	analytics: "supbrd-plugmod-analytics",
	marketing: "supbrd-plugmod-marketing",
	email: "supbrd-plugmod-email",
	support: "supbrd-plugmod-support",
	inbox: "supbrd-plugmod-support",
	files: "supbrd-plugmod-files",
	"identity-admin": "supbrd-plug-user",
	"application-users": "supbrd-plug-user",
	platform: "supbrd-plugmod-observability",
	mcp: "supbrd-plugmod-mcp",
	projects: "supbrd-core",
	instances: "supbrd-core",
};

function destinationOwner(path: string): string | null {
	if (path === "/health" || path === "/up") return "supbrd-core";
	if (
		unsafePathPattern.test(path) ||
		path.startsWith("//") ||
		new URL(path, "https://api.internal").pathname !== path
	)
		return null;
	if (path.startsWith("/api/v2/")) return "supbrd-plugmod-billing";
	if (!path.startsWith("/api/v1/")) return null;
	if (path.startsWith("/api/v1/app/") && path.includes("/setup/")) return "supbrd-plug-settings";
	return ownerByPrefix[path.split("/")[3] ?? ""] ?? null;
}

export async function gatewayAdmin(
	c: Context<{ Bindings: Env }>,
	dispatch: (request: Request) => Promise<Response>,
): Promise<Response> {
	const auth = await getRequestAuthContext(c.env, c.req.raw.headers, { request: c.req.raw });
	if (!auth?.siteOperator) return fail(401, "OPERATOR_REQUIRED");
	const actor = auth.siteOperator;
	const instance = actor.instance_id;
	const key = c.req.header("Idempotency-Key") ?? "";
	const path = new URL(c.req.url).pathname.slice("/api/v1/gateway".length);
	if (c.req.method !== "GET" && (key.length < 8 || key.length > 200))
		return fail(400, "IDEMPOTENCY_KEY_REQUIRED");
	try {
		const task = await runPluginTask(
			c.env,
			"supbrd-plugmod-gateway",
			{ kind: "runtime", task_id: `gateway:${key || crypto.randomUUID()}`, duration_ms: 30000 },
			async (checkpoint, signal) => {
				await checkpoint();
				if (path === "/routes" && c.req.method === "GET") {
					const rows = await c.env.DB.prepare(
						"SELECT route_id,route_json,revision,updated_at FROM gateway_operator_routes WHERE instance_id=? ORDER BY route_id",
					)
						.bind(instance)
						.all<{ route_id: string; route_json: string; revision: number; updated_at: string }>();
					return json(
						rows.results.map(({ route_json, ...row }) => ({ ...JSON.parse(route_json), ...row })),
					);
				}
				if (path.startsWith("/routes/") && c.req.method === "PUT") {
					const id = path.slice("/routes/".length);
					const body = routeInput.parse(await readJsonObjectLimited(c.req.raw, 65536));
					if (
						!routeIdPattern.test(id) ||
						!destinationOwner(body.target_path) ||
						body.path_pattern.startsWith("//") ||
						unsafePathPattern.test(body.path_pattern)
					)
						return fail(422, "GATEWAY_ROUTE_INVALID");
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
				}
				if (path === "/manifests" && c.req.method === "POST") {
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
					const routes = rows.results.map((row) => ({
						...routeInput.parse(JSON.parse(row.route_json)),
						route_id: row.route_id,
					}));
					const aliases = routes.map(({ method, path_pattern }) => `${method}:${path_pattern}`);
					if (new Set(aliases).size !== aliases.length) return fail(409, "GATEWAY_ROUTE_CONFLICT");
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
				}
				if (path === "/active-manifest" && c.req.method === "GET")
					return json(await active(c.env.DB, instance));
				if (path === "/access-policy" && c.req.method === "POST") {
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
				}
				if (path === "/rate-limits" && c.req.method === "GET")
					return json(
						(
							await c.env.DB.prepare(
								"SELECT route_id,window_start,requests FROM gateway_operator_limits WHERE instance_id=? AND window_start>=? ORDER BY window_start DESC,route_id LIMIT 100",
							)
								.bind(instance, Math.floor(Date.now() / 60000) - 60)
								.all()
						).results,
					);
				if (
					(path.startsWith("/invoke/") && c.req.method === "POST") ||
					path.startsWith("/proxy/")
				) {
					const manifest = await active(c.env.DB, instance);
					const alias = path.startsWith("/proxy/") ? path.slice("/proxy".length) : null;
					const route = manifest?.routes.find((route) =>
						alias
							? route.method === c.req.method && matchAlias(route.path_pattern, alias) !== null
							: route.route_id === path.slice("/invoke/".length),
					);
					if (!route) return fail(404, "GATEWAY_ROUTE_NOT_PUBLISHED");
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
							alias
								? {
										parameters: matchAlias(route.path_pattern, alias),
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
					const owner = destinationOwner(targetPath);
					if (!owner) return fail(422, "GATEWAY_TARGET_INVALID");
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
						c.env.SITE_OPERATOR_BRIDGE_TOKEN!,
					);
					signed.set("Idempotency-Key", key);
					signed.set("Content-Type", "application/json");
					const forwarded = new Request(request, { headers: signed });
					if (owner === "supbrd-core") return dispatch(forwarded);
					const result = await runPluginTask(
						c.env,
						owner,
						{ kind: "runtime", task_id: `gateway-target:${key}`, duration_ms: 30000 },
						() => dispatch(forwarded),
					);
					return result.ran ? result.value : fail(404, "PLUGIN_NOT_ACTIVE");
				}
				return fail(404, "NOT_FOUND");
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
				routes: JSON.parse(row.routes_json) as Route[],
			}
		: null;
}
function matchAlias(pattern: string, path: string): Record<string, string> | null {
	const expected = pattern.split("/");
	const actual = path.split("/");
	if (expected.length !== actual.length) return null;
	const parameters: Record<string, string> = {};
	for (let index = 0; index < expected.length; index += 1) {
		const segment = expected[index]!;
		const value = actual[index]!;
		if (segment.startsWith(":")) {
			if (!value) return null;
			try {
				parameters[segment.slice(1)] = decodeURIComponent(value);
			} catch {
				return null;
			}
		} else if (segment !== value) return null;
	}
	return parameters;
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
