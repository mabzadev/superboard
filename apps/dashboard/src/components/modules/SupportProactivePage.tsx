"use client";

import { useState } from "react";
import {
  CalendarClock,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Square,
} from "lucide-react";
import {
  createSupportCampaign,
  listSupportCampaigns,
  runSupportCampaignAction,
  type SupportCampaign,
} from "@/api/support/proactiveService";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  SupportSearchToolbar,
  SupportStatus,
  useSupportCollection,
} from "@/components/support/SupportUi";

export default function SupportProactivePage() {
  const { selectedProject } = useProjectSelection();
  const projectRef = selectedProject?.id;
  const campaigns = useSupportCollection(projectRef, listSupportCampaigns);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    inboxId: "",
    name: "",
    type: "one_off" as "one_off" | "ongoing",
    message: "",
    segment: "all_customers",
    locale: "",
    scheduledAt: "",
  });

  const create = async () => {
    if (
      !projectRef ||
      !draft.inboxId.trim() ||
      !draft.name.trim() ||
      !draft.message.trim()
    )
      return;
    setSaving(true);
    try {
      await createSupportCampaign(projectRef, {
        inbox_id: draft.inboxId.trim(),
        name: draft.name.trim(),
        campaign_type: draft.type,
        message: draft.message.trim(),
        audience: {
          segment: draft.segment,
          ...(draft.locale.trim() ? { locale: draft.locale.trim() } : {}),
        },
        scheduled_at: draft.scheduledAt
          ? new Date(draft.scheduledAt).toISOString()
          : null,
      });
      setDraft((current) => ({
        ...current,
        name: "",
        message: "",
        scheduledAt: "",
      }));
      await campaigns.reload();
      showSuccessNotification("Proactive Support campaign created");
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const run = async (
    campaign: SupportCampaign,
    action: "schedule" | "start" | "pause" | "resume" | "cancel"
  ) => {
    if (!projectRef) return;
    try {
      const scheduledAt =
        action === "schedule"
          ? campaign.scheduled_at || new Date(Date.now() + 60_000).toISOString()
          : undefined;
      await runSupportCampaignAction(
        projectRef,
        campaign.id,
        action,
        scheduledAt
      );
      await campaigns.reload();
      showSuccessNotification(
        `Campaign ${action === "start" ? "started" : `${action}d`}`
      );
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    }
  };

  return (
    <ModulePage
      title="Proactive Support"
      description="Reach eligible customers through Support inboxes with controlled, auditable campaigns."
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="space-y-4">
          <SupportSearchToolbar
            query={campaigns.query}
            setQuery={campaigns.setQuery}
            onSearch={campaigns.search}
            onRefresh={campaigns.reload}
            loading={campaigns.loading}
          />
          <SupportError message={campaigns.error} />
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarClock /> New campaign
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Campaign name">
                <Input
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Inbox ID">
                <Input
                  value={draft.inboxId}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      inboxId: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Cadence">
                <Select
                  value={draft.type}
                  onChange={(type) =>
                    setDraft((current) => ({
                      ...current,
                      type: type as typeof draft.type,
                    }))
                  }
                  options={["one_off", "ongoing"]}
                />
              </Field>
              <Field label="Audience">
                <Select
                  value={draft.segment}
                  onChange={(segment) =>
                    setDraft((current) => ({ ...current, segment }))
                  }
                  options={[
                    "all_customers",
                    "active_customers",
                    "new_customers",
                    "returning_customers",
                  ]}
                />
              </Field>
              <Field label="Audience locale (optional)">
                <Input
                  placeholder="en"
                  value={draft.locale}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      locale: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Schedule (optional)">
                <Input
                  type="datetime-local"
                  value={draft.scheduledAt}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      scheduledAt: event.target.value,
                    }))
                  }
                />
              </Field>
              <div className="space-y-2 md:col-span-2">
                <Label>Support message</Label>
                <Textarea
                  maxLength={8000}
                  rows={4}
                  value={draft.message}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      message: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="flex justify-end md:col-span-2 xl:col-span-4">
                <Button disabled={saving} onClick={() => void create()}>
                  <Plus /> Create campaign
                </Button>
              </div>
            </CardContent>
          </Card>
          {campaigns.loading ? (
            <SupportLoading />
          ) : campaigns.items.length === 0 ? (
            <SupportEmpty
              title="No proactive campaigns"
              description="Create a targeted Support message for eligible customers."
            />
          ) : (
            <div className="space-y-3">
              {campaigns.items.map((campaign) => (
                <Card key={campaign.id}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
                    <div className="max-w-2xl">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{campaign.name}</p>
                        <SupportStatus value={campaign.status} />
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {campaign.message}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {campaign.campaign_type.replaceAll("_", " ")} · Inbox{" "}
                        {campaign.inbox_id}
                        {campaign.scheduled_at
                          ? ` · ${new Date(campaign.scheduled_at).toLocaleString()}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {campaign.status === "draft" ? (
                        <>
                          <Button
                            variant="outline"
                            onClick={() => void run(campaign, "schedule")}
                          >
                            <CalendarClock /> Schedule
                          </Button>
                          <Button onClick={() => void run(campaign, "start")}>
                            <Play /> Start
                          </Button>
                        </>
                      ) : null}
                      {campaign.status === "running" ? (
                        <Button
                          variant="outline"
                          onClick={() => void run(campaign, "pause")}
                        >
                          <Pause /> Pause
                        </Button>
                      ) : null}
                      {campaign.status === "paused" ? (
                        <Button onClick={() => void run(campaign, "resume")}>
                          <RotateCcw /> Resume
                        </Button>
                      ) : null}
                      {["scheduled", "running", "paused"].includes(
                        campaign.status
                      ) ? (
                        <Button
                          variant="destructive"
                          onClick={() => void run(campaign, "cancel")}
                        >
                          <Square /> Cancel
                        </Button>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          <SupportLoadMore
            visible={campaigns.hasMore}
            loading={campaigns.loadingMore}
            onClick={campaigns.loadMore}
          />
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
function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <select
      className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm capitalize"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option.replaceAll("_", " ")}
        </option>
      ))}
    </select>
  );
}
