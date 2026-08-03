"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, ChartNoAxesCombined, Plus, RefreshCw, ShieldCheck, Target, Trash2 } from "lucide-react";
import AppHeader from "@/components/layout/app-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProjectSelection } from "@/context/useProjectSelection";
import { showErrorNotification, showSuccessNotification } from "@/lib/Notifications";
import {
  createGrowthApp,
  createGrowthAutomation,
  createGrowthCompetitor,
  createGrowthKeyword,
  deleteGrowthApp,
  deleteGrowthAutomation,
  deleteGrowthCompetitor,
  deleteGrowthKeyword,
  getGrowthApps,
  getGrowthAutomations,
  getGrowthCompetitors,
  getGrowthContracts,
  getGrowthKeywords,
  getGrowthOverview,
  getGrowthRecommendations,
  queueGrowthSync,
  updateGrowthApp,
  updateGrowthAutomation,
  updateGrowthCompetitor,
  updateGrowthKeyword,
  updateGrowthRecommendation,
  type GrowthAutomation,
  type GrowthContracts,
  type GrowthKeyword,
  type GrowthRecommendation,
  type GrowthStoreEntity,
} from "@/api/growth/growthService";

type Overview = {
  counts?: Record<string, number>;
  automation_runs?: Array<Record<string, unknown>>;
};

const emptyStoreForm = { platform: "", app_identifier: "", display_name: "", country: "", language: "", is_primary: false };
const emptyAutomationForm = { name: "", trigger_type: "", action_type: "", title: "", body: "" };

