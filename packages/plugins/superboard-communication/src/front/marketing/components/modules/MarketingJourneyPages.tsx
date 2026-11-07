"use client";

import DeleteConfirm from "@superboard/front-ui/common/delete-confirm.js";
import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { InputArea, Select, SwitchField } from "@superboard/front-ui/kumo";
import {
	showErrorNotification,
	showSuccessNotification,
} from "@superboard/front-ui/lib/Notifications.js";
import { cn } from "@superboard/front-ui/lib/utils.js";
import {
	EmptyProject,
	ModulePage,
	moduleErrorMessage,
} from "@superboard/front-ui/modules/ModulePage.js";
import {
	SettingsActions,
	SettingsRow,
	SettingsSection,
	SettingsTextField,
} from "@superboard/front-ui/settings-form";
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
import {
	Archive,
	ChevronDown,
	CirclePause,
	CirclePlay,
	GitBranch,
	Pencil,
	Plus,
	RefreshCw,
	Send,
	Trash2,
} from "lucide-react";
import {
	useCallback,
	useEffect,
	useState,
	type Dispatch,
	type FormEvent,
	type ReactNode,
	type SetStateAction,
} from "react";

import {
	createMarketingChannelConnector,
	createMarketingJourney,
	deleteMarketingChannelConnector,
	enrollJourneySubscribers,
	getEmailSubscribers,
	getEmailTemplates,
	getJourneyEnrollments,
	getJourneyStatistics,
	getMarketingChannelConnectors,
	getMarketingJourneys,
	transitionMarketingJourney,
	updateMarketingChannelConnector,
	updateMarketingJourney,
	type EmailTemplate,
	type JourneyDefinition,
	type JourneyEnrollment,
	type JourneyStatistics,
	type JourneyTrigger,
	type MarketingChannelConnector,
	type MarketingChannelConnectorInput,
	type MarketingJourney,
	type MarketingJourneyInput,
} from "../../api/marketing/marketingService.js";
import { useStudioI18n } from "../../studio/i18n.js";
import { useAutosave } from "../../studio/settings-autosave.js";
import { StateBadge } from "../../studio/settings-ui.js";
import { TriggerPicker, useEventLabel } from "../../studio/TriggerPicker.js";
import { useWorkspaceTab } from "../../studio/workspace-navigation.js";
import { JourneyCanvasEditor } from "./JourneyCanvasEditor.js";

const emptyDefinition: JourneyDefinition = {
	start_node_id: "exit",
	nodes: [{ id: "exit", type: "exit" }],
	edges: [],
};

const transitionMessages = {
	activate: "Automation activated",
	pause: "Automation paused",
	resume: "Automation resumed",
	archive: "Automation archived",
} as const;

