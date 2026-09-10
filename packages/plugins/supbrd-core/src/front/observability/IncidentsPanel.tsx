import { useFrontContext } from "@superboard/front-ui/context";
import { useCallback, useEffect, useState } from "react";

import { Button } from "../../../../../supbrd-front-ui/src/shared/components/ui/button.js";
import { Input } from "../../../../../supbrd-front-ui/src/shared/components/ui/input.js";
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
const messages = {
	en: {
		title: "Observed incidents",
		empty: "No incidents recorded.",
		loading: "Loading observations…",
		refresh: "Refresh observations",
		acknowledge: "Acknowledge",
		resolve: "Resolve",
		resolution: "Resolution",
		next: "Next page",
		first: "First page",
		open: "Open",
		acknowledged: "Acknowledged",
		resolved: "Resolved",
		healthy: "Healthy",
		unhealthy: "Unhealthy",
		unknown: "Unknown",
		service: "Service",
		state: "State",
		occurrences: "Occurrences",
		last: "Last observation",
		metrics: "Worker observations over the last hour",
		invocations: "Invocations",
		exceptions: "Exceptions",
		cpu: "Average CPU (ms)",
		wall: "Average duration (ms)",
		noMetrics:
			"No Worker observations received. No availability or activity is inferred from an empty window.",
		health: "Latest observed service health",
		healthNote:
			"Health reflects the latest invocation. Observations older than five minutes are marked unknown.",
	},
	fr: {
		title: "Incidents observés",
		empty: "Aucun incident enregistré.",
		loading: "Chargement des observations…",
		refresh: "Actualiser les observations",
		acknowledge: "Acquitter",
		resolve: "Résoudre",
		resolution: "Résolution",
		next: "Page suivante",
		first: "Première page",
		open: "Ouvert",
		acknowledged: "Acquitté",
		resolved: "Résolu",
		healthy: "Disponible",
		unhealthy: "En erreur",
		unknown: "Inconnu",
		service: "Service",
		state: "État",
		occurrences: "Occurrences",
		last: "Dernière observation",
		metrics: "Observations des Workers sur la dernière heure",
		invocations: "Invocations",
		exceptions: "Exceptions",
		cpu: "CPU moyen (ms)",
		wall: "Durée moyenne (ms)",
		noMetrics:
			"Aucune observation de Worker reçue. Une période vide ne permet pas de déduire la disponibilité ou l’activité.",
		health: "Dernier état observé des services",
		healthNote:
			"L’état reflète la dernière invocation. Les observations de plus de cinq minutes sont marquées inconnues.",
	},
};
export default function IncidentsPanel() {
	const { locale } = useFrontContext();
	const t = messages[locale];
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
	return (
		<section className="grid gap-4 rounded-lg border p-5">
			<h2 className="text-xl font-semibold">{t.title}</h2>
			<Button disabled={loading || busy} onClick={() => void load()}>
				{t.refresh}
			</Button>
			{error && <p role="alert">{error}</p>}
			{loading && <p role="status">{t.loading}</p>}
			{!loading && !incidents.length && <p>{t.empty}</p>}
			{incidents.map((incident) => (
				<article key={incident.incident_id} className="grid gap-3 rounded border p-4">
					<h3>
						{incident.service} · {incident.outcome} · {incident.http_status}
					</h3>
					<p>
						{t[incident.status]} · {t.occurrences}: {incident.occurrences} · {t.last}:{" "}
						{new Date(incident.last_observed_at).toLocaleString(locale)}
					</p>
					{incident.status === "open" && (
						<Button disabled={busy} onClick={() => void transition(incident, "acknowledge")}>
							{t.acknowledge}
						</Button>
					)}
					{incident.status !== "resolved" ? (
						<form
							onSubmit={(event) => {
								event.preventDefault();
								void transition(incident, "resolve");
							}}
							className="flex items-end gap-3"
						>
							<label>
								{t.resolution}
								<Input
									required
									maxLength={2000}
									value={resolutions[incident.incident_id] ?? ""}
									onChange={(event) =>
										setResolutions((current) => ({
											...current,
											[incident.incident_id]: event.target.value,
										}))
									}
								/>
							</label>
							<Button disabled={busy || !resolutions[incident.incident_id]?.trim()}>
								{t.resolve}
							</Button>
						</form>
					) : (
						<p>{incident.resolution}</p>
					)}
				</article>
			))}
			<div className="flex gap-3">
				{cursor && <Button onClick={() => setCursor("")}>{t.first}</Button>}
				{next && <Button onClick={() => setCursor(next)}>{t.next}</Button>}
			</div>
			<h3>{t.metrics}</h3>
			{metrics.length ? (
				<div className="overflow-x-auto">
					<table className="w-full text-start">
						<thead>
							<tr>
								<th>{t.service}</th>
								<th>{t.invocations}</th>
								<th>{t.exceptions}</th>
								<th>{t.cpu}</th>
								<th>{t.wall}</th>
							</tr>
						</thead>
						<tbody>
							{metrics.map((row, index) => (
								<tr key={`${row.service}:${index}`}>
									<td>{row.service}</td>
									<td>{row.invocations}</td>
									<td>{row.exceptions}</td>
									<td>{row.averageCpuMs}</td>
									<td>{row.averageWallMs}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : (
				!loading && <p>{t.noMetrics}</p>
			)}
			<h3>{t.health}</h3>
			<p>{t.healthNote}</p>
			<ul>
				{health.map((row) => (
					<li key={row.service}>
						{row.service} · {t[row.status]} · {new Date(row.observed_at).toLocaleString(locale)}
					</li>
				))}
			</ul>
		</section>
	);
}
