"use client";

import {
	Activity,
	AlertTriangle,
	AppWindow,
	BellRing,
	CheckCircle2,
	Clock3,
	Gauge,
	Globe2,
	LayoutDashboard,
	MapPin,
	MonitorSmartphone,
	Plus,
	RefreshCw,
	Save,
	ShieldCheck,
	Star,
	Trash2,
	Webhook,
	Wifi,
	XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import {
	EmptyProject,
	ModulePage,
	moduleErrorMessage,
} from "../../../../../../supbrd-front-ui/src/shared/components/modules/ModulePage.js";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "../../../../../../supbrd-front-ui/src/shared/components/ui/alert.js";
import { Badge } from "../../../../../../supbrd-front-ui/src/shared/components/ui/badge.js";
import { Button } from "../../../../../../supbrd-front-ui/src/shared/components/ui/button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../../../../../../supbrd-front-ui/src/shared/components/ui/card.js";
import { Input } from "../../../../../../supbrd-front-ui/src/shared/components/ui/input.js";
import { Label } from "../../../../../../supbrd-front-ui/src/shared/components/ui/label.js";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../../../../../../supbrd-front-ui/src/shared/components/ui/select.js";
import { Switch } from "../../../../../../supbrd-front-ui/src/shared/components/ui/switch.js";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "../../../../../../supbrd-front-ui/src/shared/components/ui/tabs.js";
import { useProjectSelection } from "../../../../../../supbrd-front-ui/src/shared/context/useProjectSelection.js";
import {
	showErrorNotification,
	showSuccessNotification,
} from "../../../../../../supbrd-front-ui/src/shared/lib/Notifications.js";
import {
	createAnalyticsAlert,
	createAnalyticsAnnotation,
	createAnalyticsCohort,
	createAnalyticsDashboard,
	createAnalyticsDashboardWidget,
	createAnalyticsHook,
	deleteAnalyticsAlert,
	deleteAnalyticsAnnotation,
	deleteAnalyticsCohort,
	deleteAnalyticsDashboard,
	deleteAnalyticsDashboardWidget,
	deleteAnalyticsHook,
	deleteAnalyticsRemoteConfig,
	evaluateAnalyticsCohort,
	getAnalyticsAlerts,
	getAnalyticsAnnotations,
	getAnalyticsApplications,
	getAnalyticsCohorts,
	getAnalyticsCrash,
	getAnalyticsCrashes,
	getAnalyticsDashboard,
	getAnalyticsDashboards,
	getAnalyticsDimensions,
	getAnalyticsFeedback,
	getAnalyticsHooks,
	getAnalyticsProfiles,
	getAnalyticsRemoteConfig,
	getAnalyticsSessions,
	getAnalyticsSettings,
	getAnalyticsViews,
	updateAnalyticsAlertIncident,
	updateAnalyticsApplication,
	updateAnalyticsCrash,
	updateAnalyticsSettings,
	upsertAnalyticsRemoteConfig,
	type AnalyticsAlert,
	type AnalyticsAlertIncident,
	type AnalyticsAnnotation,
	type AnalyticsApplication,
	type AnalyticsCohort,
	type AnalyticsCrash,
	type AnalyticsDashboard,
	type AnalyticsDashboardWidget,
	type AnalyticsDimensionValue,
	type AnalyticsFeedback,
	type AnalyticsHook,
	type AnalyticsProfile,
	type AnalyticsRemoteConfig,
	type AnalyticsSession,
	type AnalyticsSettings,
	type AnalyticsView,
} from "../../api/analytics/analyticsService.js";
import { useAnalyticsI18n } from "./analytics-i18n.js";

const range30Days = () => {
	const to = new Date();
	return {
		from: new Date(to.getTime() - 29 * 86_400_000).toISOString(),
		to: to.toISOString(),
	};
};

export function AnalyticsDashboardsPage() {
	const { t, locale } = useAnalyticsI18n();
	const { selectedProject } = useProjectSelection();
	const [items, setItems] = useState<AnalyticsDashboard[]>([]);
	const [selected, setSelected] = useState<AnalyticsDashboard | null>(null);
	const [name, setName] = useState("");
	const [widgetTitle, setWidgetTitle] = useState("");
	const [widgetType, setWidgetType] = useState<AnalyticsDashboardWidget["widget_type"]>("metric");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const load = useCallback(async () => {
		if (!selectedProject) return;
		try {
			const dashboards = await getAnalyticsDashboards(selectedProject.id);
			setItems(dashboards.items);
			const wanted = selected?.id ?? dashboards.items[0]?.id;
			setSelected(wanted ? await getAnalyticsDashboard(selectedProject.id, wanted) : null);
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause, locale));
		}
	}, [selected?.id, selectedProject, locale]);
	useEffect(() => void load(), [load]);

	const mutate = async (action: () => Promise<unknown>, message: string) => {
		setBusy(true);
		try {
			await action();
			showSuccessNotification(message);
			await load();
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		} finally {
			setBusy(false);
		}
	};

	return (
		<ModulePage
			title={t("Dashboards")}
			description={t(
				"Build project dashboards from reusable product, revenue, stability and audience widgets.",
			)}
			error={error}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
					<Card className="h-fit">
						<CardHeader>
							<CardTitle className="text-base">{t("Your dashboards")}</CardTitle>
							<CardDescription>{t("Private or shared with this project.")}</CardDescription>
						</CardHeader>
						<CardContent className="space-y-3">
							<div className="flex gap-2">
								<Input
									value={name}
									onChange={(event) => setName(event.target.value)}
									placeholder={t("Product pulse")}
								/>
								<Button
									size="icon"
									disabled={busy || !name.trim()}
									aria-label={t("Create dashboard")}
									onClick={() =>
										void mutate(async () => {
											const created = await createAnalyticsDashboard(selectedProject.id, {
												name: name.trim(),
												visibility: "project",
												description: t("Shared analytics dashboard"),
												layout: { columns: 12 },
											});
											setName("");
											setSelected(created);
										}, t("Dashboard created"))
									}
								>
									<Plus className="size-4" />
								</Button>
							</div>
							<div className="space-y-1">
								{items.map((dashboard) => (
									<button
										type="button"
										key={dashboard.id}
										className={`w-full rounded-lg border px-3 py-2.5 text-start transition-colors ${
											selected?.id === dashboard.id
												? "border-primary bg-primary/5"
												: "hover:bg-muted/60"
										}`}
										onClick={() =>
											void getAnalyticsDashboard(selectedProject.id, dashboard.id)
												.then(setSelected)
												.catch((cause: unknown) =>
													showErrorNotification(moduleErrorMessage(cause, locale)),
												)
										}
									>
										<span className="block truncate font-medium">{dashboard.name}</span>
										<span className="text-xs text-muted-foreground">
											{t("Widget count", { count: dashboard.widget_count ?? 0 })} ·{" "}
											{t(labelize(dashboard.visibility))}
										</span>
									</button>
								))}
								{!items.length && (
									<EmptyState compact>{t("Create your first dashboard.")}</EmptyState>
								)}
							</div>
						</CardContent>
					</Card>

					{selected ? (
						<div className="space-y-5">
							<Card>
								<CardHeader className="flex-row items-start justify-between gap-4">
									<div>
										<CardTitle>{selected.name}</CardTitle>
										<CardDescription>
											{selected.description || t("Custom analytics workspace")}
										</CardDescription>
									</div>
									<Button
										variant="ghost"
										size="icon"
										aria-label={t("Delete dashboard")}
										disabled={busy}
										onClick={() =>
											void mutate(async () => {
												await deleteAnalyticsDashboard(selectedProject.id, selected.id);
												setSelected(null);
											}, t("Dashboard deleted"))
										}
									>
										<Trash2 className="size-4" />
									</Button>
								</CardHeader>
								<CardContent className="grid gap-3 md:grid-cols-[180px_1fr_auto]">
									<Select
										value={widgetType}
										onValueChange={(value) =>
											setWidgetType(value as AnalyticsDashboardWidget["widget_type"])
										}
									>
										<SelectTrigger aria-label={t("Widget type")}>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{[
												"metric",
												"timeseries",
												"event",
												"funnel",
												"retention",
												"table",
												"map",
												"crashes",
												"views",
												"purchases",
												"installations",
											].map((type) => (
												<SelectItem key={type} value={type}>
													{t(labelize(type))}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<Input
										value={widgetTitle}
										onChange={(event) => setWidgetTitle(event.target.value)}
										placeholder={t("Widget title")}
									/>
									<Button
										disabled={busy || !widgetTitle.trim()}
										onClick={() =>
											void mutate(async () => {
												await createAnalyticsDashboardWidget(selectedProject.id, selected.id, {
													widget_type: widgetType,
													title: widgetTitle.trim(),
													definition: { range_days: 30 },
													position: { width: 6, height: 3 },
												});
												setWidgetTitle("");
											}, t("Widget added"))
										}
									>
										<Plus className="size-4" />
										{t("Add widget")}
									</Button>
								</CardContent>
							</Card>
							<div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
								{(selected.widgets ?? []).map((widget) => (
									<Card key={widget.id} className="min-h-44">
										<CardHeader className="flex-row items-start justify-between gap-3">
											<div>
												<Badge variant="outline">{t(labelize(widget.widget_type))}</Badge>
												<CardTitle className="mt-3 text-base">{widget.title}</CardTitle>
											</div>
											<Button
												variant="ghost"
												size="icon"
												aria-label={t("Delete item", { name: widget.title })}
												onClick={() =>
													void mutate(
														() =>
															deleteAnalyticsDashboardWidget(
																selectedProject.id,
																selected.id,
																widget.id,
															),
														t("Widget deleted"),
													)
												}
											>
												<Trash2 className="size-4" />
											</Button>
										</CardHeader>
										<CardContent>
											<WidgetPreview type={widget.widget_type} />
										</CardContent>
									</Card>
								))}
							</div>
							{!selected.widgets?.length && (
								<EmptyState>
									{t("Add widgets above to reproduce the dashboard workflow with SuperBoard data.")}
								</EmptyState>
							)}
						</div>
					) : (
						<EmptyState>{t("Select or create a dashboard.")}</EmptyState>
					)}
				</div>
			)}
		</ModulePage>
	);
}