export function MarketingJourneysPage() {
	const { t } = useStudioI18n();
	const { selectedProject } = useProjectSelection();
	const workspace = useWorkspaceTab("automations");
	const eventLabel = useEventLabel(selectedProject?.id ?? "");
	const [journeys, setJourneys] = useState<MarketingJourney[]>([]);
	const [templates, setTemplates] = useState<EmailTemplate[]>([]);
	const [connectors, setConnectors] = useState<MarketingChannelConnector[]>([]);
	const [selected, setSelected] = useState<MarketingJourney | null>(null);
	const [statistics, setStatistics] = useState<JourneyStatistics | null>(null);
	const [enrollments, setEnrollments] = useState<JourneyEnrollment[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [trigger, setTrigger] = useState<JourneyTrigger>({
		event_name: "account.created",
		conditions: [],
	});
	const [reentry, setReentry] = useState<MarketingJourney["reentry_policy"]>("once");
	const [builderDefinition, setBuilderDefinition] = useState<JourneyDefinition>(emptyDefinition);
	const [advanced, setAdvanced] = useState(false);
	const [triggerText, setTriggerText] = useState(
		JSON.stringify({ event_name: "account.created", conditions: [] }, null, 2),
	);
	const [definitionText, setDefinitionText] = useState(JSON.stringify(emptyDefinition, null, 2));
	const [subscriberIds, setSubscriberIds] = useState("");

	const load = useCallback(async () => {
		if (!selectedProject) return;
		try {
			const [journeyItems, templateItems, connectorItems] = await Promise.all([
				getMarketingJourneys(selectedProject.id),
				getEmailTemplates(selectedProject.id),
				getMarketingChannelConnectors(selectedProject.id),
			]);
			setJourneys(journeyItems);
			setTemplates(templateItems);
			setConnectors(connectorItems);
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause));
		}
	}, [selectedProject]);

	useEffect(() => void load(), [load]);

	const resetForm = () => {
		setEditingId(null);
		setName("");
		setDescription("");
		setTrigger({ event_name: "account.created", conditions: [] });
		setReentry("once");
		setBuilderDefinition(emptyDefinition);
		setAdvanced(false);
		setTriggerText(JSON.stringify({ event_name: "account.created", conditions: [] }, null, 2));
		setDefinitionText(JSON.stringify(emptyDefinition, null, 2));
	};

	const edit = (journey: MarketingJourney) => {
		setEditingId(journey.id);
		setName(journey.name);
		setDescription(journey.description ?? "");
		setTrigger(journey.trigger);
		setReentry(journey.reentry_policy);
		setTriggerText(JSON.stringify(journey.trigger, null, 2));
		setDefinitionText(JSON.stringify(journey.definition, null, 2));
		setBuilderDefinition(journey.definition);
		setAdvanced(false);
		window.scrollTo({ top: 0, behavior: "smooth" });
	};

	const save = async (event: FormEvent) => {
		event.preventDefault();
		if (!selectedProject) return;
		let payload: MarketingJourneyInput;
		try {
			payload = {
				name: name.trim(),
				description: description.trim() || null,
				reentry_policy: reentry,
				trigger: advanced
					? (parseObject(triggerText, "Trigger") as MarketingJourneyInput["trigger"])
					: { ...trigger, event_name: trigger.event_name.trim() },
				definition: advanced
					? (parseObject(definitionText, "Journey definition") as JourneyDefinition)
					: builderDefinition,
			};
		} catch (cause) {
			showErrorNotification(inputErrorMessage(cause, t));
			return;
		}
		setBusy(true);
		try {
			if (editingId) {
				await updateMarketingJourney(selectedProject.id, editingId, payload);
				showSuccessNotification(t("Journey version saved"));
			} else {
				await createMarketingJourney(selectedProject.id, payload);
				showSuccessNotification(t("Journey created"));
			}
			resetForm();
			await load();
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		} finally {
			setBusy(false);
		}
	};

	const transition = async (
		journey: MarketingJourney,
		actionName: "activate" | "pause" | "resume" | "archive",
	) => {
		if (!selectedProject) return;
		setBusy(true);
		try {
			await transitionMarketingJourney(selectedProject.id, journey.id, actionName);
			showSuccessNotification(t(transitionMessages[actionName]));
			await load();
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		} finally {
			setBusy(false);
		}
	};

	const inspect = async (journey: MarketingJourney) => {
		if (!selectedProject) return;
		try {
			const [stats, enrolled] = await Promise.all([
				getJourneyStatistics(selectedProject.id, journey.id),
				getJourneyEnrollments(selectedProject.id, journey.id),
			]);
			setSelected(journey);
			setStatistics(stats);
			setEnrollments(enrolled);
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		}
	};

	const manualEnrollment = async () => {
		if (!selectedProject || !selected) return;
		const values = subscriberIds
			.split(/[,\s]+/)
			.map((value) => value.trim())
			.filter(Boolean);
		if (!values.length) return;
		setBusy(true);
		try {
			const ids = await Promise.all(
				values.map(async (value) => {
					if (!value.includes("@")) return value;
					const matches = await getEmailSubscribers(selectedProject.id, value);
					const match = matches.find((item) => item.email.toLowerCase() === value.toLowerCase());
					if (!match) throw new Error(t("No contact found for {email}", { email: value }));
					return match.id;
				}),
			);
			const result = await enrollJourneySubscribers(selectedProject.id, selected.id, ids);
			showSuccessNotification(
				t("{enrolled} of {requested} contacts enrolled", {
					enrolled: result.enrolled,
					requested: result.requested,
				}),
			);
			setSubscriberIds("");
			await inspect(selected);
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		} finally {
			setBusy(false);
		}
	};

	return (
		<ModulePage
			title={t("Automations")}
			description={t(
				"Turn product events into versioned, resumable email and omnichannel customer journeys.",
			)}
			error={error}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<div className="space-y-6">
					<Card>
						<CardHeader>
							<CardTitle>{editingId ? t("Edit journey") : t("Create journey")}</CardTitle>
							<CardDescription>
								{t(
									"Each save creates an immutable version. Active enrollments keep the version they entered with.",
								)}
							</CardDescription>
						</CardHeader>
						<CardContent>
							<form className="space-y-5" onSubmit={save}>
								<div className="grid gap-4 md:grid-cols-2">
									<Field label={t("Name")}>
										<Input
											required
											value={name}
											onChange={(event) => setName(event.target.value)}
											placeholder={t("New customer activation")}
										/>
									</Field>
									{advanced ? (
										<Field label={t("Event that starts the journey")}>
											<Input disabled value={trigger.event_name} />
										</Field>
									) : (
										<TriggerPicker
											project={selectedProject.id}
											value={trigger}
											onChange={setTrigger}
										/>
									)}
									<Field label={t("Description")}>
										<Input
											value={description}
											onChange={(event) => setDescription(event.target.value)}
											placeholder={t("Welcome and activate a new account")}
										/>
									</Field>
									<Field label={t("Repeat entry")}>
										<select
											className={selectClass}
											value={reentry}
											onChange={(event) =>
												setReentry(event.target.value as MarketingJourney["reentry_policy"])
											}
										>
											<option value="once">{t("Only once")}</option>
											<option value="after_completion">{t("After completion")}</option>
											<option value="every_event">{t("For every matching event")}</option>
										</select>
									</Field>
								</div>

								{!templates.length && (
									<div
										role="status"
										className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-4"
									>
										<p className="text-sm">
											{t(
												"Email steps need an email. Create one first, then come back to this automation.",
											)}
										</p>
										<Button
											type="button"
											size="sm"
											variant="outline"
											onClick={() => void workspace.open("emails", { kind: "automated" })}
										>
											{t("Create an email")}
										</Button>
									</div>
								)}
								{!advanced && (
									<JourneyCanvasEditor
										project={selectedProject.id}
										value={builderDefinition}
										onChange={setBuilderDefinition}
										templates={templates}
										connectors={connectors}
									/>
								)}

								<details
									open={advanced}
									onToggle={(event) => {
										const open = event.currentTarget.open;
										if (open) {
											setDefinitionText(JSON.stringify(builderDefinition, null, 2));
										} else {
											try {
												setBuilderDefinition(
													parseObject(definitionText, "Journey definition") as JourneyDefinition,
												);
											} catch {}
										}
										setAdvanced(open);
									}}
									className="rounded-xl border p-4"
								>
									<summary className="cursor-pointer font-medium">
										{t("Raw graph JSON (advanced)")}
									</summary>
									<p className="mt-2 text-sm text-muted-foreground">
										{t(
											"Configure conditions, branches, delays, messages and attribute updates using the full versioned graph format.",
										)}
									</p>
									<div className="mt-4 grid gap-4 xl:grid-cols-2">
										<Field label={t("Trigger and conditions")}>
											<textarea
												className={textareaClass}
												rows={12}
												value={triggerText}
												onChange={(event) => setTriggerText(event.target.value)}
											/>
										</Field>
										<Field label={t("Journey graph")}>
											<textarea
												className={textareaClass}
												rows={12}
												value={definitionText}
												onChange={(event) => setDefinitionText(event.target.value)}
											/>
										</Field>
									</div>
								</details>

								<div className="flex flex-wrap gap-2">
									<Button disabled={busy || !name.trim()} type="submit">
										<GitBranch className="size-4" />
										{editingId ? t("Save new version") : t("Create draft")}
									</Button>
									{editingId && (
										<Button type="button" variant="outline" onClick={resetForm}>
											{t("Cancel edit")}
										</Button>
									)}
								</div>
							</form>
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="flex-row items-start justify-between gap-4">
							<div>
								<CardTitle>{t("Journeys")}</CardTitle>
								<CardDescription>
									{t("Event-triggered automation with deduplicated entry and step execution.")}
								</CardDescription>
							</div>
							<Button variant="outline" size="sm" onClick={() => void load()}>
								<RefreshCw className="size-4" /> {t("Refresh")}
							</Button>
						</CardHeader>
						<CardContent className="space-y-3">
							{journeys.map((journey) => (
								<div key={journey.id} className="rounded-xl border p-4">
									<div className="flex flex-col justify-between gap-4 lg:flex-row">
										<button
											type="button"
											className="text-start"
											onClick={() => void inspect(journey)}
										>
											<div className="flex flex-wrap items-center gap-2">
												<span className="font-semibold">{journey.name}</span>
												<StatusBadge status={journey.status} />
												<Badge variant="outline">
													{t("v")}
													{journey.current_version}
												</Badge>
											</div>
											<p className="mt-1 text-sm text-muted-foreground">
												{t("Starts on")}
												{eventLabel(journey.trigger_event_name)} {t("·")}{" "}
												{journey.enrollments_total ?? 0} {t("entries")}
											</p>
										</button>
										<div className="flex flex-wrap gap-2">
											{journey.status !== "archived" && (
												<Button variant="outline" size="sm" onClick={() => edit(journey)}>
													<Pencil className="size-4" /> {t("Edit")}
												</Button>
											)}
											{journey.status === "draft" && (
												<Button
													size="sm"
													disabled={busy}
													onClick={() => void transition(journey, "activate")}
												>
													<CirclePlay className="size-4" /> {t("Activate")}
												</Button>
											)}
											{journey.status === "active" && (
												<Button
													size="sm"
													variant="outline"
													disabled={busy}
													onClick={() => void transition(journey, "pause")}
												>
													<CirclePause className="size-4" /> {t("Pause")}
												</Button>
											)}
											{journey.status === "paused" && (
												<Button
													size="sm"
													disabled={busy}
													onClick={() => void transition(journey, "resume")}
												>
													<CirclePlay className="size-4" /> {t("Resume")}
												</Button>
											)}
											{journey.status !== "archived" && (
												<Button
													size="sm"
													variant="ghost"
													disabled={busy}
													onClick={() => void transition(journey, "archive")}
												>
													<Archive className="size-4" /> {t("Archive")}
												</Button>
											)}
										</div>
									</div>
								</div>
							))}
							{!journeys.length && (
								<p className="py-8 text-center text-sm text-muted-foreground">
									{t(
										"No automations yet. Name it, choose the event that starts it, add email or channel steps above, then activate it.",
									)}
								</p>
							)}
						</CardContent>
					</Card>

					{selected && statistics && (
						<Card>
							<CardHeader>
								<CardTitle>
									{selected.name} {t("activity")}
								</CardTitle>
								<CardDescription>
									{t("Latest entries remain pinned to journey version and execution receipts.")}
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-5">
								<div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
									{Object.entries(statistics).map(([key, value]) => (
										<div key={key} className="rounded-lg border p-3">
											<p className="text-xs text-muted-foreground">{t(labelize(key))}</p>
											<p className="text-xl font-semibold tabular-nums">{value}</p>
										</div>
									))}
								</div>
								{selected.status === "active" && (
									<div className="flex flex-col gap-2 sm:flex-row">
										<Input
											value={subscriberIds}
											onChange={(event) => setSubscriberIds(event.target.value)}
											aria-label={t("Contacts to enroll")}
											placeholder={t("Contact emails or IDs, separated by commas")}
										/>
										<Button
											disabled={busy || !subscriberIds.trim()}
											onClick={() => void manualEnrollment()}
										>
											<Send className="size-4" /> {t("Enroll")}
										</Button>
									</div>
								)}
								<div className="overflow-x-auto rounded-lg border">
									<FrontTable className="w-full min-w-[680px] text-start text-sm">
										<FrontTableHeader className="bg-muted/60 text-xs uppercase text-muted-foreground">
											<FrontTableRow>
												{["Subscriber", "Version", "Current step", "Status", "Entered"].map(
													(column) => (
														<FrontTableHead key={column} className="px-4 py-3 font-medium">
															{t(column)}
														</FrontTableHead>
													),
												)}
											</FrontTableRow>
										</FrontTableHeader>
										<FrontTableBody>
											{enrollments.map((enrollment) => (
												<FrontTableRow key={enrollment.id} className="border-t">
													<FrontTableCell className="px-4 py-3">
														{enrollment.email || enrollment.subscriber_id}
													</FrontTableCell>
													<FrontTableCell className="px-4 py-3">
														{t("v")}
														{enrollment.journey_version}
													</FrontTableCell>
													<FrontTableCell className="px-4 py-3">
														{enrollment.current_node_id}
													</FrontTableCell>
													<FrontTableCell className="px-4 py-3">
														<Badge variant="outline">{enrollment.status}</Badge>
													</FrontTableCell>
													<FrontTableCell className="px-4 py-3">
														{formatDate(enrollment.enrolled_at)}
													</FrontTableCell>
												</FrontTableRow>
											))}
											{!enrollments.length && (
												<FrontTableRow>
													<FrontTableCell
														className="px-4 py-8 text-center text-muted-foreground"
														colSpan={5}
													>
														{t("No subscribers have entered this journey.")}
													</FrontTableCell>
												</FrontTableRow>
											)}
										</FrontTableBody>
									</FrontTable>
								</div>
							</CardContent>
						</Card>
					)}
				</div>
			)}
		</ModulePage>
	);
}

