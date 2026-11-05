"use client";

import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import {
	showErrorNotification,
	showSuccessNotification,
} from "@superboard/front-ui/lib/Notifications.js";
import {
	EmptyProject,
	ModulePage,
	moduleErrorMessage,
} from "@superboard/front-ui/modules/ModulePage.js";
import { usePathname, useRouter, useSearchParams } from "@superboard/front-ui/navigation";
import {
	SectionNavigation,
	SectionNavigationProvider,
} from "@superboard/front-ui/section-navigation.js";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@superboard/front-ui/ui/card.js";
import { Input } from "@superboard/front-ui/ui/input.js";
import {
	Table as FrontTable,
	TableHeader as FrontTableHeader,
	TableBody as FrontTableBody,
	TableRow as FrontTableRow,
	TableHead as FrontTableHead,
	TableCell as FrontTableCell,
} from "@superboard/front-ui/ui/table.js";
import { DatabaseBackup, Download, Filter, MousePointerClick, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
	Area,
	AreaChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

import {
	createAnalyticsOperation,
	createAnalyticsReport,
	deleteAnalyticsReport,
	getAnalyticsEventDefinitions,
	getAnalyticsEventAnalysis,
	getAnalyticsEvents,
	getAnalyticsInstallations,
	getAnalyticsOperations,
	getAnalyticsPurchases,
	getAnalyticsReports,
	getAnalyticsRetention,
	queryAnalyticsFunnel,
	type AnalyticsEvent,
	type AnalyticsEventAnalysis,
	type AnalyticsInstallation,
	type AnalyticsOperation,
	type AnalyticsPurchase,
	type FunnelResult,
	type RetentionResult,
	type SavedAnalyticsReport,
} from "../../api/analytics/analyticsService.js";
import { useAnalyticsI18n } from "./analytics-i18n.js";
import {
	AnalyticsAlertsPage,
	AnalyticsCohortsPage,
	AnalyticsCrashesPage,
	AnalyticsDashboardsPage,
	AnalyticsDimensionsPage,
	AnalyticsFeedbackPage,
	AnalyticsRemoteConfigPage,
	AnalyticsSettingsPage,
	AnalyticsUsersPage,
	AnalyticsViewsPage,
} from "./AnalyticsFeaturePages.js";

export type AnalyticsPageKind =
	| "dashboards"
	| "users"
	| "profiles"
	| "events"
	| "dimensions"
	| "views"
	| "installations"
	| "purchases"
	| "insights"
	| "cohorts"
	| "crashes"
	| "feedback"
	| "remote-config"
	| "alerts"
	| "reports"
	| "settings";

type AnalyticsTab = { kind: AnalyticsPageKind; label: string };
type AnalyticsTabGroup = {
	parent: AnalyticsPageKind;
	label: string;
	tabs: readonly AnalyticsTab[];
};

const tabGroups: readonly AnalyticsTabGroup[] = [
	{
		parent: "users",
		label: "Audience and usage",
		tabs: [
			{ kind: "users", label: "Sessions" },
			{ kind: "profiles", label: "User profiles" },
			{ kind: "installations", label: "Installations" },
			{ kind: "views", label: "Viewed screens" },
			{ kind: "dimensions", label: "Devices and countries" },
			{ kind: "cohorts", label: "User groups" },
		],
	},
	{
		parent: "reports",
		label: "Reports and exports",
		tabs: [
			{ kind: "reports", label: "Reports and exports" },
			{ kind: "alerts", label: "Alerts" },
			{ kind: "crashes", label: "Application errors" },
			{ kind: "feedback", label: "User feedback" },
		],
	},
];

const tabGroupOf = (kind: AnalyticsPageKind) =>
	tabGroups.find((group) => group.tabs.some((tab) => tab.kind === kind));

function analyticsTabHref(group: AnalyticsTabGroup, kind: AnalyticsPageKind, locale: string) {
	return kind === group.parent
		? `/analytics/${kind}?lang=${locale}`
		: `/analytics/${group.parent}?tab=${kind}&lang=${locale}`;
}

function AnalyticsTabRow({
	group,
	active,
}: {
	group: AnalyticsTabGroup;
	active: AnalyticsPageKind;
}) {
	const { t, locale } = useAnalyticsI18n();
	return (
		<nav
			aria-label={t(group.label)}
			className="bg-muted text-muted-foreground flex w-fit flex-wrap items-center gap-1 rounded-lg p-[3px]"
		>
			{group.tabs.map((tab) => (
				<a
					key={tab.kind}
					href={analyticsTabHref(group, tab.kind, locale)}
					aria-current={tab.kind === active ? "page" : undefined}
					className="text-foreground rounded-md px-3 py-1 text-sm font-medium aria-[current=page]:bg-background aria-[current=page]:shadow-sm"
				>
					{t(tab.label)}
				</a>
			))}
		</nav>
	);
}

export function AnalyticsPage({ kind: routeKind }: { kind: AnalyticsPageKind }) {
	const hostNavigation = SectionNavigation();
	const requested = useSearchParams().get("tab");
	const routeGroup = tabGroups.find((group) => group.parent === routeKind);
	const kind = routeGroup?.tabs.find((tab) => tab.kind === requested)?.kind ?? routeKind;
	const group = tabGroupOf(kind);
	if (!group) return <AnalyticsPageContent kind={kind} />;
	return (
		<SectionNavigationProvider
			value={
				<>
					{hostNavigation}
					<AnalyticsTabRow group={group} active={kind} />
				</>
			}
		>
			<AnalyticsPageContent kind={kind} />
		</SectionNavigationProvider>
	);
}

function AnalyticsPageContent({ kind }: { kind: AnalyticsPageKind }) {
	if (kind === "dashboards") return <AnalyticsDashboardsPage />;
	if (kind === "users") return <AnalyticsUsersPage section="sessions" />;
	if (kind === "profiles") return <AnalyticsUsersPage section="profiles" />;
	if (kind === "events") return <EventsPage />;
	if (kind === "dimensions") return <AnalyticsDimensionsPage />;
	if (kind === "views") return <AnalyticsViewsPage />;
	if (kind === "installations") return <InstallationsPage />;
	if (kind === "purchases") return <PurchasesPage />;
	if (kind === "insights") return <InsightsPage />;
	if (kind === "cohorts") return <AnalyticsCohortsPage />;
	if (kind === "crashes") return <AnalyticsCrashesPage />;
	if (kind === "feedback") return <AnalyticsFeedbackPage />;
	if (kind === "remote-config") return <AnalyticsRemoteConfigPage />;
	if (kind === "alerts") return <AnalyticsAlertsPage />;
	if (kind === "settings") return <AnalyticsSettingsPage />;
	return <ReportsPage />;
}

function useAnalyticsRange() {
	return useMemo(() => {
		const to = new Date();
		const from = new Date(to.getTime() - 29 * 86_400_000);
		return { from: from.toISOString(), to: to.toISOString() };
	}, []);
}

function EventsPage() {
	const { t, locale } = useAnalyticsI18n();
	const { selectedProject } = useProjectSelection();
	const range = useAnalyticsRange();
	const [events, setEvents] = useState<AnalyticsEvent[]>([]);
	const [eventName, setEventName] = useState("");
	const [appliedName, setAppliedName] = useState("");
	const [property, setProperty] = useState("");
	const [analysis, setAnalysis] = useState<AnalyticsEventAnalysis | null>(null);
	const [error, setError] = useState<string | null>(null);
	const search = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();
	const userId = (search.get("user") ?? "").trim().slice(0, 1_024);
	const clearUser = () => {
		const next = new URLSearchParams(search);
		next.delete("user");
		const query = next.toString();
		router.replace(query ? `${pathname}?${query}` : pathname);
	};
	const load = useCallback(async () => {
		if (!selectedProject) return;
		try {
			const [result, eventAnalysis] = await Promise.all([
				getAnalyticsEvents(selectedProject.id, {
					...range,
					event_name: appliedName || undefined,
					user_id: userId || undefined,
					limit: "100",
				}),
				appliedName
					? getAnalyticsEventAnalysis(selectedProject.id, {
							...range,
							event_name: appliedName,
							property: property || undefined,
						})
					: Promise.resolve(null),
			]);
			setEvents(result.items);
			setAnalysis(eventAnalysis);
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause, locale));
		}
	}, [appliedName, property, range, selectedProject, locale, userId]);
	useEffect(() => void load(), [load]);
	return (
		<ModulePage
			title={t("Event explorer")}
			description={t(
				"Inspect the recent, pseudonymized event stream without exposing raw user identifiers.",
			)}
			error={error}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<div className="space-y-5">
					<div className="flex flex-wrap items-center gap-2">
						<form
							className="flex min-w-64 flex-1 gap-2"
							onSubmit={(event) => {
								event.preventDefault();
								setProperty("");
								setAppliedName(eventName.trim());
							}}
						>
							<Input
								value={eventName}
								onChange={(event) => setEventName(event.target.value)}
								placeholder={t("checkout.completed")}
								aria-label={t("Event name")}
							/>
							<Button type="submit">
								<Filter className="size-4" />
								{t("Apply filter")}
							</Button>
						</form>
						{userId ? (
							<div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
								<span className="text-muted-foreground">{t("Filtered by user")}</span>
								<Badge variant="secondary" className="max-w-full font-mono">
									<span className="truncate">{userId}</span>
								</Badge>
								<Button type="button" variant="ghost" size="sm" onClick={clearUser}>
									<X className="size-4" />
									{t("Clear user filter")}
								</Button>
							</div>
						) : null}
					</div>
					<DataTable
						columns={[t("Event"), t("Source"), t("Application"), t("Occurred"), t("Properties")]}
						empty={t("No events match this period and filter.")}
					>
						{events.map((event) => (
							<FrontTableRow key={event.event_id} className="border-b last:border-0">
								<Cell>
									<div className="font-medium">{event.event_name}</div>
									<div className="max-w-48 truncate font-mono text-xs text-muted-foreground">
										{event.event_id}
									</div>
								</Cell>
								<Cell>
									<Badge variant="outline">{t(labelize(event.source))}</Badge>
								</Cell>
								<Cell>{event.application_id}</Cell>
								<Cell>{formatDate(event.occurred_at, locale)}</Cell>
								<Cell>
									<code className="block max-w-80 truncate text-xs">
										{JSON.stringify(event.properties)}
									</code>
								</Cell>
							</FrontTableRow>
						))}
					</DataTable>
					{analysis && (
						<>
							<Card>
								<CardHeader className="flex-row items-start justify-between gap-4">
									<div>
										<CardTitle>{analysis.event_name}</CardTitle>
										<CardDescription>
											{t("Event volume and unique pseudonymous users over 30 days.")}
										</CardDescription>
									</div>
									<div className="flex gap-2">
										<Badge variant="secondary">
											{t("Event count", { count: analysis.totals.events })}
										</Badge>
										<Badge variant="outline">
											{t("User count", { count: analysis.totals.users })}
										</Badge>
									</div>
								</CardHeader>
								<CardContent>
									<div className="h-64 w-full">
										<ResponsiveContainer width="100%" height="100%">
											<AreaChart data={analysis.series}>
												<CartesianGrid strokeDasharray="3 3" vertical={false} />
												<XAxis
													tickFormatter={(value: string) =>
														new Intl.DateTimeFormat(locale, {
															month: "short",
															day: "numeric",
															timeZone: "UTC",
														}).format(new Date(value))
													}
													dataKey="date"
													tickLine={false}
													axisLine={false}
												/>
												<YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} />
												<Tooltip labelFormatter={(value) => formatDay(String(value), locale)} />
												<Area
													dataKey="events"
													name={t("Events")}
													type="monotone"
													stroke="var(--primary)"
													fill="var(--primary)"
													fillOpacity={0.12}
													strokeWidth={2}
												/>
											</AreaChart>
										</ResponsiveContainer>
									</div>
								</CardContent>
							</Card>
							<Card>
								<CardHeader>
									<CardTitle className="text-base">{t("Segmentation")}</CardTitle>
									<CardDescription>
										{t("Break down this event by one recorded property.")}
									</CardDescription>
								</CardHeader>
								<CardContent className="space-y-4">
									<select
										className="w-full rounded-md border bg-background px-3 py-2 text-sm sm:max-w-xs"
										value={property}
										onChange={(event) => setProperty(event.target.value)}
										aria-label={t("Event property")}
									>
										<option value="">{t("Choose a property")}</option>
										{analysis.properties.map((item) => (
											<option key={item} value={item}>
												{item}
											</option>
										))}
									</select>
									<div className="space-y-2">
										{analysis.segmentation?.items.slice(0, 12).map((item) => (
											<div
												key={item.value}
												className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
											>
												<span className="truncate">{item.value}</span>
												<span className="shrink-0 tabular-nums text-muted-foreground">
													{formatNumber(item.events, locale)}
												</span>
											</div>
										))}
										{property && !analysis.segmentation?.items.length && (
											<p className="py-6 text-center text-sm text-muted-foreground">
												{t("No values for this property.")}
											</p>
										)}
									</div>
								</CardContent>
							</Card>
						</>
					)}
				</div>
			)}
		</ModulePage>
	);
}