export function AnalyticsUsersPage() {
	const { t, locale } = useAnalyticsI18n();
	const { selectedProject } = useProjectSelection();
	const range = useMemo(() => range30Days(), []);
	const [sessions, setSessions] = useState<AnalyticsSession[]>([]);
	const [profiles, setProfiles] = useState<AnalyticsProfile[]>([]);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		if (!selectedProject) return;
		void Promise.all([
			getAnalyticsSessions(selectedProject.id, range),
			getAnalyticsProfiles(selectedProject.id),
		])
			.then(([sessionData, profileData]) => {
				setSessions(sessionData.items);
				setProfiles(profileData.items);
				setError(null);
			})
			.catch((cause: unknown) => setError(moduleErrorMessage(cause, locale)));
	}, [range, selectedProject, locale]);
	return (
		<ModulePage
			title={t("Users & sessions")}
			description={t(
				"Explore pseudonymized profiles and session timelines without exposing raw SDK identifiers.",
			)}
			error={error}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<Tabs defaultValue="sessions" className="space-y-4">
					<TabsList>
						<TabsTrigger value="sessions">{t("Sessions")}</TabsTrigger>
						<TabsTrigger value="profiles">{t("User profiles")}</TabsTrigger>
					</TabsList>
					<TabsContent value="sessions">
						<Card>
							<CardHeader>
								<CardTitle>{t("Recent sessions")}</CardTitle>
								<CardDescription>
									{t("Session duration and event depth over the last 30 days.")}
								</CardDescription>
							</CardHeader>
							<CardContent>
								<FeatureTable
									columns={[
										t("Started"),
										t("Application"),
										t("Platform"),
										t("Events"),
										t("Duration"),
										t("Profile"),
									]}
									empty={t("No sessions in this period.")}
								>
									{sessions.map((session) => (
										<tr key={session.id} className="border-b last:border-0">
											<Cell>{date(session.started_at, locale)}</Cell>
											<Cell>{session.application_id}</Cell>
											<Cell>{session.platform || "—"}</Cell>
											<Cell>{numberFormat(session.event_count, locale)}</Cell>
											<Cell>{duration(session.duration_seconds, locale)}</Cell>
											<Cell mono>{shortId(session.profile_id)}</Cell>
										</tr>
									))}
								</FeatureTable>
							</CardContent>
						</Card>
					</TabsContent>
					<TabsContent value="profiles">
						<Card>
							<CardHeader>
								<CardTitle>{t("Pseudonymized profiles")}</CardTitle>
								<CardDescription>
									{t("Identity aliases are hashed before they reach Analytics.")}
								</CardDescription>
							</CardHeader>
							<CardContent>
								<FeatureTable
									columns={[t("Last seen"), t("Application"), t("Profile"), t("Properties")]}
									empty={t("No profiles have been resolved yet.")}
								>
									{profiles.map((profile) => (
										<tr key={profile.id} className="border-b last:border-0">
											<Cell>{date(profile.last_seen_at, locale)}</Cell>
											<Cell>{profile.application_id}</Cell>
											<Cell mono>{shortId(profile.id)}</Cell>
											<Cell>
												<code className="block max-w-80 truncate text-xs">
													{JSON.stringify(profile.properties)}
												</code>
											</Cell>
										</tr>
									))}
								</FeatureTable>
							</CardContent>
						</Card>
					</TabsContent>
				</Tabs>
			)}
		</ModulePage>
	);
}

