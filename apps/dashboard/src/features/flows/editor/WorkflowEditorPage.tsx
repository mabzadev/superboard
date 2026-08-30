"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Download,
  GitCommitHorizontal,
  Rocket,
} from "lucide-react";

import {
  flowsApi,
  type FlowComponentDefinition,
  type FlowEnvironment,
  type FlowGraph,
  type FlowSurveyAnalytics,
  type FlowVersion,
  type FlowWorkflowAnalytics,
  type FlowWorkflowDetails,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  showErrorNotification,
  showSuccessNotification,
} from "@/lib/Notifications";
import { FlowStatusBadge } from "../FlowStatusBadge";
import { useFlows } from "../FlowsContext";
import { FlowsPage } from "../FlowsPage";
import { useFlowI18n } from "../i18n";
import { FlowEditor } from "./FlowEditor";
import { normalizeGraph } from "./graph";

type SelectedVersion = "draft" | string;

export function WorkflowEditorPage({ workflowId }: { workflowId: string }) {
  const { t, tr } = useFlowI18n();
  const { projectRef } = useFlows();
  const [workflow, setWorkflow] = useState<FlowWorkflowDetails | null>(null);
  const [environments, setEnvironments] = useState<FlowEnvironment[]>([]);
  const [components, setComponents] = useState<FlowComponentDefinition[]>([]);
  const [locales, setLocales] = useState<string[]>(["en", "fr"]);
  const [selectedVersion, setSelectedVersion] =
    useState<SelectedVersion>("draft");
  const [versionGraph, setVersionGraph] = useState<FlowGraph | null>(null);
  const [tab, setTab] = useState("editor");
  const [analytics, setAnalytics] = useState<FlowWorkflowAnalytics | null>(
    null
  );
  const [surveyAnalytics, setSurveyAnalytics] = useState<
    Record<string, FlowSurveyAnalytics>
  >({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);

  const load = useCallback(async () => {
    if (!projectRef) return;
    setLoading(true);
    try {
      const [details, nextEnvironments, languageGroups, componentCatalog] =
        await Promise.all([
          flowsApi.getWorkflow(projectRef, workflowId),
          flowsApi.listEnvironments(projectRef),
          flowsApi.listLocalization(projectRef),
          flowsApi.listComponents(projectRef),
        ]);
      setWorkflow(details);
      setEnvironments(nextEnvironments);
      const enabledLibraries = new Set(
        componentCatalog.libraries
          .filter((library) => Boolean(library.enabled))
          .map((library) => library.id)
      );
      setComponents(
        componentCatalog.components.filter((component) =>
          enabledLibraries.has(component.library_id)
        )
      );
      setLocales([
        ...new Set(languageGroups.flatMap((group) => group.locales)),
      ]);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("apiFailure"));
    } finally {
      setLoading(false);
    }
  }, [projectRef, t, workflowId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!projectRef || selectedVersion === "draft") {
      setVersionGraph(null);
      return;
    }
    let cancelled = false;
    void flowsApi
      .getVersion(projectRef, workflowId, selectedVersion)
      .then((version) => {
        if (!cancelled) setVersionGraph(normalizeGraph(version.graph));
      })
      .catch((cause: unknown) =>
        showErrorNotification(
          cause instanceof Error ? cause.message : t("apiFailure")
        )
      );
    return () => {
      cancelled = true;
    };
  }, [projectRef, selectedVersion, t, workflowId]);

  useEffect(() => {
    if (tab !== "analytics" || !projectRef || !workflow) return;
    const surveyIds = normalizeGraph(workflow.draft?.graph)
      .blocks.filter((block) => block.type === "survey")
      .map((block) => block.id);
    void Promise.all([
      flowsApi.workflowAnalytics(projectRef, workflowId),
      Promise.all(
        surveyIds.map((surveyId) =>
          flowsApi.surveyAnalytics(projectRef, surveyId)
        )
      ),
    ])
      .then(([result, surveys]) => {
        setAnalytics(result);
        setSurveyAnalytics(
          Object.fromEntries(
            surveys.map((survey) => [survey.survey_id, survey])
          )
        );
      })
      .catch((cause: unknown) =>
        showErrorNotification(
          cause instanceof Error ? cause.message : t("apiFailure")
        )
      );
  }, [projectRef, t, tab, workflow, workflowId]);

  const save = async (graph: FlowGraph, revision: number) => {
    if (!projectRef) return revision;
    try {
      const saved = await flowsApi.saveDraft(
        projectRef,
        workflowId,
        graph,
        revision
      );
      setWorkflow((current) =>
        current && current.draft
          ? {
              ...current,
              draft_revision: saved.revision,
              draft: {
                ...current.draft,
                revision: saved.revision,
                graph: saved.graph,
                validation: saved.validation,
                updated_at: saved.updated_at,
              },
            }
          : current
      );
      showSuccessNotification(t("saveSuccess"));
      return saved.revision;
    } catch (cause) {
      showErrorNotification(
        cause instanceof Error ? cause.message : t("apiFailure")
      );
      throw cause;
    }
  };

  const activate = async (environmentId: string, version: FlowVersion) => {
    if (!projectRef) return;
    try {
      const release = await flowsApi.activateRelease(projectRef, workflowId, {
        environment_id: environmentId,
        version_id: version.id,
        active: true,
      });
      showSuccessNotification(
        release.migration_execution_id
          ? `${tr("Environment release updated")} · ${tr("Migration scheduled")} ${release.migration_execution_id}`
          : tr("Environment release updated")
      );
      await load();
    } catch (cause) {
      showErrorNotification(
        cause instanceof Error ? cause.message : t("apiFailure")
      );
    }
  };

  const translate = async (
    blockKey: string,
    propertyKey: string,
    locale: string,
    value: unknown
  ) => {
    if (!projectRef) return;
    await flowsApi.saveTranslations(projectRef, workflowId, [
      {
        block_key: blockKey,
        property_key: propertyKey,
        locale,
        value,
      },
    ]);
    setWorkflow((current) => {
      if (!current) return current;
      const translations = current.translations.filter(
        (item) =>
          !(
            item.block_key === blockKey &&
            item.property_key === propertyKey &&
            item.locale === locale
          )
      );
      return {
        ...current,
        translations: [
          ...translations,
          {
            block_key: blockKey,
            property_key: propertyKey,
            locale,
            value,
          },
        ],
      };
    });
  };

  const draftGraph = workflow?.draft?.graph;
  const graph = useMemo<FlowGraph>(
    () =>
      selectedVersion === "draft"
        ? normalizeGraph(draftGraph)
        : (versionGraph ?? { schemaVersion: 1, blocks: [], paths: [] }),
    [draftGraph, selectedVersion, versionGraph]
  );

  return (
    <FlowsPage
      title={workflow?.name ?? tr("Workflow")}
      description={
        workflow?.description ??
        workflow?.identifier ??
        t("workflowsDescription")
      }
      fullHeight
      actions={
        workflow ? (
          <>
            <FlowStatusBadge status={workflow.status} />
            <Select value={selectedVersion} onValueChange={setSelectedVersion}>
              <SelectTrigger
                className="w-44 bg-card"
                aria-label={tr("Workflow version")}
              >
                <GitCommitHorizontal />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">
                  {t("draft")} · r
                  {workflow.draft?.revision ?? workflow.draft_revision}
                </SelectItem>
                {workflow.versions.map((version) => (
                  <SelectItem value={version.id} key={version.id}>
                    Version {version.version}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
              <DialogTrigger asChild>
                <Button size="sm" disabled={!workflow.draft}>
                  <Rocket /> {t("publish")}
                </Button>
              </DialogTrigger>
              <PublishDialog
                workflow={workflow}
                environments={environments}
                onPublished={(version, environmentId) => {
                  setPublishOpen(false);
                  void activate(environmentId, version);
                }}
              />
            </Dialog>
          </>
        ) : undefined
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex shrink-0 items-center justify-between gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/flows/workflows">
              <ArrowLeft /> {t("workflows")}
            </Link>
          </Button>
          {workflow && (
            <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
              {workflow.releases
                .filter((release) => Boolean(release.active))
                .map((release) => (
                  <span
                    key={release.environment_id}
                    className="flex items-center gap-1 rounded-full border bg-card px-2 py-1"
                  >
                    <CheckCircle2 className="size-3 text-green-600" />{" "}
                    {release.environment_name}:{" "}
                    {release.use_draft ? t("draft") : `v${release.version}`}
                  </span>
                ))}
            </div>
          )}
        </div>
        {error && (
          <div
            role="alert"
            className="rounded-[var(--radius)] border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {error}
          </div>
        )}
        {workflow ? (
          <Tabs
            value={tab}
            onValueChange={setTab}
            className="min-h-0 flex-1 gap-3"
          >
            <TabsList className="shrink-0">
              <TabsTrigger value="editor">
                <GitCommitHorizontal /> {t("editor")}
              </TabsTrigger>
              <TabsTrigger value="analytics">
                <BarChart3 /> {t("analytics")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="editor" className="flex min-h-0 flex-1">
              <FlowEditor
                key={`${workflow.id}:${selectedVersion}:${selectedVersion === "draft" ? workflow.draft?.revision : "published"}`}
                initialGraph={graph}
                revision={workflow.draft?.revision ?? workflow.draft_revision}
                readOnly={selectedVersion !== "draft"}
                locales={locales}
                translations={workflow.translations}
                components={components}
                onTranslate={translate}
                onSave={save}
              />
            </TabsContent>
            <TabsContent
              value="analytics"
              className="min-h-0 flex-1 overflow-y-auto"
            >
              <WorkflowAnalytics
                analytics={analytics}
                surveys={surveyAnalytics}
              />
            </TabsContent>
          </Tabs>
        ) : loading ? (
          <div className="min-h-0 flex-1 animate-pulse rounded-[var(--radius)] border bg-card" />
        ) : null}
      </div>
    </FlowsPage>
  );
}

function PublishDialog({
  workflow,
  environments,
  onPublished,
}: {
  workflow: FlowWorkflowDetails;
  environments: FlowEnvironment[];
  onPublished: (version: FlowVersion, environmentId: string) => void;
}) {
  const { t, tr } = useFlowI18n();
  const { projectRef } = useFlows();
  const [strategy, setStrategy] = useState("finish-current");
  const [environmentId, setEnvironmentId] = useState(environments[0]?.id ?? "");
  const [changelog, setChangelog] = useState("");
  const [busy, setBusy] = useState(false);

  const publish = async () => {
    if (!projectRef || !environmentId || busy) return;
    setBusy(true);
    try {
      const version = await flowsApi.publishWorkflow(projectRef, workflow.id, {
        migration_strategy: strategy,
        changelog: changelog.trim() || undefined,
      });
      showSuccessNotification(t("publishSuccess"));
      onPublished(version, environmentId);
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
        <DialogTitle>{t("publishVersion")}</DialogTitle>
        <DialogDescription>
          {tr(
            "Published versions are immutable. Choose how in-progress users migrate and where this version becomes active."
          )}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <label className="grid gap-2">
          <Label>{tr("Migration strategy")}</Label>
          <Select value={strategy} onValueChange={setStrategy}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="finish-current">
                {tr("End in-progress users")}
              </SelectItem>
              <SelectItem value="restart-current">
                {tr("Restart users currently in progress")}
              </SelectItem>
              <SelectItem value="restart-all">
                {tr("Restart every user")}
              </SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="grid gap-2">
          <Label>{tr("Activate in environment")}</Label>
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
        <label className="grid gap-2">
          <Label>{tr("Version note")}</Label>
          <Input
            value={changelog}
            onChange={(event) => setChangelog(event.target.value)}
            placeholder={tr("What changed?")}
          />
        </label>
      </div>
      <DialogFooter>
        <Button
          disabled={!environmentId || busy}
          onClick={() => void publish()}
        >
          <Rocket /> {busy ? t("saving") : t("publish")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function WorkflowAnalytics({
  analytics,
  surveys,
}: {
  analytics: FlowWorkflowAnalytics | null;
  surveys: Record<string, FlowSurveyAnalytics>;
}) {
  const { t, tr } = useFlowI18n();
  const { projectRef } = useFlows();
  const max = Math.max(
    1,
    ...(analytics?.totals.map((item) => Number(item.count)) ?? [1])
  );
  if (!analytics)
    return (
      <div className="min-h-52 animate-pulse rounded-[var(--radius)] border bg-card" />
    );
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <section className="rounded-[var(--radius)] border bg-card p-4">
        <h2 className="font-semibold">{tr("Event totals")}</h2>
        <p className="mb-5 mt-1 text-sm text-muted-foreground">
          {tr("Unique users and normalized runtime events.")}
        </p>
        <div className="grid gap-4">
          {analytics.totals.map((item) => (
            <div key={item.event_name} className="grid gap-1.5">
              <div className="flex justify-between gap-3 text-sm">
                <span className="font-mono text-xs">{item.event_name}</span>
                <span className="tabular-nums">
                  {item.count} · {item.users} {t("users").toLowerCase()}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-foreground"
                  style={{
                    width: `${Math.max(2, (Number(item.count) / max) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ))}
          {analytics.totals.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {t("noData")}
            </p>
          )}
        </div>
      </section>
      <section className="overflow-hidden rounded-[var(--radius)] border bg-card">
        <div className="p-4">
          <h2 className="font-semibold">{tr("Block performance")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {tr("Shown, exited, completed and survey events per block.")}
          </p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tr("Block")}</TableHead>
              <TableHead>{tr("Event")}</TableHead>
              <TableHead className="text-right">{tr("Events")}</TableHead>
              <TableHead className="text-right">{tr("Users")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {analytics.blocks.map((item) => (
              <TableRow key={`${item.block_id}:${item.event_name}`}>
                <TableCell className="font-mono text-xs">
                  {item.block_key}
                </TableCell>
                <TableCell>{item.event_name}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {item.count}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {item.users}
                </TableCell>
              </TableRow>
            ))}
            {analytics.blocks.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="h-32 text-center text-muted-foreground"
                >
                  {t("noData")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>
      {Object.values(surveys).map((survey) => (
        <section
          key={survey.survey_id}
          className="grid gap-4 rounded-[var(--radius)] border bg-card p-4 xl:col-span-2"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">{tr("Survey results")}</h2>
              <p className="font-mono text-xs text-muted-foreground">
                {survey.survey_id}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={!projectRef}
              onClick={() => {
                if (!projectRef) return;
                void flowsApi
                  .exportSurveyCsv(projectRef, survey.survey_id)
                  .then((result) =>
                    showSuccessNotification(
                      `${tr("CSV archived")}: ${result.row_count} ${tr("Responses").toLowerCase()}`
                    )
                  )
                  .catch((cause: unknown) =>
                    showErrorNotification(
                      cause instanceof Error ? cause.message : t("apiFailure")
                    )
                  );
              }}
            >
              <Download /> {tr("Export CSV")}
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Metric label={tr("Shown")} value={survey.summary.shown} />
            <Metric label={tr("Responses")} value={survey.summary.responses} />
            <Metric
              label={tr("Completion")}
              value={`${Math.round(survey.summary.completion * 100)}%`}
            />
            <Metric label={tr("Link clicks")} value={survey.links.clicks} />
            <Metric
              label={tr("Link conversion")}
              value={`${Math.round((survey.links.conversion ?? 0) * 100)}%`}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded border p-3">
              <h3 className="text-sm font-semibold">
                {tr("Rating statistics")}
              </h3>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <Stat label={tr("Average")} value={survey.numeric.average} />
                <Stat label={tr("Median")} value={survey.numeric.median} />
                <Stat
                  label={tr("Std. deviation")}
                  value={survey.numeric.standard_deviation}
                />
              </dl>
            </div>
            <div className="rounded border p-3">
              <h3 className="text-sm font-semibold">
                {tr("Choice distribution")}
              </h3>
              <div className="mt-3 grid gap-2">
                {Object.entries(survey.distributions).map(([option, count]) => (
                  <div
                    key={option}
                    className="flex justify-between gap-3 text-sm"
                  >
                    <span className="font-mono text-xs">{option}</span>
                    <span className="tabular-nums">{count}</span>
                  </div>
                ))}
                {Object.keys(survey.distributions).length === 0 && (
                  <p className="text-sm text-muted-foreground">{t("noData")}</p>
                )}
              </div>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-semibold tabular-nums">
        {value == null ? "—" : value.toFixed(2)}
      </dd>
    </div>
  );
}