function InstallationsPage() {
	const { t, locale } = useAnalyticsI18n();
	const { selectedProject } = useProjectSelection();
	const range = useAnalyticsRange();
	const [items, setItems] = useState<AnalyticsInstallation[]>([]);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		if (!selectedProject) return;
		void getAnalyticsInstallations(selectedProject.id, range)
			.then((result) => {
				setItems(result.items);
				setError(null);
			})
			.catch((cause: unknown) => setError(moduleErrorMessage(cause, locale)));
	}, [range, selectedProject, locale]);
	return (
		<ModulePage
			title={t("Installations")}
			description={t(
				"Canonical first installs only—retries and repeated attribution calls do not increase this count.",
			)}
			error={error}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<Card>
					<CardContent className="pt-6">
						<DataTable
							columns={[
								t("Installed"),
								t("Application"),
								t("Platform"),
								t("Version"),
								t("Attribution"),
							]}
							empty={t("No installations in this period.")}
						>
							{items.map((item) => (
								<FrontTableRow key={item.id} className="border-b last:border-0">
									<Cell>{formatDate(item.installed_at, locale)}</Cell>
									<Cell>{item.application_id}</Cell>
									<Cell>{item.platform || "—"}</Cell>
									<Cell>{item.app_version || "—"}</Cell>
									<Cell>{item.attribution_id || t("Organic / unknown")}</Cell>
								</FrontTableRow>
							))}
						</DataTable>
					</CardContent>
				</Card>
			)}
		</ModulePage>
	);
}

