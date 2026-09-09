import {
	parseDeploymentConfiguration,
	parseDeploymentRoutes,
	type DeploymentConfiguration,
	type DeploymentRoute,
} from "@superboard/contracts/deployment-configuration";
import { readJsonObjectLimited } from "@superboard/contracts/request-body";

import { resolveLocale } from "../../../../packages/admin/src/locales/config.js";
import type { Block, BlockResponse } from "../../../../packages/blocks/src/types.js";
import { deploymentI18n } from "../../../../packages/supbrd-front-ui/src/deployment-i18n.js";
import { proxyOperatorApiRequest, type OperatorApiProxyEnv } from "./operator-api-proxy.js";

interface ConfigurationEnv extends OperatorApiProxyEnv {
	SUPERBOARD_DEPLOYMENT_CONFIGURATION_JSON?: string;
}
export async function instanceConfiguration(
	env: ConfigurationEnv,
	operator: { id: string; role: number; disabled?: boolean },
	request: Request,
) {
	let configuration: DeploymentConfiguration | null = env.SUPERBOARD_DEPLOYMENT_CONFIGURATION_JSON
		? parseDeploymentConfiguration(env.SUPERBOARD_DEPLOYMENT_CONFIGURATION_JSON)
		: null;
	if (
		configuration &&
		(configuration.target !== env.SUPERBOARD_INSTANCE_ID ||
			configuration.environment !== env.SUPERBOARD_ENVIRONMENT)
	)
		throw new Error("DEPLOYMENT_CONTEXT_MISMATCH");
	let routes: DeploymentRoute[] = [];
	let routesStatus = "unavailable";
	let workerNames: Record<string, string> = {};
	let webOrigins = configuration?.webOrigins ?? [];
	try {
		const response = await proxyOperatorApiRequest({
			request: new Request(new URL("/internal/site/deployment-configuration", request.url), {
				signal: AbortSignal.timeout(10000),
			}),
			operator,
			env,
			plugin_context: { plugin_id: "supbrd-core", project_ref: "instance" },
		});
		if (response.ok) {
			const data = await readJsonObjectLimited(response, 2_000_000);
			const live = parseDeploymentConfiguration(JSON.stringify(data.configuration));
			if (
				live.target !== env.SUPERBOARD_INSTANCE_ID ||
				live.environment !== env.SUPERBOARD_ENVIRONMENT
			)
				throw new Error("DEPLOYMENT_CONTEXT_MISMATCH");
			routes = parseDeploymentRoutes(data.routes);
			if (Array.isArray(data.webOrigins))
				webOrigins = data.webOrigins.filter(
					(value: unknown): value is string => typeof value === "string",
				);
			if (Array.isArray(data.workers))
				workerNames = Object.fromEntries(
					data.workers.flatMap((item: unknown) =>
						item &&
						typeof item === "object" &&
						"id" in item &&
						typeof item.id === "string" &&
						"name" in item &&
						typeof item.name === "string"
							? [[item.id, item.name]]
							: [],
					),
				);
			configuration = live;
			routesStatus = "loaded";
		} else await response.body?.cancel();
	} catch {
		routesStatus = "unavailable";
	}
	if (!configuration) throw new Error("DEPLOYMENT_CONFIGURATION_UNAVAILABLE");
	return { configuration, routes, routesStatus, workerNames, webOrigins };
}
export function configurationBlocks(
	data: Awaited<ReturnType<typeof instanceConfiguration>>,
	request: Request,
	cursor = 0,
): BlockResponse {
	const t = deploymentI18n(resolveLocale(request));
	const c = data.configuration;
	const table = (
		id: string,
		columns: Array<{ key: string; label: string }>,
		rows: Array<Record<string, unknown>>,
	): Block => ({
		type: "table",
		block_id: id,
		columns,
		rows,
		page_action_id: "deployment-routes-page",
		empty_text: t("empty"),
	});
	const start = Math.max(
		0,
		Math.min(data.routes.length, Number.isSafeInteger(cursor) ? cursor : 0),
	);
	const blocks: Block[] = [
		{ type: "header", text: t("title") },
		{ type: "section", text: t("description") },
		{
			type: "fields",
			fields: [
				{ label: t("source"), value: `${c.source} · ${c.checksum}` },
				{ label: t("environment"), value: `${c.target} · ${c.environment}` },
				{ label: t("profile"), value: c.profile },
				{ label: t("status"), value: `${c.publicRouting} · ${t("configured")}` },
			],
		},
		table(
			"deployment-endpoints",
			[
				{ key: "surface", label: t("surface") },
				{ key: "url", label: t("url") },
				{ key: "worker", label: t("worker") },
			],
			c.endpoints.map((row) => ({ ...row, surface: t(`surface.${row.surface}`) })),
		),
		{ type: "header", text: t("workers") },
		table(
			"deployment-workers",
			[
				{ key: "id", label: t("worker") },
				{ key: "name", label: t("cloudflare") },
				{ key: "modules", label: t("modules") },
			],
			c.workers.map((row) => ({
				...row,
				name:
					[...new Set(row.modules.map((module) => data.workerNames[module]).filter(Boolean))].join(
						" · ",
					) ||
					row.name ||
					"—",
				modules: row.modules.join(", "),
			})),
		),
		{
			type: "fields",
			fields: [
				{ label: t("webOrigins"), value: data.webOrigins.join("\n") || "—" },
				{ label: t("authIssuer"), value: c.authIssuer },
			],
		},
		{ type: "header", text: t("routes") },
		{ type: "section", text: t("mobileWeb") },
		{
			...table(
				"deployment-routes",
				[
					{ key: "method", label: t("method") },
					{ key: "url", label: t("url") },
					{ key: "worker", label: t("worker") },
				],
				data.routes.slice(start, start + 50).map((row) => ({ ...row })),
			),
			...(start + 50 < data.routes.length ? { next_cursor: String(start + 50) } : {}),
		},
		...(data.routesStatus !== "loaded"
			? [{ type: "section" as const, text: t("routesUnavailable") }]
			: []),
		{ type: "header", text: t("aliases") },
		table(
			"deployment-aliases",
			[
				{ key: "surface", label: t("surface") },
				{ key: "hostname", label: t("url") },
			],
			c.aliases.map((row) => ({ ...row })),
		),
		{
			type: "actions",
			elements: [{ type: "button", action_id: "deployment-refresh", label: t("refresh") }],
		},
	];
	return { blocks };
}
