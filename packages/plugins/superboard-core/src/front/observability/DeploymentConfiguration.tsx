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
import { SettingsActions, SettingsRow, SettingsSection } from "@superboard/front-ui/settings-form";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import {
	Table as FrontTable,
	TableHeader as FrontTableHeader,
	TableBody as FrontTableBody,
	TableRow as FrontTableRow,
	TableHead as FrontTableHead,
	TableCell as FrontTableCell,
} from "@superboard/front-ui/ui/table.js";
import { useEffect, useState, type ReactNode } from "react";

import { useObservabilityI18n } from "./i18n.js";

export default function DeploymentConfiguration({ refreshKey = 0 }: { refreshKey?: number }) {
	const context = useFrontContext();
	const t = deploymentI18n(context.locale ?? "en");
	const routeLabels = routeInventoryLabels(context.locale ?? "en");
	const [routeLimit, setRouteLimit] = useState(50);
	const { t: text } = useObservabilityI18n();
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
	const { refetch } = query;
	useEffect(() => {
		if (refreshKey) refetch().catch(() => undefined);
	}, [refreshKey, refetch]);
	const routes = query.data?.routes ?? [];
	if (query.isPending) return <Loader />;
	if (query.error && !query.data) return <p role="alert">{t("unavailable")}</p>;
	if (!query.data) return null;
	return (
		<>
			<SettingsSection
				title={text("Running configuration")}
				description={text(
					"Profile, source and checksum of the configuration this environment runs.",
				)}
			>
				<SettingsRow>
					<div className="flex items-center justify-between gap-4">
						<p className="text-xs text-kumo-subtle">{t("configured")}</p>
						<Badge variant="info">{text("Configured")}</Badge>
					</div>
				</SettingsRow>
				<Detail label={t("profile")}>{query.data.profile}</Detail>
				<Detail label={t("source")}>
					<code className="break-all">{query.data.source}</code>
				</Detail>
				<Detail label={text("Checksum")}>
					<code className="break-all">{query.data.checksum}</code>
				</Detail>
			</SettingsSection>
			<SettingsSection
				title={t("endpoints")}
				description={text(
					"Addresses where each service of this environment answers, with the Worker that serves it.",
				)}
			>
				<ConfigurationTable
					label={t("endpoints")}
					columns={[t("surface"), t("url"), t("worker")]}
					rows={query.data.endpoints.map((endpoint) => ({
						key: endpoint.surface,
						cells: [
							t(`surface.${endpoint.surface}`),
							<code key="url" className="break-all">
								{endpoint.url}
							</code>,
							endpoint.worker,
						],
					}))}
				/>
			</SettingsSection>
			<SettingsSection
				title={text("Access")}
				description={text("Who may call the routes of this environment.")}
			>
				<Detail label={t("webOrigins")}>{query.data.webOrigins.join(", ") || text("None")}</Detail>
				<Detail label={t("authIssuer")}>
					<code className="break-all">{query.data.authIssuer}</code>
				</Detail>
				<SettingsRow>
					<p className="text-xs text-kumo-subtle">{t("mobileWeb")}</p>
				</SettingsRow>
			</SettingsSection>
			<SettingsSection
				title={t("aliases")}
				description={text("Former addresses kept so existing integrations keep working.")}
			>
				<ConfigurationTable
					label={t("aliases")}
					columns={[t("surface"), t("url")]}
					rows={query.data.aliases.map((alias) => ({
						key: `${alias.surface}:${alias.hostname}`,
						cells: [t(`surface.${alias.surface}`), alias.hostname],
					}))}
				/>
			</SettingsSection>
			<SettingsSection
				title={t("workers")}
				description={text("Workers that run this environment and the modules each one hosts.")}
			>
				<ConfigurationTable
					label={t("workers")}
					columns={[t("worker"), t("cloudflare"), t("modules")]}
					rows={query.data.workers.map((worker) => ({
						key: worker.id,
						cells: [worker.id, worker.name ?? "—", worker.modules.join(", ")],
					}))}
				/>
			</SettingsSection>
			<SettingsSection
				title={t("routes")}
				description={text("Routes served to the SDK, mobile and web apps, with their destination.")}
			>
				<ConfigurationTable
					label={t("routes")}
					columns={[t("method"), t("url"), t("worker"), routeLabels.status]}
					rows={routes.slice(0, routeLimit).map((route) => {
						const cells = [
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
						];
						return { key: cells.join("\u0000"), cells };
					})}
				/>
				<SettingsRow>
					<RouteInventoryStatus
						inventory={query.data.inventory}
						locale={context.locale ?? "en"}
						failed={!!query.error}
					/>
					{!query.data.routesLoaded && <p role="status">{t("routesUnavailable")}</p>}
				</SettingsRow>
			</SettingsSection>
			{routeLimit < routes.length && (
				<SettingsActions>
					<Button
						onClick={() => {
							setRouteLimit((limit) => limit + 50);
						}}
					>
						{t("next")}
					</Button>
				</SettingsActions>
			)}
		</>
	);
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
	return (
		<SettingsRow className="space-y-1">
			<p className="text-xs text-kumo-subtle">{label}</p>
			<div className="text-sm">{children}</div>
		</SettingsRow>
	);
}

function ConfigurationTable({
	label,
	columns,
	rows,
}: {
	label: string;
	columns: string[];
	rows: { key: string; cells: ReactNode[] }[];
}) {
	return (
		<div className="overflow-auto p-4">
			<FrontTable className="w-full text-start" aria-label={label}>
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
						<FrontTableRow key={row.key}>
							{row.cells.map((cell, index) => (
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