function PurchasesPage() {
	const { t, locale } = useAnalyticsI18n();
	const { selectedProject } = useProjectSelection();
	const range = useAnalyticsRange();
	const [items, setItems] = useState<AnalyticsPurchase[]>([]);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		if (!selectedProject) return;
		void getAnalyticsPurchases(selectedProject.id, range)
			.then((result) => {
				setItems(result.items);
				setError(null);
			})
			.catch((cause: unknown) => setError(moduleErrorMessage(cause, locale)));
	}, [range, selectedProject, locale]);
	return (
		<ModulePage
			title={t("Verified purchases")}
			description={t(
				"Financial facts emitted only after store or billing verification, deduplicated by transaction and event type.",
			)}
			error={error}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<Card>
					<CardContent className="pt-6">
						<DataTable
							columns={[
								t("Occurred"),
								t("Type"),
								t("Product"),
								t("Amount"),
								t("Store"),
								t("Transaction"),
							]}
							empty={t("No verified purchase facts in this period.")}
						>
							{items.map((item) => (
								<FrontTableRow key={item.id} className="border-b last:border-0">
									<Cell>{formatDate(item.occurred_at, locale)}</Cell>
									<Cell>
										<Badge
											variant={negativePurchase(item.event_type) ? "destructive" : "secondary"}
										>
											{t(labelize(item.event_type))}
										</Badge>
									</Cell>
									<Cell>{item.product_id || "—"}</Cell>
									<Cell>{formatPurchaseAmount(item, locale)}</Cell>
									<Cell>
										{t(labelize(item.store))} · {t(labelize(item.environment))}
									</Cell>
									<Cell>
										<span className="block max-w-44 truncate font-mono text-xs">
											{item.store_transaction_id}
										</span>
									</Cell>
								</FrontTableRow>
							))}
						</DataTable>
					</CardContent>
				</Card>
			)}
		</ModulePage>
	);
}

