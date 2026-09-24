import { parsePluginDiagnostic, parsePluginHealth } from "@superboard/contracts/plugin-diagnostic";
import type {
	PluginDependencyDiagnostic,
	PluginDiagnosticData,
	PluginHealthStatus,
	PluginHealthDiagnostic,
	PluginLifecycleState,
	PluginRouteApiDiagnostic,
} from "@superboard/contracts/plugin-diagnostic";
import {
	canonicalPluginId,
	pluginPackage,
	pluginPackageOwner,
} from "@superboard/contracts/plugin-packages";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useOptionalFrontContext } from "./context.js";
import { Badge } from "./shared/components/ui/badge.js";
import { Button } from "./shared/components/ui/button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "./shared/components/ui/card.js";
import { Spinner } from "./shared/components/ui/spinner.js";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "./shared/components/ui/table.js";

export interface PluginConfigurationTabProps {
	pluginId?: string;
	locale?: string;
	className?: string;
}

const translations = {
	en: {
		lifecycle: {
			available: "Available",
			staged: "Staged",
			installed: "Installed",
			active: "Active",
			draining: "Draining",
			disabled: "Disabled",
			quarantined: "Quarantined",
			purged: "Purged",
		},
		health: { ready: "Ready", unavailable: "Unavailable", unknown: "Unknown", expired: "Expired" },
		destination: "Destination",
		loading: "Loading configuration and diagnostic...",
		errorTitle: "Failed to load diagnostic",
		errorDesc: "An error occurred while fetching configuration diagnostic data.",
		retry: "Retry",
		disabledTitle: "Plugin Disabled",
		disabledDesc: "This plugin is currently disabled in this environment.",
		recheckHealth: "Re-check Health",
		rechecking: "Checking...",
		recheckSuccess: "Health re-checked successfully",
		recheckFailed: "Health re-check failed",
		lifecycleTitle: "Plugin Lifecycle",
		state: "State",
		lastChanged: "Last Changed",
		reason: "Reason",
		artifactChecksum: "Artifact Checksum",
		planId: "Plan ID",
		releaseId: "Release ID",
		configTitle: "Declared Configuration",
		pluginId: "Plugin ID",
		version: "Version",
		capabilities: "Capabilities",
		noCapabilities: "No capabilities declared",
		failurePolicies: "Failure Policies",
		readPolicy: "Reads",
		writePolicy: "Writes",
		settingsSchema: "Settings Schema",
		viewSchema: "View Schema",
		hideSchema: "Hide Schema",
		noSchema: "No settings schema declared",
		healthTitle: "Verified Health",
		healthStatus: "Health Status",
		checkedAt: "Checked At",
		latency: "Latency",
		dependenciesTitle: "Dependencies",
		noDependencies: "No dependencies declared",
		dependencyName: "Dependency",
		kind: "Type",
		proofStatus: "Proof",
		workersTitle: "Associated Services & Workers",
		noWorkers: "No services or workers found",
		service: "Service",
		workerPhysical: "Physical Worker",
		deploymentGroup: "Deployment Group",
		shared: "Shared",
		sharedWith: "Shared with",
		routesTitle: "Routes & Views",
		viewsTab: "Views",
		apiRoutesTab: "API Routes",
		path: "Path",
		routeId: "Route ID",
		method: "Method",
		authPolicy: "Auth Policy",
		noViews: "No views registered",
		noApiRoutes: "No API routes registered",
		page: "Page",
		of: "of",
		previous: "Previous",
		next: "Next",
		unknown: "Unknown",
		notAvailable: "N/A",
	},
	fr: {
		lifecycle: {
			available: "Disponible",
			staged: "Préparé",
			installed: "Installé",
			active: "Actif",
			draining: "Arrêt en cours",
			disabled: "Désactivé",
			quarantined: "En quarantaine",
			purged: "Purgé",
		},
		health: {
			ready: "Disponible",
			unavailable: "Indisponible",
			unknown: "Inconnu",
			expired: "Périmé",
		},
		destination: "Destination",
		loading: "Chargement de la configuration et du diagnostic...",
		errorTitle: "Échec du chargement du diagnostic",
		errorDesc: "Une erreur est survenue lors de la récupération des données de diagnostic.",
		retry: "Réessayer",
		disabledTitle: "Plugin désactivé",
		disabledDesc: "Ce plugin est actuellement désactivé dans cet environnement.",
		recheckHealth: "Vérifier à nouveau",
		rechecking: "Vérification...",
		recheckSuccess: "Santé revérifiée avec succès",
		recheckFailed: "Échec de la revérification de la santé",
		lifecycleTitle: "Cycle de vie du plugin",
		state: "État",
		lastChanged: "Dernière modification",
		reason: "Raison",
		artifactChecksum: "Somme de contrôle de l'artefact",
		planId: "ID du plan",
		releaseId: "ID de version",
		configTitle: "Configuration déclarée",
		pluginId: "Identifiant du plugin",
		version: "Version",
		capabilities: "Capacités",
		noCapabilities: "Aucune capacité déclarée",
		failurePolicies: "Politiques d'échec",
		readPolicy: "Lectures",
		writePolicy: "Écritures",
		settingsSchema: "Schéma des paramètres",
		viewSchema: "Voir le schéma",
		hideSchema: "Masquer le schéma",
		noSchema: "Aucun schéma de paramètres déclaré",
		healthTitle: "Santé vérifiée",
		healthStatus: "État de santé",
		checkedAt: "Vérifié à",
		latency: "Latence",
		dependenciesTitle: "Dépendances",
		noDependencies: "Aucune dépendance déclarée",
		dependencyName: "Dépendance",
		kind: "Type",
		proofStatus: "Preuve",
		workersTitle: "Services et Workers associés",
		noWorkers: "Aucun service ou worker trouvé",
		service: "Service",
		workerPhysical: "Worker physique",
		deploymentGroup: "Groupe de déploiement",
		shared: "Partagé",
		sharedWith: "Partagé avec",
		routesTitle: "Routes et Vues",
		viewsTab: "Vues",
		apiRoutesTab: "Routes API",
		path: "Chemin",
		routeId: "ID de route",
		method: "Méthode",
		authPolicy: "Politique d'authentification",
		noViews: "Aucune vue enregistrée",
		noApiRoutes: "Aucune route API enregistrée",
		page: "Page",
		of: "sur",
		previous: "Précédent",
		next: "Suivant",
		unknown: "Inconnu",
		notAvailable: "N/D",
	},
} as const;

