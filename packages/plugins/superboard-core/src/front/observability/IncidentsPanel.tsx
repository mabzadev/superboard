import { Button } from "@superboard/front-ui/kumo";
import {
	SettingsActions,
	SettingsRow,
	SettingsSection,
	SettingsTextField,
} from "@superboard/front-ui/settings-form";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { useCallback, useEffect, useState } from "react";

import { useObservabilityI18n } from "./i18n.js";
import { GET, POST } from "./transport.js";

interface Incident {
	incident_id: string;
	service: string;
	outcome: string;
	http_status: number;
	occurrences: number;
	status: "open" | "acknowledged" | "resolved";
	last_observed_at: string;
	resolution: string | null;
}
interface Metric {
	service: string;
	outcome?: string;
	eventType?: string;
	invocations: number;
	exceptions: number;
	averageCpuMs: number;
	averageWallMs: number;
}
interface Health {
	service: string;
	status: "healthy" | "unhealthy" | "unknown";
	observed_at: string;
}

export function useObservations() {
	const [incidents, setIncidents] = useState<Incident[]>([]);
	const [metrics, setMetrics] = useState<Metric[]>([]);
	const [health, setHealth] = useState<Health[]>([]);
	const [cursor, setCursor] = useState("");
	const [next, setNext] = useState<string | null>(null);
	const [resolutions, setResolutions] = useState<Record<string, string>>({});
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [loading, setLoading] = useState(true);
	const load = useCallback(async () => {
		setLoading(true);
		try {
			const [list, activity, services] = await Promise.all([
				GET(`/api/v1/observability/incidents?cursor=${encodeURIComponent(cursor)}`),
				GET("/api/v1/observability/runtime-metrics"),
				GET("/api/v1/observability/service-health"),
			]);
			setIncidents(list.data.data.items);
			setNext(list.data.data.nextCursor ?? null);
			setMetrics(activity.data.data.rows);
			setHealth(services.data.data.items);
			setError(null);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setLoading(false);
		}
	}, [cursor]);
	useEffect(() => {
		void load();
	}, [load]);
	async function transition(incident: Incident, action: "acknowledge" | "resolve") {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			await POST(
				`/api/v1/observability/incidents/${incident.incident_id}/${action}`,
				action === "resolve" ? { resolution: resolutions[incident.incident_id] } : {},
			);
			await load();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setBusy(false);
		}
	}
	return {
		incidents,
		metrics,
		health,
		cursor,
		setCursor,
		next,
		resolutions,
		setResolutions,
		error,
		busy,
		loading,
		load,
		transition,
	};
}

export type Observations = ReturnType<typeof useObservations>;