function InsightsPage() {
	const { t, locale } = useAnalyticsI18n();
	const { selectedProject } = useProjectSelection();
	const range = useAnalyticsRange();
	const [stepsText, setStepsText] = useState("app.opened, checkout.started, purchase.completed");
	const [funnel, setFunnel] = useState<FunnelResult | null>(null);
	const [retention, setRetention] = useState<RetentionResult | null>(null);
	const [definitions, setDefinitions] = useState<
		Array<{ event_name: string; event_count: number }>
	>([]);
	const [error, setError] = useState<string | null>(null);
	const load = useCallback(async () => {
		if (!selectedProject) return;
		try {
			const [retentionData, definitionData] = await Promise.all([
				getAnalyticsRetention(selectedProject.id, { ...range, days: "30" }),
				getAnalyticsEventDefinitions(selectedProject.id),
			]);
			setRetention(retentionData);
			setDefinitions(definitionData.items);
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause, locale));
		}
	}, [range, selectedProject, locale]);
	useEffect(() => void load(), [load]);
	const runFunnel = async () => {
		if (!selectedProject) return;
		const steps = stepsText
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean);
		if (steps.length < 2) {
			showErrorNotification(t("Add at least two comma-separated event names."));
			return;
		}
		try {
			setFunnel(await queryAnalyticsFunnel(selectedProject.id, { ...range, steps }));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		}
	};
	return (
		<ModulePage
			title={t("Funnels & retention")}
			description={t(
				"Understand conversion sequences and whether new installations return over time.",
			)}
			error={error}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<div className="space-y-6">
					<Card>
						<CardHeader>
							<CardTitle>{t("Funnel")}</CardTitle>
							<CardDescription>
								{t("Enter ordered event names separated by commas.")}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<Input
								aria-label={t("Funnel event names")}
								value={stepsText}
								onChange={(event) => setStepsText(event.target.value)}
							/>
							<Button onClick={() => void runFunnel()}>
								<MousePointerClick className="size-4" />
								{t("Run funnel")}
							</Button>
							<div className="space-y-3">
								{funnel?.steps.map((step, index) => (
									<div key={`${step.event_name}-${index}`} className="rounded-lg border p-3">
										<div className="flex items-center justify-between gap-3">
											<span className="font-medium">
												{index + 1}. {step.event_name}
											</span>
											<span>{t("People count", { count: step.subjects })}</span>
										</div>
										<div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
											<div
												className="h-full rounded-full bg-primary"
												style={{
													width: `${Math.max(2, step.conversion_from_first * 100)}%`,
												}}
											/>
										</div>
										<p className="mt-1 text-xs text-muted-foreground">
											{t("From first step", {
												percent: formatPercent(step.conversion_from_first, locale),
											})}
										</p>
									</div>
								))}
							</div>
						</CardContent>
					</Card>
					<Card>
						<CardHeader>
							<CardTitle>{t("Installation retention")}</CardTitle>
							<CardDescription>
								{t("Return rate by install cohort for the first 30 days.")}
							</CardDescription>
						</CardHeader>
						<CardContent>
							<DataTable
								columns={[t("Cohort"), t("Size"), t("Day 1"), t("Day 7"), t("Day 30")]}
								empty={t("Retention appears once installations return and emit events.")}
							>
								{retention?.cohorts.slice(-20).map((cohort) => (
									<FrontTableRow key={cohort.cohort_date} className="border-b last:border-0">
										<Cell>{formatDay(cohort.cohort_date, locale)}</Cell>
										<Cell>{formatNumber(cohort.size, locale)}</Cell>
										{[1, 7, 30].map((day) => (
											<Cell key={day}>
												{formatPercent(
													cohort.days.find((entry) => entry.day === day)?.rate ?? 0,
													locale,
												)}
											</Cell>
										))}
									</FrontTableRow>
								))}
							</DataTable>
						</CardContent>
					</Card>
					<Card>
						<CardHeader>
							<CardTitle>{t("Known event definitions")}</CardTitle>
							<CardDescription>
								{t("Most recently observed event vocabulary for funnel and journey configuration.")}
							</CardDescription>
						</CardHeader>
						<CardContent className="flex flex-wrap gap-2">
							{definitions.length ? (
								definitions.map((definition) => (
									<Badge key={definition.event_name} variant="outline">
										{definition.event_name} · {formatNumber(definition.event_count, locale)}
									</Badge>
								))
							) : (
								<p className="text-sm text-muted-foreground">
									{t("No events have been projected yet.")}
								</p>
							)}
						</CardContent>
					</Card>
				</div>
			)}
		</ModulePage>
	);
}