export function AnalyticsViewsPage() {
	const { t, locale } = useAnalyticsI18n();
	const { selectedProject } = useProjectSelection();
	const range = useMemo(() => range30Days(), []);
	const [items, setItems] = useState<AnalyticsView[]>([]);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		if (!selectedProject) return;
		void getAnalyticsViews(selectedProject.id, range)
			.then((result) => {
				setItems(result.items);
				setError(null);
			})
			.catch((cause: unknown) => setError(moduleErrorMessage(cause, locale)));
	}, [range, selectedProject, locale]);
	const total = items.reduce((sum, item) => sum + Number(item.views), 0);
	return (
		<ModulePage
			title={t("Views")}
			description={t(
				"Page and screen performance, visit depth and time spent across web and mobile applications.",
			)}
			error={error}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<div className="space-y-5">
					<div className="grid gap-4 md:grid-cols-3">
						<FeatureMetric icon={AppWindow} label={t("Tracked views")} value={total} />
						<FeatureMetric icon={Globe2} label={t("Unique screens")} value={items.length} />
						<FeatureMetric
							icon={Clock3}
							label={t("Average time")}
							text={duration(
								Math.round(
									items.reduce((sum, item) => sum + Number(item.average_duration_seconds), 0) /
										Math.max(1, items.length),
								),
								locale,
							)}
						/>
					</div>
					<Card>
						<CardHeader>
							<CardTitle>{t("Top views")}</CardTitle>
							<CardDescription>{t("Last 30 days, ordered by volume.")}</CardDescription>
						</CardHeader>
						<CardContent>
							<FeatureTable
								columns={[
									t("View"),
									t("URL"),
									t("Views"),
									t("Sessions"),
									t("Avg. time"),
									t("Last seen"),
								]}
								empty={t(
									"Send view.opened, screen.viewed or [CLY]_view events to populate this report.",
								)}
							>
								{items.map((item) => (
									<tr key={item.view_name} className="border-b last:border-0">
										<Cell strong>{item.view_name}</Cell>
										<Cell mono>{item.view_url || "—"}</Cell>
										<Cell>{numberFormat(item.views, locale)}</Cell>
										<Cell>{numberFormat(item.sessions, locale)}</Cell>
										<Cell>{duration(item.average_duration_seconds, locale)}</Cell>
										<Cell>{date(item.last_seen_at, locale)}</Cell>
									</tr>
								))}
							</FeatureTable>
						</CardContent>
					</Card>
				</div>
			)}
		</ModulePage>
	);
}

export function AnalyticsDimensionsPage() {
	const { t, locale } = useAnalyticsI18n();
	const { selectedProject } = useProjectSelection();
	const range = useMemo(() => range30Days(), []);
	const [dimensions, setDimensions] = useState<Record<string, AnalyticsDimensionValue[]>>({});
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		if (!selectedProject) return;
		void getAnalyticsDimensions(selectedProject.id, range)
			.then((result) => {
				setDimensions(result.dimensions);
				setError(null);
			})
			.catch((cause: unknown) => setError(moduleErrorMessage(cause, locale)));
	}, [range, selectedProject, locale]);
	const groups = [
		{
			title: t("Platforms & versions"),
			icon: MonitorSmartphone,
			keys: ["platform", "app_version", "os_version", "device", "device_type"],
		},
		{
			title: t("Web technology"),
			icon: Globe2,
			keys: ["browser", "browser_version", "screen_resolution"],
		},
		{
			title: t("Locations"),
			icon: MapPin,
			keys: ["country_code", "city", "carrier"],
		},
		{
			title: t("Acquisition & connection"),
			icon: Wifi,
			keys: ["connection_type", "campaign", "acquisition_source"],
		},
	];
	return (
		<ModulePage
			title={t("Technology & location")}
			description={t(
				"Compare application versions, devices, browsers, countries, carriers and acquisition context.",
			)}
			error={error}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<div className="grid gap-5 xl:grid-cols-2">
					{groups.map(({ title, icon: Icon, keys }) => (
						<Card key={title}>
							<CardHeader>
								<CardTitle className="flex items-center gap-2 text-base">
									<Icon className="size-5 text-primary" /> {title}
								</CardTitle>
								<CardDescription>{t("Top values over the last 30 days.")}</CardDescription>
							</CardHeader>
							<CardContent>
								<Tabs defaultValue={keys[0]}>
									<TabsList className="h-auto flex-wrap">
										{keys.map((key) => (
											<TabsTrigger key={key} value={key}>
												{t(labelize(key))}
											</TabsTrigger>
										))}
									</TabsList>
									{keys.map((key) => (
										<TabsContent key={key} value={key} className="space-y-2 pt-2">
											{(dimensions[key] ?? []).slice(0, 10).map((item, index) => {
												const maximum = Number(dimensions[key]?.[0]?.events ?? 1);
												return (
													<div key={item.value} className="space-y-1.5">
														<div className="flex items-center justify-between gap-3 text-sm">
															<span className="truncate">
																<span className="me-2 text-xs text-muted-foreground">
																	{index + 1}
																</span>
																{item.value}
															</span>
															<span className="shrink-0 tabular-nums text-muted-foreground">
																{t("User count", { count: item.users })} ·{" "}
																{t("Event count", { count: item.events })}
															</span>
														</div>
														<div className="h-1.5 overflow-hidden rounded-full bg-muted">
															<div
																className="h-full rounded-full bg-primary"
																style={{
																	width: `${Math.max(2, (Number(item.events) / maximum) * 100)}%`,
																}}
															/>
														</div>
													</div>
												);
											})}
											{!dimensions[key]?.length && (
												<EmptyState compact>
													{t("Dimension empty", { dimension: t(labelize(key)) })}
												</EmptyState>
											)}
										</TabsContent>
									))}
								</Tabs>
							</CardContent>
						</Card>
					))}
				</div>
			)}
		</ModulePage>
	);
}