export default function IncidentsPanel({ observations }: { observations: Observations }) {
	const i18n = useObservabilityI18n();
	const { t } = i18n;
	const { incidents, health, cursor, next, resolutions, error, busy, loading } = observations;
	return (
		<>
			<SettingsSection
				title={t("Observed incidents")}
				description={t("Errors detected on the services, to acknowledge then resolve.")}
			>
				{error && (
					<SettingsRow>
						<p role="alert" className="text-sm text-kumo-danger">
							{error}
						</p>
					</SettingsRow>
				)}
				{loading && (
					<SettingsRow>
						<p role="status" className="text-sm text-kumo-subtle">
							{t("Loading observations…")}
						</p>
					</SettingsRow>
				)}
				{!loading && !incidents.length && (
					<SettingsRow>
						<p className="text-sm text-kumo-subtle">{t("No incidents recorded.")}</p>
					</SettingsRow>
				)}
				{incidents.map((incident) => {
					const status = i18n.status(incident.status);
					return (
						<SettingsRow key={incident.incident_id}>
							<article className="space-y-3">
								<div className="flex items-start justify-between gap-3">
									<div className="min-w-0 space-y-1">
										<h3 className="text-sm font-medium">
											{incident.service} · {incident.outcome} · {incident.http_status}
										</h3>
										<p className="text-xs text-kumo-subtle">
											{t("Occurrences: {count} · Last observation: {date}", {
												count: i18n.number(incident.occurrences),
												date: i18n.date(incident.last_observed_at),
											})}
										</p>
									</div>
									<Badge variant={status.variant}>{status.label}</Badge>
								</div>
								{incident.status !== "resolved" ? (
									<form
										className="space-y-3"
										onSubmit={(event) => {
											event.preventDefault();
											observations.transition(incident, "resolve").catch(() => undefined);
										}}
									>
										<SettingsTextField
											label={t("Resolution")}
											required
											maxLength={2000}
											value={resolutions[incident.incident_id] ?? ""}
											onChange={(event) => {
												const value = event.target.value;
												observations.setResolutions((current) => ({
													...current,
													[incident.incident_id]: value,
												}));
											}}
										/>
										<SettingsActions>
											{incident.status === "open" && (
												<Button
													type="button"
													disabled={busy}
													onClick={() => void observations.transition(incident, "acknowledge")}
												>
													{t("Acknowledge")}
												</Button>
											)}
											<Button
												type="submit"
												variant="primary"
												disabled={busy || !resolutions[incident.incident_id]?.trim()}
											>
												{t("Resolve")}
											</Button>
										</SettingsActions>
									</form>
								) : (
									<p className="text-sm">{incident.resolution}</p>
								)}
							</article>
						</SettingsRow>
					);
				})}
				<SettingsRow>
					<SettingsActions>
						{cursor && (
							<Button
								onClick={() => {
									observations.setCursor("");
								}}
							>
								{t("First page")}
							</Button>
						)}
						{next && (
							<Button
								onClick={() => {
									observations.setCursor(next);
								}}
							>
								{t("Next page")}
							</Button>
						)}
						<Button disabled={loading || busy} onClick={() => void observations.load()}>
							{t("Refresh observations")}
						</Button>
					</SettingsActions>
				</SettingsRow>
			</SettingsSection>
			<SettingsSection
				title={t("Latest service health")}
				description={t(
					"Health reflects the latest invocation; observations older than five minutes are marked unknown.",
				)}
			>
				{health.length ? (
					health.map((row) => {
						const status = i18n.status(row.status);
						return (
							<SettingsRow key={row.service} className="flex items-center justify-between gap-3">
								<div className="min-w-0">
									<p className="text-sm font-medium">{row.service}</p>
									<p className="text-xs text-kumo-subtle">{i18n.date(row.observed_at)}</p>
								</div>
								<Badge variant={status.variant}>{status.label}</Badge>
							</SettingsRow>
						);
					})
				) : (
					<SettingsRow>
						<p className="text-sm text-kumo-subtle">
							{t("No service health has been observed yet.")}
						</p>
					</SettingsRow>
				)}
			</SettingsSection>
		</>
	);
}

export function WorkerObservations({ observations }: { observations: Observations }) {
	const i18n = useObservabilityI18n();
	const { t } = i18n;
	const { metrics, loading } = observations;
	return (
		<SettingsSection
			title={t("Worker observations")}
			description={t("Invocations, exceptions and durations per service over the last hour.")}
		>
			<SettingsRow>
				{metrics.length ? (
					<div className="overflow-x-auto">
						<table className="w-full text-start text-sm">
							<thead className="border-b border-kumo-line text-xs text-kumo-subtle">
								<tr>
									<th className="py-2 text-start">{t("Service")}</th>
									<th className="text-start">{t("Event")}</th>
									<th className="text-start">{t("Outcome")}</th>
									<th className="text-start">{t("Invocations")}</th>
									<th className="text-start">{t("Exceptions")}</th>
									<th className="text-start">{t("Average CPU")}</th>
									<th className="text-start">{t("Average duration")}</th>
								</tr>
							</thead>
							<tbody>
								{metrics.map((row) => (
									<tr
										key={`${row.service}:${row.eventType ?? ""}:${row.outcome ?? ""}`}
										className="border-b border-kumo-line last:border-0"
									>
										<td className="py-2">{row.service}</td>
										<td>{row.eventType ?? "—"}</td>
										<td>{row.outcome ? <OutcomeBadge value={row.outcome} /> : "—"}</td>
										<td>{i18n.number(row.invocations)}</td>
										<td>{i18n.number(row.exceptions)}</td>
										<td>{i18n.duration(row.averageCpuMs)}</td>
										<td>{i18n.duration(row.averageWallMs)}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : (
					<p role={loading ? "status" : undefined} className="text-sm text-kumo-subtle">
						{loading
							? t("Loading observations…")
							: t(
									"No Worker observations received. No availability or activity is inferred from an empty window.",
								)}
					</p>
				)}
			</SettingsRow>
		</SettingsSection>
	);
}

function OutcomeBadge({ value }: { value: string }) {
	const outcome = useObservabilityI18n().outcome(value);
	return <Badge variant={outcome.variant}>{outcome.label}</Badge>;
}