type ChannelKind = MarketingChannelConnector["channel"];
type ChannelDraft = {
	name: string;
	channel: ChannelKind;
	endpoint: string;
	secret: string;
	headersText: string;
	enabled: boolean;
};

const channelLabels: Record<ChannelKind, string> = {
	webhook: "Webhook",
	sms: "SMS",
	push: "Push",
	whatsapp: "WhatsApp",
	slack: "Slack",
};

function isChannelKind(value: unknown): value is ChannelKind {
	return typeof value === "string" && Object.hasOwn(channelLabels, value);
}

function channelDraft(connector?: MarketingChannelConnector): ChannelDraft {
	return {
		name: connector?.name ?? "",
		channel: connector?.channel ?? "webhook",
		endpoint: connector?.endpoint_url ?? "",
		secret: "",
		headersText: connector ? JSON.stringify(connector.headers, null, 2) : "{}",
		enabled: connector?.enabled ?? true,
	};
}

function channelPayload(draft: ChannelDraft): MarketingChannelConnectorInput {
	const headers = Object.fromEntries(
		Object.entries(parseObject(draft.headersText, "Headers")).map(([key, value]) => [
			key,
			String(value),
		]),
	);
	return {
		name: draft.name.trim(),
		channel: draft.channel,
		endpoint_url: draft.endpoint.trim(),
		headers,
		enabled: draft.enabled,
		...(draft.secret ? { secret: draft.secret } : {}),
	};
}

