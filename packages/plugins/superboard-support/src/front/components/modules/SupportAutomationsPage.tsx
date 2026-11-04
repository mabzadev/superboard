"use client";

import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import {
	showErrorNotification,
	showSuccessNotification,
} from "@superboard/front-ui/lib/Notifications.js";
import { EmptyProject, moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "@superboard/front-ui/ui/card.js";
import { Input } from "@superboard/front-ui/ui/input.js";
import { Label } from "@superboard/front-ui/ui/label.js";
import { Switch } from "@superboard/front-ui/ui/switch.js";
import { Textarea } from "@superboard/front-ui/ui/textarea.js";
import { Clock3, Plus, Trash2, Workflow } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { isInboxAutomation } from "../../api/support/automationScope.js";
import {
	supportAssignmentPolicies,
	supportAutomations,
	supportCannedResponses,
	supportMacros,
	supportSlaPolicies,
	supportWorkingHours,
} from "../../api/support/automationsService.js";
import type { SupportAutomation } from "../../api/support/automationsService.js";
import { getSupportResource } from "../../api/support/nativeClient.js";
import { useSupportI18n } from "../../i18n.js";
import { SupportField as Field } from "../support/SupportField.js";
import { SupportModulePage as ModulePage } from "../support/SupportModulePage.js";
import {
	SupportEmpty,
	SupportError,
	SupportLoadMore,
	SupportLoading,
	SupportSearchToolbar,
	SupportStatus,
	SupportViewSelect,
	useSupportCollection,
} from "../support/SupportUi.js";
import { SupportAutomationDetails } from "./SupportAutomationDetails.js";

type AutomationKind = "rules" | "assignment" | "sla" | "hours" | "macros" | "responses";

const optionLabels: Record<string, string> = {
	"conversation.created": "Conversation created",
	"conversation.updated": "Conversation updated",
	"message.created": "Message created",
	"sla.warning": "SLA warning",
	"sla.breached": "SLA breached",
	all: "All conditions",
	any: "Any condition",
	status: "Status",
	priority: "Priority",
	inbox_id: "Inbox",
	assigned_user_id: "Assigned agent",
	assigned_team_id: "Assigned team",
	labels: "Labels",
	subject: "Subject",
	external_user_id: "Customer ID",
	equals: "Equals",
	not_equals: "Does not equal",
	contains: "Contains",
	present: "Is present",
	not_present: "Is not present",
	greater_than: "Greater than",
	set_status: "Set status",
	set_priority: "Set priority",
	set_snooze: "Snooze",
	assign_agent: "Assign an agent",
	assign_team: "Assign a team",
	assign_inbox: "Move to an inbox",
	add_label: "Add a label",
	remove_label: "Remove a label",
	send_message: "Send a message",
	notify_agent: "Notify an agent",
	trigger_webhook: "Trigger a webhook",
	trigger_integration: "Trigger an integration",
	round_robin: "Round robin",
	balanced: "Balanced",
	manual: "Manual",
	oldest: "Oldest",
	recent: "Recent",
};
const optionLabel = (value: string) => optionLabels[value] ?? value.replaceAll("_", " ");

export default function SupportAutomationsPage({ inboxId }: { inboxId?: string } = {}) {
	const { t, locale } = useSupportI18n();
	const [kind, setKind] = useState<AutomationKind>("rules");

	const { selectedProject } = useProjectSelection();
	const projectRef = selectedProject?.id;
	const automations = useSupportCollection(projectRef, supportAutomations.list, { inboxId });
	const assignments = useSupportCollection(projectRef, supportAssignmentPolicies.list, { inboxId });
	const slas = useSupportCollection(projectRef, supportSlaPolicies.list, { inboxId });
	const schedules = useSupportCollection(projectRef, supportWorkingHours.list, {
		searchable: false,
		inboxId,
	});
	const macros = useSupportCollection(inboxId ? undefined : projectRef, supportMacros.list);
	const cannedResponses = useSupportCollection(
		inboxId ? undefined : projectRef,
		supportCannedResponses.list,
	);
	const [saving, setSaving] = useState(false);
	const [selectedAutomation, setSelectedAutomationState] = useState<string | null>(() =>
		typeof window === "undefined"
			? null
			: new URLSearchParams(window.location.search).get("automation"),
	);
	const [openedAutomation, setOpenedAutomation] = useState<SupportAutomation | null>(null);
	const [openedError, setOpenedError] = useState<string | null>(null);
	useEffect(() => {
		if (!projectRef || !selectedAutomation) return;
		let active = true;
		void getSupportResource<SupportAutomation>(projectRef, "automations", selectedAutomation)
			.then((result) => {
				if (!active) return;
				if (inboxId && !isInboxAutomation(result.data, inboxId)) {
					setOpenedError(t("This automation does not belong to this Inbox."));
					return;
				}
				setOpenedAutomation(result.data);
				setOpenedError(null);
			})
			.catch((cause: unknown) => {
				if (active) setOpenedError(moduleErrorMessage(cause, locale));
			});
		return () => {
			active = false;
		};
	}, [projectRef, selectedAutomation, inboxId, t, locale]);
	const setSelectedAutomation = (id: string | null) => {
		setOpenedAutomation(null);
		setOpenedError(null);
		setSelectedAutomationState(id);
		const url = new URL(window.location.href);
		if (id) url.searchParams.set("automation", id);
		else url.searchParams.delete("automation");
		window.history.replaceState(null, "", url);
	};
	const [rule, setRule] = useState({
		name: "",
		event: "conversation.created",
		mode: "all",
		field: "priority",
		operator: "equals",
		value: "high",
		action: "assign_team",
		actionValue: "",
	});
	const [assignment, setAssignment] = useState({
		name: "",
		policy_type: "round_robin",
		queue_order: "oldest",
		maximum: "",
	});
	const [sla, setSla] = useState({
		name: "",
		first: "30",
		next: "60",
		resolution: "480",
		businessHours: true,
	});
	const [hours, setHours] = useState({
		timezone: "UTC",
		start: "09:00",
		end: "17:00",
		unavailable: t("Our team will reply during business hours."),
	});
	const [macro, setMacro] = useState({
		name: "",
		action: "set_priority",
		value: "normal",
	});
	const [cannedResponse, setCannedResponse] = useState({
		name: "",
		shortcut: "",
		content: "",
	});

	const createRule = async () => {
		if (!projectRef || !rule.name.trim() || !rule.actionValue.trim()) return;
		setSaving(true);
		try {
			const created = await supportAutomations.create(projectRef, {
				name: rule.name.trim(),
				event_name: rule.event,
				condition_mode: inboxId ? "all" : rule.mode,
				conditions: inboxId
					? [
							{ field: "inbox_id", operator: "equals", value: inboxId },
							{
								mode: rule.mode,
								conditions: [{ field: rule.field, operator: rule.operator, value: rule.value }],
							},
						]
					: [{ field: rule.field, operator: rule.operator, value: rule.value }],
				actions: [{ type: rule.action, value: rule.actionValue.trim() }],
				position: 0,
				active: true,
			});
			setRule((current) => ({ ...current, name: "", actionValue: "" }));
			await automations.reload();
			setSelectedAutomation(created.data.id);
			showSuccessNotification(t("Automation created"));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		} finally {
			setSaving(false);
		}
	};

	const createAssignment = async () => {
		if (!projectRef || !assignment.name.trim()) return;
		setSaving(true);
		try {
			await supportAssignmentPolicies.create(projectRef, {
				name: assignment.name.trim(),
				policy_type: assignment.policy_type,
				queue_order: assignment.queue_order,
				max_assignments_per_agent: assignment.maximum ? Number(assignment.maximum) : null,
				inbox_ids: inboxId ? [inboxId] : [],
				team_ids: [],
				active: true,
			});
			setAssignment((current) => ({ ...current, name: "" }));
			await assignments.reload();
			showSuccessNotification(t("Assignment policy created"));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		} finally {
			setSaving(false);
		}
	};

	const createSla = async () => {
		if (!projectRef || !sla.name.trim()) return;
		setSaving(true);
		try {
			await supportSlaPolicies.create(projectRef, {
				name: sla.name.trim(),
				first_response_minutes: Number(sla.first),
				next_response_minutes: sla.next ? Number(sla.next) : null,
				resolution_minutes: Number(sla.resolution),
				business_hours_only: sla.businessHours,
				conditions: inboxId ? { inbox_id: inboxId } : {},
				active: true,
			});
			setSla((current) => ({ ...current, name: "" }));
			await slas.reload();
			showSuccessNotification(t("SLA policy created"));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		} finally {
			setSaving(false);
		}
	};

	const createHours = async () => {
		if (!projectRef || !hours.timezone.trim()) return;
		setSaving(true);
		try {
			const weekday = [{ start: hours.start, end: hours.end }];
			await supportWorkingHours.create(projectRef, {
				inbox_id: inboxId ?? null,
				timezone: hours.timezone.trim(),
				weekly_schedule: {
					monday: weekday,
					tuesday: weekday,
					wednesday: weekday,
					thursday: weekday,
					friday: weekday,
					saturday: [],
					sunday: [],
				},
				closed_dates: [],
				unavailable_message: hours.unavailable.trim() || null,
				active: true,
			});
			await schedules.reload();
			showSuccessNotification(t("Business hours created"));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		} finally {
			setSaving(false);
		}
	};

	const createMacro = async () => {
		if (!projectRef || !macro.name.trim() || !macro.value.trim()) return;
		setSaving(true);
		try {
			await supportMacros.create(projectRef, {
				name: macro.name.trim(),
				actions: [{ type: macro.action, value: macro.value.trim() }],
				position: 0,
				active: true,
			});
			setMacro((current) => ({ ...current, name: "" }));
			await macros.reload();
			showSuccessNotification(t("Macro created"));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		} finally {
			setSaving(false);
		}
	};

	const createCannedResponse = async () => {
		if (!projectRef || !cannedResponse.name.trim() || !cannedResponse.content.trim()) return;
		setSaving(true);
		try {
			await supportCannedResponses.create(projectRef, {
				name: cannedResponse.name.trim(),
				content: cannedResponse.content.trim(),
				shortcut: cannedResponse.shortcut.trim() || null,
				position: 0,
				active: true,
			});
			setCannedResponse({ name: "", shortcut: "", content: "" });
			await cannedResponses.reload();
			showSuccessNotification(t("Canned response created"));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		} finally {
			setSaving(false);
		}
	};

	const remove = async (
		resource: { remove: (project: string, id: string) => Promise<unknown> },
		id: string,
		reload: () => Promise<void>,
	) => {
		if (!projectRef || !window.confirm(t("Delete this Support policy?"))) return;
		try {
			await resource.remove(projectRef, id);
			await reload();
			showSuccessNotification(t("Support policy deleted"));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		}
	};

	const kindSelect = (
		<SupportViewSelect
			label={t("Automation type")}
			value={kind}
			onChange={setKind}
			options={[
				{ value: "rules", label: t("Rules") },
				{ value: "assignment", label: t("Assignment") },
				{ value: "sla", label: t("SLA") },
				{ value: "hours", label: t("Business hours") },
				...(inboxId
					? []
					: [
							{ value: "macros" as const, label: t("Macros") },
							{ value: "responses" as const, label: t("Canned responses") },
						]),
			]}
		/>
	);

	const selectedRule = openedAutomation?.id === selectedAutomation ? openedAutomation : undefined;
	if (selectedAutomation && openedError)
		return (
			<>
				<SupportError message={openedError} />
				<Button
					onClick={() => {
						setOpenedError(null);
						setSelectedAutomation(null);
					}}
				>
					{t("Back to list")}
				</Button>
			</>
		);
	if (selectedAutomation && !selectedRule) return <SupportLoading />;
	if (projectRef && selectedRule)
		return (
			<SupportAutomationDetails
				project={projectRef}
				automation={selectedRule}
				inboxId={inboxId}
				close={() => {
					setSelectedAutomation(null);
					void automations.reload().catch((cause: unknown) => {
						setOpenedError(moduleErrorMessage(cause, locale));
					});
				}}
			/>
		);

	return (
		<ModulePage
			title={t("Automations")}
			description={t("Automate routing and actions, then enforce response and resolution targets.")}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<div className="space-y-4">
					{kind === "rules" && (
						<div className="space-y-4">
							<CollectionToolbar collection={automations} filters={kindSelect} />
							<SupportError message={automations.error} />
							<Card>
								<CardHeader>
									<CardTitle className="flex items-center gap-2 text-base">
										<Workflow /> {t("New automation")}
									</CardTitle>
								</CardHeader>
								<CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
									<Field label={t("Name")}>
										<Input
											value={rule.name}
											onChange={(e) => setRule((v) => ({ ...v, name: e.target.value }))}
										/>
									</Field>
									<Field label={t("Event")}>
										<Select
											value={rule.event}
											onChange={(event) => setRule((v) => ({ ...v, event }))}
											options={[
												"conversation.created",
												"conversation.updated",
												"message.created",
												"sla.warning",
												"sla.breached",
											]}
										/>
									</Field>
									<Field label={t("Condition mode")}>
										<Select
											value={rule.mode}
											onChange={(mode) => setRule((v) => ({ ...v, mode }))}
											options={["all", "any"]}
										/>
									</Field>
									<Field label={t("Condition field")}>
										<Select
											value={rule.field}
											onChange={(field) => setRule((v) => ({ ...v, field }))}
											options={[
												"status",
												"priority",
												"inbox_id",
												"assigned_user_id",
												"assigned_team_id",
												"labels",
												"subject",
												"external_user_id",
											]}
										/>
									</Field>
									<Field label={t("Operator")}>
										<Select
											value={rule.operator}
											onChange={(operator) => setRule((v) => ({ ...v, operator }))}
											options={[
												"equals",
												"not_equals",
												"contains",
												"present",
												"not_present",
												"greater_than",
											]}
										/>
									</Field>
									<Field label={t("Condition value")}>
										<Input
											value={rule.value}
											onChange={(e) => setRule((v) => ({ ...v, value: e.target.value }))}
										/>
									</Field>
									<Field label={t("Action")}>
										<Select
											value={rule.action}
											onChange={(action) => setRule((v) => ({ ...v, action }))}
											options={[
												"set_status",
												"set_priority",
												"set_snooze",
												"assign_agent",
												"assign_team",
												"assign_inbox",
												"add_label",
												"remove_label",
												"send_message",
												"notify_agent",
												"trigger_webhook",
												"trigger_integration",
											]}
										/>
									</Field>
									<Field label={t("Action value")}>
										<Input
											value={rule.actionValue}
											onChange={(e) => setRule((v) => ({ ...v, actionValue: e.target.value }))}
										/>
									</Field>
									<div className="md:col-span-2 xl:col-span-4 flex justify-end">
										<Button disabled={saving} onClick={() => void createRule()}>
											<Plus /> {t("Create rule")}
										</Button>
									</div>
								</CardContent>
							</Card>
							<ResourceList
								loading={automations.loading}
								emptyTitle={t("No automation rules")}
								emptyDescription={t(
									"Create a rule to react to conversation, message or SLA events.",
								)}
								items={automations.items.map((item) => ({
									id: item.id,
									title: item.name,
									detail: `${t(optionLabel(item.event_name))} · ${t(optionLabel(item.condition_mode))}`,
									status: item.active ? "active" : "disabled",
								}))}
								onOpen={setSelectedAutomation}
								onDelete={(id) => void remove(supportAutomations, id, automations.reload)}
							/>
							<SupportLoadMore
								visible={automations.hasMore}
								loading={automations.loadingMore}
								onClick={automations.loadMore}
							/>
						</div>
					)}
					{kind === "assignment" && (
						<div className="space-y-4">
							<CollectionToolbar collection={assignments} filters={kindSelect} />
							<SupportError message={assignments.error} />
							<Card>
								<CardHeader>
									<CardTitle className="text-base">{t("New assignment policy")}</CardTitle>
								</CardHeader>
								<CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
									<Field label={t("Name")}>
										<Input
											value={assignment.name}
											onChange={(e) => setAssignment((v) => ({ ...v, name: e.target.value }))}
										/>
									</Field>
									<Field label={t("Strategy")}>
										<Select
											value={assignment.policy_type}
											onChange={(policy_type) => setAssignment((v) => ({ ...v, policy_type }))}
											options={["round_robin", "balanced", "manual"]}
										/>
									</Field>
									<Field label={t("Queue order")}>
										<Select
											value={assignment.queue_order}
											onChange={(queue_order) => setAssignment((v) => ({ ...v, queue_order }))}
											options={["oldest", "priority", "recent"]}
										/>
									</Field>
									<Field label={t("Maximum per agent")}>
										<Input
											min={0}
											type="number"
											value={assignment.maximum}
											onChange={(e) => setAssignment((v) => ({ ...v, maximum: e.target.value }))}
										/>
									</Field>
									<div className="md:col-span-2 xl:col-span-4 flex justify-end">
										<Button disabled={saving} onClick={() => void createAssignment()}>
											<Plus /> {t("Create policy")}
										</Button>
									</div>
								</CardContent>
							</Card>
							<ResourceList
								loading={assignments.loading}
								emptyTitle={t("No assignment policies")}
								emptyDescription={t(
									"Create a routing policy for manual, round-robin or balanced assignment.",
								)}
								items={assignments.items.map((item) => ({
									id: item.id,
									title: item.name,
									detail: `${t(optionLabel(item.policy_type))} · ${t(optionLabel(item.queue_order))}`,
									status: item.active ? "active" : "disabled",
								}))}
								onDelete={(id) => void remove(supportAssignmentPolicies, id, assignments.reload)}
							/>
						</div>
					)}
					{kind === "sla" && (
						<div className="space-y-4">
							<CollectionToolbar collection={slas} filters={kindSelect} />
							<SupportError message={slas.error} />
							<Card>
								<CardHeader>
									<CardTitle className="text-base">{t("New SLA policy")}</CardTitle>
								</CardHeader>
								<CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
									<Field label={t("Name")}>
										<Input
											value={sla.name}
											onChange={(e) => setSla((v) => ({ ...v, name: e.target.value }))}
										/>
									</Field>
									<Field label={t("First response (min)")}>
										<Input
											min={1}
											type="number"
											value={sla.first}
											onChange={(e) => setSla((v) => ({ ...v, first: e.target.value }))}
										/>
									</Field>
									<Field label={t("Next response (min)")}>
										<Input
											min={1}
											type="number"
											value={sla.next}
											onChange={(e) => setSla((v) => ({ ...v, next: e.target.value }))}
										/>
									</Field>
									<Field label={t("Resolution (min)")}>
										<Input
											min={1}
											type="number"
											value={sla.resolution}
											onChange={(e) => setSla((v) => ({ ...v, resolution: e.target.value }))}
										/>
									</Field>
									<div className="flex items-center gap-3 pt-7">
										<Switch
											checked={sla.businessHours}
											onCheckedChange={(businessHours) => setSla((v) => ({ ...v, businessHours }))}
										/>
										<Label>{t("Business hours only")}</Label>
									</div>
									<div className="md:col-span-2 xl:col-span-5 flex justify-end">
										<Button disabled={saving} onClick={() => void createSla()}>
											<Plus /> {t("Create SLA")}
										</Button>
									</div>
								</CardContent>
							</Card>
							<ResourceList
								loading={slas.loading}
								emptyTitle={t("No SLA policies")}
								emptyDescription={t(
									"Define response and resolution targets for your Support team.",
								)}
								items={slas.items.map((item) => ({
									id: item.id,
									title: item.name,
									detail: t("First response {first} min · Resolution {resolution} min", {
										first: item.first_response_minutes,
										resolution: item.resolution_minutes,
									}),
									status: item.active ? "active" : "disabled",
								}))}
								onDelete={(id) => void remove(supportSlaPolicies, id, slas.reload)}
							/>
						</div>
					)}
					{kind === "hours" && (
						<div className="space-y-4">
							<CollectionToolbar collection={schedules} search={false} filters={kindSelect} />
							<SupportError message={schedules.error} />
							<Card>
								<CardHeader>
									<CardTitle className="flex items-center gap-2 text-base">
										<Clock3 /> {t("Weekly business hours")}
									</CardTitle>
								</CardHeader>
								<CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
									<Field label={t("Timezone")}>
										<Input
											value={hours.timezone}
											onChange={(e) => setHours((v) => ({ ...v, timezone: e.target.value }))}
										/>
									</Field>
									<Field label={t("Weekday start")}>
										<Input
											type="time"
											value={hours.start}
											onChange={(e) => setHours((v) => ({ ...v, start: e.target.value }))}
										/>
									</Field>
									<Field label={t("Weekday end")}>
										<Input
											type="time"
											value={hours.end}
											onChange={(e) => setHours((v) => ({ ...v, end: e.target.value }))}
										/>
									</Field>
									<Field label={t("Out-of-hours message")}>
										<Input
											value={hours.unavailable}
											onChange={(e) => setHours((v) => ({ ...v, unavailable: e.target.value }))}
										/>
									</Field>
									<div className="md:col-span-2 xl:col-span-4 flex justify-end">
										<Button disabled={saving} onClick={() => void createHours()}>
											<Plus /> {t("Save schedule")}
										</Button>
									</div>
								</CardContent>
							</Card>
							<ResourceList
								loading={schedules.loading}
								emptyTitle={t("No business hours")}
								emptyDescription={t("Add business hours before applying time-aware SLA policies.")}
								items={schedules.items.map((item) => ({
									id: item.id,
									title: item.timezone,
									detail: item.unavailable_message || t("No out-of-hours message"),
									status: item.active ? "active" : "disabled",
								}))}
								onDelete={(id) => void remove(supportWorkingHours, id, schedules.reload)}
							/>
						</div>
					)}
					{kind === "macros" && (
						<div className="space-y-4">
							<CollectionToolbar collection={macros} filters={kindSelect} />
							<SupportError message={macros.error} />
							<Card>
								<CardHeader>
									<CardTitle className="text-base">{t("New macro")}</CardTitle>
								</CardHeader>
								<CardContent className="grid gap-4 md:grid-cols-3">
									<Field label={t("Name")}>
										<Input
											value={macro.name}
											onChange={(event) =>
												setMacro((current) => ({
													...current,
													name: event.target.value,
												}))
											}
										/>
									</Field>
									<Field label={t("Action")}>
										<Select
											value={macro.action}
											onChange={(action) => setMacro((current) => ({ ...current, action }))}
											options={[
												"set_status",
												"set_priority",
												"assign_agent",
												"assign_team",
												"assign_inbox",
												"add_label",
												"remove_label",
											]}
										/>
									</Field>
									<Field label={t("Value")}>
										<Input
											value={macro.value}
											onChange={(event) =>
												setMacro((current) => ({
													...current,
													value: event.target.value,
												}))
											}
										/>
									</Field>
									<div className="md:col-span-3 flex justify-end">
										<Button disabled={saving} onClick={() => void createMacro()}>
											<Plus /> {t("Create macro")}
										</Button>
									</div>
								</CardContent>
							</Card>
							<ResourceList
								loading={macros.loading}
								emptyTitle={t("No macros")}
								emptyDescription={t("Create reusable, validated Support actions for agents.")}
								items={macros.items.map((item) => ({
									id: item.id,
									title: item.name,
									detail: t(item.actions.length === 1 ? "{count} action" : "{count} actions", {
										count: item.actions.length,
									}),
									status: item.active ? "active" : "disabled",
								}))}
								onDelete={(id) => void remove(supportMacros, id, macros.reload)}
							/>
						</div>
					)}
					{kind === "responses" && (
						<div className="space-y-4">
							<CollectionToolbar collection={cannedResponses} filters={kindSelect} />
							<SupportError message={cannedResponses.error} />
							<Card>
								<CardHeader>
									<CardTitle className="text-base">{t("New canned response")}</CardTitle>
								</CardHeader>
								<CardContent className="grid gap-4 md:grid-cols-2">
									<Field label={t("Name")}>
										<Input
											value={cannedResponse.name}
											onChange={(event) =>
												setCannedResponse((current) => ({
													...current,
													name: event.target.value,
												}))
											}
										/>
									</Field>
									<Field label={t("Shortcut")}>
										<Input
											value={cannedResponse.shortcut}
											onChange={(event) =>
												setCannedResponse((current) => ({
													...current,
													shortcut: event.target.value,
												}))
											}
										/>
									</Field>
									<div className="space-y-2 md:col-span-2">
										<Label>{t("Response")}</Label>
										<Textarea
											value={cannedResponse.content}
											onChange={(event) =>
												setCannedResponse((current) => ({
													...current,
													content: event.target.value,
												}))
											}
										/>
									</div>
									<div className="md:col-span-2 flex justify-end">
										<Button disabled={saving} onClick={() => void createCannedResponse()}>
											<Plus /> {t("Create response")}
										</Button>
									</div>
								</CardContent>
							</Card>
							<ResourceList
								loading={cannedResponses.loading}
								emptyTitle={t("No canned responses")}
								emptyDescription={t("Create reusable replies for the Support Inbox.")}
								items={cannedResponses.items.map((item) => ({
									id: item.id,
									title: item.name,
									detail: item.shortcut || item.content.slice(0, 80),
									status: item.active ? "active" : "disabled",
								}))}
								onDelete={(id) => void remove(supportCannedResponses, id, cannedResponses.reload)}
							/>
						</div>
					)}
				</div>
			)}
		</ModulePage>
	);
}

