"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Gauge,
  Pause,
  Play,
  Plus,
  Trash2,
} from "lucide-react";

import {
  flowsApi,
  type FlowEnvironment,
  type FlowLaunchpadGroup,
  type FlowWorkflow,
} from "@/api/flows/flowsService";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  showErrorNotification,
  showSuccessNotification,
} from "@/lib/Notifications";
import { FlowStatusBadge } from "./FlowStatusBadge";
import { useFlows } from "./FlowsContext";
import { FlowsEmptyState, FlowsPage } from "./FlowsPage";
import { useFlowI18n } from "./i18n";

export function LaunchpadPage() {
  const { t, tr } = useFlowI18n();
  const { projectRef } = useFlows();
  const [groups, setGroups] = useState<FlowLaunchpadGroup[]>([]);
  const [workflows, setWorkflows] = useState<FlowWorkflow[]>([]);
  const [environments, setEnvironments] = useState<FlowEnvironment[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!projectRef) return;
    setLoading(true);
    try {
      const [nextGroups, nextWorkflows, nextEnvironments] = await Promise.all([
        flowsApi.getLaunchpad(projectRef),
        flowsApi.listWorkflows(projectRef),
        flowsApi.listEnvironments(projectRef),
      ]);
      setGroups(nextGroups);
      setWorkflows(nextWorkflows);
      setEnvironments(nextEnvironments);
    } catch (cause) {
      showErrorNotification(
        cause instanceof Error ? cause.message : t("apiFailure")
      );
    } finally {
      setLoading(false);
    }
  }, [projectRef, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateGroup = async (
    group: FlowLaunchpadGroup,
    changes: Partial<FlowLaunchpadGroup>
  ) => {
    if (!projectRef) return;
    setGroups((items) =>
      items.map((item) =>
        item.id === group.id ? { ...item, ...changes } : item
      )
    );
    try {
      await flowsApi.updateLaunchpadGroup(projectRef, group.id, changes);
      await load();
    } catch (cause) {
      showErrorNotification(
        cause instanceof Error ? cause.message : t("apiFailure")
      );
      await load();
    }
  };

  const remove = async (group: FlowLaunchpadGroup) => {
    if (!projectRef) return;
    try {
      await flowsApi.deleteLaunchpadGroup(projectRef, group.id);
      showSuccessNotification(`${group.name} · ${tr("Deleted")}`);
      await load();
    } catch (cause) {
      showErrorNotification(
        cause instanceof Error ? cause.message : t("apiFailure")
      );
    }
  };

  const moveGroup = async (index: number, direction: -1 | 1) => {
    if (!projectRef) return;
    const targetIndex = index + direction;
    const current = groups[index];
    const target = groups[targetIndex];
    if (!current || !target) return;
    const currentPosition = Number(current.position);
    const targetPosition = Number(target.position);
    const next = [...groups];
    next[index] = { ...target, position: currentPosition };
    next[targetIndex] = { ...current, position: targetPosition };
    setGroups(next);
    try {
      await Promise.all([
        flowsApi.updateLaunchpadGroup(projectRef, current.id, {
          position: targetPosition,
        }),
        flowsApi.updateLaunchpadGroup(projectRef, target.id, {
          position: currentPosition,
        }),
      ]);
      await load();
    } catch (cause) {
      showErrorNotification(
        cause instanceof Error ? cause.message : t("apiFailure")
      );
      await load();
    }
  };

  const addWorkflow = async (group: FlowLaunchpadGroup, workflowId: string) => {
    if (
      !projectRef ||
      group.workflows.some((item) => item.workflow_id === workflowId)
    )
      return;
    try {
      await flowsApi.setLaunchpadWorkflows(projectRef, group.id, [
        ...group.workflows.map((item) => ({
          workflow_id: item.workflow_id,
          priority: item.priority,
        })),
        {
          workflow_id: workflowId,
          priority: group.workflows.length
            ? Math.min(...group.workflows.map((item) => item.priority)) - 1
            : 100,
        },
      ]);
      await load();
    } catch (cause) {
      showErrorNotification(
        cause instanceof Error ? cause.message : t("apiFailure")
      );
    }
  };

  const moveWorkflow = async (
    group: FlowLaunchpadGroup,
    index: number,
    direction: -1 | 1
  ) => {
    if (!projectRef) return;
    const target = index + direction;
    if (target < 0 || target >= group.workflows.length) return;
    const next = [...group.workflows];
    const current = next[index];
    const other = next[target];
    if (!current || !other) return;
    next[index] = other;
    next[target] = current;
    await flowsApi.setLaunchpadWorkflows(
      projectRef,
      group.id,
      next.map((item, order) => ({
        workflow_id: item.workflow_id,
        priority: (next.length - order) * 100,
      }))
    );
    await load();
  };

  const removeWorkflow = async (
    group: FlowLaunchpadGroup,
    workflowId: string
  ) => {
    if (!projectRef) return;
    await flowsApi.setLaunchpadWorkflows(
      projectRef,
      group.id,
      group.workflows
        .filter((item) => item.workflow_id !== workflowId)
        .map((item) => ({
          workflow_id: item.workflow_id,
          priority: item.priority,
        }))
    );
    await load();
  };

  return (
    <FlowsPage
      title={t("launchpad")}
      description={t("launchpadDescription")}
      actions={
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus /> {t("newGroup")}
            </Button>
          </DialogTrigger>
          <CreateGroupDialog
            environments={environments}
            position={groups.length}
            onCreated={() => {
              setCreateOpen(false);
              void load();
            }}
          />
        </Dialog>
      }
    >
      {groups.length ? (
        <div className="grid gap-4">
          {groups.map((group, groupIndex) => (
            <Card key={group.id}>
              <CardHeader className="grid grid-cols-[1fr_auto] gap-3 border-b pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle>{group.name}</CardTitle>
                    <FlowStatusBadge
                      status={group.paused ? "paused" : "active"}
                    />
                  </div>
                  <CardDescription>
                    {group.environment_name} ·{" "}
                    {group.concurrency_limit == null
                      ? t("unlimited")
                      : `${group.concurrency_limit} ${tr("concurrent workflows")}`}
                  </CardDescription>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={groupIndex === 0}
                    aria-label={tr("Move group up")}
                    onClick={() => void moveGroup(groupIndex, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={groupIndex === groups.length - 1}
                    aria-label={tr("Move group down")}
                    onClick={() => void moveGroup(groupIndex, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={group.paused ? t("resume") : t("pause")}
                    onClick={() =>
                      void updateGroup(group, {
                        paused: !Boolean(group.paused),
                      })
                    }
                  >
                    {group.paused ? <Play /> : <Pause />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("delete")}
                    onClick={() => void remove(group)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 pt-0">
                {group.workflows.map((workflow, index) => (
                  <div
                    key={workflow.workflow_id}
                    className="flex items-center gap-3 rounded-[var(--radius-sm)] border bg-background p-3"
                  >
                    <span className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{workflow.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {workflow.identifier}
                      </p>
                    </div>
                    <FlowStatusBadge status={workflow.status} />
                    <span className="hidden text-xs text-muted-foreground sm:inline">
                      {t("priority")} {workflow.priority}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={index === 0}
                      aria-label={tr("Move workflow up")}
                      onClick={() => void moveWorkflow(group, index, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={index === group.workflows.length - 1}
                      aria-label={tr("Move workflow down")}
                      onClick={() => void moveWorkflow(group, index, 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={tr("Remove workflow")}
                      onClick={() =>
                        void removeWorkflow(group, workflow.workflow_id)
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                <Select
                  onValueChange={(value) => void addWorkflow(group, value)}
                >
                  <SelectTrigger className="w-full border-dashed">
                    <Plus />
                    <SelectValue
                      placeholder={tr("Add workflow to this group")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {workflows
                      .filter(
                        (workflow) =>
                          !group.workflows.some(
                            (item) => item.workflow_id === workflow.id
                          )
                      )
                      .map((workflow) => (
                        <SelectItem key={workflow.id} value={workflow.id}>
                          {workflow.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : !loading ? (
        <FlowsEmptyState
          icon={Gauge}
          title={t("noData")}
          description={tr(
            "Workflows outside Launchpad still start immediately when eligible."
          )}
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus /> {t("newGroup")}
            </Button>
          }
        />
      ) : (
        <div className="min-h-52 animate-pulse rounded-[var(--radius)] border bg-card" />
      )}
    </FlowsPage>
  );
}

function CreateGroupDialog({
  environments,
  position,
  onCreated,
}: {
  environments: FlowEnvironment[];
  position: number;
  onCreated: () => void;
}) {
  const { t, tr } = useFlowI18n();
  const { projectRef } = useFlows();
  const [name, setName] = useState("");
  const [environmentId, setEnvironmentId] = useState(environments[0]?.id ?? "");
  const [limited, setLimited] = useState(false);
  const [limit, setLimit] = useState(1);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!projectRef || !name.trim() || !environmentId) return;
    setBusy(true);
    try {
      await flowsApi.createLaunchpadGroup(projectRef, {
        name: name.trim(),
        environment_id: environmentId,
        position,
        concurrency_limit: limited ? limit : null,
      });
      showSuccessNotification(`${name} · ${tr("Created")}`);
      onCreated();
    } catch (cause) {
      showErrorNotification(
        cause instanceof Error ? cause.message : t("apiFailure")
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{t("newGroup")}</DialogTitle>
        <DialogDescription>
          {tr(
            "The first eligible group owns workflows that appear in several groups."
          )}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <label className="grid gap-2">
          <Label>{t("name")}</Label>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="grid gap-2">
          <Label>{t("environmentsCount")}</Label>
          <Select value={environmentId} onValueChange={setEnvironmentId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={tr("Environment")} />
            </SelectTrigger>
            <SelectContent>
              {environments.map((environment) => (
                <SelectItem value={environment.id} key={environment.id}>
                  {environment.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <div className="flex items-center justify-between rounded-[var(--radius-sm)] border p-3">
          <div>
            <Label>{t("concurrency")}</Label>
            <p className="text-xs text-muted-foreground">
              {limited ? tr("Queue workflows after the limit") : t("unlimited")}
            </p>
          </div>
          <Switch checked={limited} onCheckedChange={setLimited} />
        </div>
        {limited && (
          <label className="grid gap-2">
            <Label>{t("limit")}</Label>
            <Input
              type="number"
              min={1}
              value={limit}
              onChange={(event) =>
                setLimit(Math.max(1, Number(event.target.value)))
              }
            />
          </label>
        )}
      </div>
      <DialogFooter>
        <Button
          disabled={!name.trim() || !environmentId || busy}
          onClick={() => void create()}
        >
          {busy ? t("saving") : t("create")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
