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
import { PluginConfigurationTab } from "@superboard/front-ui/plugin-configuration-tab";
import { Button } from "@superboard/front-ui/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "@superboard/front-ui/ui/card.js";
import { Input } from "@superboard/front-ui/ui/input.js";
import { Label } from "@superboard/front-ui/ui/label.js";
import { Switch } from "@superboard/front-ui/ui/switch.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@superboard/front-ui/ui/tabs.js";
import {
	Activity,
	Bell,
	CheckCheck,
	Clock3,
	DatabaseZap,
	RefreshCw,
	RotateCcw,
	Save,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
	discardSupportDeadLetter,
	getSupportOperationsHealth,
	listSupportDeadLetters,
	replaySupportDeadLetter,
	type SupportDeadLetter,
	type SupportOperationsHealth,
} from "../../api/support/operationsHealthService.js";
import {
	deleteSupportNotification,
	getSupportNotifications,
	getSupportNotificationPreferences,
	markAllSupportNotificationsRead,
	markSupportNotificationRead,
	snoozeSupportNotification,
	updateSupportNotificationPreferences,
	type SupportNotification,
	type SupportNotificationPreferences,
} from "../../api/support/operationsService.js";
import {
	getSupportSettings,
	updateSupportSettings,
	type SupportProjectSettings,
} from "../../api/support/settingsService.js";
import { useSupportI18n } from "../../i18n.js";
import { SupportDetail } from "../support/SupportModulePage.js";
import { AccessNotice, SupportEmpty, SupportMetric, SupportStatus } from "../support/SupportUi.js";
import SupportAutomationsPage from "./SupportAutomationsPage.js";
import SupportCaptainPage from "./SupportCaptainPage.js";
import SupportContactsPage from "./SupportContactsPage.js";
import SupportIntegrationsPage from "./SupportIntegrationsPage.js";
import { SupportQualityPage } from "./SupportQualityPage.js";
import SupportWorkforcePage from "./SupportWorkforcePage.js";

const sharedSettings = {
	workforce: { label: "Agents and teams", Component: SupportWorkforcePage },
	contacts: { label: "Contacts", Component: () => <SupportContactsPage embedded /> },
	automations: { label: "Shared automations", Component: SupportAutomationsPage },
	integrations: { label: "Integrations", Component: SupportIntegrationsPage },
	assistant: { label: "AI assistant", Component: SupportCaptainPage },
};

const defaults: SupportProjectSettings = {
	business_name: "",
	locale: "en",
	timezone: "UTC",
	date_format: "YYYY-MM-DD",
	auto_resolve_minutes: null,
	attachment_max_bytes: 10 * 1024 * 1024,
	allowed_content_types: [],
	features: {},
};
const notificationDefaults: SupportNotificationPreferences = {
	email_enabled: true,
	push_enabled: true,
	browser_enabled: true,
	in_app_enabled: true,
	audio_enabled: true,
	muted_event_types: [],
};

