"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  CircleCheck,
  Globe2,
  Laptop,
  Pencil,
  Plus,
  Smartphone,
  Trash2,
} from "lucide-react";
import {
  createRedirectRule,
  deleteRedirectRule,
  getRedirectRules,
  updateRedirectRule,
  type RedirectRule,
} from "@/api/dynamic-links/dynamicLinksService";
import { EmptyProject, ModulePage, moduleErrorMessage } from "@/components/modules/ModulePage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { useProjectSelection } from "@/context/useProjectSelection";
import { showErrorNotification, showSuccessNotification } from "@/lib/Notifications";

const platforms = [
  { value: "ios", label: "iOS", icon: Smartphone },
  { value: "android", label: "Android", icon: Smartphone },
  { value: "web", label: "Web", icon: Globe2 },
  { value: "desktop", label: "Desktop", icon: Laptop },
] as const;

type RuleForm = {
  id?: string;
  name: string;
  platform: string;
  destination: string;
  priority: number;
  active: boolean;
};

const emptyForm: RuleForm = {
  name: "",
  platform: "ios",
  destination: "",
  priority: 100,
  active: true,
};

function formFromRule(rule: RedirectRule): RuleForm {
  return {
    id: rule.id,
    name: rule.name,
    platform:
      typeof rule.rule.platform === "string" ? rule.rule.platform : "web",
    destination:
      typeof rule.rule.destination_url === "string"
        ? rule.rule.destination_url
        : "",
    priority: rule.priority,
    active: rule.active,
  };
}

