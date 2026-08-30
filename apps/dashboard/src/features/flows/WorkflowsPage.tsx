"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  Copy,
  ExternalLink,
  GitBranch,
  Plus,
  Search,
} from "lucide-react";

import {
  flowsApi,
  type FlowFrequency,
  type FlowOrigin,
  type FlowWorkflow,
} from "@/api/flows/flowsService";
import { Button } from "@/components/ui/button";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  showErrorNotification,
  showSuccessNotification,
} from "@/lib/Notifications";
import { FlowStatusBadge } from "./FlowStatusBadge";
import { useFlows } from "./FlowsContext";
import { FlowsEmptyState, FlowsPage } from "./FlowsPage";
import { useFlowI18n } from "./i18n";

const ALL = "__all__";

export function FlowsWorkflowsPage({
  initialOrigin,
}: {
  initialOrigin?: string;
}) {
  const { t, locale, tr } = useFlowI18n();
  const { projectRef } = useFlows();
  const [workflows, setWorkflows] = useState<FlowWorkflow[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(ALL);
  const [origin, setOrigin] = useState(initialOrigin ?? ALL);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    if (!projectRef) return;
    setLoading(true);
    try {
      setWorkflows(
        await flowsApi.listWorkflows(projectRef, {
          search: search.trim() || undefined,
          status: status === ALL ? undefined : status,
          origin: origin === ALL ? undefined : origin,
        })
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("apiFailure"));
    } finally {
      setLoading(false);
    }
  }, [origin, projectRef, search, status, t]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const migrateLabel = useMemo(() => {
    if (origin === "paywalls") return tr("Migrated paywalls");
    if (origin === "onboardings") return tr("Migrated onboardings");
    return null;
  }, [origin, tr]);

  const duplicate = async (workflow: FlowWorkflow) => {
    if (!projectRef) return;
    try {
      await flowsApi.duplicateWorkflow(projectRef, workflow.id, {
        name: `${workflow.name} copy`,
        identifier:
          `${workflow.identifier}-copy-${Date.now().toString(36)}`.slice(0, 96),
      });
      showSuccessNotification(`${workflow.name} · ${tr("Duplicated")}`);
      await load();
    } catch (cause) {
      showErrorNotification(
        cause instanceof Error ? cause.message : t("apiFailure")
      );
    }
  };

  const archive = async (workflow: FlowWorkflow) => {
    if (!projectRef) return;
    try {
      await flowsApi.updateWorkflow(projectRef, workflow.id, {
        status: "archived",
      });
      showSuccessNotification(`${workflow.name} · ${tr("Archived")}`);
      await load();
    } catch (cause) {
      showErrorNotification(
        cause instanceof Error ? cause.message : t("apiFailure")
      );
    }
  };

  return (
    <FlowsPage
      title={t("workflows")}
      description={t("workflowsDescription")}
      actions={
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus /> {t("newWorkflow")}
            </Button>
          </DialogTrigger>
          <CreateWorkflowDialog
            onCreated={() => {
              setCreateOpen(false);
              void load();
            }}
          />
        </Dialog>
      }
    >
      <div className="flex flex-col gap-3 rounded-[var(--radius)] border bg-card p-3 md:flex-row md:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
            placeholder={t("search")}
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full md:w-44" aria-label={t("status")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("allStatuses")}</SelectItem>
            {(["draft", "active", "paused", "archived"] as const).map(
              (value) => (
                <SelectItem value={value} key={value} className="capitalize">
                  {tr(
                    value === "draft"
                      ? "Draft"
                      : value === "active"
                        ? "Active"
                        : value === "paused"
                          ? "Paused"
                          : "Archived"
                  )}
                </SelectItem>
              )
            )}
          </SelectContent>
        </Select>
        <Select value={origin} onValueChange={setOrigin}>
          <SelectTrigger className="w-full md:w-48" aria-label={t("origin")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("allOrigins")}</SelectItem>
            <SelectItem value="flows">Flows</SelectItem>
            <SelectItem value="paywalls">Paywalls</SelectItem>
            <SelectItem value="onboardings">Onboardings</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {migrateLabel && (
        <div className="rounded-[var(--radius)] border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          {migrateLabel}:{" "}
          {tr(
            "Historical identifiers and statistics remain available through Flows."
          )}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-[var(--radius)] border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-[var(--radius)] border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("name")}</TableHead>
              <TableHead>{t("status")}</TableHead>
              <TableHead>{t("origin")}</TableHead>
              <TableHead>{t("versions")}</TableHead>
              <TableHead>{t("environmentsCount")}</TableHead>
              <TableHead>{t("updated")}</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">{tr("Actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workflows.map((workflow) => (
              <TableRow key={workflow.id}>
                <TableCell>
                  <div className="grid gap-0.5">
                    <Link
                      href={`/flows/workflows/${workflow.id}`}
                      className="font-medium hover:underline"
                    >
                      {workflow.name}
                    </Link>
                    <span className="font-mono text-xs text-muted-foreground">
                      {workflow.identifier}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <FlowStatusBadge status={workflow.status} />
                </TableCell>
                <TableCell className="capitalize">{workflow.origin}</TableCell>
                <TableCell>{workflow.latest_version ?? "—"}</TableCell>
                <TableCell>{workflow.active_environments ?? 0}</TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(workflow.updated_at, locale)}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      asChild
                      variant="ghost"
                      size="icon"
                      title={t("open")}
                    >
                      <Link href={`/flows/workflows/${workflow.id}`}>
                        <ExternalLink />
                        <span className="sr-only">{t("open")}</span>
                      </Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t("duplicate")}
                      onClick={() => void duplicate(workflow)}
                    >
                      <Copy />
                      <span className="sr-only">{t("duplicate")}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t("archive")}
                      onClick={() => void archive(workflow)}
                    >
                      <Archive />
                      <span className="sr-only">{t("archive")}</span>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!loading && workflows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="p-0">
                  <FlowsEmptyState icon={GitBranch} title={t("noData")} />
                </TableCell>
              </TableRow>
            )}
            {loading && workflows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="h-32 text-center text-muted-foreground"
                >
                  {t("loading")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </FlowsPage>
  );
}

