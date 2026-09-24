import { Badge, Button, Loader } from "@cloudflare/kumo";
import { useLingui } from "@lingui/react/macro";
import type {
	PluginHealthStatus,
	PluginLifecycleState,
} from "@superboard/contracts/plugin-diagnostic";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { fetchPluginDiagnostic } from "../lib/api/plugin-configuration.js";
import { fetchPluginSettings } from "../lib/api/plugins.js";
import { ArrowPrev } from "./ArrowIcons.js";
import { RouterLinkButton } from "./RouterLinkButton.js";

export function PluginConfiguration({ pluginId }: { pluginId: string }) {
	const { t, i18n } = useLingui();
	const queryClient = useQueryClient();
	const queryKey = ["plugin-configuration", pluginId];
	const diagnostic = useQuery({ queryKey, queryFn: () => fetchPluginDiagnostic(pluginId) });
	const settings = useQuery({
		queryKey: ["plugin-settings", pluginId],
		queryFn: () => fetchPluginSettings(pluginId),
	});
	const refresh = useMutation({
		mutationFn: () => fetchPluginDiagnostic(pluginId, true),
		onSuccess: (data) => {
			queryClient.setQueryData(queryKey, data);
			void queryClient
				.invalidateQueries({ queryKey: ["plugin-settings", pluginId] })
				.catch(() => undefined);
		},
	});
	const [showSchema, setShowSchema] = useState(false);
	const data = diagnostic.data;
	const health: Record<PluginHealthStatus, string> = {
		ready: t`Ready`,
		unavailable: t`Unavailable`,
		unknown: t`Unknown`,
		expired: t`Expired`,
	};
	const lifecycle: Record<PluginLifecycleState, string> = {
		available: t`Available`,
		staged: t`Staged`,
		installed: t`Installed`,
		active: t`Active`,
		draining: t`Draining`,
		disabled: t`Disabled`,
		quarantined: t`Quarantined`,
		purged: t`Purged`,
	};
	const date = (value: string | null | undefined) =>
		value ? new Date(value).toLocaleString(i18n.locale) : "—";
	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-center gap-3">
				<RouterLinkButton
					to="/plugins-manager"
					variant="ghost"
					shape="square"
					aria-label={t`Back to plugins`}
					icon={<ArrowPrev />}
				/>
				<div className="flex-1 min-w-0">
					<h1 className="text-2xl font-semibold">
						{t`Configuration`}
						{data ? ` · ${data.label}` : ""}
					</h1>
					<p className="text-sm text-kumo-subtle font-mono break-all">{pluginId}</p>
				</div>
				<Button
					onClick={() => {
						refresh.mutate();
					}}
					disabled={!data || refresh.isPending}
				>
					{refresh.isPending ? t`Checking...` : t`Re-check Health`}
				</Button>
			</div>
			{diagnostic.isPending && <Loader />}
			{diagnostic.error && (
				<div role="alert" className="space-y-2 text-kumo-danger">
					<p>{t`Failed to load plugin configuration`}</p>
					<Button
						onClick={() => {
							void diagnostic.refetch().catch(() => undefined);
						}}
					>{t`Retry`}</Button>
				</div>
			)}
			{refresh.error && (
				<p role="alert" className="text-kumo-danger">{t`Health re-check failed`}</p>
			)}
			{data && (
				<>
					<ConfigurationSection title={t`Plugin Lifecycle`}>
						<dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
							<ConfigurationValue label={t`State`}>
								<Badge variant={data.lifecycle.state === "active" ? "primary" : "secondary"}>
									{lifecycle[data.lifecycle.state]}
								</Badge>
							</ConfigurationValue>
							<ConfigurationValue label={t`Last Changed`}>
								{date(data.lifecycle.changedAt)}
							</ConfigurationValue>
							<ConfigurationValue label={t`Reason`}>
								{data.lifecycle.reason ?? "—"}
							</ConfigurationValue>
							<ConfigurationValue label={t`Artifact Checksum`}>
								{data.lifecycle.artifactChecksum ?? "—"}
							</ConfigurationValue>
							<ConfigurationValue label={t`Plan ID`}>
								{data.lifecycle.planId ?? "—"}
							</ConfigurationValue>
							<ConfigurationValue label={t`Release ID`}>
								{data.lifecycle.activatedReleaseId ?? "—"}
							</ConfigurationValue>
						</dl>
					</ConfigurationSection>
					<ConfigurationSection title={t`Declared Configuration`}>
						<dl className="grid gap-4 sm:grid-cols-2">
							<ConfigurationValue label={t`Plugin ID`}>
								{data.configuration.pluginId}
							</ConfigurationValue>
							<ConfigurationValue label={t`Version`}>
								{data.configuration.version}
							</ConfigurationValue>
							<ConfigurationValue label={t`Capabilities`}>
								{data.configuration.capabilities.join(", ") || t`No capabilities declared`}
							</ConfigurationValue>
							<ConfigurationValue label={t`Reads`}>
								{data.configuration.failurePolicies.reads}
							</ConfigurationValue>
							<ConfigurationValue label={t`Writes`}>
								{data.configuration.failurePolicies.writes}
							</ConfigurationValue>
						</dl>
						{data.configuration.settingsSchema && (
							<div className="mt-4">
								<Button
									variant="ghost"
									onClick={() => {
										setShowSchema(!showSchema);
									}}
								>
									{showSchema ? t`Hide Schema` : t`View Schema`}
								</Button>
								{showSchema && (
									<pre className="mt-2 max-h-80 overflow-auto rounded bg-kumo-tint p-3 text-xs">
										{JSON.stringify(data.configuration.settingsSchema, null, 2)}
									</pre>
								)}
							</div>
						)}
					</ConfigurationSection>
					<ConfigurationSection title={t`Settings`}>
						{settings.isPending && <Loader />}
						{settings.error && (
							<div role="alert">
								<p>{t`Failed to load plugin settings`}</p>
								<Button
									onClick={() => {
										void settings.refetch().catch(() => undefined);
									}}
								>{t`Retry`}</Button>
							</div>
						)}
						{settings.data && (
							<ConfigurationTable
								title={t`Settings`}
								columns={[t`Setting`, t`Value`]}
								rows={Object.entries(settings.data.schema).map(([key, field]) => [
									key,
									field.type === "secret"
										? settings.data.secretsSet[key]
											? t`Configured`
											: t`Not set`
										: displaySetting(
												settings.data.values[key] ??
													("default" in field ? field.default : undefined),
												t`Not set`,
											),
								])}
							/>
						)}
					</ConfigurationSection>
					<ConfigurationSection title={t`Verified Health`}>
						<dl className="grid gap-4 sm:grid-cols-3">
							<ConfigurationValue label={t`Health Status`}>
								{health[data.health.status]}
							</ConfigurationValue>
							<ConfigurationValue label={t`Checked At`}>
								{date(data.health.checkedAt)}
							</ConfigurationValue>
							<ConfigurationValue label={t`Reason`}>{data.health.reason ?? "—"}</ConfigurationValue>
						</dl>
					</ConfigurationSection>
					<ConfigurationSection title={t`Dependencies`}>
						<ConfigurationTable
							title={t`Dependencies`}
							columns={[t`Dependency`, t`Health Status`, t`Checked At`, t`Expires`]}
							rows={data.dependencies.map((item) => [
								item.id,
								health[item.status],
								date(item.checkedAt),
								date(item.expiresAt),
							])}
						/>
					</ConfigurationSection>
					<ConfigurationSection title={t`Associated Services & Workers`}>
						<ConfigurationTable
							title={t`Associated Services & Workers`}
							columns={[
								t`Service`,
								t`Physical Worker`,
								t`Deployment Group`,
								t`Health Status`,
								t`Checked At`,
								t`Shared with`,
							]}
							rows={data.workers.map((item) => [
								item.service,
								item.physicalName ?? "—",
								item.deploymentGroup,
								health[item.health?.status ?? "unknown"],
								date(item.health?.checkedAt),
								item.sharedWith.join(", ") || "—",
							])}
						/>
					</ConfigurationSection>
					<ConfigurationSection title={t`Views`}>
						<ConfigurationTable
							title={t`Views`}
							columns={[t`Path`, t`Method`, t`Route ID`]}
							rows={data.routes.views.map((item) => [item.path, item.method, item.routeId])}
						/>
					</ConfigurationSection>
					<ConfigurationSection title={t`API Routes`}>
						<ConfigurationTable
							title={t`API Routes`}
							columns={[t`Method`, t`Path`, t`Service`, t`Destination`]}
							rows={data.routes.api.map((item) => [
								item.method,
								item.path,
								item.worker ?? "—",
								item.url ?? "—",
							])}
						/>
					</ConfigurationSection>
				</>
			)}
		</div>
	);
}