export function AnalyticsCrashesPage() {
	const { t, locale } = useAnalyticsI18n();
	const { selectedProject } = useProjectSelection();
	const [items, setItems] = useState<AnalyticsCrash[]>([]);
	const [selected, setSelected] = useState<AnalyticsCrash | null>(null);
	const [status, setStatus] = useState("open");
	const [error, setError] = useState<string | null>(null);
	const load = useCallback(async () => {
		if (!selectedProject) return;
		try {
			const result = await getAnalyticsCrashes(selectedProject.id, {
				resolved: status === "all" ? undefined : String(status === "resolved"),
			});
			setItems(result.items);
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause, locale));
		}
	}, [selectedProject, status, locale]);
	useEffect(() => void load(), [load]);
	const open = async (item: AnalyticsCrash) => {
		if (!selectedProject) return;
		try {
			setSelected(await getAnalyticsCrash(selectedProject.id, item.fingerprint));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		}
	};
	const resolve = async (resolved: boolean) => {
		if (!selectedProject || !selected) return;
		try {
			await updateAnalyticsCrash(selectedProject.id, selected.fingerprint, {
				resolved,
			});
			showSuccessNotification(resolved ? t("Crash resolved") : t("Crash reopened"));
			setSelected(null);
			await load();
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		}
	};
	return (
		<ModulePage
			title={t("Crashes")}
			description={t(
				"Group recurring errors by deterministic fingerprint, inspect occurrences and manage resolution.",
			)}
			error={error}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
					<Card>
						<CardHeader className="flex-row items-center justify-between gap-4">
							<div>
								<CardTitle>{t("Crash groups")}</CardTitle>
								<CardDescription>{t("Fatal and non-fatal SDK reports.")}</CardDescription>
							</div>
							<Select value={status} onValueChange={setStatus}>
								<SelectTrigger className="w-36" aria-label={t("Crash status")}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="open">{t("Open")}</SelectItem>
									<SelectItem value="resolved">{t("Resolved")}</SelectItem>
									<SelectItem value="all">{t("All")}</SelectItem>
								</SelectContent>
							</Select>
						</CardHeader>
						<CardContent>
							<FeatureTable
								columns={[t("Crash"), t("Impact"), t("Version"), t("Last seen"), t("Status")]}
								empty={t("No crash groups match this filter.")}
							>
								{items.map((item) => (
									<tr
										key={`${item.application_id}:${item.fingerprint}`}
										className="cursor-pointer border-b hover:bg-muted/40 last:border-0"
										onClick={() => void open(item)}
									>
										<Cell>
											<div className="flex items-center gap-2 font-medium">
												{item.fatal && <AlertTriangle className="size-4 text-destructive" />}
												{item.title}
											</div>
											<div className="font-mono text-xs text-muted-foreground">
												{shortId(item.fingerprint)}
											</div>
										</Cell>
										<Cell>
											{t("Occurrences count", { count: item.occurrence_count })} ·{" "}
											{t("User count", { count: item.affected_profiles })}
										</Cell>
										<Cell>{item.last_app_version || "—"}</Cell>
										<Cell>{date(item.last_seen_at, locale)}</Cell>
										<Cell>
											<StatusBadge ok={item.resolved} okText={t("Resolved")} badText={t("Open")} />
										</Cell>
									</tr>
								))}
							</FeatureTable>
						</CardContent>
					</Card>
					<Card className="h-fit xl:sticky xl:top-5">
						<CardHeader>
							<CardTitle className="text-base">{selected?.title || t("Crash details")}</CardTitle>
							<CardDescription>
								{selected
									? t("Occurrences since", {
											count: selected.occurrence_count,
											date: date(selected.first_seen_at, locale),
										})
									: t("Select a group to inspect its latest stack traces.")}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							{selected ? (
								<>
									<div className="flex flex-wrap gap-2">
										<Badge variant="outline">
											{selected.last_platform || t("unknown platform")}
										</Badge>
										<Badge variant="outline">
											{selected.last_app_version || t("unknown version")}
										</Badge>
										{selected.fatal && <Badge variant="destructive">{t("Fatal")}</Badge>}
									</div>
									{(selected.occurrences ?? []).slice(0, 5).map((occurrence) => (
										<div key={occurrence.id} className="rounded-lg border p-3">
											<div className="text-xs text-muted-foreground">
												{date(occurrence.occurred_at, locale)}
											</div>
											<div className="mt-1 text-sm">{occurrence.message || selected.title}</div>
											{occurrence.stack && (
												<pre className="mt-2 max-h-32 overflow-auto rounded bg-muted p-2 text-xs">
													{occurrence.stack}
												</pre>
											)}
										</div>
									))}
									<Button className="w-full" onClick={() => void resolve(!selected.resolved)}>
										{selected.resolved ? (
											<RefreshCw className="size-4" />
										) : (
											<CheckCircle2 className="size-4" />
										)}
										{selected.resolved ? t("Reopen group") : t("Mark as resolved")}
									</Button>
								</>
							) : (
								<EmptyState compact>{t("No crash selected.")}</EmptyState>
							)}
						</CardContent>
					</Card>
				</div>
			)}
		</ModulePage>
	);
}

export function AnalyticsFeedbackPage() {
	const { t, locale } = useAnalyticsI18n();
	const { selectedProject } = useProjectSelection();
	const [items, setItems] = useState<AnalyticsFeedback[]>([]);
	const [summary, setSummary] = useState({
		responses: 0,
		average_rating: null as number | null,
		positive: 0,
		negative: 0,
	});
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		if (!selectedProject) return;
		void getAnalyticsFeedback(selectedProject.id)
			.then((result) => {
				setItems(result.items);
				setSummary(result.summary);
				setError(null);
			})
			.catch((cause: unknown) => setError(moduleErrorMessage(cause, locale)));
	}, [selectedProject, locale]);
	return (
		<ModulePage
			title={t("Feedback")}
			description={t(
				"Review star ratings and written feedback captured from web and mobile experiences.",
			)}
			error={error}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<div className="space-y-5">
					<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
						<FeatureMetric
							icon={Star}
							label={t("Average rating")}
							text={
								summary.average_rating == null
									? "—"
									: `${numberFormat(summary.average_rating, locale)} / 5`
							}
						/>
						<FeatureMetric icon={Activity} label={t("Responses")} value={summary.responses} />
						<FeatureMetric icon={CheckCircle2} label={t("Positive")} value={summary.positive} />
						<FeatureMetric icon={XCircle} label={t("Critical")} value={summary.negative} />
					</div>
					<Card>
						<CardHeader>
							<CardTitle>{t("Recent responses")}</CardTitle>
							<CardDescription>Ratings of 4–5 are positive; 1–2 require attention.</CardDescription>
						</CardHeader>
						<CardContent>
							<FeatureTable
								columns={[t("Rating"), t("Comment"), t("Application"), t("Widget"), t("Submitted")]}
								empty={t("No feedback has been submitted yet.")}
							>
								{items.map((item) => (
									<tr key={item.id} className="border-b last:border-0">
										<Cell>
											<span className="inline-flex items-center gap-1 font-medium">
												<Star className="size-4 fill-amber-400 text-amber-400" />
												{item.rating ?? "—"}
											</span>
										</Cell>
										<Cell>{item.comment || t("No comment")}</Cell>
										<Cell>{item.application_id}</Cell>
										<Cell mono>{item.widget_id || "—"}</Cell>
										<Cell>{date(item.occurred_at, locale)}</Cell>
									</tr>
								))}
							</FeatureTable>
						</CardContent>
					</Card>
				</div>
			)}
		</ModulePage>
	);
}