function headersProblem(draft: ChannelDraft, t: ReturnType<typeof useStudioI18n>["t"]) {
	try {
		parseObject(draft.headersText, "Headers");
		return null;
	} catch (cause) {
		return inputErrorMessage(cause, t);
	}
}

export function MarketingChannelsPage() {
	const { selectedProject } = useProjectSelection();
	return <MarketingChannelsEditor key={selectedProject?.id} />;
}

function MarketingChannelsEditor() {
	const { t } = useStudioI18n();
	const { selectedProject } = useProjectSelection();
	const [connectors, setConnectors] = useState<MarketingChannelConnector[]>([]);
	const [openId, setOpenId] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		if (!selectedProject) return;
		try {
			setConnectors(await getMarketingChannelConnectors(selectedProject.id));
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause));
		}
	}, [selectedProject]);
	useEffect(() => void load(), [load]);

	if (!selectedProject) return <EmptyProject />;
	const opened = connectors.find((connector) => connector.id === openId);
	return (
		<div className="flex w-full flex-col gap-8">
			<div className="space-y-4">
				<SettingsSection
					title={t("Other channels")}
					description={t(
						"Connect secure HTTPS destinations for SMS, push, WhatsApp, Slack and custom webhooks. Automations can then use them as steps.",
					)}
				>
					{connectors.length ? (
						connectors.map((connector) => (
							<SettingsRow
								key={connector.id}
								className={cn("p-0", openId === connector.id && "bg-kumo-tint")}
							>
								<button
									type="button"
									className="flex w-full items-center justify-between gap-4 p-4 text-start"
									aria-expanded={openId === connector.id}
									onClick={() => {
										setCreating(false);
										setOpenId((current) => (current === connector.id ? null : connector.id));
									}}
								>
									<span className="min-w-0 space-y-0.5">
										<span className="block text-sm font-medium">{connector.name}</span>
										<span className="block truncate text-xs text-kumo-subtle">
											{t(channelLabels[connector.channel])} {t("·")} {connector.endpoint_url}
										</span>
										<span className="block text-xs text-kumo-subtle">
											{t(connector.secret_configured ? "Signed requests" : "Unsigned requests")}
										</span>
									</span>
									<span className="flex shrink-0 items-center gap-3">
										<StateBadge state={connector.enabled ? "enabled" : "off"} />
										<ChevronDown
											aria-hidden
											className={cn(
												"size-4 text-kumo-subtle transition-transform",
												openId === connector.id && "rotate-180",
											)}
										/>
									</span>
								</button>
							</SettingsRow>
						))
					) : (
						<SettingsRow>
							<p className="text-sm text-kumo-subtle">{t("No external channels connected yet.")}</p>
						</SettingsRow>
					)}
				</SettingsSection>
				{error && (
					<p role="alert" className="text-sm text-kumo-danger">
						{error}
					</p>
				)}
				{!creating && (
					<SettingsActions>
						<Button
							variant="default"
							icon={<Plus className="size-4" />}
							onClick={() => {
								setOpenId(null);
								setCreating(true);
							}}
						>
							{t("Add a channel")}
						</Button>
					</SettingsActions>
				)}
			</div>
			{creating && (
				<NewChannel
					project={selectedProject.id}
					onCancel={() => {
						setCreating(false);
					}}
					onCreated={() => {
						setCreating(false);
						load().catch(() => undefined);
					}}
				/>
			)}
			{opened && (
				<ChannelDetails
					key={opened.id}
					project={selectedProject.id}
					connector={opened}
					onSaved={() => void load()}
					onClose={() => {
						setOpenId(null);
					}}
				/>
			)}
		</div>
	);
}

