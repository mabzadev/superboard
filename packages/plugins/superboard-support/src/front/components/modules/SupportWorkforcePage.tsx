"use client";

import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import {
	showErrorNotification,
	showSuccessNotification,
} from "@superboard/front-ui/lib/Notifications.js";
import { EmptyProject, moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import {
	SettingsActions,
	SettingsRow,
	SettingsSection,
	SettingsTextField,
	SwitchField,
} from "@superboard/front-ui/settings-form";
import { Button } from "@superboard/front-ui/ui/button.js";
import { Plus, Trash2, UsersRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
	createSupportCapacityPolicy,
	createSupportLeave,
	createSupportMembership,
	createSupportTeam,
	deleteSupportCapacityPolicy,
	deleteSupportInbox,
	deleteSupportLeave,
	deleteSupportMembership,
	deleteSupportTeam,
	getWorkforceSummary,
	linkSupportInboxMember,
	linkSupportTeamMember,
	listSupportCapacityPolicies,
	listSupportInboxMembers,
	listSupportInboxes,
	listSupportLeaves,
	listSupportMemberships,
	listSupportTeamMembers,
	listSupportTeams,
	unlinkSupportInboxMember,
	unlinkSupportTeamMember,
	updateSupportCapacityPolicy,
	updateSupportInbox,
	updateSupportMembership,
	updateSupportTeam,
	type SupportMembership,
	type WorkforceSummary,
} from "../../api/support/workforceService.js";
import { useSupportI18n } from "../../i18n.js";
import { SupportModulePage as ModulePage } from "../support/SupportModulePage.js";
import { SettingsSelectField } from "../support/SupportSettingsFields.js";
import {
	SupportEmpty,
	SupportError,
	SupportLoadMore,
	SupportLoading,
	SupportMetric,
	SupportSearchToolbar,
	SupportStatus,
	SupportViewSelect,
	supportChannelLabel,
	useSupportCollection,
} from "../support/SupportUi.js";

const optionLabels: Record<string, string> = {
	agent: "Agent",
	supervisor: "Supervisor",
	online: "Online",
	busy: "Busy",
	offline: "Offline",
};
const optionLabel = (value: string) => optionLabels[value] ?? supportChannelLabel(value);

type WorkforceView = "members" | "teams" | "inboxes" | "routing" | "leaves" | "capacity";

type MemberDraft = {
	auth_user_id: string;
	display_name: string;
	role: "agent" | "supervisor";
	availability: "online" | "busy" | "offline";
	active: boolean;
	capacity: number;
	auto_offline: boolean;
};

const emptyMember: MemberDraft = {
	auth_user_id: "",
	display_name: "",
	role: "agent",
	availability: "offline",
	active: true,
	capacity: 10,
	auto_offline: true,
};
const emptyTeam = {
	name: "",
	description: "",
	allow_auto_assign: true,
	active: true,
};
const emptyCapacity = { name: "", default_capacity: 10, active: true };
const emptyLeave = { membershipId: "", startsAt: "", endsAt: "", reason: "" };

export default function SupportWorkforcePage() {
	const { t, locale } = useSupportI18n();
	const [view, setView] = useState<WorkforceView>("members");

	const { selectedProject } = useProjectSelection();
	const projectRef = selectedProject?.id;
	const [summary, setSummary] = useState<WorkforceSummary | null>(null);
	const [summaryError, setSummaryError] = useState<string | null>(null);
	const [member, setMember] = useState(emptyMember);
	const [team, setTeam] = useState(emptyTeam);
	const [capacity, setCapacity] = useState(emptyCapacity);
	const [leave, setLeave] = useState(emptyLeave);
	const [routing, setRouting] = useState({
		membershipId: "",
		teamId: "",
		inboxId: "",
	});
	const [teamMembers, setTeamMembers] = useState<SupportMembership[]>([]);
	const [inboxMembers, setInboxMembers] = useState<SupportMembership[]>([]);
	const [routingError, setRoutingError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const memberships = useSupportCollection(projectRef, listSupportMemberships);
	const teams = useSupportCollection(projectRef, listSupportTeams);
	const inboxes = useSupportCollection(projectRef, listSupportInboxes);
	const capacities = useSupportCollection(projectRef, listSupportCapacityPolicies);
	const leaves = useSupportCollection(projectRef, listSupportLeaves);

	const loadSummary = useCallback(async () => {
		if (!projectRef) return;
		try {
			setSummary((await getWorkforceSummary(projectRef)).data);
			setSummaryError(null);
		} catch (cause) {
			setSummaryError(moduleErrorMessage(cause, locale));
		}
	}, [projectRef, locale]);
	useEffect(() => void loadSummary(), [loadSummary]);

	const saveMember = async () => {
		if (!projectRef || !member.auth_user_id.trim() || !member.display_name.trim()) return;
		setSaving(true);
		try {
			await createSupportMembership(projectRef, {
				...member,
				auth_user_id: member.auth_user_id.trim(),
				display_name: member.display_name.trim(),
			});
			setMember(emptyMember);
			await Promise.all([memberships.reload(), loadSummary()]);
			showSuccessNotification(t("Support member added"));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		} finally {
			setSaving(false);
		}
	};

	const saveTeam = async () => {
		if (!projectRef || !team.name.trim()) return;
		setSaving(true);
		try {
			await createSupportTeam(projectRef, {
				...team,
				name: team.name.trim(),
				description: team.description.trim() || null,
			});
			setTeam(emptyTeam);
			await Promise.all([teams.reload(), loadSummary()]);
			showSuccessNotification(t("Support team created"));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		} finally {
			setSaving(false);
		}
	};

	const saveCapacity = async () => {
		if (!projectRef || !capacity.name.trim()) return;
		setSaving(true);
		try {
			await createSupportCapacityPolicy(projectRef, {
				...capacity,
				name: capacity.name.trim(),
			});
			setCapacity(emptyCapacity);
			await capacities.reload();
			showSuccessNotification(t("Capacity policy created"));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		} finally {
			setSaving(false);
		}
	};

	const saveLeave = async () => {
		if (!projectRef || !leave.membershipId || !leave.startsAt || !leave.endsAt) return;
		setSaving(true);
		try {
			await createSupportLeave(projectRef, {
				membership_id: leave.membershipId,
				starts_at: new Date(leave.startsAt).toISOString(),
				ends_at: new Date(leave.endsAt).toISOString(),
				reason: leave.reason.trim() || null,
			});
			setLeave(emptyLeave);
			await Promise.all([leaves.reload(), loadSummary()]);
			showSuccessNotification(t("Leave schedule created"));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		} finally {
			setSaving(false);
		}
	};

	const reloadRouting = async (next = routing) => {
		if (!projectRef) return;
		setRoutingError(null);
		try {
			const [teamResult, inboxResult] = await Promise.all([
				next.teamId
					? listSupportTeamMembers(projectRef, next.teamId)
					: Promise.resolve({ data: [] as SupportMembership[] }),
				next.inboxId
					? listSupportInboxMembers(projectRef, next.inboxId)
					: Promise.resolve({ data: [] as SupportMembership[] }),
			]);
			setTeamMembers(teamResult.data);
			setInboxMembers(inboxResult.data);
		} catch (cause) {
			setRoutingError(moduleErrorMessage(cause, locale));
		}
	};

	const updateRouting = async (target: "team" | "inbox", linked: boolean) => {
		if (!projectRef || !routing.membershipId) return;
		const targetId = target === "team" ? routing.teamId : routing.inboxId;
		if (!targetId) return;
		setSaving(true);
		try {
			if (target === "team") {
				await (linked ? linkSupportTeamMember : unlinkSupportTeamMember)(
					projectRef,
					targetId,
					routing.membershipId,
				);
			} else {
				await (linked ? linkSupportInboxMember : unlinkSupportInboxMember)(
					projectRef,
					targetId,
					routing.membershipId,
				);
			}
			await reloadRouting();
			showSuccessNotification(
				linked ? t("Support routing membership added") : t("Support routing membership removed"),
			);
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		} finally {
			setSaving(false);
		}
	};

	const removeMember = async (id: string) => {
		if (!projectRef || !window.confirm(t("Remove this member from Support?"))) return;
		try {
			await deleteSupportMembership(projectRef, id);
			await Promise.all([memberships.reload(), loadSummary()]);
			showSuccessNotification(t("Support member removed"));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		}
	};

	const removeTeam = async (id: string) => {
		if (!projectRef || !window.confirm(t("Delete this Support team?"))) return;
		try {
			await deleteSupportTeam(projectRef, id);
			await Promise.all([teams.reload(), loadSummary()]);
			showSuccessNotification(t("Support team deleted"));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		}
	};

	const removeInbox = async (id: string) => {
		if (!projectRef || !window.confirm(t("Delete this Support inbox?"))) return;
		try {
			await deleteSupportInbox(projectRef, id);
			await Promise.all([inboxes.reload(), loadSummary()]);
			showSuccessNotification(t("Support inbox deleted"));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		}
	};

	const removeCapacity = async (id: string) => {
		if (!projectRef || !window.confirm(t("Delete this capacity policy?"))) return;
		try {
			await deleteSupportCapacityPolicy(projectRef, id);
			await capacities.reload();
			showSuccessNotification(t("Capacity policy deleted"));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		}
	};

	const removeLeave = async (id: string) => {
		if (!projectRef || !window.confirm(t("Delete this leave schedule?"))) return;
		try {
			await deleteSupportLeave(projectRef, id);
			await Promise.all([leaves.reload(), loadSummary()]);
			showSuccessNotification(t("Leave schedule deleted"));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		}
	};

	const setMemberActive = async (item: SupportMembership) => {
		if (!projectRef) return;
		setSaving(true);
		try {
			await updateSupportMembership(projectRef, item.id, {
				active: !item.active,
				availability: item.active ? "offline" : item.availability,
			});
			await Promise.all([memberships.reload(), loadSummary()]);
			showSuccessNotification(
				item.active ? t("Support member disabled") : t("Support member enabled"),
			);
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		} finally {
			setSaving(false);
		}
	};

	const setTeamActive = async (id: string, active: boolean) => {
		if (!projectRef) return;
		setSaving(true);
		try {
			await updateSupportTeam(projectRef, id, { active: !active });
			await Promise.all([teams.reload(), loadSummary()]);
			showSuccessNotification(active ? t("Support team disabled") : t("Support team enabled"));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		} finally {
			setSaving(false);
		}
	};

	const setInboxActive = async (id: string, active: boolean) => {
		if (!projectRef) return;
		setSaving(true);
		try {
			await updateSupportInbox(projectRef, id, {
				status: active ? "disabled" : "active",
			});
			await Promise.all([inboxes.reload(), loadSummary()]);
			showSuccessNotification(active ? t("Support inbox disabled") : t("Support inbox enabled"));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		} finally {
			setSaving(false);
		}
	};

	const setCapacityActive = async (id: string, active: boolean) => {
		if (!projectRef) return;
		setSaving(true);
		try {
			await updateSupportCapacityPolicy(projectRef, id, { active: !active });
			await capacities.reload();
			showSuccessNotification(
				active ? t("Capacity policy disabled") : t("Capacity policy enabled"),
			);
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		} finally {
			setSaving(false);
		}
	};

	const viewSelect = (
		<SupportViewSelect
			label={t("Show")}
			value={view}
			onChange={setView}
			options={[
				{ value: "members", label: t("Members") },
				{ value: "teams", label: t("Teams") },
				{ value: "inboxes", label: t("Inboxes") },
				{ value: "routing", label: t("Routing") },
				{ value: "leaves", label: t("Leave") },
				{ value: "capacity", label: t("Capacity") },
			]}
		/>
	);

	return (
		<ModulePage
			title={t("Workforce")}
			description={t("Support roles, teams, availability, capacity and leave schedules.")}
			error={summaryError}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<div className="space-y-6">
					<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
						<SupportMetric
							label={t("Active members")}
							value={
								summary?.memberships.reduce(
									(total, group) => total + (group.active ? Number(group.count) : 0),
									0,
								) ?? "—"
							}
						/>
						<SupportMetric label={t("Active teams")} value={summary?.active_teams ?? "—"} />
						<SupportMetric label={t("Active inboxes")} value={summary?.active_inboxes ?? "—"} />
						<SupportMetric label={t("Members on leave")} value={summary?.active_leaves ?? "—"} />
					</div>
					<div className="space-y-6">
						{view === "members" && (
							<div className="space-y-6">
								<SupportSearchToolbar
									filters={viewSelect}
									query={memberships.query}
									setQuery={memberships.setQuery}
									onSearch={memberships.search}
									onRefresh={memberships.reload}
									loading={memberships.loading}
								/>
								<SupportError message={memberships.error} />
								<SettingsSection
									title={t("Add a Support member")}
									description={t("Give an existing user access to Support conversations.")}
								>
									<SettingsRow>
										<SettingsTextField
											label={t("Identity user ID")}
											value={member.auth_user_id}
											onChange={(e) =>
												setMember((v) => ({
													...v,
													auth_user_id: e.target.value,
												}))
											}
										/>
										<SettingsTextField
											label={t("Display name")}
											value={member.display_name}
											onChange={(e) =>
												setMember((v) => ({
													...v,
													display_name: e.target.value,
												}))
											}
										/>
										<SelectField
											label={t("Support role")}
											value={member.role}
											onChange={(value) =>
												setMember((v) => ({
													...v,
													role: value as "agent" | "supervisor",
												}))
											}
											options={["agent", "supervisor"]}
										/>
										<SelectField
											label={t("Availability")}
											value={member.availability}
											onChange={(value) =>
												setMember((v) => ({
													...v,
													availability: value as "online" | "busy" | "offline",
												}))
											}
											options={["online", "busy", "offline"]}
										/>
										<SettingsTextField
											label={t("Capacity")}
											description={t("Maximum number of conversations at the same time.")}
											type="number"
											min={0}
											value={member.capacity}
											onChange={(e) =>
												setMember((v) => ({
													...v,
													capacity: Number(e.target.value),
												}))
											}
										/>
										<SettingsActions>
											<Button disabled={saving} onClick={() => void saveMember()}>
												<Plus /> {t("Add member")}
											</Button>
										</SettingsActions>
									</SettingsRow>
								</SettingsSection>
								{memberships.loading ? (
									<SupportLoading />
								) : memberships.items.length === 0 ? (
									<SupportEmpty
										title={t("No Support members")}
										description={t(
											"Add an active agent or supervisor to start assigning conversations.",
										)}
									/>
								) : (
									<SettingsSection
										title={t("Members")}
										description={t("Switch a member off to stop assigning conversations to them.")}
									>
										{memberships.items.map((item) => (
											<RecordRow
												key={item.id}
												title={item.display_name}
												detail={t("{user} · {role} · capacity {capacity}", {
													user: item.auth_user_id,
													role: t(optionLabel(item.role)),
													capacity: item.capacity,
												})}
												status={item.active ? item.availability : "disabled"}
												active={item.active}
												disabled={saving}
												onActiveChange={() => void setMemberActive(item)}
												removeLabel={t("Remove {name}", { name: item.display_name })}
												onRemove={() => void removeMember(item.id)}
											/>
										))}
									</SettingsSection>
								)}
								<SupportLoadMore
									visible={memberships.hasMore}
									loading={memberships.loadingMore}
									onClick={memberships.loadMore}
								/>
							</div>
						)}
						{view === "teams" && (
							<div className="space-y-6">
								<SupportSearchToolbar
									filters={viewSelect}
									query={teams.query}
									setQuery={teams.setQuery}
									onSearch={teams.search}
									onRefresh={teams.reload}
									loading={teams.loading}
								/>
								<SupportError message={teams.error} />
								<SettingsSection
									title={t("Create a team")}
									description={t("Group agents to route conversations to them together.")}
								>
									<SettingsRow>
										<SettingsTextField
											label={t("Name")}
											value={team.name}
											onChange={(e) => setTeam((v) => ({ ...v, name: e.target.value }))}
										/>
										<SettingsTextField
											label={t("Description")}
											value={team.description}
											onChange={(e) => setTeam((v) => ({ ...v, description: e.target.value }))}
										/>
									</SettingsRow>
									<SettingsRow>
										<SwitchField
											label={t("Automatic assignment")}
											checked={team.allow_auto_assign}
											onCheckedChange={(value) =>
												setTeam((v) => ({ ...v, allow_auto_assign: value }))
											}
										/>
										<SettingsActions>
											<Button disabled={saving} onClick={() => void saveTeam()}>
												<Plus /> {t("Create team")}
											</Button>
										</SettingsActions>
									</SettingsRow>
								</SettingsSection>
								{teams.loading ? (
									<SupportLoading />
								) : teams.items.length === 0 ? (
									<SupportEmpty
										title={t("No Support teams")}
										description={t("Create a team to group agents and route conversations.")}
									/>
								) : (
									<SettingsSection
										title={t("Teams")}
										description={t("Switch a team off to stop routing conversations to it.")}
									>
										{teams.items.map((item) => (
											<RecordRow
												key={item.id}
												title={item.name}
												detail={item.description || t("No description")}
												status={item.active ? "active" : "disabled"}
												active={item.active}
												disabled={saving}
												onActiveChange={() => void setTeamActive(item.id, item.active)}
												removeLabel={t("Delete {name}", { name: item.name })}
												onRemove={() => void removeTeam(item.id)}
											/>
										))}
									</SettingsSection>
								)}
								<SupportLoadMore
									visible={teams.hasMore}
									loading={teams.loadingMore}
									onClick={teams.loadMore}
								/>
							</div>
						)}
						{view === "inboxes" && (
							<div className="space-y-6">
								<SupportSearchToolbar
									filters={viewSelect}
									query={inboxes.query}
									setQuery={inboxes.setQuery}
									onSearch={inboxes.search}
									onRefresh={inboxes.reload}
									loading={inboxes.loading}
								/>
								<SupportError message={inboxes.error} />
								{inboxes.loading ? (
									<SupportLoading />
								) : inboxes.items.length === 0 ? (
									<SupportEmpty
										title={t("No Support inboxes")}
										description={t("Create inboxes from the Inbox page.")}
									/>
								) : (
									<SettingsSection
										title={t("Inboxes")}
										description={t(
											"Inboxes are created from the Inbox page. Switch one off to stop receiving its conversations.",
										)}
									>
										{inboxes.items.map((item) => (
											<RecordRow
												key={item.id}
												title={item.name}
												detail={`${item.identifier} · ${t(supportChannelLabel(item.channel_type))}`}
												status={item.status}
												active={item.status === "active"}
												disabled={saving}
												onActiveChange={() =>
													void setInboxActive(item.id, item.status === "active")
												}
												removeLabel={t("Delete {name}", { name: item.name })}
												onRemove={() => void removeInbox(item.id)}
											/>
										))}
									</SettingsSection>
								)}
								<SupportLoadMore
									visible={inboxes.hasMore}
									loading={inboxes.loadingMore}
									onClick={inboxes.loadMore}
								/>
							</div>
						)}
						{view === "routing" && (
							<div className="space-y-6">
								<div className="flex flex-wrap items-center gap-2">{viewSelect}</div>
								<SupportError message={routingError} />
								<SettingsSection
									title={t("Membership routing")}
									description={t("Choose the teams and inboxes a member works in.")}
								>
									<SettingsRow>
										<SelectField
											label={t("Member")}
											value={routing.membershipId}
											onChange={(membershipId) =>
												setRouting((value) => ({ ...value, membershipId }))
											}
											optionsWithLabels={memberships.items.map((item) => ({
												value: item.id,
												label: item.display_name,
											}))}
										/>
										<SelectField
											label={t("Team")}
											value={routing.teamId}
											onChange={(teamId) => {
												const next = { ...routing, teamId };
												setRouting(next);
												void reloadRouting(next);
											}}
											optionsWithLabels={teams.items.map((item) => ({
												value: item.id,
												label: item.name,
											}))}
										/>
										<SettingsActions>
											<Button
												disabled={saving || !routing.teamId || !routing.membershipId}
												variant="outline"
												onClick={() => void updateRouting("team", false)}
											>
												{t("Remove from team")}
											</Button>
											<Button
												disabled={saving || !routing.teamId || !routing.membershipId}
												onClick={() => void updateRouting("team", true)}
											>
												{t("Add to team")}
											</Button>
										</SettingsActions>
									</SettingsRow>
									<SettingsRow>
										<SelectField
											label={t("Inbox")}
											value={routing.inboxId}
											onChange={(inboxId) => {
												const next = { ...routing, inboxId };
												setRouting(next);
												void reloadRouting(next);
											}}
											optionsWithLabels={inboxes.items.map((item) => ({
												value: item.id,
												label: item.name,
											}))}
										/>
										<SettingsActions>
											<Button
												disabled={saving || !routing.inboxId || !routing.membershipId}
												variant="outline"
												onClick={() => void updateRouting("inbox", false)}
											>
												{t("Remove from inbox")}
											</Button>
											<Button
												disabled={saving || !routing.inboxId || !routing.membershipId}
												onClick={() => void updateRouting("inbox", true)}
											>
												{t("Add to inbox")}
											</Button>
										</SettingsActions>
									</SettingsRow>
								</SettingsSection>
								<RoutingList
									title={t("Team members")}
									description={t("Members of the selected team.")}
									items={teamMembers}
								/>
								<RoutingList
									title={t("Inbox members")}
									description={t("Members of the selected inbox.")}
									items={inboxMembers}
								/>
							</div>
						)}
						{view === "leaves" && (
							<div className="space-y-6">
								<SupportSearchToolbar
									filters={viewSelect}
									query={leaves.query}
									setQuery={leaves.setQuery}
									onSearch={leaves.search}
									onRefresh={leaves.reload}
									loading={leaves.loading}
								/>
								<SupportError message={leaves.error} />
								<SettingsSection
									title={t("Schedule leave")}
									description={t("Scheduled leave is applied to automatic assignment.")}
								>
									<SettingsRow>
										<SelectField
											label={t("Member")}
											value={leave.membershipId}
											onChange={(membershipId) => {
												setLeave((value) => ({ ...value, membershipId }));
											}}
											optionsWithLabels={memberships.items.map((item) => ({
												value: item.id,
												label: item.display_name,
											}))}
										/>
										<SettingsTextField
											label={t("Starts")}
											type="datetime-local"
											value={leave.startsAt}
											onChange={(event) =>
												setLeave((value) => ({ ...value, startsAt: event.target.value }))
											}
										/>
										<SettingsTextField
											label={t("Ends")}
											type="datetime-local"
											value={leave.endsAt}
											onChange={(event) =>
												setLeave((value) => ({ ...value, endsAt: event.target.value }))
											}
										/>
										<SettingsTextField
											label={t("Reason")}
											value={leave.reason}
											onChange={(event) =>
												setLeave((value) => ({ ...value, reason: event.target.value }))
											}
										/>
										<SettingsActions>
											<Button disabled={saving} onClick={() => void saveLeave()}>
												<Plus /> {t("Schedule")}
											</Button>
										</SettingsActions>
									</SettingsRow>
								</SettingsSection>
								{leaves.loading ? (
									<SupportLoading />
								) : leaves.items.length === 0 ? (
									<SupportEmpty
										title={t("No leave schedules")}
										description={t("Scheduled leave is applied to automatic assignment.")}
									/>
								) : (
									<SettingsSection
										title={t("Leave")}
										description={t("Upcoming and current leave periods.")}
									>
										{leaves.items.map((item) => (
											<SettingsRow
												key={item.id}
												className="flex items-center justify-between gap-4 space-y-0"
											>
												<div className="min-w-0">
													<p className="font-medium">
														{memberships.items.find(
															(memberItem) => memberItem.id === item.membership_id,
														)?.display_name || item.membership_id}
													</p>
													<p className="text-sm text-kumo-subtle">
														{new Date(item.starts_at).toLocaleString(locale)} –{" "}
														{new Date(item.ends_at).toLocaleString(locale)}
													</p>
												</div>
												<Button
													aria-label={t("Delete leave")}
													size="icon"
													variant="ghost"
													onClick={() => void removeLeave(item.id)}
												>
													<Trash2 />
												</Button>
											</SettingsRow>
										))}
									</SettingsSection>
								)}
							</div>
						)}
						{view === "capacity" && (
							<div className="space-y-6">
								<SupportSearchToolbar
									filters={viewSelect}
									query={capacities.query}
									setQuery={capacities.setQuery}
									onSearch={capacities.search}
									onRefresh={capacities.reload}
									loading={capacities.loading}
								/>
								<SupportError message={capacities.error} />
								<SettingsSection
									title={t("Create a capacity policy")}
									description={t("Limit how many conversations an agent handles at the same time.")}
								>
									<SettingsRow>
										<SettingsTextField
											label={t("Name")}
											value={capacity.name}
											onChange={(event) =>
												setCapacity((value) => ({ ...value, name: event.target.value }))
											}
										/>
										<SettingsTextField
											label={t("Default capacity")}
											type="number"
											min={0}
											value={capacity.default_capacity}
											onChange={(event) =>
												setCapacity((value) => ({
													...value,
													default_capacity: Number(event.target.value),
												}))
											}
										/>
										<SettingsActions>
											<Button disabled={saving} onClick={() => void saveCapacity()}>
												<Plus /> {t("Create policy")}
											</Button>
										</SettingsActions>
									</SettingsRow>
								</SettingsSection>
								{capacities.items.length > 0 && (
									<SettingsSection
										title={t("Capacity policies")}
										description={t("Switch a policy off to stop applying its limit.")}
									>
										{capacities.items.map((item) => (
											<RecordRow
												key={item.id}
												title={item.name}
												detail={t("Default capacity: {count}", { count: item.default_capacity })}
												status={item.active ? "active" : "disabled"}
												active={item.active}
												disabled={saving}
												onActiveChange={() => void setCapacityActive(item.id, item.active)}
												removeLabel={t("Delete {name}", { name: item.name })}
												onRemove={() => void removeCapacity(item.id)}
											/>
										))}
									</SettingsSection>
								)}
								<SettingsSection
									title={
										<span className="flex items-center gap-2">
											<UsersRound className="size-4" /> {t("Assignment load")}
										</span>
									}
									description={t("Open conversations currently assigned to each agent.")}
								>
									{(summary?.assignments ?? []).length === 0 ? (
										<SettingsRow>
											<p className="text-sm font-medium">{t("No active assignments")}</p>
											<p className="text-sm text-kumo-subtle">
												{t("Assignment load will appear when conversations are routed to agents.")}
											</p>
										</SettingsRow>
									) : (
										summary?.assignments.map((assignment) => (
											<SettingsRow
												key={assignment.assigned_user_id}
												className="flex justify-between gap-4 space-y-0"
											>
												<span>{assignment.assigned_user_id}</span>
												<strong>{assignment.count}</strong>
											</SettingsRow>
										))
									)}
								</SettingsSection>
							</div>
						)}
					</div>
				</div>
			)}
		</ModulePage>
	);
}