export default function GrowthPage() {
  const { selectedProject } = useProjectSelection();
  const projectId = selectedProject?.id;
  const [contracts, setContracts] = useState<GrowthContracts>();
  const [overview, setOverview] = useState<Overview>({});
  const [apps, setApps] = useState<GrowthStoreEntity[]>([]);
  const [keywords, setKeywords] = useState<GrowthKeyword[]>([]);
  const [competitors, setCompetitors] = useState<GrowthStoreEntity[]>([]);
  const [recommendations, setRecommendations] = useState<GrowthRecommendation[]>([]);
  const [automations, setAutomations] = useState<GrowthAutomation[]>([]);
  const [appForm, setAppForm] = useState(emptyStoreForm);
  const [competitorForm, setCompetitorForm] = useState(emptyStoreForm);
  const [keywordForm, setKeywordForm] = useState({ app_id: "", keyword: "", country: "", language: "" });
  const [automationForm, setAutomationForm] = useState(emptyAutomationForm);
  const [loading, setLoading] = useState(false);
  const advancedSource = contracts?.sources.find((source) => source.capabilities.includes("keyword_rank"));

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [nextContracts, nextOverview, nextApps, nextKeywords, nextCompetitors, nextRecommendations, nextAutomations] = await Promise.all([
        getGrowthContracts(projectId), getGrowthOverview(projectId), getGrowthApps(projectId), getGrowthKeywords(projectId),
        getGrowthCompetitors(projectId), getGrowthRecommendations(projectId), getGrowthAutomations(projectId),
      ]);
      setContracts(nextContracts); setOverview(nextOverview); setApps(nextApps); setKeywords(nextKeywords);
      setCompetitors(nextCompetitors); setRecommendations(nextRecommendations); setAutomations(nextAutomations);
      setAppForm((current) => current.platform ? current : { ...current, platform: nextContracts.platforms[0]?.id || "" });
      setCompetitorForm((current) => current.platform ? current : { ...current, platform: nextContracts.platforms[0]?.id || "" });
      setAutomationForm((current) => ({
        ...current,
        trigger_type: current.trigger_type || nextContracts.automation_triggers[0] || "",
        action_type: current.action_type || nextContracts.automation_actions[0] || "",
      }));
      setKeywordForm((current) => current.app_id ? current : { ...current, app_id: nextApps[0]?.id || "" });
    } catch (error) {
      showErrorNotification(message(error, "Unable to load growth intelligence"));
    } finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const submitApp = async () => {
    if (!projectId || !appForm.platform || !appForm.app_identifier.trim()) return;
    try {
      await createGrowthApp(projectId, storePayload(appForm, contracts));
      setAppForm({ ...emptyStoreForm, platform: contracts?.platforms[0]?.id || "" });
      showSuccessNotification("Store app added"); await load();
    } catch (error) { showErrorNotification(message(error, "Unable to add the store app")); }
  };

  const submitKeyword = async () => {
    if (!projectId || !keywordForm.app_id || !keywordForm.keyword.trim()) return;
    try {
      await createGrowthKeyword(projectId, compact(keywordForm));
      setKeywordForm((current) => ({ ...current, keyword: "" }));
      showSuccessNotification("Keyword added"); await load();
    } catch (error) { showErrorNotification(message(error, "Unable to add the keyword")); }
  };

  const submitCompetitor = async () => {
    if (!projectId || !competitorForm.platform || !competitorForm.app_identifier.trim()) return;
    try {
      await createGrowthCompetitor(projectId, storePayload(competitorForm, contracts));
      setCompetitorForm({ ...emptyStoreForm, platform: contracts?.platforms[0]?.id || "" });
      showSuccessNotification("Competitor added"); await load();
    } catch (error) { showErrorNotification(message(error, "Unable to add the competitor")); }
  };

  const submitAutomation = async () => {
    if (!projectId || !automationForm.name.trim() || !automationForm.trigger_type || !automationForm.action_type || !automationForm.body.trim()) return;
    try {
      await createGrowthAutomation(projectId, {
        name: automationForm.name.trim(), trigger_type: automationForm.trigger_type,
        action_type: automationForm.action_type, enabled: false, trigger_config: {},
        action_config: compact({ title: automationForm.title, body: automationForm.body }),
      });
      setAutomationForm((current) => ({ ...emptyAutomationForm, trigger_type: current.trigger_type, action_type: current.action_type }));
      showSuccessNotification("Automation saved in disabled mode"); await load();
    } catch (error) { showErrorNotification(message(error, "Unable to create the automation")); }
  };

  const synchronize = async () => {
    if (!projectId) return;
    try { await queueGrowthSync(projectId); showSuccessNotification("Growth synchronization queued"); }
    catch (error) { showErrorNotification(message(error, "Unable to queue synchronization")); }
  };

  const toggle = async (kind: "app" | "keyword" | "competitor" | "automation", id: string, enabled: boolean) => {
    if (!projectId) return;
    try {
      if (kind === "app") await updateGrowthApp(projectId, id, { enabled });
      else if (kind === "keyword") await updateGrowthKeyword(projectId, id, { enabled });
      else if (kind === "competitor") await updateGrowthCompetitor(projectId, id, { enabled });
      else await updateGrowthAutomation(projectId, id, { enabled });
      await load();
    } catch (error) { showErrorNotification(message(error, "Unable to update the item")); }
  };

  const remove = async (kind: "app" | "keyword" | "competitor" | "automation", id: string) => {
    if (!projectId) return;
    try {
      if (kind === "app") await deleteGrowthApp(projectId, id);
      else if (kind === "keyword") await deleteGrowthKeyword(projectId, id);
      else if (kind === "competitor") await deleteGrowthCompetitor(projectId, id);
      else await deleteGrowthAutomation(projectId, id);
      showSuccessNotification("Item removed"); await load();
    } catch (error) { showErrorNotification(message(error, "Unable to remove the item")); }
  };

  const countCards = useMemo(() => [
    ["Tracked keywords", overview.counts?.keywords || 0],
    ["Competitors", overview.counts?.competitors || 0],
    ["Open recommendations", overview.counts?.recommendations || 0],
    ["Active automations", overview.counts?.active_automations || 0],
  ] as const, [overview]);

  return <div className="flex h-dvh flex-col overflow-hidden">
    <AppHeader titleOverride="Growth" />
    <main className="flex-1 space-y-5 overflow-auto p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Growth intelligence</h1><p className="text-sm text-muted-foreground">ASO, keyword tracking, competitor monitoring, recommendations, and lifecycle automations.</p></div>
        <div className="flex gap-2"><Button onClick={() => void synchronize()}><RefreshCw className="mr-2 h-4 w-4" />Synchronize</Button><Button variant="outline" disabled={loading} onClick={() => void load()}>Refresh</Button></div>
      </div>

      <Alert><ShieldCheck /><AlertTitle>Billing isolation is enforced</AlertTitle><AlertDescription>Growth automations can send chat, push, or in-app messages. They cannot grant, revoke, or edit entitlements.</AlertDescription></Alert>
      {advancedSource && !advancedSource.configured && <Alert><Target /><AlertTitle>Advanced store intelligence is not configured</AlertTitle><AlertDescription>Apple public metadata remains available. Configure the optional provider to collect Google Play metadata, keyword ranks, volume, and difficulty.</AlertDescription></Alert>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{countCards.map(([label, value]) => <Card key={label}><CardContent className="p-4"><div className="text-2xl font-semibold">{value}</div><div className="text-sm text-muted-foreground">{label}</div></CardContent></Card>)}</div>

      <Tabs defaultValue="aso">
        <TabsList className="flex-wrap"><TabsTrigger value="aso">ASO & Keywords</TabsTrigger><TabsTrigger value="competitors">Competitors</TabsTrigger><TabsTrigger value="recommendations">Recommendations</TabsTrigger><TabsTrigger value="automations">Automations</TabsTrigger></TabsList>
        <TabsContent value="aso" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-2">
            <Card><CardHeader><CardTitle>Store apps</CardTitle><CardDescription>Configure the owned listing that keywords belong to.</CardDescription></CardHeader><CardContent className="space-y-3"><StoreEntityForm form={appForm} setForm={setAppForm} contracts={contracts} includePrimary /><Button onClick={() => void submitApp()}><Plus className="mr-2 h-4 w-4" />Add app</Button><EntityList entities={apps} kind="app" onToggle={toggle} onRemove={remove} /></CardContent></Card>
            <Card><CardHeader><CardTitle>Track a keyword</CardTitle><CardDescription>Ranks and advanced metrics are collected only when the configured source supports them.</CardDescription></CardHeader><CardContent className="space-y-3"><label className="grid gap-1 text-sm">App<select className="h-9 rounded-md border bg-background px-3" value={keywordForm.app_id} onChange={(event) => setKeywordForm({ ...keywordForm, app_id: event.target.value })}><option value="">Select an app</option>{apps.map((item) => <option key={item.id} value={item.id}>{item.display_name || item.app_identifier}</option>)}</select></label><Input placeholder="Keyword" value={keywordForm.keyword} onChange={(event) => setKeywordForm({ ...keywordForm, keyword: event.target.value })} /><div className="grid grid-cols-2 gap-2"><Input placeholder="Country (provider default)" value={keywordForm.country} onChange={(event) => setKeywordForm({ ...keywordForm, country: event.target.value })} /><Input placeholder="Language (app default)" value={keywordForm.language} onChange={(event) => setKeywordForm({ ...keywordForm, language: event.target.value })} /></div><Button onClick={() => void submitKeyword()}><Plus className="mr-2 h-4 w-4" />Add keyword</Button></CardContent></Card>
          </div>
          <Card><CardHeader><CardTitle>Keyword performance</CardTitle></CardHeader><CardContent><KeywordTable keywords={keywords} onToggle={toggle} onRemove={remove} /></CardContent></Card>
        </TabsContent>

        <TabsContent value="competitors" className="space-y-4">
          <Card><CardHeader><CardTitle>Add a competitor</CardTitle><CardDescription>Track listing metadata and rating changes without mixing this data with purchase records.</CardDescription></CardHeader><CardContent className="space-y-3"><StoreEntityForm form={competitorForm} setForm={setCompetitorForm} contracts={contracts} /><Button onClick={() => void submitCompetitor()}><Plus className="mr-2 h-4 w-4" />Add competitor</Button></CardContent></Card>
          <Card><CardHeader><CardTitle>Tracked competitors</CardTitle></CardHeader><CardContent><EntityList entities={competitors} kind="competitor" onToggle={toggle} onRemove={remove} /></CardContent></Card>
        </TabsContent>

        <TabsContent value="recommendations">
          <Card><CardHeader><CardTitle>Prioritized recommendations</CardTitle><CardDescription>Recommendations are generated from the latest store and keyword snapshots.</CardDescription></CardHeader><CardContent className="space-y-3">{recommendations.map((item) => <div key={item.id} className="flex flex-wrap items-start justify-between gap-3 rounded-md border p-4"><div className="max-w-3xl"><div className="flex items-center gap-2"><Badge variant={item.priority === "high" ? "destructive" : "outline"}>{item.priority}</Badge><span className="font-medium">{item.title}</span></div><p className="mt-2 text-sm text-muted-foreground">{item.summary}</p></div>{item.status === "open" && <div className="flex gap-2"><Button size="sm" onClick={() => { if (projectId) void updateGrowthRecommendation(projectId, item.id, "completed").then(load); }}>Complete</Button><Button size="sm" variant="outline" onClick={() => { if (projectId) void updateGrowthRecommendation(projectId, item.id, "dismissed").then(load); }}>Dismiss</Button></div>}</div>)}{!recommendations.length && <Empty text="No recommendations are available yet. Synchronize after configuring at least one store app." />}</CardContent></Card>
        </TabsContent>

        <TabsContent value="automations" className="space-y-4">
          <Card><CardHeader><CardTitle>Create an automation</CardTitle><CardDescription>New automations are saved disabled so the message can be reviewed before activation.</CardDescription></CardHeader><CardContent className="grid gap-3 xl:grid-cols-2"><div className="space-y-3"><Input placeholder="Automation name" value={automationForm.name} onChange={(event) => setAutomationForm({ ...automationForm, name: event.target.value })} /><label className="grid gap-1 text-sm">Trigger<select className="h-9 rounded-md border bg-background px-3" value={automationForm.trigger_type} onChange={(event) => setAutomationForm({ ...automationForm, trigger_type: event.target.value })}>{contracts?.automation_triggers.map((item) => <option key={item} value={item}>{humanize(item)}</option>)}</select></label><label className="grid gap-1 text-sm">Channel<select className="h-9 rounded-md border bg-background px-3" value={automationForm.action_type} onChange={(event) => setAutomationForm({ ...automationForm, action_type: event.target.value })}>{contracts?.automation_actions.map((item) => <option key={item} value={item}>{humanize(item)}</option>)}</select></label></div><div className="space-y-3"><Input placeholder="Message title (optional)" value={automationForm.title} onChange={(event) => setAutomationForm({ ...automationForm, title: event.target.value })} /><textarea className="min-h-28 w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="Message body" value={automationForm.body} onChange={(event) => setAutomationForm({ ...automationForm, body: event.target.value })} /><Button onClick={() => void submitAutomation()}><Bot className="mr-2 h-4 w-4" />Save automation</Button></div></CardContent></Card>
          <Card><CardHeader><CardTitle>Lifecycle automations</CardTitle></CardHeader><CardContent className="space-y-3">{automations.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-4"><div><div className="flex items-center gap-2"><span className="font-medium">{item.name}</span><Badge variant="outline">{humanize(item.trigger_type)}</Badge><Badge variant="secondary">{humanize(item.action_type)}</Badge></div><div className="mt-1 text-xs text-muted-foreground">{item.run_count || 0} runs · {item.failed_count || 0} failed</div></div><div className="flex items-center gap-3"><Switch checked={item.enabled} onCheckedChange={(checked) => void toggle("automation", item.id, checked)} /><Button size="sm" variant="outline" onClick={() => void remove("automation", item.id)}><Trash2 className="h-4 w-4" /></Button></div></div>)}{!automations.length && <Empty text="No lifecycle automation has been created." />}</CardContent></Card>
        </TabsContent>
      </Tabs>
    </main>
  </div>;
}

function StoreEntityForm({ form, setForm, contracts, includePrimary = false }: {
  form: typeof emptyStoreForm;
  setForm: (next: typeof emptyStoreForm) => void;
  contracts?: GrowthContracts;
  includePrimary?: boolean;
}) {
  return <div className="space-y-3"><div className="grid gap-2 md:grid-cols-2"><label className="grid gap-1 text-sm">Platform<select className="h-9 rounded-md border bg-background px-3" value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value })}>{contracts?.platforms.map((item) => <option key={item.id} value={item.id}>{item.id === "apple" ? "Apple App Store" : "Google Play"}</option>)}</select></label><Input placeholder="Store app identifier" value={form.app_identifier} onChange={(event) => setForm({ ...form, app_identifier: event.target.value })} /></div><Input placeholder="Display name (optional)" value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} /><div className="grid grid-cols-2 gap-2"><Input placeholder="Country (provider default)" value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value })} /><Input placeholder="Language (provider default)" value={form.language} onChange={(event) => setForm({ ...form, language: event.target.value })} /></div>{includePrimary && <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.is_primary} onCheckedChange={(checked) => setForm({ ...form, is_primary: checked === true })} />Primary listing</label>}</div>;
}