function NewChannel({
	project,
	onCancel,
	onCreated,
}: {
	project: string;
	onCancel(): void;
	onCreated(): void;
}) {
	const { t } = useStudioI18n();
	const [draft, setDraft] = useState(channelDraft);
	const [busy, setBusy] = useState(false);
	const problem = headersProblem(draft, t);
	return (
		<form
			className="flex w-full flex-col gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				setBusy(true);
				createMarketingChannelConnector(project, channelPayload(draft))
					.then(() => {
						showSuccessNotification(t("Channel created"));
						onCreated();
					})
					.catch((cause: unknown) => {
						showErrorNotification(moduleErrorMessage(cause));
					})
					.finally(() => {
						setBusy(false);
					});
			}}
		>
			<ChannelFields
				title={t("Add a channel")}
				draft={draft}
				problem={problem}
				onChange={setDraft}
			/>
			<SettingsActions>
				<Button type="button" variant="ghost" onClick={onCancel}>
					{t("Cancel")}
				</Button>
				<Button
					type="submit"
					variant="primary"
					loading={busy}
					disabled={!draft.name.trim() || !draft.endpoint.trim() || Boolean(problem)}
				>
					{t("Add channel")}
				</Button>
			</SettingsActions>
		</form>
	);
}

function ChannelDetails({
	project,
	connector,
	onSaved,
	onClose,
}: {
	project: string;
	connector: MarketingChannelConnector;
	onSaved(): void;
	onClose(): void;
}) {
	const { t } = useStudioI18n();
	const [draft, setDraft] = useState(() => channelDraft(connector));
	const problem = headersProblem(draft, t);
	const { indicator } = useAutosave({
		resourceKey: connector.id,
		value: draft,
		enabled: Boolean(draft.name.trim() && draft.endpoint.trim() && !problem),
		save: async (next) => {
			await updateMarketingChannelConnector(project, connector.id, channelPayload(next));
			onSaved();
		},
	});
	return (
		<div className="flex w-full flex-col gap-4">
			<ChannelFields
				title={draft.name || t("Edit channel")}
				draft={draft}
				problem={problem}
				editing
				onChange={setDraft}
			/>
			<SettingsActions>
				<Button variant="ghost" onClick={onClose}>
					{t("Close")}
				</Button>
				<DeleteConfirm
					title={t("Delete this channel?")}
					description={t("Automation steps that use it can no longer deliver messages.")}
					onConfirm={async () => {
						try {
							await deleteMarketingChannelConnector(project, connector.id);
							showSuccessNotification(t("Channel deleted"));
							onClose();
							onSaved();
						} catch (cause) {
							showErrorNotification(moduleErrorMessage(cause));
						}
					}}
				>
					<Button
						variant="outline"
						className="text-destructive"
						icon={<Trash2 className="size-4" />}
						aria-label={t("Delete {name}", { name: connector.name })}
					>
						{t("Delete channel")}
					</Button>
				</DeleteConfirm>
			</SettingsActions>
			{indicator}
		</div>
	);
}