function readHealthResult(value: unknown): PluginHealthDiagnostic {
	if (!value || typeof value !== "object") throw new Error("INVALID_HEALTH_RESPONSE");
	return parsePluginHealth("health" in value ? value.health : value);
}

async function readDiagnosticResponse(response: Response, pluginId: string) {
	if (await isDisabledResponse(response)) return null;
	if (!response.ok) throw new Error(`DIAGNOSTIC_HTTP_${response.status}`);
	const diagnostic = parsePluginDiagnostic(await response.json());
	if (diagnostic.pluginId !== diagnosticPluginId(pluginId))
		throw new Error("DIAGNOSTIC_PLUGIN_MISMATCH");
	return diagnostic;
}

function diagnosticPluginId(pluginId: string) {
	return pluginPackage(pluginId)?.directory === pluginId ? pluginId : pluginPackageOwner(pluginId);
}

async function isDisabledResponse(response: Response): Promise<boolean> {
	if (response.status !== 404) return false;
	const body: unknown = await response
		.clone()
		.json()
		.catch(() => null);
	if (!body || typeof body !== "object" || !("error" in body)) return false;
	const error = body.error;
	return Boolean(
		error &&
		typeof error === "object" &&
		"code" in error &&
		(error.code === "PLUGIN_NOT_ACTIVE" || error.code === "PLUGIN_DISABLED"),
	);
}

function resolveLocale(explicitLocale?: string): "en" | "fr" {
	if (explicitLocale?.toLowerCase().startsWith("fr")) return "fr";
	if (explicitLocale?.toLowerCase().startsWith("en")) return "en";
	if (typeof window !== "undefined") {
		const urlParams = new URLSearchParams(window.location.search);
		const langParam = urlParams.get("lang") ?? urlParams.get("locale");
		if (langParam?.toLowerCase().startsWith("fr")) return "fr";
		if (document.documentElement.lang?.toLowerCase().startsWith("fr")) return "fr";
	}
	return "en";
}