export default function RedirectRulesPageContent() {
  const { selectedProject } = useProjectSelection();
  const [rules, setRules] = useState<RedirectRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<RuleForm>(emptyForm);

  const load = useCallback(async () => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      setRules(await getRedirectRules(selectedProject.id));
      setError(null);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [selectedProject]);

  useEffect(() => { void load(); }, [load]);

  const grouped = useMemo(
    () =>
      Object.fromEntries(
        platforms.map(({ value }) => [
          value,
          rules
            .filter((rule) => rule.rule.platform === value)
            .sort((left, right) => left.priority - right.priority),
        ]),
      ) as Record<string, RedirectRule[]>,
    [rules],
  );

  const openCreate = (platform = "ios") => {
    setForm({ ...emptyForm, platform });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!selectedProject || !form.name.trim() || !form.destination.trim()) return;
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      priority: form.priority,
      active: form.active,
      rule: {
        platform: form.platform,
        destination_url: form.destination.trim(),
      },
    };
    try {
      if (form.id) {
        await updateRedirectRule(selectedProject.id, form.id, payload);
        showSuccessNotification("Redirect rule updated");
      } else {
        await createRedirectRule(selectedProject.id, payload);
        showSuccessNotification("Redirect rule created");
      }
      setDialogOpen(false);
      await load();
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selectedProject || !form.id) return;
    setSaving(true);
    try {
      await deleteRedirectRule(selectedProject.id, form.id);
      setDialogOpen(false);
      showSuccessNotification("Redirect rule deleted");
      await load();
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModulePage
      title="Redirect Rules"
      description="Resolve the first matching platform rule by priority, then fall back to the link destination."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="grid gap-6 2xl:grid-cols-[1fr_340px]">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Platform routing</h2>
                <p className="text-sm text-muted-foreground">
                  Lower priority numbers are evaluated first.
                </p>
              </div>
              <Button disabled={loading} onClick={() => openCreate()}>
                <Plus className="size-4" /> Add rule
              </Button>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              {platforms.map(({ value, label, icon: Icon }) => (
                <Card key={value}>
                  <CardHeader className="flex-row items-start gap-3">
                    <div className="rounded-lg bg-muted p-2"><Icon className="size-5" /></div>
                    <div className="flex-1"><CardTitle>{label}</CardTitle><CardDescription>{grouped[value]?.length ?? 0} configured rules</CardDescription></div>
                    <Button variant="outline" size="sm" onClick={() => openCreate(value)}><Plus className="size-4"/>Add</Button>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {grouped[value]?.length ? grouped[value].map((rule) => (
                      <button key={rule.id} type="button" className="flex w-full items-center gap-3 rounded-lg border p-3 text-left hover:bg-muted/50" onClick={() => { setForm(formFromRule(rule)); setDialogOpen(true); }}>
                        <span className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold">{rule.priority}</span>
                        <span className="min-w-0 flex-1"><span className="block truncate font-medium">{rule.name}</span><span className="block truncate text-xs text-muted-foreground">{String(rule.rule.destination_url || "No destination")}</span></span>
                        <Badge variant={rule.active ? "default" : "secondary"}>{rule.active ? "Active" : "Paused"}</Badge>
                        <Pencil className="size-4 text-muted-foreground" />
                      </button>
                    )) : <div className="rounded-lg border border-dashed p-8 text-center"><p className="text-sm text-muted-foreground">No {label} redirect configured.</p><Button variant="link" onClick={() => openCreate(value)}>Create the first rule</Button></div>}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <Card className="h-fit 2xl:sticky 2xl:top-6">
            <CardHeader><CardTitle>Resolution flow</CardTitle><CardDescription>Preview of the runtime decision order.</CardDescription></CardHeader>
            <CardContent className="space-y-2">
              <FlowStep icon={Globe2} label="Customer opens a dynamic link" />
              <ArrowDown className="mx-auto size-4 text-muted-foreground" />
              <FlowStep icon={Smartphone} label="Detect platform and device" />
              <ArrowDown className="mx-auto size-4 text-muted-foreground" />
              <FlowStep icon={CircleCheck} label="Select first active matching rule" />
              <ArrowDown className="mx-auto size-4 text-muted-foreground" />
              <FlowStep icon={Globe2} label="Use the link fallback destination" />
              <p className="pt-3 text-xs text-muted-foreground">{rules.filter((rule) => rule.active).length} active rules are currently evaluated.</p>
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{form.id ? "Edit redirect rule" : "Add redirect rule"}</DialogTitle><DialogDescription>Choose a platform destination and its evaluation priority.</DialogDescription></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Rule name" value={form.name} onChange={(name) => setForm((value) => ({ ...value, name }))} />
            <label className="space-y-2"><Label>Platform</Label><Select value={form.platform} onValueChange={(platform) => setForm((value) => ({ ...value, platform }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{platforms.map((platform) => <SelectItem key={platform.value} value={platform.value}>{platform.label}</SelectItem>)}</SelectContent></Select></label>
            <div className="sm:col-span-2"><Field label="Destination URL" type="url" value={form.destination} onChange={(destination) => setForm((value) => ({ ...value, destination }))} /></div>
            <Field label="Priority" type="number" value={String(form.priority)} onChange={(priority) => setForm((value) => ({ ...value, priority: Math.max(0, Number(priority) || 0) }))} />
            <label className="flex items-center gap-3 self-end pb-2 text-sm"><Switch checked={form.active} onCheckedChange={(active) => setForm((value) => ({ ...value, active }))} />Active rule</label>
          </div>
          <DialogFooter className="sm:justify-between">{form.id ? <Button variant="destructive" disabled={saving} onClick={() => void remove()}><Trash2 className="size-4"/>Delete</Button> : <span/>}<div className="flex gap-2"><Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button><Button disabled={saving || !form.name.trim() || !form.destination.trim()} onClick={() => void save()}>{saving ? "Saving…" : "Save rule"}</Button></div></DialogFooter>
        </DialogContent>
      </Dialog>
    </ModulePage>
  );
}

function FlowStep({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) { return <div className="flex items-center gap-3 rounded-lg border p-3"><Icon className="size-4 text-muted-foreground"/><span className="text-sm">{label}</span></div>; }
function Field({label,value,onChange,type="text"}:{label:string;value:string;onChange:(value:string)=>void;type?:string}) { return <div className="space-y-2"><Label>{label}</Label><Input type={type} value={value} onChange={(event) => onChange(event.currentTarget.value)} /></div>; }
