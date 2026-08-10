"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { ImageIcon, Save, Undo2 } from "lucide-react";
import {
  getSocialPreview,
  saveSocialPreview,
} from "@/api/dynamic-links/dynamicLinksService";
import {
  EmptyProject,
  ModulePage,
  moduleErrorMessage,
} from "@/components/modules/ModulePage";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProjectSelection } from "@/context/useProjectSelection";
import {
  showErrorNotification,
  showSuccessNotification,
} from "@/lib/Notifications";
import { cn } from "@/lib/utils";
import { config } from "@/lib/config";

type PreviewForm = {
  title: string;
  description: string;
  image_url: string;
  site_name: string;
};

const emptyForm: PreviewForm = {
  title: "",
  description: "",
  image_url: "",
  site_name: "",
};

export default function SocialPreviewPageContent() {
  const { selectedProject } = useProjectSelection();
  const [form, setForm] = useState<PreviewForm>(emptyForm);
  const [initial, setInitial] = useState<PreviewForm>(emptyForm);
  const [platform, setPlatform] = useState("facebook");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const load = useCallback(async () => {
    if (!selectedProject) return;
    try {
      const value = await getSocialPreview(selectedProject.id);
      const next = {
        title: value?.title ?? "",
        description: value?.description ?? "",
        image_url: value?.image_url ?? "",
        site_name: value?.site_name ?? "",
      };
      setForm(next);
      setInitial(next);
      setImageFailed(false);
      setError(null);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    }
  }, [selectedProject]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initial),
    [form, initial],
  );

  const save = async () => {
    if (!selectedProject || !form.title.trim()) return;
    setSaving(true);
    try {
      await saveSocialPreview(selectedProject.id, form);
      setInitial(form);
      showSuccessNotification("Social preview saved");
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const domain = form.site_name || new URL(config.shortlinkUrl).hostname;

  return (
    <ModulePage
      title="Social Media Preview"
      description="Design the default Open Graph card shown when a dynamic link is shared."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="space-y-4">
          {dirty ? (
            <div className="sticky top-0 z-10 flex items-center justify-between rounded-lg border bg-background/90 p-3 shadow-sm backdrop-blur">
              <span className="text-sm text-muted-foreground">
                Unsaved social preview changes
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setForm(initial);
                    setImageFailed(false);
                  }}
                >
                  <Undo2 className="size-4" /> Discard
                </Button>
                <Button
                  disabled={saving || !form.title.trim()}
                  onClick={() => void save()}
                >
                  <Save className="size-4" />
                  {saving ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </div>
          ) : null}
          <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
            <Card className="h-fit">
              <CardHeader>
                <CardTitle>Default metadata</CardTitle>
                <CardDescription>
                  Individual links may override these project defaults.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field
                  label="Title"
                  value={form.title}
                  onChange={(title) =>
                    setForm((value) => ({ ...value, title }))
                  }
                />
                <div className="space-y-2">
                  <Label>Description</Label>
                  <textarea
                    rows={4}
                    className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={form.description}
                    onChange={(event) =>
                      setForm((value) => ({
                        ...value,
                        description: event.currentTarget.value,
                      }))
                    }
                  />
                </div>
                <Field
                  label="Site name or domain"
                  value={form.site_name}
                  onChange={(site_name) =>
                    setForm((value) => ({ ...value, site_name }))
                  }
                />
                <Field
                  label="Image URL"
                  type="url"
                  value={form.image_url}
                  onChange={(image_url) => {
                    setImageFailed(false);
                    setForm((value) => ({ ...value, image_url }));
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Recommended ratio 1.91:1, at least 1200 × 630 pixels. The URL
                  must be publicly accessible over HTTPS.
                </p>
                <Button
                  className="w-full"
                  disabled={!dirty || saving || !form.title.trim()}
                  onClick={() => void save()}
                >
                  <Save className="size-4" /> Save preview
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle>Live preview</CardTitle>
                  <CardDescription>
                    Platform rendering is approximate and updates as you type.
                  </CardDescription>
                </div>
                <Tabs value={platform} onValueChange={setPlatform}>
                  <TabsList>
                    <TabsTrigger value="facebook">Facebook</TabsTrigger>
                    <TabsTrigger value="x">X</TabsTrigger>
                    <TabsTrigger value="linkedin">LinkedIn</TabsTrigger>
                  </TabsList>
                </Tabs>
              </CardHeader>
              <CardContent className="flex min-h-[500px] items-center justify-center bg-muted/20 p-6">
                <div
                  className={cn(
                    "w-full max-w-2xl overflow-hidden border bg-background shadow-sm",
                    platform === "x" ? "rounded-2xl" : "rounded-lg",
                  )}
                >
                  <div className="relative aspect-[1.91/1] w-full bg-muted">
                    {form.image_url && !imageFailed ? (
                      <Image
                        unoptimized
                        fill
                        sizes="(max-width: 768px) 100vw, 640px"
                        src={form.image_url}
                        alt="Social preview"
                        className="object-cover"
                        onError={() => setImageFailed(true)}
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <ImageIcon className="size-12 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <div
                    className={cn(
                      "space-y-1 p-4",
                      platform === "facebook" && "bg-muted/40",
                    )}
                  >
                    {platform !== "x" ? (
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        {domain}
                      </p>
                    ) : null}
                    <h3 className="font-semibold leading-snug">
                      {form.title || "Your link preview title"}
                    </h3>
                    {platform !== "linkedin" ? (
                      <p className="text-sm text-muted-foreground">
                        {form.description ||
                          "Add a concise description that explains where the shared link leads."}
                      </p>
                    ) : null}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </ModulePage>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        type={type}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </div>
  );
}