export function AnalyticsCohortsPage() {
	const { t, locale } = useAnalyticsI18n();
	const { selectedProject } = useProjectSelection();
	const [items, setItems] = useState<AnalyticsCohort[]>([]);
	const [name, setName] = useState("");
	const [eventName, setEventName] = useState("");
	const [days, setDays] = useState("30");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const load = useCallback(async () => {
		if (!selectedProject) return;
		try {
			setItems((await getAnalyticsCohorts(selectedProject.id)).items);
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause, locale));
		}
	}, [selectedProject, locale]);
	useEffect(() => void load(), [load]);
	const run = async (action: () => Promise<unknown>, message: string) => {
		setBusy(true);
		try {
			await action();
			showSuccessNotification(message);
			await load();
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		} finally {
			setBusy(false);
		}
	};
	return (
		<ModulePage
			title={t("Cohorts")}
			description={t(
				"Define reusable audiences from behavior and keep their estimated size current.",
			)}
			error={error}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
					<Card className="h-fit">
						<CardHeader>
							<CardTitle className="text-base">{t("New behavioral cohort")}</CardTitle>
							<CardDescription>
								{t("Users who performed an event in a rolling window.")}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<Field label={t("Name")}>
								<Input
									value={name}
									onChange={(event) => setName(event.target.value)}
									placeholder={t("Recently activated")}
								/>
							</Field>
							<Field label={t("Event")}>
								<Input
									value={eventName}
									onChange={(event) => setEventName(event.target.value)}
									placeholder={t("account.activated")}
								/>
							</Field>
							<Field label={t("Lookback days")}>
								<Input
									type="number"
									min={1}
									max={366}
									value={days}
									onChange={(event) => setDays(event.target.value)}
								/>
							</Field>
							<Button
								className="w-full"
								disabled={busy || !name.trim() || !eventName.trim()}
								onClick={() =>
									void run(async () => {
										await createAnalyticsCohort(selectedProject.id, {
											name: name.trim(),
											definition: {
												event_name: eventName.trim(),
												days: Number(days),
											},
											enabled: true,
										});
										setName("");
										setEventName("");
									}, t("Cohort created"))
								}
							>
								<Plus className="size-4" />
								{t("Create cohort")}
							</Button>
						</CardContent>
					</Card>
					<Card>
						<CardHeader>
							<CardTitle>{t("Saved cohorts")}</CardTitle>
							<CardDescription>
								{t("Evaluate on demand before using a cohort in journeys or reports.")}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-3">
							{items.map((cohort) => (
								<div
									key={cohort.id}
									className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between"
								>
									<div>
										<div className="flex items-center gap-2">
											<span className="font-medium">{cohort.name}</span>
											<StatusBadge ok={cohort.enabled} okText={t("Active")} badText={t("Paused")} />
										</div>
										<p className="mt-1 text-sm text-muted-foreground">
											{t("Cohort estimate", {
												count: cohort.estimated_size,
												event: String(cohort.definition.event_name),
												days: Number(cohort.definition.days),
											})}
										</p>
										<p className="mt-1 text-xs text-muted-foreground">
											{cohort.last_evaluated_at
												? t("Evaluated at", { date: date(cohort.last_evaluated_at, locale) })
												: t("Not evaluated yet")}
										</p>
									</div>
									<div className="flex gap-2">
										<Button
											variant="outline"
											size="sm"
											disabled={busy}
											onClick={() =>
												void run(
													() => evaluateAnalyticsCohort(selectedProject.id, cohort.id),
													t("Cohort evaluated"),
												)
											}
										>
											<RefreshCw className="size-4" />
											{t("Evaluate")}
										</Button>
										<Button
											variant="ghost"
											size="icon"
											aria-label={t("Delete item", { name: cohort.name })}
											disabled={busy}
											onClick={() =>
												void run(
													() => deleteAnalyticsCohort(selectedProject.id, cohort.id),
													t("Cohort deleted"),
												)
											}
										>
											<Trash2 className="size-4" />
										</Button>
									</div>
								</div>
							))}
							{!items.length && <EmptyState compact>{t("No cohorts yet.")}</EmptyState>}
						</CardContent>
					</Card>
				</div>
			)}
		</ModulePage>
	);
}

export function AnalyticsRemoteConfigPage() {
	const { t, locale } = useAnalyticsI18n();
	const { selectedProject, projectType } = useProjectSelection();
	const environment = projectType.toLowerCase() === "test" ? "test" : "production";
	const [items, setItems] = useState<AnalyticsRemoteConfig[]>([]);
	const [key, setKey] = useState("");
	const [value, setValue] = useState('{\n  "enabled": true\n}');
	const [rollout, setRollout] = useState("100");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const load = useCallback(async () => {
		if (!selectedProject) return;
		try {
			setItems((await getAnalyticsRemoteConfig(selectedProject.id)).items);
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause, locale));
		}
	}, [selectedProject, locale]);
	useEffect(() => void load(), [load]);
	const save = async () => {
		if (!selectedProject) return;
		let parsed: unknown;
		try {
			parsed = JSON.parse(value);
		} catch {
			showErrorNotification(t("The configuration value must be valid JSON."));
			return;
		}
		setBusy(true);
		try {
			await upsertAnalyticsRemoteConfig(selectedProject.id, key.trim(), {
				environment,
				value: parsed,
				conditions: [{ rollout_percentage: Number(rollout) }],
				enabled: true,
			});
			showSuccessNotification(t("Remote configuration published"));
			setKey("");
			await load();
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		} finally {
			setBusy(false);
		}
	};
	return (
		<ModulePage
			title={t("Remote Config")}
			description={t(
				"Publish versioned JSON values with deterministic rollouts for the selected environment.",
			)}
			error={error}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<div className="space-y-5">
					<Alert>
						<ShieldCheck className="size-4" />
						<AlertTitle>{t("Stable assignments")}</AlertTitle>
						<AlertDescription>
							{t(
								"Rollout buckets are computed from a pseudonymous identity, project and key. The same installation always receives the same result.",
							)}
						</AlertDescription>
					</Alert>
					<div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
						<Card className="h-fit">
							<CardHeader>
								<CardTitle className="text-base">{t("Publish parameter")}</CardTitle>
								<CardDescription>
									{t("Environment:")}
									<Badge variant="outline">{t(labelize(environment))}</Badge>
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								<Field label={t("Parameter key")}>
									<Input
										value={key}
										onChange={(event) => setKey(event.target.value)}
										placeholder={t("checkout_banner")}
									/>
								</Field>
								<Field label={t("JSON value")}>
									<textarea
										className="min-h-36 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
										value={value}
										onChange={(event) => setValue(event.target.value)}
									/>
								</Field>
								<Field
									label={t("Rollout percentage", {
										percent: new Intl.NumberFormat(locale, { style: "percent" }).format(
											Number(rollout) / 100,
										),
									})}
								>
									<Input
										type="range"
										min={0}
										max={100}
										value={rollout}
										onChange={(event) => setRollout(event.target.value)}
									/>
								</Field>
								<Button
									className="w-full"
									disabled={busy || !key.trim()}
									onClick={() => void save()}
								>
									<Save className="size-4" />
									{t("Publish")}
								</Button>
							</CardContent>
						</Card>
						<Card>
							<CardHeader>
								<CardTitle>{t("Parameters")}</CardTitle>
								<CardDescription>
									{t("Each update increments an immutable client-visible version.")}
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-3">
								{items.map((item) => (
									<div key={item.id} className="rounded-xl border p-4">
										<div className="flex items-start justify-between gap-4">
											<div>
												<div className="flex flex-wrap items-center gap-2">
													<code className="font-semibold">{item.config_key}</code>
													<Badge variant="outline">v{item.version}</Badge>
													<Badge variant="secondary">{t(labelize(item.environment))}</Badge>
													<StatusBadge
														ok={item.enabled}
														okText={t("Live")}
														badText={t("Disabled")}
													/>
												</div>
												<pre className="mt-3 max-h-36 overflow-auto rounded-lg bg-muted/60 p-3 text-xs">
													{JSON.stringify(item.value, null, 2)}
												</pre>
											</div>
											<Button
												variant="ghost"
												size="icon"
												aria-label={t("Delete item", { name: item.config_key })}
												onClick={() =>
													void deleteAnalyticsRemoteConfig(
														selectedProject.id,
														item.config_key,
														item.environment,
													)
														.then(load)
														.then(() => showSuccessNotification(t("Parameter deleted")))
														.catch((cause: unknown) =>
															showErrorNotification(moduleErrorMessage(cause, locale)),
														)
												}
											>
												<Trash2 className="size-4" />
											</Button>
										</div>
									</div>
								))}
								{!items.length && (
									<EmptyState compact>{t("No remote parameters published.")}</EmptyState>
								)}
							</CardContent>
						</Card>
					</div>
				</div>
			)}
		</ModulePage>
	);
}