function RecordRow({
	title,
	detail,
	status,
	active,
	disabled,
	onActiveChange,
	removeLabel,
	onRemove,
}: {
	title: string;
	detail: string;
	status: string;
	active: boolean;
	disabled: boolean;
	onActiveChange(): void;
	removeLabel: string;
	onRemove(): void;
}) {
	return (
		<SettingsRow>
			<SwitchField
				label={title}
				description={detail}
				trailing={
					<>
						<SupportStatus value={status} />
						<Button aria-label={removeLabel} size="icon" variant="ghost" onClick={onRemove}>
							<Trash2 />
						</Button>
					</>
				}
				checked={active}
				disabled={disabled}
				onCheckedChange={onActiveChange}
			/>
		</SettingsRow>
	);
}

function SelectField({
	label,
	value,
	onChange,
	options = [],
	optionsWithLabels = [],
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	options?: string[];
	optionsWithLabels?: Array<{ value: string; label: string }>;
}) {
	const { t } = useSupportI18n();

	return (
		<SettingsSelectField
			label={label}
			value={value}
			onChange={(event) => onChange(event.target.value)}
		>
			{optionsWithLabels.length ? <option value="">{t("Select")}</option> : null}
			{options.map((option) => (
				<option key={option} value={option}>
					{t(optionLabel(option))}
				</option>
			))}
			{optionsWithLabels.map((option) => (
				<option key={option.value} value={option.value}>
					{option.label}
				</option>
			))}
		</SettingsSelectField>
	);
}

function RoutingList({
	title,
	description,
	items,
}: {
	title: string;
	description: string;
	items: SupportMembership[];
}) {
	const { t } = useSupportI18n();

	return (
		<SettingsSection title={title} description={description}>
			{items.length === 0 ? (
				<SettingsRow>
					<p className="text-sm text-kumo-subtle">{t("No linked members.")}</p>
				</SettingsRow>
			) : (
				items.map((item) => (
					<SettingsRow className="flex items-center justify-between gap-4 space-y-0" key={item.id}>
						<span>{item.display_name}</span>
						<SupportStatus value={item.active ? item.availability : "disabled"} />
					</SettingsRow>
				))
			)}
		</SettingsSection>
	);
}
