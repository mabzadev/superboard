"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, RefreshCw, ShieldAlert } from "lucide-react";
import {
  getAccessKey,
  rotateAccessKey,
  type AccessKeyInfo,
} from "@/api/app/appService";
import { RenderCodeBlock } from "@/components/developers/SetupShared";
import {
  EmptyProject,
  ModulePage,
  moduleErrorMessage,
} from "@/components/modules/ModulePage";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
} from "@/components/ui/dialog";
import { useProjectSelection } from "@/context/useProjectSelection";
import {
  showErrorNotification,
  showSuccessNotification,
} from "@/lib/Notifications";

export default function AccessKeyPageContent() {
  const { selectedProject } = useProjectSelection();
  const [key, setKey] = useState<AccessKeyInfo | null>(null);
  const [secret, setSecret] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);

  const load = useCallback(async () => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      setKey(await getAccessKey(selectedProject.id));
      setError(null);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [selectedProject]);

  useEffect(() => {
    void load();
  }, [load]);

  const rotate = async () => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      const next = await rotateAccessKey(selectedProject.id);
      setKey(next);
      setSecret(next.secret);
      setRotateOpen(false);
      showSuccessNotification(
        "Access Key rotated. Copy it now; the full secret will not be shown again.",
      );
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  };

  const copySecret = async () => {
    if (!secret) return;
    await navigator.clipboard.writeText(secret);
    showSuccessNotification("Access Key copied");
  };

  const displayedKey = secret || (key ? `${key.prefix}••••••••••••••••` : "No key created");

  return (
    <ModulePage
      title="Access Key"
      description="Authenticate public OpenGrow SDK requests without exposing an administrative session."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
          <div className="space-y-6">
            <Card>
              <CardHeader className="flex-row items-start gap-3">
                <div className="rounded-xl bg-muted p-3">
                  <KeyRound className="size-5" />
                </div>
                <div className="flex-1">
                  <CardTitle>Project Access Key</CardTitle>
                  <CardDescription>
                    Scoped to the selected project and environment.
                  </CardDescription>
                </div>
                <Badge variant={key ? "default" : "secondary"}>
                  {key ? "Active" : "Not configured"}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-4">
                  <code className="min-w-0 flex-1 break-all text-sm">
                    {displayedKey}
                  </code>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Copy full Access Key"
                    disabled={!secret}
                    onClick={() => void copySecret()}
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
                {secret ? (
                  <Alert variant="destructive">
                    <ShieldAlert className="size-4" />
                    <AlertTitle>One-time secret</AlertTitle>
                    <AlertDescription>
                      Store this value in your app configuration now. Refreshing
                      this page permanently hides it.
                    </AlertDescription>
                  </Alert>
                ) : null}
                <dl className="grid gap-4 text-sm sm:grid-cols-3">
                  <Metadata label="Prefix" value={key?.prefix || "—"} />
                  <Metadata
                    label="Created"
                    value={key?.created_at ? new Date(key.created_at).toLocaleString() : "—"}
                  />
                  <Metadata
                    label="Last used"
                    value={key?.last_used_at ? new Date(key.last_used_at).toLocaleString() : "Never"}
                  />
                </dl>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={loading}
                    onClick={() => setRotateOpen(true)}
                  >
                    <RefreshCw className="size-4" />
                    {key ? "Rotate Access Key" : "Create Access Key"}
                  </Button>
                  <Button variant="outline" disabled={loading} onClick={() => void load()}>
                    Refresh status
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="h-fit">
            <CardHeader>
              <CardTitle>SDK initialization</CardTitle>
              <CardDescription>
                Use the full key only in client SDK initialization, never in the
                Dashboard API.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RenderCodeBlock
                data={[
                  {
                    language: "typescript",
                    filename: "opengrow.ts",
                    code: `OpenGrow.initialize({\n  accessKey: "${secret || "YOUR_ACCESS_KEY"}"\n});`,
                  },
                  {
                    language: "dart",
                    filename: "main.dart",
                    code: `await OpenGrow.initialize(\n  accessKey: '${secret || "YOUR_ACCESS_KEY"}',\n);`,
                  },
                ]}
              />
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={rotateOpen} onOpenChange={setRotateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{key ? "Rotate Access Key?" : "Create Access Key?"}</DialogTitle>
            <DialogDescription>
              {key
                ? "The existing key is revoked immediately. Deployed applications must be updated with the new value."
                : "The full secret is displayed only once after creation."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRotateOpen(false)}>
              Cancel
            </Button>
            <Button disabled={loading} onClick={() => void rotate()}>
              {key ? "Rotate key" : "Create key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ModulePage>
  );
}

function Metadata({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-all font-medium">{value}</dd>
    </div>
  );
}
