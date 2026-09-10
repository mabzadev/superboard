import { runPluginTask, PluginTaskUnavailable } from "@superboard/contracts/plugin-task";
import { createProjectContextHeaders } from "@superboard/contracts/project-context";
import { readJsonObjectLimited } from "@superboard/contracts/request-body";
import type { SiteOperatorIdentity } from "@superboard/contracts/site-operator";

import type { Env } from "../types.js";

interface Project {
	id: string | number;
	instanceId: string | number;
	externalId: string;
	is_test?: number;
}
type RecordValue = Record<string, unknown>;
class NativeIntegrationError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
	) {
		super(code);
	}
}

export async function dispatchMcpDynamicLinks(
	env: Env,
	actor: SiteOperatorIdentity,
	project: Project,
	request: Request,
): Promise<Response> {
	try {
		const execution = await runPluginTask(
			env,
			"supbrd-plugmod-dynamic-links",
			{ kind: "runtime", task_id: `mcp-links:${crypto.randomUUID()}`, duration_ms: 30000 },
			async () => {
				const source = new URL(request.url);
				const path = source.pathname.slice("/api/v1/mcp".length);
				const body = ["GET", "DELETE"].includes(request.method)
					? {}
					: await readJsonObjectLimited(request, 65536);
				if (body.custom_redirects !== undefined && !record(body.custom_redirects))
					throw new NativeIntegrationError(422, "Custom redirects must be an object");
				const native = async (
					path: string,
					method = "GET",
					data?: unknown,
					envelope = false,
				): Promise<unknown> => {
					if (!env.DYNAMIC_LINKS_MODULE || !env.MODULE_INTERNAL_TOKEN)
						throw new NativeIntegrationError(503, "dynamic_links_unavailable");
					const target = new URL(`/internal/v1${path}`, "https://dynamic-links.internal");
					const headers = await createProjectContextHeaders(
						{
							module: "dynamic-links",
							method,
							pathname: target.pathname,
							projectId: Number(project.id),
							instanceId: Number(project.instanceId),
							projectRef: project.externalId,
							environment: project.is_test ? "test" : "production",
							actorId: 0,
							operatorId: actor.operator_id,
							role: actor.role === 50 ? "owner" : "admin",
							requestId: crypto.randomUUID(),
							issuedAt: Math.floor(Date.now() / 1000),
						},
						env.MODULE_INTERNAL_TOKEN,
					);
					headers.set("Content-Type", "application/json");
					headers.set("Idempotency-Key", crypto.randomUUID());
					const response = await env.DYNAMIC_LINKS_MODULE.fetch(
						new Request(target, {
							method,
							headers,
							...(data === undefined ? {} : { body: JSON.stringify(data) }),
							signal: AbortSignal.timeout(15000),
						}),
					);
					const payload = await readJsonObjectLimited(response, 1048576);
					if (!response.ok) {
						const error = record(payload.error);
						throw new NativeIntegrationError(
							response.status,
							typeof error?.message === "string" ? error.message : "dynamic_links_request_failed",
						);
					}
					return envelope ? payload : payload.data;
				};
				const findLink = async (id: string, byPath = false): Promise<RecordValue> => {
					if (!byPath) {
						const value = record(await native(`/links/${encodeURIComponent(id)}`));
						if (value) return value;
					} else {
						const rows = await native(`/links?slug=${encodeURIComponent(id)}&limit=1`);
						if (Array.isArray(rows)) {
							const row = rows.map(record).find((item) => item?.slug === id);
							if (row) return row;
						}
					}
					throw new NativeIntegrationError(404, "Link not found");
				};
				if (path === "/links/search") {
					const perPage = limit(body.limit, 20, 100);
					const page = limit(body.page, 1, Math.floor(1000000 / perPage) + 1);
					const query = new URLSearchParams({
						limit: String(perPage),
						offset: String((page - 1) * perPage),
						search: String(body.search ?? body.query ?? ""),
						sort_by: String(body.sort_by ?? "created_at"),
						sort_order: String(body.sort_order ?? "desc"),
					});
					const result = record(await native(`/links?${query}`, "GET", undefined, true));
					const total = Number(record(result?.meta)?.total_entries ?? 0);
					return json({
						links: records(result?.data).map(link),
						meta: {
							page,
							per_page: perPage,
							total_entries: total,
							total_pages: Math.ceil(total / perPage),
						},
					});
				}
				if (path === "/links" && request.method === "POST") {
					const defaults = record(await native("/redirect-config")) ?? {};
					const redirects = record(body.custom_redirects) ?? {};
					const destination =
						body.destination_url ?? redirects.default_fallback ?? defaults.default_fallback;
					if (typeof destination !== "string" || !destination)
						return json(
							{
								error:
									"Configure a default fallback or supply custom_redirects.default_fallback before creating a link",
							},
							422,
						);
					const created = record(
						await native("/links", "POST", {
							...body,
							slug: body.path || crypto.randomUUID().slice(0, 12),
							destination_url: destination,
							destinations: redirectDestinations(redirects),
							use_project_defaults:
								body.destination_url === undefined && redirects.default_fallback === undefined,
							utm: {
								campaign: body.tracking_campaign,
								medium: body.tracking_medium,
								source: body.tracking_source,
							},
						}),
					);
					if (!created || typeof created.id !== "string")
						throw new NativeIntegrationError(502, "Invalid link creation response");
					return json({ link: link(await findLink(created.id)) }, 201);
				}
				if (path.startsWith("/links/by-path/"))
					return json({
						link: link(
							await findLink(decodeURIComponent(path.slice("/links/by-path/".length)), true),
						),
					});
				if (path.startsWith("/links/") && ["PATCH", "DELETE"].includes(request.method)) {
					const id = decodeURIComponent(path.slice("/links/".length));
					const existing = await findLink(id);
					const custom = record(body.custom_redirects);
					const changed = await native(`/links/${encodeURIComponent(id)}`, "PUT", {
						...existing,
						...body,
						slug: body.path ?? existing.slug,
						...(custom
							? {
									destinations: {
										...record(existing.destinations),
										...redirectDestinations(custom),
									},
									...(typeof custom.default_fallback === "string"
										? { destination_url: custom.default_fallback, use_project_defaults: false }
										: {}),
								}
							: {}),
						...(request.method === "DELETE" ? { active: false } : {}),
					});
					return json({ link: link(record(changed) ?? (await findLink(id))) });
				}
				if (path === "/campaigns" && request.method === "POST") {
					const created = record(
						await native("/campaigns", "POST", {
							name: body.name,
							slug: `mcp-${crypto.randomUUID().slice(0, 12)}`,
							status: "active",
							metadata: {},
						}),
					);
					const rows = records(await native("/campaigns"));
					const campaign = rows.find((row) => row.id === created?.id);
					return json({ campaign }, 201);
				}
				if (path === "/campaigns/search") {
					const query = new URLSearchParams();
					for (const [key, source] of [
						["from", "start_date"],
						["to", "end_date"],
						["platform", "platform"],
					])
						if (typeof body[source] === "string") query.set(key, body[source]);
					const term = String(body.term ?? "").toLowerCase();
					const sort = ["name", "created_at", "views", "opens", "installs", "revenue"].includes(
						String(body.sort_by),
					)
						? String(body.sort_by)
						: "created_at";
					const key = ["name", "created_at"].includes(sort) ? sort : `total_${sort}`;
					const direction = body.ascendent === true ? 1 : -1;
					const campaigns = records(await native(`/campaign-analytics?${query}`))
						.filter(
							(row) =>
								(row.status === "archived") === (body.archived === true) &&
								String(row.name).toLowerCase().includes(term),
						)
						.sort((left, right) => {
							const compared = ["name", "created_at"].includes(sort)
								? String(left[key]).localeCompare(String(right[key]))
								: Number(left[key]) - Number(right[key]);
							return direction * compared || String(left.id).localeCompare(String(right.id));
						});
					const perPage = limit(body.per_page, 20, 100);
					const page = limit(body.page, 1, 1000001);
					return json({
						campaigns: campaigns
							.slice((page - 1) * perPage, page * perPage)
							.map((row) => ({ ...row, archived: row.status === "archived" })),
						meta: {
							page,
							per_page: perPage,
							total_pages: Math.ceil(campaigns.length / perPage),
							total_entries: campaigns.length,
						},
					});
				}
				if (path.startsWith("/campaigns/") && request.method === "DELETE") {
					const id = decodeURIComponent(path.slice("/campaigns/".length));
					const campaign = records(await native("/campaigns")).find((row) => row.id === id);
					if (!campaign) throw new NativeIntegrationError(404, "Campaign not found");
					await native(`/campaigns/${encodeURIComponent(id)}`, "PUT", {
						...campaign,
						status: "archived",
					});
					return json({ campaign: { ...campaign, status: "archived", archived: true } });
				}
				if (path === "/redirects" && request.method === "PUT") {
					if (body.platforms !== undefined && !record(body.platforms))
						throw new NativeIntegrationError(422, "Redirect platforms must be an object");
					const platforms = record(body.platforms) ?? {};
					for (const platform of ["ios", "android", "desktop", "web"])
						if (body[`${platform}_redirect`] !== undefined) {
							if (typeof body[`${platform}_redirect`] !== "string")
								throw new NativeIntegrationError(422, "Redirect URLs must be strings");
							platforms[platform] = {
								...record(platforms[platform]),
								fallback_url: body[`${platform}_redirect`],
							};
						}
					return json({
						redirect_config: await native("/redirect-config", "PUT", {
							...body,
							default_fallback: body.fallback_url ?? body.default_fallback,
							platforms,
						}),
					});
				}
				if (path.startsWith("/analytics/")) {
					const query = new URLSearchParams();
					for (const [key, source] of [
						["from", "start_date"],
						["to", "end_date"],
						["platform", "platform"],
					])
						if (typeof body[source] === "string") query.set(key, body[source]);
					if (path === "/analytics/top_links") {
						const rows = records(
							await native(
								`/links?${query}&limit=${limit(body.limit, 10, 25)}&sort_by=views&sort_order=desc`,
							),
						);
						return json({
							links: rows.map((row) => ({ ...link(row), views: Number(row.total_views ?? 0) })),
						});
					}
					if (path === "/analytics/link") {
						const selected = await findLink(String(body.path ?? ""), true);
						query.set("link_id", String(selected.id));
					}
					const statistics = record(await native(`/statistics?${query}`));
					const totals = record(statistics?.totals) ?? {};
					return json({
						...(path === "/analytics/link" ? { link_path: body.path } : {}),
						metrics: {
							views: Number(totals.views ?? 0),
							opens: Number(totals.opens ?? 0),
							installs: Number(totals.installs ?? 0),
							reinstalls: Number(totals.reinstalls ?? 0),
							reactivations: Number(totals.reactivations ?? 0),
							app_opens: Number(totals.app_opens ?? 0),
							user_referred: Number(totals.user_referred ?? 0),
							revenue: Number(totals.revenue ?? 0),
							time_spent: Number(totals.time_spent ?? 0),
						},
					});
				}
				return json({ error: "Unsupported Dynamic Links integration operation" }, 404);
			},
		);
		return execution.ran
			? execution.value
			: json({ error: "Dynamic Links plugin is disabled" }, 404);
	} catch (error) {
		if (error instanceof NativeIntegrationError) return json({ error: error.code }, error.status);
		if (error instanceof PluginTaskUnavailable) return json({ error: error.code }, error.status);
		console.error("[mcp-dynamic-links] request failed", error);
		return json({ error: "Dynamic Links integration is unavailable" }, 503);
	}
}
function isRecord(value: unknown): value is RecordValue {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function record(value: unknown): RecordValue | null {
	return isRecord(value) ? value : null;
}
function records(value: unknown): RecordValue[] {
	return Array.isArray(value)
		? value.flatMap((row) => {
				const item = record(row);
				return item ? [item] : [];
			})
		: [];
}
function link(row: RecordValue) {
	return {
		...row,
		path: row.slug,
		custom_redirects: row.destinations,
		data: row.data ?? {},
		tags: row.tags ?? [],
		hidden: row.hidden ?? false,
	};
}
function limit(value: unknown, fallback: number, maximum: number) {
	const n = Number(value ?? fallback);
	return Number.isSafeInteger(n) ? Math.max(1, Math.min(n, maximum)) : fallback;
}
function json(value: unknown, status = 200) {
	return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function redirectDestinations(value: RecordValue): Record<string, string> {
	if (value.default_fallback !== undefined && typeof value.default_fallback !== "string")
		throw new NativeIntegrationError(422, "Default redirect URL must be a string");
	const result: Record<string, string> = {};
	for (const platform of ["ios", "android", "desktop", "web"]) {
		const entry = value[platform];
		if (entry === undefined) continue;
		const object = record(entry);
		if (typeof entry !== "string" && !object)
			throw new NativeIntegrationError(422, "Redirect URLs must be strings or URL objects");
		for (const field of ["url", "fallback_url"])
			if (object && object[field] !== undefined && typeof object[field] !== "string")
				throw new NativeIntegrationError(422, "Redirect URLs must be strings");
		const url = typeof entry === "string" ? entry : (object?.url ?? object?.fallback_url);
		if (typeof url === "string") result[platform] = url;
	}
	return result;
}
