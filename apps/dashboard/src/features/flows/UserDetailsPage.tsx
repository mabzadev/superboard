"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, RotateCcw, UserRound } from "lucide-react";

import { flowsApi, type FlowUserDetails } from "@/api/flows/flowsService";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  showErrorNotification,
  showSuccessNotification,
} from "@/lib/Notifications";
import { FlowStatusBadge } from "./FlowStatusBadge";
import { useFlows } from "./FlowsContext";
import { FlowsEmptyState, FlowsPage } from "./FlowsPage";
import { useFlowI18n } from "./i18n";

export function FlowUserDetailsPage({ userHash }: { userHash: string }) {
  const { t, locale, tr } = useFlowI18n();
  const { projectRef } = useFlows();
  const [details, setDetails] = useState<FlowUserDetails | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!projectRef) return;
    setLoading(true);
    try {
      setDetails(await flowsApi.getUser(projectRef, userHash));
    } catch (cause) {
      showErrorNotification(
        cause instanceof Error ? cause.message : t("apiFailure")
      );
    } finally {
      setLoading(false);
    }
  }, [projectRef, t, userHash]);
  useEffect(() => {
    void load();
  }, [load]);

  const reset = async (workflowId?: string) => {
    if (!projectRef) return;
    try {
      const result = await flowsApi.resetUser(projectRef, userHash, workflowId);
      showSuccessNotification(
        `${result.states_removed} ${tr("States reset").toLowerCase()}`
      );
      await load();
    } catch (cause) {
      showErrorNotification(
        cause instanceof Error ? cause.message : t("apiFailure")
      );
    }
  };

  return (
    <FlowsPage
      title={tr("User runtime")}
      description={userHash}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href="/flows/users">
            <ArrowLeft /> {t("users")}
          </Link>
        </Button>
      }
    >
      {details ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {details.profiles.map((profile) => (
              <Card key={profile.environment_id}>
                <CardHeader>
                  <CardTitle className="text-sm">
                    {tr("Environment")} {shortId(profile.environment_id)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-1 text-sm">
                  <p>
                    {profile.platform ?? tr("Unknown platform")} ·{" "}
                    {profile.locale ?? tr("No locale")}
                  </p>
                  <p className="text-muted-foreground">
                    {profile.country ?? tr("No country")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {tr("Last seen")} {formatDate(profile.last_seen_at, locale)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
          <Tabs defaultValue="state">
            <TabsList>
              <TabsTrigger value="state">{t("workflowState")}</TabsTrigger>
              <TabsTrigger value="activity">{t("activity")}</TabsTrigger>
            </TabsList>
            <TabsContent value="state" className="grid gap-3">
              {details.workflow_states.map((state) => (
                <Card key={`${state.workflow_id}:${state.updated_at}`}>
                  <CardContent className="flex flex-wrap items-center gap-3 py-0">
                    <div className="min-w-48 flex-1">
                      <p className="font-medium">{state.workflow_name}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {state.workflow_identifier}
                      </p>
                    </div>
                    <FlowStatusBadge status={state.state} />
                    <span className="text-xs text-muted-foreground">
                      {state.active_block_ids.length}{" "}
                      {tr("Active blocks").toLowerCase()}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void reset(state.workflow_id)}
                    >
                      <RotateCcw /> {t("resetProgress")}
                    </Button>
                  </CardContent>
                </Card>
              ))}
              {details.workflow_states.length === 0 && (
                <FlowsEmptyState icon={UserRound} title={t("noData")} />
              )}
            </TabsContent>
            <TabsContent value="activity">
              <div className="grid gap-2 rounded-[var(--radius)] border bg-card p-3">
                {details.events.map((event) => (
                  <div
                    key={event.event_id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b p-2 last:border-0"
                  >
                    <div>
                      <p className="font-mono text-xs">
                        {event.event_name}
                        {event.block_key ? ` · ${event.block_key}` : ""}
                      </p>
                      {Object.keys(event.properties).length > 0 && (
                        <pre className="mt-2 max-h-32 overflow-auto rounded bg-muted p-2 text-[10px]">
                          {JSON.stringify(event.properties, null, 2)}
                        </pre>
                      )}
                    </div>
                    <time className="text-xs text-muted-foreground">
                      {formatDate(event.occurred_at, locale)}
                    </time>
                  </div>
                ))}
                {details.events.length === 0 && (
                  <p className="py-12 text-center text-sm text-muted-foreground">
                    {t("noData")}
                  </p>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </>
      ) : loading ? (
        <div className="min-h-52 animate-pulse rounded-[var(--radius)] border bg-card" />
      ) : (
        <FlowsEmptyState icon={UserRound} title={t("noData")} />
      )}
    </FlowsPage>
  );
}
function shortId(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}
function formatDate(value: string, locale: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}
