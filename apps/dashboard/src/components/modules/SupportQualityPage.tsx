"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldCheck, Star } from "lucide-react";
import {
  getSupportCsat,
  getSupportAudit,
  getSupportQuality,
  type SupportCsat,
  type SupportAuditEvent,
  type SupportQuality,
} from "@/api/messaging/operationsService";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useProjectSelection } from "@/context/useProjectSelection";
import { EmptyProject, ModulePage, moduleErrorMessage } from "./ModulePage";

export function SupportQualityPage() {
  const { selectedProject } = useProjectSelection();
  const [quality, setQuality] = useState<SupportQuality | null>(null);
  const [responses, setResponses] = useState<SupportCsat[]>([]);
  const [audit, setAudit] = useState<SupportAuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      const [summary, csat, trail] = await Promise.all([
        getSupportQuality(selectedProject.id),
        getSupportCsat(selectedProject.id),
        getSupportAudit(selectedProject.id),
      ]);
      setQuality(summary.data);
      setResponses(csat.data || []);
      setAudit(trail.data || []);
      setError(null);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [selectedProject]);
  useEffect(() => void load(), [load]);

  return (
    <ModulePage
      title="Quality"
      description="CSAT, response performance and the complete Support audit trail."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="space-y-6">
          <div className="flex justify-end">
            <Button
              variant="outline"
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCw className={loading ? "animate-spin" : ""} />
              Refresh
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Metric
              label="Average CSAT"
              value={
                quality?.csat.average_rating == null
                  ? "—"
                  : `${Number(quality.csat.average_rating).toFixed(2)} / 5`
              }
            />
            <Metric
              label="CSAT responses"
              value={String(quality?.csat.responses ?? 0)}
            />
            <Metric
              label="Open conversations"
              value={String(quality?.conversations.open ?? 0)}
            />
            <Metric
              label="First reply"
              value={minutes(
                quality?.response_times.average_first_reply_minutes
              )}
            />
            <Metric
              label="Resolution"
              value={minutes(
                quality?.response_times.average_resolution_minutes
              )}
            />
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Star />
                  Customer satisfaction
                </CardTitle>
                <CardDescription>
                  Latest ratings and customer feedback
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {responses.length === 0 ? (
                  <Empty text="No CSAT responses yet." />
                ) : (
                  responses.map((item) => (
                    <div key={item.id} className="rounded-md border p-3">
                      <div className="flex justify-between gap-3">
                        <p className="font-medium">
                          {item.subject || item.conversation_id}
                        </p>
                        <span className="rounded-full bg-muted px-2 py-1 text-xs">
                          {item.rating}/5
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {item.feedback || "No written feedback"}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {new Date(item.created_at).toLocaleString()}
                      </p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck />
                  Audit trail
                </CardTitle>
                <CardDescription>
                  Every Support configuration and conversation mutation
                </CardDescription>
              </CardHeader>
              <CardContent className="max-h-[560px] space-y-2 overflow-auto">
                {audit.length === 0 ? (
                  <Empty text="No audit events yet." />
                ) : (
                  audit.map((event) => (
                    <div key={event.id} className="rounded-md border p-3">
                      <div className="flex justify-between gap-3">
                        <p className="font-medium">{event.action}</p>
                        <span className="text-xs text-muted-foreground">
                          {event.source}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {event.actor_kind}:{event.actor_id} ·{" "}
                        {new Date(event.created_at).toLocaleString()}
                      </p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </ModulePage>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle>{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <p className="py-10 text-center text-sm text-muted-foreground">{text}</p>
  );
}
function minutes(value?: number | null) {
  return value == null ? "—" : `${Number(value).toFixed(1)} min`;
}