function lifecycleBadgeVariant(
	state: PluginLifecycleState,
): "default" | "secondary" | "destructive" | "outline" {
	switch (state) {
		case "active":
			return "default";
		case "disabled":
		case "purged":
		case "quarantined":
			return "destructive";
		case "draining":
		case "staged":
			return "secondary";
		case "available":
		case "installed":
			return "outline";
	}
}

function healthBadgeVariant(
	status: PluginHealthStatus,
): "default" | "secondary" | "destructive" | "outline" {
	switch (status) {
		case "ready":
			return "default";
		case "unknown":
		case "expired":
			return "secondary";
		case "unavailable":
			return "destructive";
		default:
			return "outline";
	}
}

const ITEMS_PER_PAGE = 8;

export function PluginConfigurationTab(props: PluginConfigurationTabProps) {
	const context = useOptionalFrontContext();
	const pluginId = context ? canonicalPluginId(context.pluginId) : props.pluginId;
	if (!pluginId) return <p role="alert">{translations[resolveLocale(props.locale)].errorDesc}</p>;
	return <PluginConfigurationContent key={pluginId} {...props} pluginId={pluginId} />;
}

function PluginConfigurationContent({
	pluginId,
	locale: explicitLocale,
	className,
}: PluginConfigurationTabProps & { pluginId: string }) {
	const currentLocale = resolveLocale(explicitLocale);
	const t = translations[currentLocale];

	const [data, setData] = useState<PluginDiagnosticData | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [isDisabled, setIsDisabled] = useState(false);
	const [rechecking, setRechecking] = useState(false);
	const [showSchema, setShowSchema] = useState(false);

	const [activeRouteTab, setActiveRouteTab] = useState<"views" | "api">("views");
	const [viewsPage, setViewsPage] = useState(1);
	const [apiPage, setApiPage] = useState(1);

	const fetchDiagnostic = useCallback(async () => {
		setLoading(true);
		setError(null);
		setIsDisabled(false);
		try {
			const res = await fetch(
				`/_emdash/api/superboard/plugins/${encodeURIComponent(pluginId)}/diagnostic`,
				{
					headers: {
						"X-EmDash-Request": "1",
					},
				},
			);
			const diagnostic = await readDiagnosticResponse(res, pluginId);
			setIsDisabled(diagnostic === null);
			setData(diagnostic);
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [pluginId]);

	useEffect(() => {
		let active = true;
		fetch(`/_emdash/api/superboard/plugins/${encodeURIComponent(pluginId)}/diagnostic`, {
			headers: { "X-EmDash-Request": "1" },
		})
			.then(async (res) => {
				const diagnostic = await readDiagnosticResponse(res, pluginId);
				if (!active) return;
				setIsDisabled(diagnostic === null);
				setData(diagnostic);
				setError(null);
				setLoading(false);
			})
			.catch((err: unknown) => {
				if (!active) return;
				setError(err instanceof Error ? err.message : String(err));
				setLoading(false);
			});
		return () => {
			active = false;
		};
	}, [pluginId]);

	const handleRecheckHealth = async () => {
		setRechecking(true);
		try {
			const res = await fetch(
				`/_emdash/api/superboard/plugins/${encodeURIComponent(pluginId)}/health`,
				{
					method: "POST",
					headers: {
						"X-EmDash-Request": "1",
					},
				},
			);
			if (!res.ok) {
				throw new Error(`HEALTH_HTTP_${res.status}`);
			}
			const payload: unknown = await res.json();
			const health = readHealthResult(payload);
			if (payload && typeof payload === "object" && "diagnostic" in payload) {
				const refreshed = parsePluginDiagnostic(payload.diagnostic);
				if (
					refreshed.pluginId !== diagnosticPluginId(pluginId) ||
					refreshed.health.status !== health.status ||
					refreshed.health.checkedAt !== health.checkedAt
				)
					throw new Error("INVALID_HEALTH_RESPONSE");
				setData(refreshed);
			} else {
				setData((current) => (current ? { ...current, health } : current));
			}
			if (health.status === "ready") toast.success(t.recheckSuccess);
			else toast.error(t.recheckFailed);
		} catch {
			setData((current) =>
				current
					? {
							...current,
							workers: current.workers.map((worker) => ({
								...worker,
								health: {
									status: "unknown" as const,
									checkedAt: worker.health?.checkedAt ?? null,
									reason: t.recheckFailed,
								},
							})),
							health: {
								status: "unknown",
								checkedAt: current.health?.checkedAt ?? null,
								reason: t.recheckFailed,
							},
						}
					: current,
			);
			toast.error(t.recheckFailed);
		} finally {
			setRechecking(false);
		}
	};

	const paginatedViews = useMemo(() => {
		const all = data?.routes.views ?? [];
		const totalPages = Math.max(1, Math.ceil(all.length / ITEMS_PER_PAGE));
		const page = Math.max(1, Math.min(viewsPage, totalPages));
		const start = (page - 1) * ITEMS_PER_PAGE;
		return {
			page,
			items: all.slice(start, start + ITEMS_PER_PAGE),
			totalPages,
			totalItems: all.length,
		};
	}, [data?.routes.views, viewsPage]);

	const paginatedApiRoutes = useMemo(() => {
		const all = data?.routes.api ?? [];
		const totalPages = Math.max(1, Math.ceil(all.length / ITEMS_PER_PAGE));
		const page = Math.max(1, Math.min(apiPage, totalPages));
		const start = (page - 1) * ITEMS_PER_PAGE;
		return {
			page,
			items: all.slice(start, start + ITEMS_PER_PAGE),
			totalPages,
			totalItems: all.length,
		};
	}, [data?.routes.api, apiPage]);

	if (loading) {
		return (
			<div className="flex flex-col items-center justify-center p-12 text-center" role="status">
				<Spinner className="mb-4 size-8 text-primary" />
				<p className="text-sm text-muted-foreground">{t.loading}</p>
			</div>
		);
	}

	if (isDisabled) {
		return (
			<Card className={className}>
				<CardHeader>
					<CardTitle className="text-destructive">{t.disabledTitle}</CardTitle>
					<CardDescription>{t.disabledDesc}</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	if (error || !data) {
		return (
			<Card className={className}>
				<CardHeader>
					<CardTitle className="text-destructive">{t.errorTitle}</CardTitle>
					<CardDescription>{t.errorDesc}</CardDescription>
				</CardHeader>
				<CardContent>
					<Button
						onClick={() => {
							fetchDiagnostic().catch(() => {
								setError("DIAGNOSTIC_UNAVAILABLE");
							});
						}}
						variant="outline"
					>
						{t.retry}
					</Button>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className={`space-y-6 ${className ?? ""}`}>
			{/* Section 1: Plugin Lifecycle */}
			<Card>
				<CardHeader>
					<CardTitle>{t.lifecycleTitle}</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
						<div>
							<div className="text-xs font-medium text-muted-foreground uppercase">{t.state}</div>
							<div className="mt-1">
								<Badge variant={lifecycleBadgeVariant(data.lifecycle.state)}>
									{t.lifecycle[data.lifecycle.state]}
								</Badge>
							</div>
						</div>
						<div>
							<div className="text-xs font-medium text-muted-foreground uppercase">
								{t.lastChanged}
							</div>
							<div className="mt-1 text-sm font-semibold">
								{data.lifecycle.changedAt
									? new Date(data.lifecycle.changedAt).toLocaleString(currentLocale)
									: t.notAvailable}
							</div>
						</div>
						{data.lifecycle.reason && (
							<div>
								<div className="text-xs font-medium text-muted-foreground uppercase">
									{t.reason}
								</div>
								<div className="mt-1 text-sm">{data.lifecycle.reason}</div>
							</div>
						)}
						<div>
							<div className="text-xs font-medium text-muted-foreground uppercase">
								{t.artifactChecksum}
							</div>
							<div
								className="mt-1 font-mono text-xs truncate"
								title={data.lifecycle.artifactChecksum ?? undefined}
							>
								{data.lifecycle.artifactChecksum ?? t.notAvailable}
							</div>
						</div>
						{data.lifecycle.planId && (
							<div>
								<div className="text-xs font-medium text-muted-foreground uppercase">
									{t.planId}
								</div>
								<div className="mt-1 font-mono text-xs">{data.lifecycle.planId}</div>
							</div>
						)}
						{data.lifecycle.activatedReleaseId && (
							<div>
								<div className="text-xs font-medium text-muted-foreground uppercase">
									{t.releaseId}
								</div>
								<div className="mt-1 font-mono text-xs">{data.lifecycle.activatedReleaseId}</div>
							</div>
						)}
					</div>
				</CardContent>
			</Card>

			{/* Section 2: Declared Configuration */}
			<Card>
				<CardHeader>
					<CardTitle>{t.configTitle}</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div>
							<div className="text-xs font-medium text-muted-foreground uppercase">
								{t.pluginId}
							</div>
							<div className="mt-1 font-mono text-sm">{data.configuration.pluginId}</div>
						</div>
						<div>
							<div className="text-xs font-medium text-muted-foreground uppercase">{t.version}</div>
							<div className="mt-1 text-sm font-semibold">{data.configuration.version}</div>
						</div>
					</div>

					<div>
						<div className="text-xs font-medium text-muted-foreground uppercase">
							{t.capabilities}
						</div>
						<div className="mt-1 flex flex-wrap gap-1">
							{data.configuration.capabilities.length > 0 ? (
								data.configuration.capabilities.map((cap) => (
									<Badge key={cap} variant="secondary">
										{cap}
									</Badge>
								))
							) : (
								<span className="text-sm text-muted-foreground">{t.noCapabilities}</span>
							)}
						</div>
					</div>

					<div>
						<div className="text-xs font-medium text-muted-foreground uppercase">
							{t.failurePolicies}
						</div>
						<div className="mt-1 flex gap-4 text-sm">
							<div>
								<span className="text-muted-foreground">{t.readPolicy}: </span>
								<span className="font-medium">{data.configuration.failurePolicies.reads}</span>
							</div>
							<div>
								<span className="text-muted-foreground">{t.writePolicy}: </span>
								<span className="font-medium">{data.configuration.failurePolicies.writes}</span>
							</div>
						</div>
					</div>

					{data.configuration.settingsSchema && (
						<div>
							<div className="flex items-center justify-between">
								<div className="text-xs font-medium text-muted-foreground uppercase">
									{t.settingsSchema}
								</div>
								<Button
									variant="ghost"
									size="sm"
									onClick={() => {
										setShowSchema(!showSchema);
									}}
								>
									{showSchema ? t.hideSchema : t.viewSchema}
								</Button>
							</div>
							{showSchema && (
								<pre className="mt-2 max-h-60 overflow-auto rounded bg-muted p-3 font-mono text-xs">
									{JSON.stringify(data.configuration.settingsSchema, null, 2)}
								</pre>
							)}
						</div>
					)}
				</CardContent>
			</Card>

			{/* Section 3: Verified Health */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0">
					<div>
						<CardTitle>{t.healthTitle}</CardTitle>
					</div>
					<Button
						onClick={() => {
							handleRecheckHealth().catch(() => {
								toast.error(t.recheckFailed);
							});
						}}
						disabled={rechecking}
						variant="outline"
						size="sm"
					>
						{rechecking && <Spinner className="me-2 size-4" />}
						{rechecking ? t.rechecking : t.recheckHealth}
					</Button>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
						<div>
							<div className="text-xs font-medium text-muted-foreground uppercase">
								{t.healthStatus}
							</div>
							<div className="mt-1">
								<Badge variant={healthBadgeVariant(data.health.status)}>
									{t.health[data.health.status]}
								</Badge>
							</div>
						</div>
						<div>
							<div className="text-xs font-medium text-muted-foreground uppercase">
								{t.checkedAt}
							</div>
							<div className="mt-1 text-sm font-semibold">
								{data.health.checkedAt
									? new Date(data.health.checkedAt).toLocaleString(currentLocale)
									: t.notAvailable}
							</div>
						</div>
						{data.health.reason && (
							<div>
								<div className="text-xs font-medium text-muted-foreground uppercase">
									{t.reason}
								</div>
								<div className="mt-1 text-sm font-semibold">{data.health.reason}</div>
							</div>
						)}
					</div>
					{data.health.status !== "ready" && data.health.reason && (
						<div className="rounded bg-destructive/10 p-3 text-sm text-destructive">
							{data.health.reason}
						</div>
					)}
				</CardContent>
			</Card>

			{/* Section 4: Dependencies */}
			<Card>
				<CardHeader>
					<CardTitle>{t.dependenciesTitle}</CardTitle>
				</CardHeader>
				<CardContent>
					{data.dependencies.length === 0 ? (
						<p className="text-sm text-muted-foreground">{t.noDependencies}</p>
					) : (
						<Table aria-label={t.dependenciesTitle}>
							<TableHeader>
								<TableRow>
									<TableHead>{t.dependencyName}</TableHead>
									<TableHead>{t.healthStatus}</TableHead>
									<TableHead>{t.checkedAt}</TableHead>
									<TableHead>{t.proofStatus}</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{data.dependencies.map((dep: PluginDependencyDiagnostic) => (
									<TableRow key={dep.id}>
										<TableCell className="font-mono text-sm">{dep.id}</TableCell>
										<TableCell>
											<Badge variant={healthBadgeVariant(dep.status)}>{t.health[dep.status]}</Badge>
										</TableCell>
										<TableCell className="text-sm text-muted-foreground">
											{dep.checkedAt
												? new Date(dep.checkedAt).toLocaleString(currentLocale)
												: t.notAvailable}
										</TableCell>
										<TableCell className="text-sm text-muted-foreground">
											{dep.expiresAt
												? new Date(dep.expiresAt).toLocaleString(currentLocale)
												: t.notAvailable}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			{/* Section 5: Associated Services & Workers */}
			<Card>
				<CardHeader>
					<CardTitle>{t.workersTitle}</CardTitle>
				</CardHeader>
				<CardContent>
					{data.workers.length === 0 ? (
						<p className="text-sm text-muted-foreground">{t.noWorkers}</p>
					) : (
						<Table aria-label={t.workersTitle}>
							<TableHeader>
								<TableRow>
									<TableHead>{t.service}</TableHead>
									<TableHead>{t.workerPhysical}</TableHead>
									<TableHead>{t.deploymentGroup}</TableHead>
									<TableHead>{t.healthStatus}</TableHead>
									<TableHead>{t.checkedAt}</TableHead>
									<TableHead>{t.shared}</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{data.workers.map((w) => (
									<TableRow key={w.service}>
										<TableCell className="font-semibold">{w.service}</TableCell>
										<TableCell className="font-mono text-sm">
											{w.physicalName ?? t.unknown}
										</TableCell>
										<TableCell className="text-sm text-muted-foreground">
											{w.deploymentGroup}
										</TableCell>
										<TableCell>
											<Badge
												variant={healthBadgeVariant(w.health?.status ?? "unknown")}
												title={w.health?.reason ?? undefined}
											>
												{t.health[w.health?.status ?? "unknown"]}
											</Badge>
										</TableCell>
										<TableCell>
											{w.health?.checkedAt ? (
												<time dateTime={w.health.checkedAt}>
													{new Date(w.health.checkedAt).toLocaleString(currentLocale)}
												</time>
											) : (
												t.notAvailable
											)}
										</TableCell>
										<TableCell>
											{w.isShared ? (
												<div className="flex items-center gap-1.5">
													<Badge variant="secondary">{t.shared}</Badge>
													{w.sharedWith.length > 0 && (
														<span className="text-xs text-muted-foreground">
															({w.sharedWith.join(", ")})
														</span>
													)}
												</div>
											) : (
												<span className="text-xs text-muted-foreground">{t.notAvailable}</span>
											)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			{/* Section 6: Routes (Views & API Routes) */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0">
					<CardTitle>{t.routesTitle}</CardTitle>
					<div className="flex gap-2">
						<Button
							variant={activeRouteTab === "views" ? "default" : "outline"}
							size="sm"
							onClick={() => {
								setActiveRouteTab("views");
							}}
						>
							{t.viewsTab} ({data.routes.views.length})
						</Button>
						<Button
							variant={activeRouteTab === "api" ? "default" : "outline"}
							size="sm"
							onClick={() => {
								setActiveRouteTab("api");
							}}
						>
							{t.apiRoutesTab} ({data.routes.api.length})
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					{activeRouteTab === "views" ? (
						paginatedViews.items.length === 0 ? (
							<p className="text-sm text-muted-foreground">{t.noViews}</p>
						) : (
							<div>
								<Table aria-label={t.viewsTab}>
									<TableHeader>
										<TableRow>
											<TableHead>{t.path}</TableHead>
											<TableHead>{t.method}</TableHead>
											<TableHead>{t.routeId}</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{paginatedViews.items.map((v) => (
											<TableRow key={v.routeId + v.path}>
												<TableCell className="font-mono text-sm">{v.path}</TableCell>
												<TableCell>
													<Badge variant="outline">{v.method}</Badge>
												</TableCell>
												<TableCell className="font-mono text-xs text-muted-foreground">
													{v.routeId}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
								{paginatedViews.totalPages > 1 && (
									<div className="mt-4 flex items-center justify-between text-sm">
										<span className="text-muted-foreground">
											{t.page} {paginatedViews.page} {t.of} {paginatedViews.totalPages}
										</span>
										<div className="flex gap-2">
											<Button
												variant="outline"
												size="sm"
												disabled={paginatedViews.page <= 1}
												onClick={() => {
													setViewsPage(Math.max(1, paginatedViews.page - 1));
												}}
											>
												{t.previous}
											</Button>
											<Button
												variant="outline"
												size="sm"
												disabled={paginatedViews.page >= paginatedViews.totalPages}
												onClick={() => {
													setViewsPage(
														Math.min(paginatedViews.totalPages, paginatedViews.page + 1),
													);
												}}
											>
												{t.next}
											</Button>
										</div>
									</div>
								)}
							</div>
						)
					) : paginatedApiRoutes.items.length === 0 ? (
						<p className="text-sm text-muted-foreground">{t.noApiRoutes}</p>
					) : (
						<div>
							<Table aria-label={t.apiRoutesTab}>
								<TableHeader>
									<TableRow>
										<TableHead>{t.method}</TableHead>
										<TableHead>{t.path}</TableHead>
										<TableHead>{t.service}</TableHead>
										<TableHead>{t.destination}</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{paginatedApiRoutes.items.map((r: PluginRouteApiDiagnostic) => (
										<TableRow key={`${r.method}-${r.path}-${r.worker ?? ""}-${r.surface ?? ""}`}>
											<TableCell>
												<Badge
													variant={
														r.method === "GET"
															? "outline"
															: r.method === "POST"
																? "default"
																: "secondary"
													}
												>
													{r.method}
												</Badge>
											</TableCell>
											<TableCell className="font-mono text-sm">{r.path}</TableCell>
											<TableCell className="text-xs text-muted-foreground">
												{r.worker ?? t.unknown}
											</TableCell>
											<TableCell className="font-mono text-xs">{r.url ?? t.unknown}</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
							{paginatedApiRoutes.totalPages > 1 && (
								<div className="mt-4 flex items-center justify-between text-sm">
									<span className="text-muted-foreground">
										{t.page} {paginatedApiRoutes.page} {t.of} {paginatedApiRoutes.totalPages}
									</span>
									<div className="flex gap-2">
										<Button
											variant="outline"
											size="sm"
											disabled={paginatedApiRoutes.page <= 1}
											onClick={() => {
												setApiPage(Math.max(1, paginatedApiRoutes.page - 1));
											}}
										>
											{t.previous}
										</Button>
										<Button
											variant="outline"
											size="sm"
											disabled={paginatedApiRoutes.page >= paginatedApiRoutes.totalPages}
											onClick={() => {
												setApiPage(
													Math.min(paginatedApiRoutes.totalPages, paginatedApiRoutes.page + 1),
												);
											}}
										>
											{t.next}
										</Button>
									</div>
								</div>
							)}
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