function ChannelFields({
	title,
	draft,
	problem,
	editing = false,
	onChange,
}: {
	title: string;
	draft: ChannelDraft;
	problem: string | null;
	editing?: boolean;
	onChange: Dispatch<SetStateAction<ChannelDraft>>;
}) {
	const { t } = useStudioI18n();
	const patch = (value: Partial<ChannelDraft>) => {
		onChange((current) => ({ ...current, ...value }));
	};
	return (
		<SettingsSection
			title={title}
			description={t("Secrets are encrypted at rest and never returned by the API.")}
		>
			<SettingsRow>
				<SwitchField
					label={t("Enabled")}
					description={t("Automations can only use enabled channels.")}
					checked={draft.enabled}
					onCheckedChange={(enabled) => {
						patch({ enabled });
					}}
				/>
			</SettingsRow>
			<SettingsRow>
				<SettingsTextField
					label={t("Name")}
					required
					placeholder={t("Customer notifications")}
					value={draft.name}
					onChange={(event) => {
						patch({ name: event.target.value });
					}}
				/>
			</SettingsRow>
			<SettingsRow>
				<Select
					className="w-full"
					label={t("Channel")}
					value={draft.channel}
					onValueChange={(channel) => {
						if (isChannelKind(channel)) patch({ channel });
					}}
					items={Object.fromEntries(
						Object.entries(channelLabels).map(([key, label]) => [key, t(label)]),
					)}
				/>
			</SettingsRow>
			<SettingsRow>
				<SettingsTextField
					label={t("HTTPS destination")}
					required
					type="url"
					placeholder={t("https://provider.example/messages")}
					value={draft.endpoint}
					onChange={(event) => {
						patch({ endpoint: event.target.value });
					}}
				/>
			</SettingsRow>
			<SettingsRow>
				<SettingsTextField
					label={editing ? t("New signing secret (optional)") : t("Signing secret")}
					description={t("Journey deliveries carry an idempotency key and an HMAC signature.")}
					type="password"
					autoComplete="new-password"
					value={draft.secret}
					onChange={(event) => {
						patch({ secret: event.target.value });
					}}
				/>
			</SettingsRow>
			<SettingsRow>
				<InputArea
					label={t("Additional request headers")}
					description={t("A JSON object of header names and values.")}
					className="font-mono"
					rows={5}
					value={draft.headersText}
					onChange={(event) => {
						patch({ headersText: event.target.value });
					}}
				/>
				{problem && (
					<p role="alert" className="text-sm text-kumo-danger">
						{problem}
					</p>
				)}
			</SettingsRow>
		</SettingsSection>
	);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<label className="grid gap-2">
			<span>{label}</span>
			{children}
		</label>
	);
}

function StatusBadge({ status }: { status: MarketingJourney["status"] }) {
	const { t } = useStudioI18n();
	return (
		<Badge
			variant={status === "active" ? "secondary" : status === "archived" ? "outline" : "default"}
		>
			{t(labelize(status))}
		</Badge>
	);
}

class JsonInputError extends Error {
	label: string;
	constructor(message: string, label: string) {
		super(message);
		this.label = label;
	}
}

function inputErrorMessage(cause: unknown, t: ReturnType<typeof useStudioI18n>["t"]) {
	return cause instanceof JsonInputError
		? t(cause.message, { label: t(cause.label) })
		: moduleErrorMessage(cause);
}

function parseObject(value: string, label: string) {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw new JsonInputError("{label} must contain valid JSON.", label);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new JsonInputError("{label} must be a JSON object.", label);
	}
	return parsed as Record<string, unknown>;
}

function labelize(value: string) {
	return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string) {
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(value));
}

const selectClass =
	"border-input h-10 w-full rounded-[var(--radius-sm)] border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const textareaClass =
	"border-input w-full rounded-[var(--radius-sm)] border bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