export default function SupportSettingsPage() {
	const { t, locale } = useSupportI18n();
	const { selectedProject, selectedInstance } = useProjectSelection();
	const projectRef = selectedProject?.id;
	const administrator = new Set(["owner", "admin"]).has(selectedInstance?.role || "member");
	const [settings, setSettings] = useState(defaults);
	const [featuresJson, setFeaturesJson] = useState("{}");
	const [operations, setOperations] = useState<SupportOperationsHealth | null>(null);
	const [deadLetters, setDeadLetters] = useState<SupportDeadLetter[]>([]);
	const [notifications, setNotifications] = useState<SupportNotification[]>([]);
	const [notificationPreferences, setNotificationPreferences] = useState(notificationDefaults);
	const [mutedEvents, setMutedEvents] = useState("");
	const [notificationsLoading, setNotificationsLoading] = useState(true);
	const [notificationError, setNotificationError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const [activeTab, setActiveTab] = useState(() => {
		const requested =
			typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab");
		return requested &&
			(["general", "notifications", "operations", "configuration"].includes(requested) ||
				Object.hasOwn(sharedSettings, requested))
			? requested
			: "general";
	});

	const loadSettings = useCallback(async () => {
		if (!projectRef) return;
		try {
			const loaded = (await getSupportSettings(projectRef)).data.settings;
			setSettings(loaded);
			setFeaturesJson(JSON.stringify(loaded.features, null, 2));
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause));
		} finally {
			setLoading(false);
		}
	}, [projectRef]);
	const loadOperations = useCallback(async () => {
		if (!projectRef || !administrator) return;
		try {
			const [health, letters] = await Promise.all([
				getSupportOperationsHealth(projectRef),
				listSupportDeadLetters(projectRef),
			]);
			setOperations(health.data);
			setDeadLetters(letters.data);
		} catch (cause) {
			setError(moduleErrorMessage(cause));
		}
	}, [administrator, projectRef]);
	const loadNotifications = useCallback(async () => {
		if (!projectRef) return;
		try {
			const [items, preferences] = await Promise.all([
				getSupportNotifications(projectRef),
				getSupportNotificationPreferences(projectRef),
			]);
			setNotifications(items.data);
			setNotificationPreferences(preferences.data);
			setMutedEvents(preferences.data.muted_event_types.join(", "));
			setNotificationError(null);
		} catch (cause) {
			setNotificationError(moduleErrorMessage(cause));
		} finally {
			setNotificationsLoading(false);
		}
	}, [projectRef]);
	useEffect(() => {
		if (activeTab !== "general") return;
		let active = true;
		Promise.resolve().then(() => {
			if (active) void loadSettings();
		});
		return () => {
			active = false;
		};
	}, [activeTab, loadSettings]);
	useEffect(() => {
		if (activeTab !== "operations") return;
		let active = true;
		Promise.resolve().then(() => {
			if (active) void loadOperations();
		});
		return () => {
			active = false;
		};
	}, [activeTab, loadOperations]);
	useEffect(() => {
		if (activeTab !== "notifications") return;
		let active = true;
		Promise.resolve().then(() => {
			if (active) void loadNotifications();
		});
		return () => {
			active = false;
		};
	}, [activeTab, loadNotifications]);

	const save = async () => {
		if (!projectRef) return;
		setLoading(true);
		try {
			const features: unknown = JSON.parse(featuresJson);
			if (!features || typeof features !== "object" || Array.isArray(features))
				throw new Error(t("Every feature flag must be true or false"));
			const flags: Record<string, boolean> = {};
			for (const [key, value] of Object.entries(features)) {
				if (typeof value !== "boolean")
					throw new Error(t("Every feature flag must be true or false"));
				flags[key] = value;
			}
			await updateSupportSettings(projectRef, {
				...settings,
				allowed_content_types: settings.allowed_content_types.filter(Boolean),
				features: flags,
			});
			showSuccessNotification(t("Support settings saved"));
			await loadSettings();
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		} finally {
			setLoading(false);
		}
	};

	const resolveDeadLetter = async (item: SupportDeadLetter, action: "replay" | "discard") => {
		if (!projectRef) return;
		try {
			if (action === "replay") await replaySupportDeadLetter(projectRef, item.id);
			else await discardSupportDeadLetter(projectRef, item.id);
			showSuccessNotification(
				action === "replay" ? "Support job replayed" : "Support job discarded",
			);
			await loadOperations();
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		}
	};

	const saveNotificationPreferences = async () => {
		if (!projectRef) return;
		setNotificationsLoading(true);
		try {
			const muted = [
				...new Set(
					mutedEvents
						.split(",")
						.map((item) => item.trim())
						.filter(Boolean),
				),
			];
			await updateSupportNotificationPreferences(projectRef, {
				...notificationPreferences,
				muted_event_types: muted,
			});
			showSuccessNotification(t("Notification preferences saved"));
			await loadNotifications();
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		} finally {
			setNotificationsLoading(false);
		}
	};

	const updateNotification = async (
		item: SupportNotification,
		action: "read" | "snooze" | "delete",
	) => {
		if (!projectRef) return;
		try {
			if (action === "read") {
				await markSupportNotificationRead(projectRef, item.id);
			} else if (action === "snooze") {
				await snoozeSupportNotification(
					projectRef,
					item.id,
					new Date(Date.now() + 60 * 60 * 1000).toISOString(),
				);
			} else {
				await deleteSupportNotification(projectRef, item.id);
			}
			await loadNotifications();
			showSuccessNotification(
				action === "read"
					? "Notification marked as read"
					: action === "snooze"
						? "Notification snoozed for one hour"
						: "Notification removed",
			);
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		}
	};

	const markAllNotificationsRead = async () => {
		if (!projectRef) return;
		try {
			await markAllSupportNotificationsRead(projectRef);
			await loadNotifications();
			showSuccessNotification("All notifications marked as read");
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		}
	};

	useEffect(() => {
		if (window.location.pathname === "/support/configuration") {
			const url = new URL(window.location.href);
			url.pathname = "/support/settings";
			if (!url.searchParams.has("tab")) url.searchParams.set("tab", "general");
			window.location.replace(url);
		}
	}, []);

	return (
		<ModulePage
			title={t("Settings")}
			description={t("Project-wide Support behavior, attachments, features and operations.")}
			error={error}
		>
			<Tabs
				value={activeTab}
				onValueChange={(value) => {
					setActiveTab(value);
					const url = new URL(window.location.href);
					url.searchParams.set("tab", value);
					window.history.replaceState(null, "", url);
				}}
			>
				<TabsList aria-label={t("Settings sections")} className="h-auto flex-wrap">
					<TabsTrigger value="general">{t("General")}</TabsTrigger>
					<TabsTrigger value="notifications">{t("Notifications")}</TabsTrigger>
					<TabsTrigger value="operations">{t("Operations")}</TabsTrigger>
					{Object.entries(sharedSettings).map(([value, { label }]) => (
						<TabsTrigger key={value} value={value}>
							{t(label)}
						</TabsTrigger>
					))}
					<TabsTrigger value="configuration">{t("Configuration")}</TabsTrigger>
				</TabsList>

				<TabsContent className="space-y-6" value="configuration">
					<PluginConfigurationTab locale={locale} />
				</TabsContent>

				{!selectedProject ? (
					<div className="pt-4">
						<EmptyProject />
					</div>
				) : (
					<>
						{Object.entries(sharedSettings).map(([value, { Component }]) => (
							<TabsContent key={value} value={value}>
								<SupportDetail>
									<Component />
								</SupportDetail>
							</TabsContent>
						))}
						<TabsContent className="space-y-6" value="general">
							<fieldset className="space-y-6" disabled={loading}>
								<Card>
									<CardHeader>
										<CardTitle className="text-base">{t("Support profile")}</CardTitle>
									</CardHeader>
									<CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
										<Field label={t("Business name")}>
											<Input
												value={settings.business_name}
												onChange={(e) =>
													setSettings((v) => ({
														...v,
														business_name: e.target.value,
													}))
												}
											/>
										</Field>
										<Field label={t("Locale")}>
											<Input
												value={settings.locale}
												onChange={(e) => setSettings((v) => ({ ...v, locale: e.target.value }))}
											/>
										</Field>
										<Field label={t("Timezone")}>
											<Input
												value={settings.timezone}
												onChange={(e) => setSettings((v) => ({ ...v, timezone: e.target.value }))}
											/>
										</Field>
										<Field label={t("Date format")}>
											<Input
												value={settings.date_format}
												onChange={(event) => {
													setSettings((current) => ({
														...current,
														date_format: event.target.value,
													}));
												}}
											/>
										</Field>
										<Field label={t("Auto-resolve after (minutes)")}>
											<Input
												min={0}
												type="number"
												value={settings.auto_resolve_minutes ?? ""}
												onChange={(e) =>
													setSettings((v) => ({
														...v,
														auto_resolve_minutes:
															e.target.value === "" ? null : Number(e.target.value),
													}))
												}
											/>
										</Field>
										<Field label={t("Attachment limit in bytes")}>
											<Input
												min={1}
												max={104857600}
												type="number"
												value={settings.attachment_max_bytes}
												onChange={(e) =>
													setSettings((v) => ({
														...v,
														attachment_max_bytes: Number(e.target.value),
													}))
												}
											/>
										</Field>
									</CardContent>
								</Card>
								<div className="space-y-4">
									<Card>
										<CardHeader>
											<CardTitle className="text-base">{t("Allowed attachments")}</CardTitle>
										</CardHeader>
										<CardContent className="space-y-3">
											<Field label={t("Allowed content types")}>
												<Input
													value={settings.allowed_content_types.join(", ")}
													onChange={(event) =>
														setSettings((current) => ({
															...current,
															allowed_content_types: event.target.value
																.split(",")
																.map((value) => value.trim()),
														}))
													}
												/>
											</Field>
										</CardContent>
									</Card>
									<details className="rounded-md border p-4">
										<summary className="cursor-pointer text-sm">{t("Advanced settings")}</summary>
										<Field label={t("Feature flags")}>
											<textarea
												aria-label={t("Feature flags")}
												className="min-h-32 w-full rounded-md border p-3 font-mono text-sm"
												value={featuresJson}
												onChange={(event) => {
													setFeaturesJson(event.target.value);
												}}
											/>
										</Field>
									</details>
								</div>
								<div className="flex justify-end">
									<Button disabled={loading || Boolean(error)} onClick={() => void save()}>
										<Save /> {t("Save settings")}
									</Button>
								</div>
							</fieldset>
						</TabsContent>
						<TabsContent className="space-y-6" value="notifications">
							{notificationError ? (
								<AccessNotice>
									{notificationError}
									{t(
										". Personal notification controls require an active Support membership; project administration remains available in the other Settings tabs.",
									)}
								</AccessNotice>
							) : (
								<div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
									<Card>
										<CardHeader>
											<CardTitle className="flex items-center gap-2 text-base">
												<Bell /> {t("Delivery preferences")}
											</CardTitle>
										</CardHeader>
										<CardContent className="space-y-4">
											{(
												[
													["email_enabled", "Email"],
													["push_enabled", "Mobile push"],
													["browser_enabled", "Browser"],
													["in_app_enabled", "In-app"],
													["audio_enabled", "Notification sounds"],
												] as const
											).map(([key, label]) => (
												<div className="flex items-center justify-between gap-4" key={key}>
													<Label>{t(label)}</Label>
													<Switch
														aria-label={t(label)}
														disabled={notificationsLoading}
														checked={notificationPreferences[key]}
														onCheckedChange={(enabled) =>
															setNotificationPreferences((current) => ({
																...current,
																[key]: enabled,
															}))
														}
													/>
												</div>
											))}
											<Field label={t("Muted event types")}>
												<Input
													placeholder={t("assignment.updated, sla.warning")}
													value={mutedEvents}
													onChange={(event) => setMutedEvents(event.target.value)}
												/>
											</Field>
											<p className="text-xs text-muted-foreground">
												{t(
													"Use comma-separated native Support event names. Muted events remain visible in audit history.",
												)}
											</p>
											<Button
												className="w-full"
												disabled={notificationsLoading}
												onClick={() => void saveNotificationPreferences()}
											>
												<Save /> {t("Save preferences")}
											</Button>
										</CardContent>
									</Card>
									<Card>
										<CardHeader>
											<CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
												<span>{t("Recent notifications")}</span>
												<Button
													size="sm"
													variant="outline"
													onClick={() => void markAllNotificationsRead()}
												>
													<CheckCheck /> {t("Read all")}
												</Button>
											</CardTitle>
										</CardHeader>
										<CardContent className="space-y-3">
											{notifications.length === 0 ? (
												<SupportEmpty
													title={t("No notifications")}
													description={t(
														"Assignment, SLA and conversation notifications will appear here.",
													)}
												/>
											) : (
												notifications.map((item) => (
													<div className="rounded-md border p-3" key={item.id}>
														<div className="flex flex-wrap items-start justify-between gap-3">
															<div>
																<p className="font-medium">{item.title}</p>
																<p className="mt-1 text-sm text-muted-foreground">{item.body}</p>
																<p className="mt-2 text-xs text-muted-foreground">
																	{new Date(item.created_at).toLocaleString()} ·{" "}
																	{item.notification_type}
																</p>
															</div>
															<SupportStatus value={item.read_at ? "read" : "unread"} />
														</div>
														<div className="mt-3 flex flex-wrap justify-end gap-2">
															{!item.read_at ? (
																<Button
																	size="sm"
																	variant="outline"
																	onClick={() => void updateNotification(item, "read")}
																>
																	<CheckCheck /> {t("Mark read")}
																</Button>
															) : null}
															<Button
																size="sm"
																variant="outline"
																onClick={() => void updateNotification(item, "snooze")}
															>
																<Clock3 /> {t("Snooze 1 hour")}
															</Button>
															<Button
																size="sm"
																variant="ghost"
																onClick={() => void updateNotification(item, "delete")}
															>
																<Trash2 /> {t("Remove")}
															</Button>
														</div>
													</div>
												))
											)}
										</CardContent>
									</Card>
								</div>
							)}
						</TabsContent>
						<TabsContent className="space-y-6" value="operations">
							{!administrator ? (
								<AccessNotice>
									{t(
										"Operations and delivery diagnostics are available to project owners and administrators.",
									)}
								</AccessNotice>
							) : (
								<>
									<div className="flex justify-end">
										<Button variant="outline" onClick={() => void loadOperations()}>
											<RefreshCw /> {t("Refresh diagnostics")}
										</Button>
									</div>
									<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
										<SupportMetric label={t("Queued jobs")} value={total(operations?.queues)} />
										<SupportMetric
											label={t("Dead letters")}
											value={total(operations?.dead_letters)}
										/>
										<SupportMetric
											label={t("Provider events")}
											value={total(operations?.providers)}
										/>
										<SupportMetric
											label={t("Knowledge documents")}
											value={total(operations?.knowledge)}
										/>
									</div>
									<div className="grid gap-6 xl:grid-cols-2">
										<OperationGroup
											icon={<Activity />}
											title={t("Queues and schedules")}
											rows={operations?.queues ?? []}
											label={(row) => String(row.queue_name || "Support queue")}
										/>
										<OperationGroup
											icon={<DatabaseZap />}
											title={t("Indexing and bulk jobs")}
											rows={[
												...(operations?.knowledge ?? []),
												...(operations?.imports ?? []),
												...(operations?.exports ?? []),
											]}
											label={(row) => String(row.status || "queued")}
										/>
									</div>
									<OperationGroup
										icon={<Activity />}
										title={t("Provider diagnostics")}
										rows={operations?.providers ?? []}
										label={(row) => String(row.provider || "Support provider")}
									/>
									<Card>
										<CardHeader>
											<CardTitle className="text-base">{t("Dead-letter quarantine")}</CardTitle>
										</CardHeader>
										<CardContent className="space-y-2">
											{deadLetters.filter((item) => item.status === "quarantined").length === 0 ? (
												<SupportEmpty
													title={t("Quarantine is empty")}
													description={t("No Support jobs currently require an operator decision.")}
												/>
											) : (
												deadLetters
													.filter((item) => item.status === "quarantined")
													.map((item) => (
														<div
															key={item.id}
															className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
														>
															<div>
																<p className="font-medium">
																	{item.job_type || "Unclassified Support job"}
																</p>
																<p className="text-xs text-muted-foreground">
																	{item.source_queue} · {item.attempts} {t("attempts")}
																</p>
															</div>
															<div className="flex gap-2">
																{item.replayable ? (
																	<Button
																		size="sm"
																		variant="outline"
																		onClick={() => void resolveDeadLetter(item, "replay")}
																	>
																		<RotateCcw /> {t("Replay")}
																	</Button>
																) : null}
																<Button
																	size="sm"
																	variant="ghost"
																	onClick={() => void resolveDeadLetter(item, "discard")}
																>
																	<Trash2 /> {t("Discard")}
																</Button>
															</div>
														</div>
													))
											)}
										</CardContent>
									</Card>
								</>
							)}
							<SupportDetail>
								<SupportQualityPage auditOnly />
							</SupportDetail>
						</TabsContent>
					</>
				)}
			</Tabs>
		</ModulePage>
	);
}

type CountRow = {
	status?: string;
	count: number;
	queue_name?: string;
	provider?: string;
};
function OperationGroup({
	icon,
	title,
	rows,
	label,
}: {
	icon: React.ReactNode;
	title: string;
	rows: CountRow[];
	label: (row: CountRow) => string;
}) {
	const { t } = useSupportI18n();

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-base">
					{icon}
					{title}
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-2">
				{rows.length === 0 ? (
					<SupportEmpty
						title={t("Healthy and idle")}
						description={t("No queued or failed work is currently recorded.")}
					/>
				) : (
					rows.map((row, index) => (
						<div
							className="flex items-center justify-between rounded-md border p-3"
							key={`${label(row)}-${row.status}-${index}`}
						>
							<div>
								<p className="font-medium">{label(row)}</p>
								<SupportStatus value={row.status} />
							</div>
							<strong>{Number(row.count).toLocaleString()}</strong>
						</div>
					))
				)}
			</CardContent>
		</Card>
	);
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<Label className="block space-y-2">
			<span>{label}</span>
			{children}
		</Label>
	);
}
function total(rows?: Array<{ count: number }>) {
	return (rows ?? []).reduce((sum, row) => sum + Number(row.count), 0).toLocaleString();
}
