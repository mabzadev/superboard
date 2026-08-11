"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Save, ShieldCheck } from "lucide-react";
import {
  getLinkStatistics,
  getTracking,
  saveTracking,
  type LinkStatistics,
  type TrackingSettings,
} from "@/api/dynamic-links/dynamicLinksService";
import AdsPlatformSelect from "@/components/common/ads-platform";
import { DateRangePicker } from "@/components/dateRangePicker/DateRangePicker";
import { EmptyProject, ModulePage, moduleErrorMessage } from "@/components/modules/ModulePage";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { platformsFilterList } from "@/constants/FilterOptions";
import { useProjectSelection } from "@/context/useProjectSelection";
import { useTableParams } from "@/hooks/useTableParams";
import { showErrorNotification, showSuccessNotification } from "@/lib/Notifications";
import { formatCurrencyFromCents } from "@/utils/formatCurrency";

const metricKeys = [
  ["views", "Views"],
  ["opens", "Opens"],
  ["installs", "Installs"],
  ["reinstalls", "Reinstalls"],
  ["reactivations", "Reactivations"],
  ["app_opens", "App opens"],
  ["user_referred", "Users referred"],
] as const;

type DailyRow = {
  date: string;
  views: number;
  opens: number;
  installs: number;
  appOpens: number;
  conversions: number;
  revenue: number;
};

function dailySeries(statistics: LinkStatistics): DailyRow[] {
  const dates = new Map<string, DailyRow>();
  for (const point of statistics.series) {
    const date = typeof point.date === "string" ? point.date : "Unknown";
    const row = dates.get(date) ?? {
      date,
      views: 0,
      opens: 0,
      installs: 0,
      appOpens: 0,
      conversions: 0,
      revenue: 0,
    };
    const count = typeof point.count === "number" ? point.count : Number(point.count) || 0;
    const type = typeof point.event_type === "string" ? point.event_type : "";
    if (["view", "click", "redirect"].includes(type)) row.views += count;
    if (type === "open") row.opens += count;
    if (type === "install") row.installs += count;
    if (type === "app_open") row.appOpens += count;
    if (["user_referred", "conversion"].includes(type)) row.conversions += count;
    row.revenue += typeof point.revenue_cents === "number" ? point.revenue_cents : Number(point.revenue_cents) || 0;
    dates.set(date, row);
  }
  return [...dates.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export default function TrackingPageContent() {
  const { selectedProject } = useProjectSelection();
  const { dateRange, setDateRange, platform, setPlatform } = useTableParams();
  const [settings, setSettings] = useState<TrackingSettings>({
    enabled: true,
    provider: "opengrow",
    configuration: {},
  });
  const [statistics, setStatistics] = useState<LinkStatistics>({ totals: {}, series: [] });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      const [nextSettings, nextStatistics] = await Promise.all([
        getTracking(selectedProject.id),
        getLinkStatistics(selectedProject.id, {
          from: dateRange?.from?.toISOString().slice(0, 10),
          to: dateRange?.to?.toISOString().slice(0, 10),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          interval: "day",
          platform: platform || undefined,
        }),
      ]);
      setSettings(nextSettings);
      setStatistics(nextStatistics);
      setError(null);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [dateRange?.from, dateRange?.to, platform, selectedProject]);

  useEffect(() => { void load(); }, [load]);
  const series = useMemo(() => dailySeries(statistics), [statistics]);

  const save = async () => {
    if (!selectedProject) return;
    setSaving(true);
    try {
      await saveTracking(selectedProject.id, settings);
      showSuccessNotification("Tracking preferences saved");
      await load();
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModulePage title="Tracking" description="Inspect attributed link events and control consent-aware collection by project." error={error}>
      {!selectedProject ? <EmptyProject /> : <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap gap-2"><DateRangePicker date={dateRange} setDate={setDateRange}/><AdsPlatformSelect platformAdsOptions={platformsFilterList} selectedAdsPlatform={platform} setSelectedAdsPlatforms={setPlatform} title="Platforms" selectListTitle="Platforms"/></div><Button variant="outline" disabled={loading} onClick={() => void load()}><BarChart3 className="size-4"/>{loading ? "Refreshing…" : "Refresh analytics"}</Button></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metricKeys.map(([key,label])=><Card key={key}><CardHeader className="pb-2"><CardDescription>{label}</CardDescription><CardTitle className="text-3xl">{(statistics.totals[key] ?? 0).toLocaleString()}</CardTitle></CardHeader></Card>)}<Card><CardHeader className="pb-2"><CardDescription>Revenue</CardDescription><CardTitle className="text-3xl">{formatCurrencyFromCents(statistics.totals.revenue ?? 0)}</CardTitle></CardHeader></Card></div>
        <div className="grid gap-6 2xl:grid-cols-[1fr_420px]">
          <Card><CardHeader><CardTitle>Daily performance</CardTitle><CardDescription>Attributed events grouped by day for the selected period.</CardDescription></CardHeader><CardContent><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Views</TableHead><TableHead>Opens</TableHead><TableHead>Installs</TableHead><TableHead>App opens</TableHead><TableHead>Conversions</TableHead><TableHead>Revenue</TableHead></TableRow></TableHeader><TableBody>{series.length ? series.map((row)=><TableRow key={row.date}><TableCell>{row.date}</TableCell><TableCell>{row.views.toLocaleString()}</TableCell><TableCell>{row.opens.toLocaleString()}</TableCell><TableCell>{row.installs.toLocaleString()}</TableCell><TableCell>{row.appOpens.toLocaleString()}</TableCell><TableCell>{row.conversions.toLocaleString()}</TableCell><TableCell>{formatCurrencyFromCents(row.revenue)}</TableCell></TableRow>):<TableRow><TableCell colSpan={7} className="h-32 text-center text-muted-foreground">No tracked events for this period.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
          <Card className="h-fit"><CardHeader><CardTitle>Tracking settings</CardTitle><CardDescription>Disable tracking globally or forward events to an approved analytics provider.</CardDescription></CardHeader><CardContent className="space-y-5"><label className="flex items-center justify-between gap-4 rounded-lg border p-4"><span><span className="block font-medium">Collect link analytics</span><span className="block text-xs text-muted-foreground">Consent rules are still enforced by the SDK.</span></span><Switch checked={settings.enabled} onCheckedChange={(enabled)=>setSettings((value)=>({...value,enabled}))}/></label><label className="space-y-2"><Label>Provider</Label><Select value={settings.provider} onValueChange={(provider)=>setSettings((value)=>({...value,provider}))}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="opengrow">SuperBoard</SelectItem><SelectItem value="google">Google Analytics</SelectItem><SelectItem value="segment">Segment</SelectItem><SelectItem value="none">No external provider</SelectItem></SelectContent></Select></label>{settings.provider!=="opengrow"&&settings.provider!=="none"?<div className="space-y-2"><Label>{settings.provider==="google"?"Measurement ID":"Write key reference"}</Label><Input type="password" value={typeof settings.configuration.credential==="string"?settings.configuration.credential:""} onChange={(event)=>setSettings((value)=>({...value,configuration:{...value.configuration,credential:event.currentTarget.value}}))}/></div>:null}<Alert><ShieldCheck className="size-4"/><AlertTitle>Consent-aware</AlertTitle><AlertDescription>Tracking may be disabled per project. Collection changes are audited by the Dynamic Links Worker.</AlertDescription></Alert><Button className="w-full" disabled={saving} onClick={()=>void save()}><Save className="size-4"/>{saving?"Saving…":"Save tracking settings"}</Button></CardContent></Card>
        </div>
      </div>}
    </ModulePage>
  );
}