export function AnalyticsAlertsPage() {
	const { t, locale } = useAnalyticsI18n();
	const { selectedProject } = useProjectSelection();
	const [items, setItems] = useState<AnalyticsAlert[]>([]);
	const [incidents, setIncidents] = useState<AnalyticsAlertIncident[]>([]);
	const [name, setName] = useState("");
	const [type, setType] = useState<AnalyticsAlert["alert_type"]>("crash_spike");
	const [threshold, setThreshold] = useState("10");
	const [email, setEmail] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const load = useCallback(async () => {
		if (!selectedProject) return;
		try {
			const result = await getAnalyticsAlerts(selectedProject.id);
			setItems(result.items);
			setIncidents(result.incidents);
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause, locale));
		}
	}, [selectedProject, locale]);
	useEffect(() => void load(), [load]);
	const run = async (action: () => Promise<unknown>, message: string) => {
		setBusy(true);
		try {
			await action();
			showSuccessNotification(message);
			await load();
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		} finally {
			setBusy(false);
		}
	};
	const definition = () => {
		if (type === "purchase_drop" || type === "installation_drop")
			return { window_minutes: 60, drop_percentage: Number(threshold) };
		if (type === "no_data") return { window_minutes: Number(threshold) };
		return {
			window_minutes: 60,
			threshold: Number(threshold),
			operator: "gte",
		};
	};
	return (
		<ModulePage
			title={t("Alerts")}
			description={t(
				"Continuously evaluate product, crash, installation and verified-payment signals at the edge.",
			)}
			error={error}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<Tabs defaultValue="rules" className="space-y-4">
					<TabsList>
						<TabsTrigger value="rules">{t("Alert rules")}</TabsTrigger>
						<TabsTrigger value="incidents">
							Incidents{" "}
							<Badge className="ml-2" variant="secondary">
								{incidents.filter((item) => item.status !== "resolved").length}
							</Badge>
						</TabsTrigger>
					</TabsList>
					<TabsContent value="rules" className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
						<Card className="h-fit">
							<CardHeader>
								<CardTitle className="text-base">{t("New alert")}</CardTitle>
								<CardDescription>
									{t("Evaluated every minute by the Analytics Worker.")}
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								<Field label={t("Rule name")}>
									<Input
										value={name}
										onChange={(event) => setName(event.target.value)}
										placeholder={t("Crash spike")}
									/>
								</Field>
								<Field label={t("Signal")}>
									<Select
										value={type}
										onValueChange={(value) => setType(value as AnalyticsAlert["alert_type"])}
									>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="crash_spike">{t("Crash spike")}</SelectItem>
											<SelectItem value="no_data">{t("No incoming data")}</SelectItem>
											<SelectItem value="purchase_drop">{t("Verified purchase drop")}</SelectItem>
											<SelectItem value="installation_drop">{t("Installation drop")}</SelectItem>
										</SelectContent>
									</Select>
								</Field>
								<Field
									label={
										type === "no_data"
											? t("No-data minutes")
											: type.endsWith("_drop")
												? t("Drop percentage")
												: t("Threshold")
									}
								>
									<Input
										type="number"
										min={0}
										value={threshold}
										onChange={(event) => setThreshold(event.target.value)}
									/>
								</Field>
								<Field label={t("AWS SES recipient (optional)")}>
									<Input
										type="email"
										value={email}
										onChange={(event) => setEmail(event.target.value)}
										placeholder={t("team@example.com")}
									/>
								</Field>
								<Button
									className="w-full"
									disabled={busy || !name.trim()}
									onClick={() =>
										void run(async () => {
											await createAnalyticsAlert(selectedProject.id, {
												name: name.trim(),
												alert_type: type,
												definition: definition(),
												channels: email.trim() ? [{ type: "email", to: email.trim() }] : [],
												enabled: true,
												cooldown_minutes: 60,
											});
											setName("");
										}, t("Alert created"))
									}
								>
									<BellRing className="size-4" />
									{t("Create alert")}
								</Button>
							</CardContent>
						</Card>
						<Card>
							<CardHeader>
								<CardTitle>{t("Active rules")}</CardTitle>
								<CardDescription>
									{t("Notifications use the central AWS SES Email Worker.")}
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-3">
								{items.map((item) => (
									<div
										key={item.id}
										className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between"
									>
										<div>
											<div className="flex items-center gap-2">
												<span className="font-medium">{item.name}</span>
												<StatusBadge
													ok={item.enabled}
													okText={t("Enabled")}
													badText={t("Paused")}
												/>
											</div>
											<p className="mt-1 text-sm text-muted-foreground">
												{t("Alert cooldown", {
													type: t(labelize(item.alert_type)),
													minutes: item.cooldown_minutes,
												})}
											</p>
											<p className="mt-1 text-xs text-muted-foreground">
												{item.last_evaluated_at
													? t("Evaluated at", { date: date(item.last_evaluated_at, locale) })
													: t("Awaiting first evaluation")}
											</p>
										</div>
										<Button
											variant="ghost"
											size="icon"
											aria-label={t("Delete item", { name: item.name })}
											disabled={busy}
											onClick={() =>
												void run(
													() => deleteAnalyticsAlert(selectedProject.id, item.id),
													t("Alert deleted"),
												)
											}
										>
											<Trash2 className="size-4" />
										</Button>
									</div>
								))}
								{!items.length && (
									<EmptyState compact>{t("No alert rules configured.")}</EmptyState>
								)}
							</CardContent>
						</Card>
					</TabsContent>
					<TabsContent value="incidents">
						<Card>
							<CardHeader>
								<CardTitle>{t("Incident history")}</CardTitle>
								<CardDescription>
									{t("Acknowledge active incidents and resolve them after investigation.")}
								</CardDescription>
							</CardHeader>
							<CardContent>
								<FeatureTable
									columns={[
										t("Triggered"),
										t("Summary"),
										t("Status"),
										t("Notification"),
										t("Actions"),
									]}
									empty={t("No incidents have been triggered.")}
								>
									{incidents.map((incident) => (
										<tr key={incident.id} className="border-b last:border-0">
											<Cell>{date(incident.triggered_at, locale)}</Cell>
											<Cell strong>{incident.summary}</Cell>
											<Cell>
												<Badge variant={incident.status === "open" ? "destructive" : "outline"}>
													{t(labelize(incident.status))}
												</Badge>
											</Cell>
											<Cell>
												<Badge variant="secondary">
													{t(labelize(incident.notification_status))}
												</Badge>
											</Cell>
											<Cell>
												<div className="flex gap-2">
													{incident.status === "open" && (
														<Button
															size="sm"
															variant="outline"
															onClick={() =>
																void run(
																	() =>
																		updateAnalyticsAlertIncident(
																			selectedProject.id,
																			incident.id,
																			"acknowledge",
																		),
																	t("Incident acknowledged"),
																)
															}
														>
															{t("Acknowledge")}
														</Button>
													)}
													{incident.status !== "resolved" && (
														<Button
															size="sm"
															onClick={() =>
																void run(
																	() =>
																		updateAnalyticsAlertIncident(
																			selectedProject.id,
																			incident.id,
																			"resolve",
																		),
																	t("Incident resolved"),
																)
															}
														>
															{t("Resolve")}
														</Button>
													)}
												</div>
											</Cell>
										</tr>
									))}
								</FeatureTable>
							</CardContent>
						</Card>
					</TabsContent>
				</Tabs>
			)}
		</ModulePage>
	);
}