function displaySetting(value: unknown, unset: string): string {
	if (value === undefined || value === null) return unset;
	return typeof value === "string" ? value : JSON.stringify(value);
}

function ConfigurationSection({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="rounded-lg border border-kumo-line bg-kumo-base p-5 space-y-4">
			<h2 className="text-lg font-semibold">{title}</h2>
			{children}
		</section>
	);
}

function ConfigurationValue({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="min-w-0">
			<dt className="text-xs text-kumo-subtle">{label}</dt>
			<dd className="mt-1 text-sm break-all">{children}</dd>
		</div>
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
	const { t } = useLingui();
	const [page, setPage] = useState(0);
	const count = Math.max(1, Math.ceil(rows.length / 10));
	const current = Math.min(page, count - 1);
	return (
		<div className="space-y-3">
			<div className="overflow-auto">
				<table aria-label={title} className="w-full text-start text-sm">
					<thead>
						<tr>
							{columns.map((column) => (
								<th key={column} scope="col" className="text-start p-2 border-b border-kumo-line">
									{column}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.slice(current * 10, (current + 1) * 10).map((row) => (
							<tr key={row.join("\u0000")}>
								{row.map((cell, index) => (
									<td key={columns[index]} className="p-2 border-b border-kumo-line break-words">
										{cell}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{rows.length === 0 && <p className="text-kumo-subtle">{t`No items`}</p>}
			{count > 1 && (
				<div className="flex flex-wrap items-center justify-between gap-3">
					<span>{t`Page ${current + 1} of ${count}`}</span>
					<div className="flex gap-2">
						<Button
							variant="outline"
							disabled={current === 0}
							onClick={() => {
								setPage(current - 1);
							}}
						>{t`Previous`}</Button>
						<Button
							variant="outline"
							disabled={current + 1 >= count}
							onClick={() => {
								setPage(current + 1);
							}}
						>{t`Next`}</Button>
					</div>
				</div>
			)}
		</div>
	);
}
