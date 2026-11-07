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
import { PluginDiagnosticsLink } from "@superboard/front-ui/plugin-diagnostics-link";
import {
	AutosaveIndicator,
	SettingsActions,
	SettingsDependents,
	SettingsRow,
	SettingsSection,
	SettingsTextField,
	SwitchField,
	useSettingsAutosave,
} from "@superboard/front-ui/settings-form";
import { Button } from "@superboard/front-ui/ui/button.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@superboard/front-ui/ui/tabs.js";
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
	getSupportNotificationPreferences,
	updateSupportNotificationPreferences,
	type SupportNotificationPreferences,
} from "../../api/support/operationsService.js";
import {
	getSupportSettings,
	updateSupportSettings,
	type SupportProjectSettings,
} from "../../api/support/settingsService.js";
import { useSupportI18n } from "../../i18n.js";
import { SupportDetail } from "../support/SupportModulePage.js";
import { SettingsDurationField, SettingsValidatedField } from "../support/SupportSettingsFields.js";
import {
	AccessNotice,
	SupportLoading,
	SupportMetric,
	SupportStatus,
	supportChannelLabel,
	supportStatusLabel,
} from "../support/SupportUi.js";
import SupportCaptainPage from "./SupportCaptainPage.js";
import SupportIntegrationsPage from "./SupportIntegrationsPage.js";
import SupportWorkforcePage from "./SupportWorkforcePage.js";

const sharedSettings = {
	workforce: { label: "Agents and teams", Component: SupportWorkforcePage },
	integrations: { label: "Integrations", Component: SupportIntegrationsPage },
	assistant: { label: "AI assistant", Component: SupportCaptainPage },
};

const bytesPerMegabyte = 1024 * 1024;
const maximumAttachmentMegabytes = 10;
const defaultAutoResolveMinutes = 1440;
const minimumAutoResolveMinutes = 1;
const maximumAutoResolveMinutes = 525_600;
const eventNamePattern = /^[a-z][a-z0-9_.-]*$/u;

const deliveryChannels = [
	["email_enabled", "Email"],
	["push_enabled", "Mobile push"],
	["browser_enabled", "Browser"],
	["in_app_enabled", "In-app"],
	["audio_enabled", "Notification sounds"],
] as const;
type DeliveryKey = (typeof deliveryChannels)[number][0];
const builtInEvents = [
	["conversation_assigned", "Conversation assignments"],
	["workflow", "Automation notifications"],
] as const;
const builtInEventNames = new Set<string>(builtInEvents.map(([name]) => name));

type SettingsDraft = {
	project: string;
	value: SupportProjectSettings;
	contentTypes: string;
	attachmentSize: string;
	autoResolveInput: number | "";
};
type PreferencesDraft = {
	project: string;
	delivery: Record<DeliveryKey, boolean>;
	muted: string[];
	otherMuted: string;
};