function ReportsPage() {
	const { t, locale } = useAnalyticsI18n();
	const { selectedProject } = useProjectSelection();
	const [reports, setReports] = useState<SavedAnalyticsReport[]>([]);
	const [operations, setOperations] = useState<AnalyticsOperation[]>([]);
	const [name, setName] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const load = useCallback(async () => {
		if (!selectedProject) return;
		try {
			const [saved, jobs] = await Promise.all([
				getAnalyticsReports(selectedProject.id),
				getAnalyticsOperations(selectedProject.id),
			]);
			setReports(saved.items);
			setOperations(jobs.items);
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
			title={t("Reports & data operations")}
			description={t("Save reusable analysis definitions and run durable export or rollup jobs.")}
			error={error}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<div className="space-y-6">
					<Card>
						<CardHeader>
							<CardTitle>{t("Saved reports")}</CardTitle>
							<CardDescription>
								{t("Definitions stay scoped to the selected project.")}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="flex gap-2">
								<Input
									value={name}
									onChange={(event) => setName(event.target.value)}
									placeholder={t("Weekly product pulse")}
									aria-label={t("Report name")}
								/>
								<Button
									disabled={busy || !name.trim()}
									onClick={() =>
										void run(async () => {
											await createAnalyticsReport(selectedProject.id, {
												report_type: "dashboard",
												name: name.trim(),
												description: t("Dashboard report"),
												definition: {
													range_days: 30,
													metrics: ["events", "sessions", "installations", "purchases"],
												},
												enabled: true,
											});
											setName("");
										}, t("Report saved"))
									}
								>
									<Plus className="size-4" />
									{t("Save")}
								</Button>
							</div>
							<div className="space-y-2">
								{reports.map((report) => (
									<div
										key={report.id}
										className="flex items-center justify-between gap-3 rounded-lg border p-3"
									>
										<div>
											<div className="font-medium">{report.name}</div>
											<div className="text-xs text-muted-foreground">
												{t("Report updated", {
													type: t(labelize(report.report_type)),
													date: formatDate(report.updated_at, locale),
												})}
											</div>
										</div>
										<Button
											variant="ghost"
											size="icon"
											aria-label={t("Delete item", { name: report.name })}
											disabled={busy}
											onClick={() =>
												void run(
													() => deleteAnalyticsReport(selectedProject.id, report.id),
													t("Report deleted"),
												)
											}
										>
											<Trash2 className="size-4" />
										</Button>
									</div>
								))}
								{!reports.length && (
									<p className="text-sm text-muted-foreground">{t("No saved reports yet.")}</p>
								)}
							</div>
						</CardContent>
					</Card>
					<Card>
						<CardHeader>
							<CardTitle>{t("Durable operations")}</CardTitle>
							<CardDescription>
								{t("Long-running work uses resumable Cloudflare Workflows.")}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="flex flex-wrap gap-2">
								<Button
									disabled={busy}
									onClick={() =>
										void run(
											() =>
												createAnalyticsOperation(selectedProject.id, {
													operation_type: "export",
													input: {},
												}),
											t("Export queued"),
										)
									}
								>
									<Download className="size-4" />
									{t("Export events")}
								</Button>
								<Button
									variant="outline"
									disabled={busy}
									onClick={() =>
										void run(
											() =>
												createAnalyticsOperation(selectedProject.id, {
													operation_type: "rebuild_rollups",
													input: {},
												}),
											t("Rollup rebuild queued"),
										)
									}
								>
									<DatabaseBackup className="size-4" />
									{t("Rebuild rollups")}
								</Button>
							</div>
							<DataTable
								columns={[t("Operation"), t("Status"), t("Created")]}
								empty={t("No analytics operations yet.")}
							>
								{operations.map((operation) => (
									<FrontTableRow key={operation.id} className="border-b last:border-0">
										<Cell>{t(labelize(operation.operation_type))}</Cell>
										<Cell>
											<Badge variant={operation.status === "failed" ? "destructive" : "outline"}>
												{t(labelize(operation.status))}
											</Badge>
										</Cell>
										<Cell>{formatDate(operation.created_at, locale)}</Cell>
									</FrontTableRow>
								))}
							</DataTable>
						</CardContent>
					</Card>
				</div>
			)}
		</ModulePage>
	);
}