function CreateWorkflowDialog({ onCreated }: { onCreated: () => void }) {
  const { t, tr } = useFlowI18n();
  const { projectRef } = useFlows();
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [description, setDescription] = useState("");
  const [frequency, setFrequency] = useState<FlowFrequency>("once");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!projectRef || !name.trim() || !identifier || busy) return;
    setBusy(true);
    try {
      const created = await flowsApi.createWorkflow(projectRef, {
        name: name.trim(),
        identifier,
        description: description.trim() || undefined,
        frequency,
        origin: "flows" satisfies FlowOrigin,
      });
      showSuccessNotification(`${created.name} · ${tr("Created")}`);
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
        <DialogTitle>{t("newWorkflow")}</DialogTitle>
        <DialogDescription>
          {tr(
            "Start with an automatic Start block and an End block. You can add branches in the editor."
          )}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <label className="grid gap-2">
          <Label>{t("name")}</Label>
          <Input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (!identifier) setIdentifier(toIdentifier(event.target.value));
            }}
          />
        </label>
        <label className="grid gap-2">
          <Label>{t("identifier")}</Label>
          <Input
            className="font-mono"
            value={identifier}
            onChange={(event) =>
              setIdentifier(toIdentifier(event.target.value))
            }
          />
        </label>
        <label className="grid gap-2">
          <Label>{t("description")}</Label>
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className="grid gap-2">
          <Label>{t("frequency")}</Label>
          <Select
            value={frequency}
            onValueChange={(value) => setFrequency(value as FlowFrequency)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="once">{t("once")}</SelectItem>
              <SelectItem value="every-time">{t("everyTime")}</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>
      <DialogFooter>
        <Button
          disabled={!name.trim() || !identifier || busy}
          onClick={() => void create()}
        >
          {busy ? t("saving") : t("create")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function toIdentifier(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function formatDate(value: string | undefined, locale: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}
