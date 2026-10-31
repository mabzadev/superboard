import {
	parseDeploymentConfiguration,
	parseDeploymentRoutes,
} from "@superboard/contracts/deployment-configuration";
import { parseRouteInventorySummary } from "@superboard/contracts/route-inventory";
import { useFrontContext } from "@superboard/front-ui/context";
import { deploymentI18n } from "@superboard/front-ui/deployment-i18n.js";
import { Button, Loader } from "@superboard/front-ui/kumo";
import { useLiveQuery } from "@superboard/front-ui/live-query.js";
import {
	RouteInventoryStatus,
	routeInventoryLabels,
	routeDestinationText,
} from "@superboard/front-ui/route-inventory-status.js";
import {
	Table as FrontTable,
	TableHeader as FrontTableHeader,
	TableBody as FrontTableBody,
	TableRow as FrontTableRow,
	TableHead as FrontTableHead,
	TableCell as FrontTableCell,
} from "@superboard/front-ui/ui/table.js";
import { useState } from "react";

/** Environment settings › Infrastructure: deployment, Workers and routes inventory. */
export default function InstanceConfiguration() {
	const context = useFrontContext();
	const t = deploymentI18n(context.locale ?? "en");
	const routeLabels = routeInventoryLabels(context.locale ?? "en");
	const [routeLimit, setRouteLimit] = useState(50);
	const query = useLiveQuery({
		key: [
			"deployment-configuration",
			context.instanceId,
			context.deployment?.environment,
			context.operator?.id,
		],
		url: "/_emdash/api/superboard/deployment-configuration",
		parse: async (response) => {
			if (!response.ok) throw new Error("DEPLOYMENT_CONFIGURATION_UNAVAILABLE");
			const body: unknown = await response.json();
			if (!body || typeof body !== "object" || !("configuration" in body))
				throw new Error("DEPLOYMENT_CONFIGURATION_INVALID");
			return {
				...parseDeploymentConfiguration(JSON.stringify(body.configuration)),
				routes: parseDeploymentRoutes("routes" in body ? body.routes : []),
				routesLoaded: "routesStatus" in body && body.routesStatus === "loaded",
				inventory:
					"routeInventory" in body && body.routeInventory
						? parseRouteInventorySummary(body.routeInventory)
						: undefined,
			};
		},
	});
	return (
		<section className="space-y-5 py-4">
			<p>{t("description")}</p>
			{query.isPending ? (
				<Loader />
			) : query.error && !query.data ? (
				<p role="alert">{t("unavailable")}</p>
			) : query.data ? (
				<>
					<p>
						{query.data.target} · {query.data.environment} · {t("configured")}
					</p>
					<p>
						{t("source")} : {query.data.source} · {query.data.checksum}
					</p>
					<p>
						{t("profile")} : {query.data.profile}
					</p>
					<p>
						{t("status")} : {query.data.publicRouting}
					</p>
					<div className="overflow-auto">
						<FrontTable className="w-full text-start">
							<FrontTableHeader>
								<FrontTableRow>
									<FrontTableHead>{t("surface")}</FrontTableHead>
									<FrontTableHead>{t("url")}</FrontTableHead>
									<FrontTableHead>{t("worker")}</FrontTableHead>
								</FrontTableRow>
							</FrontTableHeader>
							<FrontTableBody>
								{query.data.endpoints.map((endpoint) => (
									<FrontTableRow key={endpoint.surface}>
										<FrontTableCell className="py-2">
											{t(`surface.${endpoint.surface}`)}
										</FrontTableCell>
										<FrontTableCell className="px-4">
											<code>{endpoint.url}</code>
										</FrontTableCell>
										<FrontTableCell>{endpoint.worker}</FrontTableCell>
									</FrontTableRow>
								))}
							</FrontTableBody>
						</FrontTable>
					</div>
					<ConfigurationTable
						title={t("workers")}
						columns={[t("worker"), t("cloudflare"), t("modules")]}
						rows={query.data.workers.map((worker) => [
							worker.id,
							worker.name ?? "—",
							worker.modules.join(", "),
						])}
					/>
					<p>
						{t("webOrigins")} : {query.data.webOrigins.join(", ") || "—"}
					</p>
					<p>
						{t("authIssuer")} : {query.data.authIssuer}
					</p>
					<p>{t("mobileWeb")}</p>
					<ConfigurationTable
						title={t("routes")}
						columns={[t("method"), t("url"), t("worker"), routeLabels.status]}
						rows={query.data.routes
							.slice(0, routeLimit)
							.map((route) => [
								route.method,
								route.url ?? route.path,
								[
									route.worker,
									route.executionScope,
									routeDestinationText(
										route.destinations,
										query.data?.inventory,
										context.locale ?? "en",
									),
								]
									.filter(Boolean)
									.join(" · "),
								`${route.transport === "websocket" ? `${routeLabels.websocket} · ` : route.transport === "fallback" ? `${routeLabels.fallback} · ` : ""}${route.kind === "alias" ? routeLabels.alias : routeLabels.canonical} · ${route.surface === "internal" ? routeLabels.internal : route.surface} · ${route.availability === "stale" ? routeLabels.expired : routeLabels.current}`,
							])}
					/>
					<RouteInventoryStatus
						inventory={query.data.inventory}
						locale={context.locale ?? "en"}
						failed={!!query.error}
					/>
					{!query.data.routesLoaded && <p role="status">{t("routesUnavailable")}</p>}
					{routeLimit < query.data.routes.length && (
						<Button
							onClick={() => {
								setRouteLimit((limit) => limit + 50);
							}}
						>
							{t("next")}
						</Button>
					)}
					<ConfigurationTable
						title={t("aliases")}
						columns={[t("surface"), t("url")]}
						rows={query.data.aliases.map((alias) => [
							t(`surface.${alias.surface}`),
							alias.hostname,
						])}
					/>
				</>
			) : null}
			<Button
				disabled={query.isFetching}
				onClick={() => {
					query.refetch().catch(() => undefined);
				}}
			>
				{t("refresh")}
			</Button>
		</section>
	);
}

function ConfigurationTable({
	title,
	columns,
	rows,
}: {
	title: string;
	columns: string[];
	rows: string[][];
}) {
	return (
		<div className="overflow-auto">
			<h2 className="text-lg font-semibold">{title}</h2>
			<FrontTable className="w-full text-start" aria-label={title}>
				<FrontTableHeader>
					<FrontTableRow>
						{columns.map((column) => (
							<FrontTableHead key={column} scope="col">
								{column}
							</FrontTableHead>
						))}
					</FrontTableRow>
				</FrontTableHeader>
				<FrontTableBody>
					{rows.map((row) => (
						<FrontTableRow key={row.join("\u0000")}>
							{row.map((cell, index) => (
								<FrontTableCell key={columns[index]} className="py-2 pe-4">
									{cell}
								</FrontTableCell>
							))}
						</FrontTableRow>
					))}
				</FrontTableBody>
			</FrontTable>
		</div>
	);
}