function DataTable({
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
			<FrontTable className="w-full min-w-[680px] text-start text-sm">
				<FrontTableHeader className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
					<FrontTableRow>
						{columns.map((column) => (
							<FrontTableHead key={column} className="px-4 py-3 font-medium">
								{column}
							</FrontTableHead>
						))}
					</FrontTableRow>
				</FrontTableHeader>
				<FrontTableBody>
					{hasRows ? (
						children
					) : (
						<FrontTableRow>
							<FrontTableCell
								className="px-4 py-10 text-center text-muted-foreground"
								colSpan={columns.length}
							>
								{empty}
							</FrontTableCell>
						</FrontTableRow>
					)}
				</FrontTableBody>
			</FrontTable>
		</div>
	);
}

function Cell({ children }: { children: ReactNode }) {
	return <FrontTableCell className="px-4 py-3 align-top">{children}</FrontTableCell>;
}

function formatNumber(value: number | undefined, locale: string) {
	if (value === undefined || !Number.isFinite(value)) return "—";
	return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

function formatDay(value: string, locale: string) {
	return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
		new Date(value),
	);
}

function formatDate(value: string, locale: string) {
	return new Intl.DateTimeFormat(locale, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(value));
}

function formatPercent(value: number, locale: string) {
	return new Intl.NumberFormat(locale, {
		style: "percent",
		maximumFractionDigits: 1,
	}).format(value);
}

function formatPurchaseAmount(item: AnalyticsPurchase, locale: string) {
	if (item.amount_micros == null || !item.currency) return "—";
	try {
		return new Intl.NumberFormat(locale, {
			style: "currency",
			currency: item.currency,
		}).format(item.amount_micros / 1_000_000);
	} catch {
		return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(item.amount_micros / 1_000_000)} ${item.currency}`;
	}
}

function negativePurchase(type: string) {
	return type === "refund" || type === "chargeback" || type === "cancellation";
}

function labelize(value: string) {
	return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