function EntityList({ entities, kind, onToggle, onRemove }: { entities: GrowthStoreEntity[]; kind: "app" | "competitor"; onToggle: (kind: "app" | "keyword" | "competitor" | "automation", id: string, enabled: boolean) => Promise<void>; onRemove: (kind: "app" | "keyword" | "competitor" | "automation", id: string) => Promise<void> }) {
  return <div className="space-y-2">{entities.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border p-3"><div><div className="flex items-center gap-2"><span className="font-medium">{item.display_name || item.app_identifier}</span><Badge variant="outline">{item.platform}</Badge>{item.is_primary === 1 && <Badge>primary</Badge>}</div><div className="text-xs text-muted-foreground">{item.app_identifier} · {item.country}/{item.language} · {item.device}</div></div><div className="flex items-center gap-3"><Switch checked={item.enabled === 1} onCheckedChange={(checked) => void onToggle(kind, item.id, checked)} /><Button size="sm" variant="outline" onClick={() => void onRemove(kind, item.id)}><Trash2 className="h-4 w-4" /></Button></div></div>)}{!entities.length && <Empty text={kind === "app" ? "No store app is configured." : "No competitor is tracked."} />}</div>;
}

function KeywordTable({ keywords, onToggle, onRemove }: { keywords: GrowthKeyword[]; onToggle: (kind: "app" | "keyword" | "competitor" | "automation", id: string, enabled: boolean) => Promise<void>; onRemove: (kind: "app" | "keyword" | "competitor" | "automation", id: string) => Promise<void> }) {
  return <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="p-2">Keyword</th><th className="p-2">App</th><th className="p-2">Rank</th><th className="p-2">Volume</th><th className="p-2">Difficulty</th><th className="p-2">Observed</th><th className="p-2 text-right">Status</th></tr></thead><tbody>{keywords.map((item) => <tr key={item.id} className="border-b"><td className="p-2 font-medium">{item.keyword}</td><td className="p-2">{item.app_name || item.app_identifier}</td><td className="p-2">{metric(item.rank)}</td><td className="p-2">{metric(item.volume)}</td><td className="p-2">{metric(item.difficulty)}</td><td className="p-2">{item.observed_date || "—"}</td><td className="p-2"><div className="flex justify-end gap-3"><Switch checked={item.enabled === 1} onCheckedChange={(checked) => void onToggle("keyword", item.id, checked)} /><Button size="sm" variant="outline" onClick={() => void onRemove("keyword", item.id)}><Trash2 className="h-4 w-4" /></Button></div></td></tr>)}</tbody></table>{!keywords.length && <Empty text="No keyword is tracked." />}</div>;
}

function Empty({ text }: { text: string }) { return <div className="py-8 text-center text-sm text-muted-foreground"><ChartNoAxesCombined className="mx-auto mb-2 h-5 w-5" />{text}</div>; }
function humanize(value: string) { return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase()); }
function metric(value: unknown) { return value == null || value === "" ? "—" : String(value); }
function message(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }
function compact<T extends Record<string, unknown>>(value: T) { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== "" && item !== undefined)); }
function storePayload(form: typeof emptyStoreForm, contracts?: GrowthContracts) {
  const provider = contracts?.platforms.find((item) => item.id === form.platform);
  return compact({ ...form, device: provider?.devices[0] });
}