type Collection = ReturnType<typeof useSupportCollection<unknown>>;
function CollectionToolbar({
	collection,
	search = true,
	filters,
}: {
	collection: Collection;
	search?: boolean;
	filters?: ReactNode;
}) {
	const { t } = useSupportI18n();

	return search ? (
		<SupportSearchToolbar
			query={collection.query}
			setQuery={collection.setQuery}
			onSearch={collection.search}
			onRefresh={collection.reload}
			loading={collection.loading}
			filters={filters}
		/>
	) : (
		<div className="flex flex-wrap items-center gap-2">
			{filters}
			<Button
				className="ms-auto"
				variant="outline"
				onClick={() => {
					collection.reload().catch(() => undefined);
				}}
			>
				{t("Refresh")}
			</Button>
		</div>
	);
}
function ResourceList({
	loading,
	items,
	emptyTitle,
	emptyDescription,
	onDelete,
	onOpen,
}: {
	loading: boolean;
	items: Array<{ id: string; title: string; detail: string; status: string }>;
	emptyTitle: string;
	emptyDescription: string;
	onDelete: (id: string) => void;
	onOpen?: (id: string) => void;
}) {
	const { t } = useSupportI18n();
	if (loading) return <SupportLoading />;
	if (!items.length) return <SupportEmpty title={emptyTitle} description={emptyDescription} />;
	return (
		<div className="grid gap-3">
			{items.map((item) => (
				<Card key={item.id}>
					<CardContent className="flex items-center justify-between gap-3 p-4">
						<div>
							{onOpen ? (
								<button
									type="button"
									className="font-medium underline"
									onClick={() => {
										onOpen(item.id);
									}}
								>
									{item.title}
								</button>
							) : (
								<p className="font-medium">{item.title}</p>
							)}
							<p className="text-sm text-muted-foreground">{item.detail}</p>
						</div>
						<div className="flex items-center gap-2">
							<SupportStatus value={item.status} />
							<Button
								aria-label={t("Delete {name}", { name: item.title })}
								size="icon"
								variant="ghost"
								onClick={() => onDelete(item.id)}
							>
								<Trash2 />
							</Button>
						</div>
					</CardContent>
				</Card>
			))}
		</div>
	);
}

function Select({
	id,
	value,
	onChange,
	options,
}: {
	id?: string;
	value: string;
	onChange: (value: string) => void;
	options: string[];
}) {
	const { t } = useSupportI18n();
	return (
		<select
			id={id}
			className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
			value={value}
			onChange={(event) => onChange(event.target.value)}
		>
			{options.map((option) => (
				<option key={option} value={option}>
					{t(optionLabel(option))}
				</option>
			))}
		</select>
	);
}