export function AnalyticsSettingsPage() {
	const { t, locale } = useAnalyticsI18n();
	const { selectedProject } = useProjectSelection();
	const [settings, setSettings] = useState<AnalyticsSettings | null>(null);
	const [applications, setApplications] = useState<AnalyticsApplication[]>([]);
	const [hooks, setHooks] = useState<AnalyticsHook[]>([]);
	const [annotations, setAnnotations] = useState<AnalyticsAnnotation[]>([]);
	const [hookName, setHookName] = useState("");
	const [hookUrl, setHookUrl] = useState("");
	const [hookEvents, setHookEvents] = useState("*");
	const [hookSecret, setHookSecret] = useState("");
	const [annotation, setAnnotation] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const load = useCallback(async () => {
		if (!selectedProject) return;
		try {
			const [settingsData, applicationData, hookData, annotationData] = await Promise.all([
				getAnalyticsSettings(selectedProject.id),
				getAnalyticsApplications(selectedProject.id),
				getAnalyticsHooks(selectedProject.id),
				getAnalyticsAnnotations(selectedProject.id),
			]);
			setSettings(settingsData);
			setApplications(applicationData.items);
			setHooks(hookData.items);
			setAnnotations(annotationData.items);
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause, locale));
		}
	}, [selectedProject, locale]);
	useEffect(() => void load(), [load]);
	const run = async (action: () => Promise<unknown>, message: string) => {
		setBusy(true);
		try {
			await action();
			showSuccessNotification(message);
			await load();
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		} finally {
			setBusy(false);
		}
	};
	return (
		<ModulePage
			title={t("Analytics settings")}
			description={t(
				"Manage applications, retention, collection, signed webhooks and timeline annotations.",
			)}
			error={error}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<Tabs defaultValue="applications" className="space-y-4">
					<TabsList className="h-auto flex-wrap">
						<TabsTrigger value="applications">{t("Applications")}</TabsTrigger>
						<TabsTrigger value="collection">{t("Data collection")}</TabsTrigger>
						<TabsTrigger value="hooks">{t("Webhooks")}</TabsTrigger>
						<TabsTrigger value="annotations">{t("Annotations")}</TabsTrigger>
					</TabsList>
					<TabsContent value="applications">
						<Card>
							<CardHeader>
								<CardTitle>{t("Observed applications")}</CardTitle>
								<CardDescription>
									{t("Applications appear automatically after their first accepted event.")}
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-3">
								{applications.map((application) => (
									<div
										key={application.application_id}
										className="flex flex-col gap-3 rounded-xl border p-4 md:flex-row md:items-center md:justify-between"
									>
										<div>
											<div className="flex items-center gap-2">
												<span className="font-medium">{application.name}</span>
												<Badge variant="outline">{application.platform || t("Unknown")}</Badge>
											</div>
											<p className="mt-1 font-mono text-xs text-muted-foreground">
												{application.application_id}
											</p>
											<p className="mt-1 text-xs text-muted-foreground">
												{t("Last seen at", { date: date(application.last_seen_at, locale) })}
											</p>
										</div>
										<div className="flex items-center gap-3">
											<Label htmlFor={`application-${application.application_id}`}>
												{t("Collect data")}
											</Label>
											<Switch
												id={`application-${application.application_id}`}
												checked={application.active}
												onCheckedChange={(active) =>
													void run(
														() =>
															updateAnalyticsApplication(
																selectedProject.id,
																application.application_id,
																{ active },
															),
														active ? t("Application enabled") : t("Application disabled"),
													)
												}
											/>
										</div>
									</div>
								))}
								{!applications.length && (
									<EmptyState compact>{t("No applications observed.")}</EmptyState>
								)}
							</CardContent>
						</Card>
					</TabsContent>
					<TabsContent value="collection">
						{settings && (
							<Card className="max-w-2xl">
								<CardHeader>
									<CardTitle>{t("Collection & retention")}</CardTitle>
									<CardDescription>
										Raw hot events expire automatically; aggregated facts and R2 archives remain
										available for reports and exports.
									</CardDescription>
								</CardHeader>
								<CardContent className="space-y-5">
									<div className="flex items-center justify-between rounded-lg border p-4">
										<div>
											<div className="font-medium">{t("Collect analytics events")}</div>
											<div className="text-sm text-muted-foreground">
												{t("Applies to the selected project.")}
											</div>
										</div>
										<Switch
											checked={settings.data_collection_enabled}
											onCheckedChange={(data_collection_enabled) =>
												setSettings({ ...settings, data_collection_enabled })
											}
										/>
									</div>
									<Field label={t("Hot-event retention (days)")}>
										<Input
											type="number"
											min={1}
											max={366}
											value={settings.hot_retention_days}
											onChange={(event) =>
												setSettings({
													...settings,
													hot_retention_days: Number(event.target.value),
												})
											}
										/>
									</Field>
									<Field label={t("Reporting timezone")}>
										<Input
											value={settings.timezone}
											onChange={(event) =>
												setSettings({
													...settings,
													timezone: event.target.value,
												})
											}
										/>
									</Field>
									<Button
										disabled={busy}
										onClick={() =>
											void run(
												() => updateAnalyticsSettings(selectedProject.id, settings),
												t("Analytics settings saved"),
											)
										}
									>
										<Save className="size-4" />
										{t("Save settings")}
									</Button>
								</CardContent>
							</Card>
						)}
					</TabsContent>
					<TabsContent value="hooks" className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
						<Card className="h-fit">
							<CardHeader>
								<CardTitle className="text-base">{t("Signed webhook")}</CardTitle>
								<CardDescription>
									{t("Only public HTTPS endpoints are accepted. Secrets are encrypted at rest.")}
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								<Field label={t("Name")}>
									<Input
										value={hookName}
										onChange={(event) => setHookName(event.target.value)}
										placeholder={t("Data warehouse")}
									/>
								</Field>
								<Field label={t("Endpoint")}>
									<Input
										type="url"
										value={hookUrl}
										onChange={(event) => setHookUrl(event.target.value)}
										placeholder={t("https://hooks.example.com/analytics")}
									/>
								</Field>
								<Field label={t("Events")}>
									<Input
										value={hookEvents}
										onChange={(event) => setHookEvents(event.target.value)}
										placeholder={t("*, alert.triggered")}
									/>
								</Field>
								<Field label={t("Signing secret")}>
									<Input
										type="password"
										value={hookSecret}
										onChange={(event) => setHookSecret(event.target.value)}
									/>
								</Field>
								<Button
									className="w-full"
									disabled={busy || !hookName.trim() || !hookUrl.trim()}
									onClick={() =>
										void run(async () => {
											await createAnalyticsHook(selectedProject.id, {
												name: hookName.trim(),
												endpoint_url: hookUrl.trim(),
												event_types: hookEvents
													.split(",")
													.map((item) => item.trim())
													.filter(Boolean),
												secret: hookSecret || undefined,
												enabled: true,
											});
											setHookName("");
											setHookUrl("");
											setHookSecret("");
										}, t("Webhook created"))
									}
								>
									<Webhook className="size-4" />
									{t("Add webhook")}
								</Button>
							</CardContent>
						</Card>
						<Card>
							<CardHeader>
								<CardTitle>{t("Destinations")}</CardTitle>
								<CardDescription>
									{t("Deliveries are idempotent, signed and retried with backoff.")}
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-3">
								{hooks.map((hook) => (
									<div
										key={hook.id}
										className="flex items-start justify-between gap-4 rounded-xl border p-4"
									>
										<div>
											<div className="flex items-center gap-2">
												<span className="font-medium">{hook.name}</span>
												<StatusBadge ok={hook.enabled} okText={t("Active")} badText={t("Paused")} />
											</div>
											<p className="mt-1 break-all text-sm text-muted-foreground">
												{hook.endpoint_url}
											</p>
											<p className="mt-2 text-xs text-muted-foreground">
												{hook.event_types.join(", ")} ·{" "}
												{hook.secret_configured ? t("HMAC signed") : t("Unsigned")} ·{" "}
												{hook.last_delivery_status
													? t(labelize(hook.last_delivery_status))
													: t("no deliveries")}
											</p>
										</div>
										<Button
											variant="ghost"
											size="icon"
											aria-label={t("Delete item", { name: hook.name })}
											onClick={() =>
												void run(
													() => deleteAnalyticsHook(selectedProject.id, hook.id),
													t("Webhook deleted"),
												)
											}
										>
											<Trash2 className="size-4" />
										</Button>
									</div>
								))}
								{!hooks.length && <EmptyState compact>{t("No webhook destinations.")}</EmptyState>}
							</CardContent>
						</Card>
					</TabsContent>
					<TabsContent
						value="annotations"
						className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]"
					>
						<Card className="h-fit">
							<CardHeader>
								<CardTitle className="text-base">{t("Add annotation")}</CardTitle>
								<CardDescription>
									{t("Mark releases or campaigns on the analytics timeline.")}
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								<Field label={t("Title")}>
									<Input
										value={annotation}
										onChange={(event) => setAnnotation(event.target.value)}
										placeholder={t("Version 3.2 released")}
									/>
								</Field>
								<Button
									className="w-full"
									disabled={!annotation.trim()}
									onClick={() =>
										void run(async () => {
											await createAnalyticsAnnotation(selectedProject.id, {
												title: annotation.trim(),
												annotation_at: new Date().toISOString(),
												color: "#6366f1",
											});
											setAnnotation("");
										}, t("Annotation added"))
									}
								>
									<Plus className="size-4" />
									{t("Add now")}
								</Button>
							</CardContent>
						</Card>
						<Card>
							<CardHeader>
								<CardTitle>{t("Timeline")}</CardTitle>
							</CardHeader>
							<CardContent className="space-y-3">
								{annotations.map((item) => (
									<div
										key={item.id}
										className="flex items-center justify-between gap-4 rounded-xl border p-4"
									>
										<div className="flex items-center gap-3">
											<span
												className="size-3 rounded-full"
												style={{ backgroundColor: item.color }}
											/>
											<div>
												<div className="font-medium">{item.title}</div>
												<div className="text-xs text-muted-foreground">
													{date(item.annotation_at, locale)}
												</div>
											</div>
										</div>
										<Button
											variant="ghost"
											size="icon"
											aria-label={t("Delete item", { name: item.title })}
											onClick={() =>
												void run(
													() => deleteAnalyticsAnnotation(selectedProject.id, item.id),
													t("Annotation deleted"),
												)
											}
										>
											<Trash2 className="size-4" />
										</Button>
									</div>
								))}
								{!annotations.length && (
									<EmptyState compact>{t("No timeline annotations.")}</EmptyState>
								)}
							</CardContent>
						</Card>
					</TabsContent>
				</Tabs>
			)}
		</ModulePage>
	);
}

