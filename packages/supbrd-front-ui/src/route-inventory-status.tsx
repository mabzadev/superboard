import type { RouteDestination } from "@superboard/contracts/route-registry";
import type { RouteInventorySummary } from "@superboard/contracts/route-inventory";

const messages = {
	en: {
		complete: "Inventory observed",
		legacyProject: "Projects before migration",
		flowsProject: "Projects migrated to Flows",
		partial: "Partial inventory",
		stale: "Refresh failed — last observation retained",
		unknown: "Inventory not verified",
		mixed: "Deployment in progress: different releases observed",
		versionsUnknown: "Service versions not verified",
		current: "Current",
		unavailable: "Unavailable",
		disabled: "Disabled",
		expired: "Stale",
		canonical: "Canonical",
		alias: "Alias",
		internal: "Internal",
		status: "Route status",
		websocket: "WebSocket",
		fallback: "Fallback",
		routingConflict: "Conflicting route declarations",
	},
	fr: {
		complete: "Inventaire observé",
		legacyProject: "Projets non migrés",
		flowsProject: "Projets migrés vers Flows",
		partial: "Inventaire partiel",
		stale: "Échec de l’actualisation — dernière observation conservée",
		unknown: "Inventaire non vérifié",
		mixed: "Déploiement en cours : versions différentes observées",
		versionsUnknown: "Versions des services non vérifiées",
		current: "Actuel",
		unavailable: "Indisponible",
		disabled: "Désactivé",
		expired: "Périmé",
		canonical: "Canonique",
		alias: "Alias",
		internal: "Interne",
		status: "État de la route",
		websocket: "WebSocket",
		fallback: "Secours",
		routingConflict: "Déclarations de routes en conflit",
	},
};
export function routeInventoryLabels(locale: string) {
	return locale.startsWith("fr") ? messages.fr : messages.en;
}

export function RouteInventoryStatus({
	inventory,
	locale,
	failed = false,
}: {
	inventory?: RouteInventorySummary;
	locale: string;
	failed?: boolean;
}) {
	const t = routeInventoryLabels(locale);
	return (
		<div role="status" className="space-y-1 text-sm">
			<p>{failed ? t.stale : inventory ? t[inventory.status] : t.unknown}</p>
			{!!inventory?.issues?.length && (
				<p>
					{t.routingConflict} · {inventory.issues.length}
				</p>
			)}
			{inventory?.versions === "mixed" && <p>{t.mixed}</p>}
			{inventory?.versions === "unknown" && <p>{t.versionsUnknown}</p>}
			{inventory?.sources.map((source) => (
				<p key={`${source.service}:${source.workerName}`}>
					{source.service} · {source.status === "stale" ? t.expired : t[source.status]} ·{" "}
					{source.buildId ?? "—"} · {source.observedAt ?? "—"}
				</p>
			))}
		</div>
	);
}

export function routeDestinationText(
	destinations: readonly RouteDestination[] | undefined,
	inventory: RouteInventorySummary | undefined,
	locale: string,
): string {
	const t = routeInventoryLabels(locale);
	return (destinations ?? [])
		.map((destination) => {
			const source = inventory?.sources.find((item) => item.service === destination.service);
			const status = !source ? t.unknown : source.status === "stale" ? t.expired : t[source.status];
			const condition =
				destination.condition === "flows-project"
					? t.flowsProject
					: destination.condition === "legacy-project"
						? t.legacyProject
						: undefined;
			return [destination.service, condition, status, destination.path].filter(Boolean).join(" · ");
		})
		.join("; ");
}
