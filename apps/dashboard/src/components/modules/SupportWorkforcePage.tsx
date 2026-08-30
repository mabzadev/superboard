"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, UsersRound } from "lucide-react";
import {
  createSupportCapacityPolicy,
  createSupportInbox,
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
} from "@/api/support/workforceService";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProjectSelection } from "@/context/useProjectSelection";
import {
  showErrorNotification,
  showSuccessNotification,
} from "@/lib/Notifications";
import { EmptyProject, ModulePage, moduleErrorMessage } from "./ModulePage";
import {
  SupportEmpty,
  SupportError,
  SupportLoadMore,
  SupportLoading,
  SupportMetric,
  SupportSearchToolbar,
  SupportStatus,
  useSupportCollection,
} from "@/components/support/SupportUi";

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
const emptyInbox = {
  name: "",
  identifier: "",
  channel_type: "api",
  status: "active" as const,
  auto_assignment: true,
  allow_reopen: true,
  csat_enabled: true,
};
const emptyCapacity = { name: "", default_capacity: 10, active: true };
const emptyLeave = { membershipId: "", startsAt: "", endsAt: "", reason: "" };

export default function SupportWorkforcePage() {
  const { selectedProject } = useProjectSelection();
  const projectRef = selectedProject?.id;
  const [summary, setSummary] = useState<WorkforceSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [member, setMember] = useState(emptyMember);
  const [team, setTeam] = useState(emptyTeam);
  const [inbox, setInbox] = useState(emptyInbox);
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
  const capacities = useSupportCollection(
    projectRef,
    listSupportCapacityPolicies
  );
  const leaves = useSupportCollection(projectRef, listSupportLeaves);

  const loadSummary = useCallback(async () => {
    if (!projectRef) return;
    try {
      setSummary((await getWorkforceSummary(projectRef)).data);
      setSummaryError(null);
    } catch (cause) {
      setSummaryError(moduleErrorMessage(cause));
    }
  }, [projectRef]);
  useEffect(() => void loadSummary(), [loadSummary]);

  const saveMember = async () => {
    if (
      !projectRef ||
      !member.auth_user_id.trim() ||
      !member.display_name.trim()
    )
      return;
    setSaving(true);
    try {
      await createSupportMembership(projectRef, {
        ...member,
        auth_user_id: member.auth_user_id.trim(),
        display_name: member.display_name.trim(),
      });
      setMember(emptyMember);
      await Promise.all([memberships.reload(), loadSummary()]);
      showSuccessNotification("Support member added");
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
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
      showSuccessNotification("Support team created");
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const saveInbox = async () => {
    if (!projectRef || !inbox.name.trim() || !inbox.identifier.trim()) return;
    setSaving(true);
    try {
      await createSupportInbox(projectRef, {
        ...inbox,
        name: inbox.name.trim(),
        identifier: inbox.identifier.trim(),
      });
      setInbox(emptyInbox);
      await Promise.all([inboxes.reload(), loadSummary()]);
      showSuccessNotification("Support inbox created");
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
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
      showSuccessNotification("Capacity policy created");
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const saveLeave = async () => {
    if (
      !projectRef ||
      !leave.membershipId ||
      !leave.startsAt ||
      !leave.endsAt
    )
      return;
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
      showSuccessNotification("Leave schedule created");
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
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
      setRoutingError(moduleErrorMessage(cause));
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
          routing.membershipId
        );
      } else {
        await (linked ? linkSupportInboxMember : unlinkSupportInboxMember)(
          projectRef,
          targetId,
          routing.membershipId
        );
      }
      await reloadRouting();
      showSuccessNotification(
        linked ? "Support routing membership added" : "Support routing membership removed"
      );
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const removeMember = async (id: string) => {
    if (!projectRef || !window.confirm("Remove this member from Support?"))
      return;
    try {
      await deleteSupportMembership(projectRef, id);
      await Promise.all([memberships.reload(), loadSummary()]);
      showSuccessNotification("Support member removed");
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    }
  };

  const removeTeam = async (id: string) => {
    if (!projectRef || !window.confirm("Delete this Support team?")) return;
    try {
      await deleteSupportTeam(projectRef, id);
      await Promise.all([teams.reload(), loadSummary()]);
      showSuccessNotification("Support team deleted");
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    }
  };

  const removeInbox = async (id: string) => {
    if (!projectRef || !window.confirm("Delete this Support inbox?")) return;
    try {
      await deleteSupportInbox(projectRef, id);
      await Promise.all([inboxes.reload(), loadSummary()]);
      showSuccessNotification("Support inbox deleted");
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    }
  };

  const removeCapacity = async (id: string) => {
    if (!projectRef || !window.confirm("Delete this capacity policy?")) return;
    try {
      await deleteSupportCapacityPolicy(projectRef, id);
      await capacities.reload();
      showSuccessNotification("Capacity policy deleted");
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    }
  };

  const removeLeave = async (id: string) => {
    if (!projectRef || !window.confirm("Delete this leave schedule?")) return;
    try {
      await deleteSupportLeave(projectRef, id);
      await Promise.all([leaves.reload(), loadSummary()]);
      showSuccessNotification("Leave schedule deleted");
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
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
        item.active ? "Support member disabled" : "Support member enabled"
      );
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
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
      showSuccessNotification(active ? "Support team disabled" : "Support team enabled");
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
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
      showSuccessNotification(active ? "Support inbox disabled" : "Support inbox enabled");
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
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
      showSuccessNotification(active ? "Capacity policy disabled" : "Capacity policy enabled");
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModulePage
      title="Workforce"
      description="Support roles, teams, availability, capacity and leave schedules."
      error={summaryError}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SupportMetric
              label="Active members"
              value={
                summary?.memberships.reduce(
                  (total, group) =>
                    total + (group.active ? Number(group.count) : 0),
                  0
                ) ?? "—"
              }
            />
            <SupportMetric
              label="Active teams"
              value={summary?.active_teams ?? "—"}
            />
            <SupportMetric
              label="Active inboxes"
              value={summary?.active_inboxes ?? "—"}
            />
            <SupportMetric
              label="Members on leave"
              value={summary?.active_leaves ?? "—"}
            />
          </div>
          <Tabs defaultValue="members">
            <TabsList>
              <TabsTrigger value="members">Members</TabsTrigger>
              <TabsTrigger value="teams">Teams</TabsTrigger>
              <TabsTrigger value="inboxes">Inboxes</TabsTrigger>
              <TabsTrigger value="routing">Routing</TabsTrigger>
              <TabsTrigger value="leaves">Leave</TabsTrigger>
              <TabsTrigger value="capacity">Capacity</TabsTrigger>
            </TabsList>
            <TabsContent className="space-y-4" value="members">
              <SupportSearchToolbar
                query={memberships.query}
                setQuery={memberships.setQuery}
                onSearch={memberships.search}
                onRefresh={memberships.reload}
                loading={memberships.loading}
              />
              <SupportError message={memberships.error} />
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Add a Support member
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
                  <Field label="Identity user ID">
                    <Input
                      value={member.auth_user_id}
                      onChange={(e) =>
                        setMember((v) => ({
                          ...v,
                          auth_user_id: e.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="Display name">
                    <Input
                      value={member.display_name}
                      onChange={(e) =>
                        setMember((v) => ({
                          ...v,
                          display_name: e.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="Support role">
                    <NativeSelect
                      value={member.role}
                      onChange={(value) =>
                        setMember((v) => ({
                          ...v,
                          role: value as "agent" | "supervisor",
                        }))
                      }
                      options={["agent", "supervisor"]}
                    />
                  </Field>
                  <Field label="Availability">
                    <NativeSelect
                      value={member.availability}
                      onChange={(value) =>
                        setMember((v) => ({
                          ...v,
                          availability: value as "online" | "busy" | "offline",
                        }))
                      }
                      options={["online", "busy", "offline"]}
                    />
                  </Field>
                  <Field label="Capacity">
                    <Input
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
                  </Field>
                  <div className="flex items-end">
                    <Button
                      className="w-full"
                      disabled={saving}
                      onClick={() => void saveMember()}
                    >
                      <Plus /> Add member
                    </Button>
                  </div>
                </CardContent>
              </Card>
              {memberships.loading ? (
                <SupportLoading />
              ) : memberships.items.length === 0 ? (
                <SupportEmpty
                  title="No Support members"
                  description="Add an active agent or supervisor to start assigning conversations."
                />
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {memberships.items.map((item) => (
                    <Card key={item.id}>
                      <CardContent className="flex items-center justify-between gap-4 p-4">
                        <div>
                          <p className="font-medium">{item.display_name}</p>
                          <p className="text-sm text-muted-foreground">
                            {item.auth_user_id} · {item.role} · capacity{" "}
                            {item.capacity}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <SupportStatus
                            value={item.active ? item.availability : "disabled"}
                          />
                          <Button
                            disabled={saving}
                            size="sm"
                            variant="outline"
                            onClick={() => void setMemberActive(item)}
                          >
                            {item.active ? "Disable" : "Enable"}
                          </Button>
                          <Button
                            aria-label={`Remove ${item.display_name}`}
                            size="icon"
                            variant="ghost"
                            onClick={() => void removeMember(item.id)}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
              <SupportLoadMore
                visible={memberships.hasMore}
                loading={memberships.loadingMore}
                onClick={memberships.loadMore}
              />
            </TabsContent>
            <TabsContent className="space-y-4" value="teams">
              <SupportSearchToolbar
                query={teams.query}
                setQuery={teams.setQuery}
                onSearch={teams.search}
                onRefresh={teams.reload}
                loading={teams.loading}
              />
              <SupportError message={teams.error} />
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Create a team</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <Field label="Name">
                    <Input
                      value={team.name}
                      onChange={(e) =>
                        setTeam((v) => ({ ...v, name: e.target.value }))
                      }
                    />
                  </Field>
                  <Field label="Description">
                    <Input
                      value={team.description}
                      onChange={(e) =>
                        setTeam((v) => ({ ...v, description: e.target.value }))
                      }
                    />
                  </Field>
                  <div className="flex items-center gap-3 pt-7">
                    <Switch
                      checked={team.allow_auto_assign}
                      onCheckedChange={(value) =>
                        setTeam((v) => ({ ...v, allow_auto_assign: value }))
                      }
                    />
                    <Label>Automatic assignment</Label>
                  </div>
                  <div className="flex items-end">
                    <Button
                      className="w-full"
                      disabled={saving}
                      onClick={() => void saveTeam()}
                    >
                      <Plus /> Create team
                    </Button>
                  </div>
                </CardContent>
              </Card>
              {teams.loading ? (
                <SupportLoading />
              ) : teams.items.length === 0 ? (
                <SupportEmpty
                  title="No Support teams"
                  description="Create a team to group agents and route conversations."
                />
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {teams.items.map((item) => (
                    <Card key={item.id}>
                      <CardContent className="flex items-center justify-between p-4">
                        <div>
                          <p className="font-medium">{item.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {item.description || "No description"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <SupportStatus
                            value={item.active ? "active" : "disabled"}
                          />
                          <Button
                            disabled={saving}
                            size="sm"
                            variant="outline"
                            onClick={() => void setTeamActive(item.id, item.active)}
                          >
                            {item.active ? "Disable" : "Enable"}
                          </Button>
                          <Button
                            aria-label={`Delete ${item.name}`}
                            size="icon"
                            variant="ghost"
                            onClick={() => void removeTeam(item.id)}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
              <SupportLoadMore
                visible={teams.hasMore}
                loading={teams.loadingMore}
                onClick={teams.loadMore}
              />
            </TabsContent>
            <TabsContent className="space-y-4" value="inboxes">
              <SupportSearchToolbar
                query={inboxes.query}
                setQuery={inboxes.setQuery}
                onSearch={inboxes.search}
                onRefresh={inboxes.reload}
                loading={inboxes.loading}
              />
              <SupportError message={inboxes.error} />
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Create an inbox</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <Field label="Name">
                    <Input value={inbox.name} onChange={(event) =>
                      setInbox((value) => ({ ...value, name: event.target.value }))} />
                  </Field>
                  <Field label="Identifier">
                    <Input value={inbox.identifier} onChange={(event) =>
                      setInbox((value) => ({ ...value, identifier: event.target.value }))} />
                  </Field>
                  <Field label="Channel type">
                    <NativeSelect value={inbox.channel_type} onChange={(channel_type) =>
                      setInbox((value) => ({ ...value, channel_type }))}
                      options={["api", "widget", "email_google", "email_microsoft", "smtp", "whatsapp_cloud", "facebook_messenger", "instagram", "twilio_sms", "twilio_voice", "telegram", "line", "twitter"]} />
                  </Field>
                  <div className="flex items-end">
                    <Button className="w-full" disabled={saving} onClick={() => void saveInbox()}>
                      <Plus /> Create inbox
                    </Button>
                  </div>
                </CardContent>
              </Card>
              {inboxes.loading ? <SupportLoading /> : inboxes.items.length === 0 ? (
                <SupportEmpty title="No Support inboxes" description="Create an inbox before connecting a customer channel." />
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {inboxes.items.map((item) => (
                    <Card key={item.id}>
                      <CardContent className="flex items-center justify-between gap-3 p-4">
                        <div><p className="font-medium">{item.name}</p><p className="text-sm text-muted-foreground">{item.identifier} · {item.channel_type}</p></div>
                        <div className="flex items-center gap-2">
                          <SupportStatus value={item.status} />
                          <Button
                            disabled={saving}
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void setInboxActive(item.id, item.status === "active")
                            }
                          >
                            {item.status === "active" ? "Disable" : "Enable"}
                          </Button>
                          <Button aria-label={`Delete ${item.name}`} size="icon" variant="ghost" onClick={() => void removeInbox(item.id)}><Trash2 /></Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
              <SupportLoadMore visible={inboxes.hasMore} loading={inboxes.loadingMore} onClick={inboxes.loadMore} />
            </TabsContent>
            <TabsContent className="space-y-4" value="routing">
              <SupportError message={routingError} />
              <Card>
                <CardHeader><CardTitle className="text-base">Membership routing</CardTitle></CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-3">
                  <Field label="Member"><NativeSelect value={routing.membershipId} onChange={(membershipId) => setRouting((value) => ({ ...value, membershipId }))} optionsWithLabels={memberships.items.map((item) => ({ value: item.id, label: item.display_name }))} /></Field>
                  <Field label="Team"><NativeSelect value={routing.teamId} onChange={(teamId) => { const next = { ...routing, teamId }; setRouting(next); void reloadRouting(next); }} optionsWithLabels={teams.items.map((item) => ({ value: item.id, label: item.name }))} /></Field>
                  <Field label="Inbox"><NativeSelect value={routing.inboxId} onChange={(inboxId) => { const next = { ...routing, inboxId }; setRouting(next); void reloadRouting(next); }} optionsWithLabels={inboxes.items.map((item) => ({ value: item.id, label: item.name }))} /></Field>
                  <div className="flex flex-wrap gap-2 md:col-span-3">
                    <Button disabled={saving || !routing.teamId || !routing.membershipId} onClick={() => void updateRouting("team", true)}>Add to team</Button>
                    <Button disabled={saving || !routing.teamId || !routing.membershipId} variant="outline" onClick={() => void updateRouting("team", false)}>Remove from team</Button>
                    <Button disabled={saving || !routing.inboxId || !routing.membershipId} onClick={() => void updateRouting("inbox", true)}>Add to inbox</Button>
                    <Button disabled={saving || !routing.inboxId || !routing.membershipId} variant="outline" onClick={() => void updateRouting("inbox", false)}>Remove from inbox</Button>
                  </div>
                </CardContent>
              </Card>
              <div className="grid gap-4 lg:grid-cols-2">
                <RoutingList title="Team members" items={teamMembers} />
                <RoutingList title="Inbox members" items={inboxMembers} />
              </div>
            </TabsContent>
            <TabsContent className="space-y-4" value="leaves">
              <SupportSearchToolbar query={leaves.query} setQuery={leaves.setQuery} onSearch={leaves.search} onRefresh={leaves.reload} loading={leaves.loading} />
              <SupportError message={leaves.error} />
              <Card><CardHeader><CardTitle className="text-base">Schedule leave</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <Field label="Member"><NativeSelect value={leave.membershipId} onChange={(membershipId) => setLeave((value) => ({ ...value, membershipId }))} optionsWithLabels={memberships.items.map((item) => ({ value: item.id, label: item.display_name }))} /></Field>
                <Field label="Starts"><Input type="datetime-local" value={leave.startsAt} onChange={(event) => setLeave((value) => ({ ...value, startsAt: event.target.value }))} /></Field>
                <Field label="Ends"><Input type="datetime-local" value={leave.endsAt} onChange={(event) => setLeave((value) => ({ ...value, endsAt: event.target.value }))} /></Field>
                <Field label="Reason"><Input value={leave.reason} onChange={(event) => setLeave((value) => ({ ...value, reason: event.target.value }))} /></Field>
                <div className="flex items-end"><Button className="w-full" disabled={saving} onClick={() => void saveLeave()}><Plus /> Schedule</Button></div>
              </CardContent></Card>
              {leaves.loading ? <SupportLoading /> : leaves.items.length === 0 ? <SupportEmpty title="No leave schedules" description="Scheduled leave is applied to automatic assignment." /> : leaves.items.map((item) => <Card key={item.id}><CardContent className="flex items-center justify-between gap-3 p-4"><div><p className="font-medium">{memberships.items.find((memberItem) => memberItem.id === item.membership_id)?.display_name || item.membership_id}</p><p className="text-sm text-muted-foreground">{new Date(item.starts_at).toLocaleString()} – {new Date(item.ends_at).toLocaleString()}</p></div><Button aria-label="Delete leave" size="icon" variant="ghost" onClick={() => void removeLeave(item.id)}><Trash2 /></Button></CardContent></Card>)}
            </TabsContent>
            <TabsContent className="space-y-4" value="capacity">
              <SupportSearchToolbar query={capacities.query} setQuery={capacities.setQuery} onSearch={capacities.search} onRefresh={capacities.reload} loading={capacities.loading} />
              <SupportError message={capacities.error} />
              <Card><CardHeader><CardTitle className="text-base">Create a capacity policy</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-3"><Field label="Name"><Input value={capacity.name} onChange={(event) => setCapacity((value) => ({ ...value, name: event.target.value }))} /></Field><Field label="Default capacity"><Input type="number" min={0} value={capacity.default_capacity} onChange={(event) => setCapacity((value) => ({ ...value, default_capacity: Number(event.target.value) }))} /></Field><div className="flex items-end"><Button className="w-full" disabled={saving} onClick={() => void saveCapacity()}><Plus /> Create policy</Button></div></CardContent></Card>
              {capacities.items.map((item) => <Card key={item.id}><CardContent className="flex items-center justify-between p-4"><div><p className="font-medium">{item.name}</p><p className="text-sm text-muted-foreground">Default capacity {item.default_capacity}</p></div><div className="flex items-center gap-2"><SupportStatus value={item.active ? "active" : "disabled"} /><Button disabled={saving} size="sm" variant="outline" onClick={() => void setCapacityActive(item.id, item.active)}>{item.active ? "Disable" : "Enable"}</Button><Button aria-label={`Delete ${item.name}`} size="icon" variant="ghost" onClick={() => void removeCapacity(item.id)}><Trash2 /></Button></div></CardContent></Card>)}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <UsersRound /> Assignment load
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(summary?.assignments ?? []).length === 0 ? (
                    <SupportEmpty
                      title="No active assignments"
                      description="Assignment load will appear when conversations are routed to agents."
                    />
                  ) : (
                    summary?.assignments.map((assignment) => (
                      <div
                        key={assignment.assigned_user_id}
                        className="flex justify-between rounded-md border p-3"
                      >
                        <span>{assignment.assigned_user_id}</span>
                        <strong>{assignment.count}</strong>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </ModulePage>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function NativeSelect({
  value,
  onChange,
  options = [],
  optionsWithLabels = [],
}: {
  value: string;
  onChange: (value: string) => void;
  options?: string[];
  optionsWithLabels?: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {optionsWithLabels.length ? <option value="">Select</option> : null}
      {options.map((option) => (
        <option key={option} value={option}>
          {option.replaceAll("_", " ")}
        </option>
      ))}
      {optionsWithLabels.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function RoutingList({
  title,
  items,
}: {
  title: string;
  items: SupportMembership[];
}) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No linked members.</p>
        ) : items.map((item) => (
          <div className="flex items-center justify-between rounded-md border p-3" key={item.id}>
            <span>{item.display_name}</span>
            <SupportStatus value={item.active ? item.availability : "disabled"} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