function WidgetPreview({ type }: { type: AnalyticsDashboardWidget["widget_type"] }) {
	const { t } = useAnalyticsI18n();
	const icon =
		type === "crashes"
			? AlertTriangle
			: type === "views"
				? AppWindow
				: type === "purchases"
					? ShieldCheck
					: type === "installations"
						? AppWindow
						: Gauge;
	const Icon = icon;
	return (
		<div className="flex min-h-20 items-center gap-3 rounded-lg border border-dashed bg-muted/30 p-4">
			<div className="rounded-lg bg-primary/10 p-2 text-primary">
				<Icon className="size-5" />
			</div>
			<div>
				<div className="font-medium">{t("Live widget", { type: t(labelize(type)) })}</div>
				<div className="text-xs text-muted-foreground">
					{t("Uses the selected dashboard range and project filters.")}
				</div>
			</div>
		</div>
	);
}

function FeatureMetric({
	icon: Icon,
	label,
	value,
	text,
}: {
	icon: typeof Activity;
	label: string;
	value?: number;
	text?: string;
}) {
	const { locale } = useAnalyticsI18n();
	return (
		<Card>
			<CardContent className="flex items-center gap-3 pt-6">
				<div className="rounded-lg bg-primary/10 p-2 text-primary">
					<Icon className="size-5" />
				</div>
				<div>
					<p className="text-sm text-muted-foreground">{label}</p>
					<p className="text-2xl font-semibold tabular-nums">
						{text ?? numberFormat(value ?? 0, locale)}
					</p>
				</div>
			</CardContent>
		</Card>
	);
}

function FeatureTable({
	columns,
	empty,
	children,
}: {
	columns: string[];
	empty: string;
	children: ReactNode;
}) {
	const hasRows = Array.isArray(children) ? children.length > 0 : Boolean(children);
	return (
		<div className="overflow-x-auto rounded-lg border">
			<table className="w-full min-w-[720px] text-start text-sm">
				<thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
					<tr>
						{columns.map((column) => (
							<th key={column} className="px-4 py-3 font-medium">
								{column}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{hasRows ? (
						children
					) : (
						<tr>
							<td colSpan={columns.length} className="px-4 py-10 text-center text-muted-foreground">
								{empty}
							</td>
						</tr>
					)}
				</tbody>
			</table>
		</div>
	);
}

function Cell({
	children,
	mono,
	strong,
}: {
	children: ReactNode;
	mono?: boolean;
	strong?: boolean;
}) {
	return (
		<td
			className={`px-4 py-3 align-top ${mono ? "font-mono text-xs" : ""} ${strong ? "font-medium" : ""}`}
		>
			{children}
		</td>
	);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="space-y-2">
			<Label>{label}</Label>
			{children}
		</div>
	);
}

function EmptyState({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
	return (
		<div
			className={`rounded-xl border border-dashed text-center text-sm text-muted-foreground ${compact ? "p-5" : "p-10"}`}
		>
			<LayoutDashboard className="mx-auto mb-2 size-5 opacity-60" />
			{children}
		</div>
	);
}

function StatusBadge({ ok, okText, badText }: { ok: boolean; okText: string; badText: string }) {
	return <Badge variant={ok ? "secondary" : "outline"}>{ok ? okText : badText}</Badge>;
}

function labelize(value: string) {
	return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function date(value: string, locale: string) {
	return new Intl.DateTimeFormat(locale, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(value));
}

function numberFormat(value: number, locale: string) {
	return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Number(value) || 0);
}

function duration(value: number, locale: string) {
	const seconds = Math.max(0, Math.round(Number(value) || 0));
	const secondsFormat = new Intl.NumberFormat(locale, {
		style: "unit",
		unit: "second",
		unitDisplay: "narrow",
	});
	if (seconds < 60) return secondsFormat.format(seconds);
	const minutes = Math.floor(seconds / 60);
	return `${new Intl.NumberFormat(locale, { style: "unit", unit: "minute", unitDisplay: "narrow" }).format(minutes)} ${secondsFormat.format(seconds % 60)}`;
}

function shortId(value?: string | null) {
	if (!value) return "—";
	return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}
