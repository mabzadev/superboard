import {
	parseDeploymentConfiguration,
	parseDeploymentRoutes,
} from "@superboard/contracts/deployment-configuration";
import { useFrontContext } from "@superboard/front-ui/context";
import { deploymentI18n } from "@superboard/front-ui/deployment-i18n.js";
import { Button, Loader } from "@superboard/front-ui/kumo";
import { useQuery } from "@superboard/front-ui/query";
import { SectionNavigation } from "@superboard/front-ui/section-navigation.js";
import {
	Table as FrontTable,
	TableHeader as FrontTableHeader,
	TableBody as FrontTableBody,
	TableRow as FrontTableRow,
	TableHead as FrontTableHead,
	TableCell as FrontTableCell,
} from "@superboard/front-ui/ui/table.js";
import { useState } from "react";

export default function InstanceConfiguration() {
	const context = useFrontContext();
	const t = deploymentI18n(context.locale ?? "en");
	const [routeLimit, setRouteLimit] = useState(50);
	const query = useQuery({
		queryKey: ["deployment-configuration", context.instanceId],
		queryFn: async () => {
			const response = await fetch("/_emdash/api/superboard/deployment-configuration", {
				credentials: "same-origin",
			});
			if (!response.ok) throw new Error("DEPLOYMENT_CONFIGURATION_UNAVAILABLE");
			const body: unknown = await response.json();
			if (!body || typeof body !== "object" || !("configuration" in body))
				throw new Error("DEPLOYMENT_CONFIGURATION_INVALID");
			return {
				...parseDeploymentConfiguration(JSON.stringify(body.configuration)),
				routes: parseDeploymentRoutes("routes" in body ? body.routes : []),
				routesLoaded: "routesStatus" in body && body.routesStatus === "loaded",
			};
		},
		refetchInterval: 30000,
	});
	return (
		<section className="ds-page space-y-5">
			<h1 className="ds-page-title">{t("title")}</h1>
			<p>{t("description")}</p>
			<SectionNavigation />
			{query.isPending ? (
				<Loader />
			) : query.error ? (
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
						columns={[t("method"), t("url"), t("worker")]}
						rows={query.data.routes
							.slice(0, routeLimit)
							.map((route) => [route.method, route.url, route.worker])}
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
					setRouteLimit(50);
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