function commaList(value: string) {
	return value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

function megabytes(bytes: number) {
	return String(Math.round((bytes / bytesPerMegabyte) * 100) / 100);
}

function attachmentBytes(size: string) {
	const value = Number(size);
	if (size.trim() === "" || !Number.isFinite(value)) return null;
	const bytes = Math.round(value * bytesPerMegabyte);
	return bytes >= 1 && bytes <= maximumAttachmentMegabytes * bytesPerMegabyte ? bytes : null;
}

function settingsDraft(project: string, settings: SupportProjectSettings): SettingsDraft {
	return {
		project,
		value: settings,
		contentTypes: settings.allowed_content_types.join(", "),
		attachmentSize: megabytes(settings.attachment_max_bytes),
		autoResolveInput: settings.auto_resolve_minutes ?? defaultAutoResolveMinutes,
	};
}

function autoResolveValid(minutes: number | ""): minutes is number {
	return (
		minutes !== "" && minutes >= minimumAutoResolveMinutes && minutes <= maximumAutoResolveMinutes
	);
}

function settingsPayload(draft: SettingsDraft): SupportProjectSettings {
	const { value } = draft;
	return {
		business_name: value.business_name,
		locale: value.locale,
		timezone: value.timezone,
		date_format: value.date_format,
		auto_resolve_minutes: value.auto_resolve_minutes,
		attachment_max_bytes: value.attachment_max_bytes,
		allowed_content_types: commaList(draft.contentTypes),
		features: value.features,
	};
}

function preferencesDraft(
	project: string,
	preferences: SupportNotificationPreferences,
): PreferencesDraft {
	return {
		project,
		delivery: {
			email_enabled: preferences.email_enabled,
			push_enabled: preferences.push_enabled,
			browser_enabled: preferences.browser_enabled,
			in_app_enabled: preferences.in_app_enabled,
			audio_enabled: preferences.audio_enabled,
		},
		muted: preferences.muted_event_types.filter((name) => builtInEventNames.has(name)),
		otherMuted: preferences.muted_event_types
			.filter((name) => !builtInEventNames.has(name))
			.join(", "),
	};
}

function preferencesPayload(draft: PreferencesDraft): SupportNotificationPreferences {
	return {
		...draft.delivery,
		muted_event_types: [
			...new Set([
				...builtInEvents.map(([name]) => name).filter((name) => draft.muted.includes(name)),
				...commaList(draft.otherMuted),
			]),
		],
	};
}

export default function SupportSettingsPage() {
	const { t, locale } = useSupportI18n();
	const { selectedProject, selectedInstance } = useProjectSelection();
	const projectRef = selectedProject?.id;
	const administrator = new Set(["owner", "admin"]).has(selectedInstance?.role || "member");
	const [settingsState, setSettingsState] = useState<SettingsDraft | null>(null);
	const [preferencesState, setPreferencesState] = useState<PreferencesDraft | null>(null);
	const [operations, setOperations] = useState<SupportOperationsHealth | null>(null);
	const [deadLetters, setDeadLetters] = useState<SupportDeadLetter[]>([]);
	const [notificationError, setNotificationError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const settings = settingsState?.project === projectRef ? settingsState : null;
	const preferences = preferencesState?.project === projectRef ? preferencesState : null;

	const [activeTab, setActiveTab] = useState(() => {
		const requested =
			typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab");
		return requested &&
			(["general", "notifications", "operations"].includes(requested) ||
				Object.hasOwn(sharedSettings, requested))
			? requested
			: "general";
	});

	const settingsValid =
		settings !== null &&
		(settings.value.auto_resolve_minutes === null || autoResolveValid(settings.autoResolveInput)) &&
		attachmentBytes(settings.attachmentSize) !== null;
	const settingsAutosave = useSettingsAutosave({
		resourceKey: `settings:${settings?.project ?? ""}`,
		value: settings ? { project: settings.project, settings: settingsPayload(settings) } : null,
		enabled: settingsValid,
		save: async (request) => {
			if (!request) return;
			try {
				await updateSupportSettings(request.project, request.settings);
			} catch (cause) {
				showErrorNotification(moduleErrorMessage(cause, locale));
				throw cause;
			}
		},
	});
	const otherMutedInvalid =
		preferences !== null &&
		!commaList(preferences.otherMuted).every((name) => eventNamePattern.test(name));
	const preferencesAutosave = useSettingsAutosave({
		resourceKey: `preferences:${preferences?.project ?? ""}`,
		value: preferences
			? { project: preferences.project, preferences: preferencesPayload(preferences) }
			: null,
		enabled: preferences !== null && !otherMutedInvalid,
		save: async (request) => {
			if (!request) return;
			try {
				await updateSupportNotificationPreferences(request.project, request.preferences);
			} catch (cause) {
				showErrorNotification(moduleErrorMessage(cause, locale));
				throw cause;
			}
		},
	});

	const updateSettings = (change: (draft: SettingsDraft) => SettingsDraft) => {
		setSettingsState((current) => (current ? change(current) : current));
	};
	const updatePreferences = (change: (draft: PreferencesDraft) => PreferencesDraft) => {
		setPreferencesState((current) => (current ? change(current) : current));
	};

	const loadSettings = useCallback(async () => {
		if (!projectRef) return;
		try {
			const loaded = (await getSupportSettings(projectRef)).data.settings;
			setSettingsState(settingsDraft(projectRef, loaded));
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause, locale));
		}
	}, [projectRef, locale]);
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
			setError(moduleErrorMessage(cause, locale));
		}
	}, [administrator, projectRef, locale]);
	const loadPreferences = useCallback(async () => {
		if (!projectRef) return;
		try {
			const loaded = (await getSupportNotificationPreferences(projectRef)).data;
			setPreferencesState(preferencesDraft(projectRef, loaded));
			setNotificationError(null);
		} catch (cause) {
			setNotificationError(moduleErrorMessage(cause, locale));
		}
	}, [projectRef, locale]);
	const settingsLoaded = settings !== null;
	useEffect(() => {
		if ((activeTab !== "general" && activeTab !== "operations") || settingsLoaded) return;
		let active = true;
		Promise.resolve()
			.then(async () => {
				if (active) await loadSettings();
			})
			.catch((cause: unknown) => {
				setError(moduleErrorMessage(cause, locale));
			});
		return () => {
			active = false;
		};
	}, [activeTab, loadSettings, settingsLoaded, locale]);
	useEffect(() => {
		if (activeTab !== "operations") return;
		let active = true;
		Promise.resolve()
			.then(async () => {
				if (active) await loadOperations();
			})
			.catch((cause: unknown) => {
				setError(moduleErrorMessage(cause, locale));
			});
		return () => {
			active = false;
		};
	}, [activeTab, loadOperations, locale]);
	const preferencesLoaded = preferences !== null;
	useEffect(() => {
		if (activeTab !== "notifications" || preferencesLoaded) return;
		let active = true;
		Promise.resolve()
			.then(async () => {
				if (active) await loadPreferences();
			})
			.catch((cause: unknown) => {
				setNotificationError(moduleErrorMessage(cause, locale));
			});
		return () => {
			active = false;
		};
	}, [activeTab, loadPreferences, preferencesLoaded, locale]);

	const resolveDeadLetter = async (item: SupportDeadLetter, action: "replay" | "discard") => {
		if (!projectRef) return;
		if (
			action === "discard" &&
			!window.confirm(
				t("Discard {name}? It will not run again.", {
					name: item.job_type || t("Unclassified Support job"),
				}),
			)
		)
			return;
		try {
			if (action === "replay") await replaySupportDeadLetter(projectRef, item.id);
			else await discardSupportDeadLetter(projectRef, item.id);
			showSuccessNotification(
				action === "replay" ? t("Support job replayed") : t("Support job discarded"),
			);
			await loadOperations();
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		}
	};

	useEffect(() => {
		const movedTab = new URLSearchParams(window.location.search).get("tab");
		if (movedTab === "automations" || movedTab === "contacts") {
			const url = new URL(window.location.href);
			url.pathname = "/support/inbox";
			url.searchParams.delete("tab");
			url.searchParams.set("section", movedTab);
			window.location.replace(url);
			return;
		}
		if (window.location.pathname === "/support/configuration") {
			const url = new URL(window.location.href);
			url.pathname = "/support/settings";
			if (!url.searchParams.has("tab")) url.searchParams.set("tab", "general");
			window.location.replace(url);
		}
	}, []);

	const quarantined = deadLetters.filter((item) => item.status === "quarantined");

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
					url.searchParams.delete("contact");
					window.history.replaceState(null, "", url);
				}}
			>
				<TabsList aria-label={t("Settings sections")} className="h-auto flex-wrap">
					<TabsTrigger value="general">{t("General")}</TabsTrigger>
					<TabsTrigger value="notifications">{t("Notifications")}</TabsTrigger>
					{Object.entries(sharedSettings).map(([value, { label }]) => (
						<TabsTrigger key={value} value={value}>
							{t(label)}
						</TabsTrigger>
					))}
					<TabsTrigger value="operations">{t("Advanced")}</TabsTrigger>
				</TabsList>

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
						<TabsContent className="space-y-8 pt-4" value="general">
							{settings ? (
								<>
									<SettingsSection
										title={t("Support profile")}
										description={t("How your Support team introduces itself to customers.")}
									>
										<SettingsRow>
											<SettingsTextField
												label={t("Business name")}
												description={t(
													"Shown to customers in the widget, in transcripts and as the sender of SMTP replies.",
												)}
												value={settings.value.business_name}
												onChange={(event) => {
													const business_name = event.target.value;
													updateSettings((draft) => ({
														...draft,
														value: { ...draft.value, business_name },
													}));
												}}
											/>
										</SettingsRow>
										<SettingsRow>
											<SettingsTextField
												label={t("Locale")}
												description={t(
													"Language code used for customer messages, for example en or fr.",
												)}
												value={settings.value.locale}
												onChange={(event) => {
													const value = event.target.value;
													updateSettings((draft) => ({
														...draft,
														value: { ...draft.value, locale: value },
													}));
												}}
											/>
										</SettingsRow>
										<SettingsRow>
											<SettingsTextField
												label={t("Timezone")}
												description={t(
													"Used for times shown to customers, for example Europe/Paris or UTC.",
												)}
												value={settings.value.timezone}
												onChange={(event) => {
													const timezone = event.target.value;
													updateSettings((draft) => ({
														...draft,
														value: { ...draft.value, timezone },
													}));
												}}
											/>
										</SettingsRow>
										<SettingsRow>
											<SettingsTextField
												label={t("Date format")}
												description={t(
													"Used for dates in conversation transcripts, for example YYYY-MM-DD or DD/MM/YYYY.",
												)}
												value={settings.value.date_format}
												onChange={(event) => {
													const date_format = event.target.value;
													updateSettings((draft) => ({
														...draft,
														value: { ...draft.value, date_format },
													}));
												}}
											/>
										</SettingsRow>
									</SettingsSection>
									<SettingsSection
										title={t("Conversations")}
										description={t("What happens to conversations that receive no new message.")}
									>
										<SettingsRow>
											<SwitchField
												label={t("Resolve inactive conversations automatically")}
												checked={settings.value.auto_resolve_minutes !== null}
												onCheckedChange={(enabled) => {
													updateSettings((draft) => ({
														...draft,
														autoResolveInput: defaultAutoResolveMinutes,
														value: {
															...draft.value,
															auto_resolve_minutes: enabled ? defaultAutoResolveMinutes : null,
														},
													}));
												}}
											/>
											{settings.value.auto_resolve_minutes !== null && (
												<SettingsDependents>
													<SettingsDurationField
														label={t("Resolve after")}
														minutes={settings.autoResolveInput}
														error={
															autoResolveValid(settings.autoResolveInput)
																? undefined
																: t("Enter a duration between one minute and one year.")
														}
														onChange={(minutes) => {
															updateSettings((draft) => ({
																...draft,
																autoResolveInput: minutes,
																value: autoResolveValid(minutes)
																	? { ...draft.value, auto_resolve_minutes: minutes }
																	: draft.value,
															}));
														}}
													/>
												</SettingsDependents>
											)}
										</SettingsRow>
									</SettingsSection>
									<AutosaveIndicator
										status={settingsAutosave.status}
										onRetry={settingsAutosave.retry}
									/>
								</>
							) : error ? null : (
								<SupportLoading />
							)}
						</TabsContent>
						<TabsContent className="space-y-8 pt-4" value="notifications">
							{notificationError ? (
								<AccessNotice>
									{notificationError}
									{t(
										". Personal notification controls require an active Support membership; project administration remains available in the other Settings tabs.",
									)}
								</AccessNotice>
							) : (
								<>
									{preferences ? (
										<>
											<SettingsSection
												title={t("Delivery preferences")}
												description={t("Where your personal Support notifications reach you.")}
											>
												{deliveryChannels.map(([key, label]) => (
													<SettingsRow key={key}>
														<SwitchField
															label={t(label)}
															checked={preferences.delivery[key]}
															onCheckedChange={(enabled) => {
																updatePreferences((draft) => ({
																	...draft,
																	delivery: { ...draft.delivery, [key]: enabled },
																}));
															}}
														/>
													</SettingsRow>
												))}
											</SettingsSection>
											<SettingsSection
												title={t("Notify me about")}
												description={t("Turn off the events you do not want to be notified about.")}
											>
												{builtInEvents.map(([name, label]) => (
													<SettingsRow key={name}>
														<SwitchField
															label={t(label)}
															checked={!preferences.muted.includes(name)}
															onCheckedChange={(enabled) => {
																updatePreferences((draft) => ({
																	...draft,
																	muted: enabled
																		? draft.muted.filter((item) => item !== name)
																		: [...draft.muted, name],
																}));
															}}
														/>
													</SettingsRow>
												))}
											</SettingsSection>
										</>
									) : (
										<SupportLoading />
									)}
									{preferences && (
										<SettingsSection
											title={t("Advanced")}
											description={t("Mute other event types by their technical name.")}
										>
											<SettingsRow>
												<SettingsValidatedField
													label={t("Muted event types")}
													placeholder={t("conversation_assigned, workflow")}
													description={t(
														"Use comma-separated native Support event names. Muted events remain visible in audit history.",
													)}
													error={
														otherMutedInvalid
															? t("Use lowercase event names separated by commas.")
															: undefined
													}
													value={preferences.otherMuted}
													onChange={(event) => {
														const otherMuted = event.target.value;
														updatePreferences((draft) => ({ ...draft, otherMuted }));
													}}
												/>
											</SettingsRow>
										</SettingsSection>
									)}
									{preferences && (
										<AutosaveIndicator
											status={preferencesAutosave.status}
											onRetry={preferencesAutosave.retry}
										/>
									)}
								</>
							)}
						</TabsContent>
						<TabsContent className="space-y-8 pt-4" value="operations">
							{settings ? (
								<>
									<SettingsSection
										title={t("Attachments")}
										description={t("Limits for the files customers and agents can send.")}
									>
										<SettingsRow>
											<SettingsValidatedField
												label={t("Maximum attachment size (MB)")}
												inputMode="decimal"
												error={
													attachmentBytes(settings.attachmentSize) === null
														? t("Enter a size greater than 0 and at most {max} MB.", {
																max: maximumAttachmentMegabytes,
															})
														: undefined
												}
												value={settings.attachmentSize}
												onChange={(event) => {
													const attachmentSize = event.target.value;
													const bytes = attachmentBytes(attachmentSize);
													updateSettings((draft) => ({
														...draft,
														attachmentSize,
														value:
															bytes === null
																? draft.value
																: { ...draft.value, attachment_max_bytes: bytes },
													}));
												}}
											/>
										</SettingsRow>
										<SettingsRow>
											<SettingsTextField
												label={t("Allowed content types")}
												description={t(
													"Comma-separated file types, for example image/png, application/pdf. Leave empty to accept every type.",
												)}
												value={settings.contentTypes}
												onChange={(event) => {
													const contentTypes = event.target.value;
													updateSettings((draft) => ({ ...draft, contentTypes }));
												}}
											/>
										</SettingsRow>
									</SettingsSection>
								</>
							) : error ? null : (
								<SupportLoading />
							)}
							{!administrator ? (
								<AccessNotice>
									{t(
										"Operations and delivery diagnostics are available to project owners and administrators.",
									)}
								</AccessNotice>
							) : (
								<>
									<section className="space-y-3">
										<div className="space-y-1">
											<h2 className="text-base font-semibold">{t("Diagnostics")}</h2>
											<p className="text-sm text-kumo-subtle">
												{t("Live state of Support background work.")}
											</p>
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
										<SettingsActions>
											<Button variant="outline" onClick={() => void loadOperations()}>
												{t("Refresh diagnostics")}
											</Button>
										</SettingsActions>
									</section>
									<OperationGroup
										title={t("Queues and schedules")}
										description={t("Background work waiting to run.")}
										rows={operations?.queues ?? []}
										label={(row) => row.queue_name || t("Support queue")}
									/>
									<OperationGroup
										title={t("Indexing and bulk jobs")}
										description={t("Knowledge indexing, imports and exports.")}
										rows={[
											...(operations?.knowledge ?? []),
											...(operations?.imports ?? []),
											...(operations?.exports ?? []),
										]}
										label={(row) => t(supportStatusLabel(row.status || "queued"))}
									/>
									<OperationGroup
										title={t("Provider diagnostics")}
										description={t("Events received from connected channels.")}
										rows={operations?.providers ?? []}
										label={(row) =>
											row.provider ? t(supportChannelLabel(row.provider)) : t("Support provider")
										}
									/>
									<SettingsSection
										title={t("Dead-letter quarantine")}
										description={t("Jobs that failed repeatedly and wait for a decision.")}
									>
										{quarantined.length === 0 ? (
											<SettingsRow>
												<p className="text-sm font-medium">{t("Quarantine is empty")}</p>
												<p className="text-sm text-kumo-subtle">
													{t("No Support jobs currently require an operator decision.")}
												</p>
											</SettingsRow>
										) : (
											quarantined.map((item) => (
												<SettingsRow key={item.id}>
													<div>
														<p className="font-medium">
															{item.job_type || t("Unclassified Support job")}
														</p>
														<p className="text-xs text-kumo-subtle">
															{item.source_queue} · {item.attempts} {t("attempts")}
														</p>
													</div>
													<SettingsActions className="gap-2">
														{item.replayable ? (
															<Button
																size="sm"
																variant="outline"
																onClick={() => void resolveDeadLetter(item, "replay")}
															>
																{t("Replay")}
															</Button>
														) : null}
														<Button
															size="sm"
															variant="ghost"
															onClick={() => void resolveDeadLetter(item, "discard")}
														>
															{t("Discard")}
														</Button>
													</SettingsActions>
												</SettingsRow>
											))
										)}
									</SettingsSection>
								</>
							)}
							{settings && (
								<AutosaveIndicator
									status={settingsAutosave.status}
									onRetry={settingsAutosave.retry}
								/>
							)}
						</TabsContent>
					</>
				)}
			</Tabs>
			<PluginDiagnosticsLink locale={locale} />
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
	title,
	description,
	rows,
	label,
}: {
	title: string;
	description: string;
	rows: CountRow[];
	label: (row: CountRow) => string;
}) {
	const { t } = useSupportI18n();

	return (
		<SettingsSection title={title} description={description}>
			{rows.length === 0 ? (
				<SettingsRow>
					<p className="text-sm font-medium">{t("Healthy and idle")}</p>
					<p className="text-sm text-kumo-subtle">
						{t("No queued or failed work is currently recorded.")}
					</p>
				</SettingsRow>
			) : (
				rows.map((row, index) => (
					<SettingsRow
						className="flex items-center justify-between gap-4 space-y-0"
						key={`${label(row)}-${row.status}-${index}`}
					>
						<div className="space-y-1">
							<p className="font-medium">{label(row)}</p>
							<SupportStatus value={row.status} />
						</div>
						<strong>{Number(row.count).toLocaleString()}</strong>
					</SettingsRow>
				))
			)}
		</SettingsSection>
	);
}
function total(rows?: Array<{ count: number }>) {
	return (rows ?? []).reduce((sum, row) => sum + Number(row.count), 0).toLocaleString();
}
