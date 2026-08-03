"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  BarChart3,
  CloudDownload,
  Coins,
  CreditCard,
  FlaskConical,
  PanelTop,
  PlugZap,
  RefreshCw,
  ShieldAlert,
  Store,
  Users,
  Webhook,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import AppHeader from "@/components/layout/app-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProjectSelection } from "@/context/useProjectSelection";
import {
  archiveBillingEntitlement,
  archiveBillingOffering,
  archiveBillingProduct,
  approveBillingRefundAction,
  createBillingExperiment,
  createBillingExport,
  createBillingRefundEvidence,
  createBillingRefundAction,
  createBillingConnection,
  createBillingPackage,
  createBillingPaywall,
  createBillingPlacement,
  createBillingProviderProduct,
  createBillingTargetingRule,
  createBillingVirtualCurrency,
  createEntitlement,
  createOffering,
  createProduct,
  getBillingAnalytics,
  getBillingConnections,
  getBillingCustomer,
  getBillingExperiments,
  getBillingExports,
  getBillingHealth,
  getBillingOverview,
  getBillingPaywalls,
  getBillingPlacements,
  getBillingRefundCase,
  getBillingRefundCases,
  getBillingSubscriptions,
  getBillingTargeting,
  getBillingTransactions,
  getBillingVirtualCurrencies,
  getBillingWebhookDeliveries,
  grantBillingEntitlement,
  publishBillingPaywall,
  replayBillingWebhookDelivery,
  reviewBillingRefundEvidence,
  searchBillingCustomers,
  setBillingCustomerBlocked,
  syncBillingProducts,
  testBillingConnection,
  updateBillingExperiment,
  updateBillingRefundAction,
  updateBillingTargetingRule,
  type BillingAnalytics,
  type BillingConnection,
  type BillingExperiment,
  type BillingHealth,
  type BillingOverview,
  type BillingPaywall,
  type BillingPlacement,
  type BillingRefundCase,
  type BillingRefundCaseDetail,
  type BillingSubscription,
  type BillingTargetingRule,
  type BillingTransaction,
} from "@/api/billing/billingService";
import { showErrorNotification, showSuccessNotification } from "@/lib/Notifications";

type CustomerRow = {
  id: string;
  primary_app_user_id: string;
  aliases?: string | null;
  blocked?: number;
  first_seen_at?: string;
  last_seen_at?: string;
};

type CustomerDetail = {
  customer: CustomerRow;
  customer_info: {
    entitlements?: Record<string, { is_active?: boolean; status?: string; expires_at?: string | null }>;
    subscriptions?: Array<Record<string, unknown>>;
    balances?: Record<string, number>;
  };
  transactions?: BillingTransaction[];
};

type Delivery = {
  id: string;
  endpoint_name?: string;
  event_type?: string;
  status?: string;
  attempts?: number;
  last_error?: string | null;
  created_at?: string;
};

const money = (micros: unknown, currency = "") =>
  `${(Number(micros || 0) / 1_000_000).toFixed(2)}${currency ? ` ${currency}` : ""}`;

const date = (value: unknown) =>
  value ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(String(value))) : "—";

const statusBadge = (status: unknown) => {
  const value = String(status || "unknown");
  const destructive = ["failed", "degraded", "refunded", "revoked", "expired", "billing_issue"].includes(value);
  return <Badge variant={destructive ? "destructive" : value === "active" || value === "connected" || value === "healthy" ? "default" : "outline"}>{value}</Badge>;
};

const PurchasesPage = () => {
  const { selectedProject, projectType } = useProjectSelection();
  const projectId = selectedProject?.id;
  const [overview, setOverview] = useState<BillingOverview>();
  const [connections, setConnections] = useState<BillingConnection[]>([]);
  const [transactions, setTransactions] = useState<BillingTransaction[]>([]);
  const [subscriptions, setSubscriptions] = useState<BillingSubscription[]>([]);
  const [paywalls, setPaywalls] = useState<BillingPaywall[]>([]);
  const [placements, setPlacements] = useState<BillingPlacement[]>([]);
  const [targeting, setTargeting] = useState<BillingTargetingRule[]>([]);
  const [experiments, setExperiments] = useState<BillingExperiment[]>([]);
  const [analytics, setAnalytics] = useState<BillingAnalytics>();
  const [health, setHealth] = useState<BillingHealth>();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [virtualCurrencies, setVirtualCurrencies] = useState<Array<Record<string, unknown>>>([]);
  const [exports, setExports] = useState<Array<Record<string, unknown>>>([]);
  const [refundCases, setRefundCases] = useState<BillingRefundCase[]>([]);
  const [refundCaseDetail, setRefundCaseDetail] = useState<BillingRefundCaseDetail>();
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [customerDetail, setCustomerDetail] = useState<CustomerDetail>();
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [entitlementId, setEntitlementId] = useState("premium");
  const [productId, setProductId] = useState("");
  const [store, setStore] = useState("apple");
  const [productType, setProductType] = useState("subscription");
  const [offeringId, setOfferingId] = useState("default");
  const [packageId, setPackageId] = useState("monthly");
  const [customerQuery, setCustomerQuery] = useState("");
  const [paywallId, setPaywallId] = useState("premium");
  const [paywallTitle, setPaywallTitle] = useState("Go Premium");
  const [paywallSubtitle, setPaywallSubtitle] = useState("Unlock every feature.");
  const [paywallAccent, setPaywallAccent] = useState("#5B5FF0");
  const [placementId, setPlacementId] = useState("onboarding_end");
  const [ruleCountry, setRuleCountry] = useState("CH");
  const [experimentName, setExperimentName] = useState("Paywall test");
  const [currencyCode, setCurrencyCode] = useState("CREDITS");
  const [providerSecret, setProviderSecret] = useState("");
  const [providerWebhookSecret, setProviderWebhookSecret] = useState("");
  const [refundEvidenceType, setRefundEvidenceType] = useState("customer_context");
  const [refundEvidenceContent, setRefundEvidenceContent] = useState("");
  const [refundActionType, setRefundActionType] = useState("");
  const [refundActionPayloads, setRefundActionPayloads] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [
        nextOverview,
        nextConnections,
        nextTransactions,
        nextSubscriptions,
        nextPaywalls,
        nextPlacements,
        nextTargeting,
        nextExperiments,
        nextAnalytics,
        nextHealth,
        nextDeliveries,
        nextCurrencies,
        nextExports,
        nextRefundCases,
      ] = await Promise.allSettled([
        getBillingOverview(projectId),
        getBillingConnections(projectId),
        getBillingTransactions(projectId),
        getBillingSubscriptions(projectId),
        getBillingPaywalls(projectId),
        getBillingPlacements(projectId),
        getBillingTargeting(projectId),
        getBillingExperiments(projectId),
        getBillingAnalytics(projectId),
        getBillingHealth(projectId),
        getBillingWebhookDeliveries(projectId),
        getBillingVirtualCurrencies(projectId),
        getBillingExports(projectId),
        getBillingRefundCases(projectId),
      ]);
      const failures: string[] = [];
      const failed = (name: string, reason: unknown) => failures.push(`${name}: ${reason instanceof Error ? reason.message : "unable to load"}`);
      if (nextOverview.status === "fulfilled") setOverview(nextOverview.value); else failed("Overview", nextOverview.reason);
      if (nextConnections.status === "fulfilled") setConnections(nextConnections.value.data || []); else failed("Stores", nextConnections.reason);
      if (nextTransactions.status === "fulfilled") setTransactions(nextTransactions.value.data || []); else failed("Transactions", nextTransactions.reason);
      if (nextSubscriptions.status === "fulfilled") setSubscriptions(nextSubscriptions.value.data || []); else failed("Subscriptions", nextSubscriptions.reason);
      if (nextPaywalls.status === "fulfilled") setPaywalls(nextPaywalls.value.data || []); else failed("Paywalls", nextPaywalls.reason);
      if (nextPlacements.status === "fulfilled") setPlacements(nextPlacements.value.data || []); else failed("Placements", nextPlacements.reason);
      if (nextTargeting.status === "fulfilled") setTargeting(nextTargeting.value.data || []); else failed("Targeting", nextTargeting.reason);
      if (nextExperiments.status === "fulfilled") setExperiments(nextExperiments.value.data || []); else failed("Experiments", nextExperiments.reason);
      if (nextAnalytics.status === "fulfilled") setAnalytics(nextAnalytics.value); else failed("Analytics", nextAnalytics.reason);
      if (nextHealth.status === "fulfilled") setHealth(nextHealth.value); else failed("Diagnostics", nextHealth.reason);
      if (nextDeliveries.status === "fulfilled") setDeliveries(nextDeliveries.value.data || []); else failed("Webhooks", nextDeliveries.reason);
      if (nextCurrencies.status === "fulfilled") setVirtualCurrencies(nextCurrencies.value.data || []); else failed("Currencies", nextCurrencies.reason);
      if (nextExports.status === "fulfilled") setExports(nextExports.value.data || []); else failed("Exports", nextExports.reason);
      if (nextRefundCases.status === "fulfilled") setRefundCases(nextRefundCases.value.data || []); else failed("Refund Center", nextRefundCases.reason);
      if (failures.length) showErrorNotification(failures.join(" · "));
    } catch (error) {
      showErrorNotification(error instanceof Error ? error.message : "Unable to load Purchases");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const run = async (action: () => Promise<unknown>, success: string, refresh = true) => {
    try {
      await action();
      showSuccessNotification(success);
      if (refresh) await load();
    } catch (error) {
      showErrorNotification(error instanceof Error ? error.message : "The action failed");
    }
  };

  const syncProducts = async () => {
    if (!projectId) return;
    setSyncing(true);
    try {
      const result = await syncBillingProducts(projectId);
      const imported = result.stores.reduce((total, item) => total + (item.imported || 0), 0);
      const failures = result.stores.filter((item) => !item.ok);
      if (failures.length) showErrorNotification(failures.map((item) => item.error).filter(Boolean).join(" · "));
      if (result.stores.some((item) => item.ok)) showSuccessNotification(`${imported} product(s) synchronized`);
      await load();
    } catch (error) {
      showErrorNotification(error instanceof Error ? error.message : "Unable to synchronize products");
    } finally {
      setSyncing(false);
    }
  };

  const searchCustomers = async () => {
    if (!projectId) return;
    try {
      const result = await searchBillingCustomers(projectId, customerQuery);
      setCustomers((result.data || []) as CustomerRow[]);
    } catch (error) {
      showErrorNotification(error instanceof Error ? error.message : "Unable to search customers");
    }
  };

  const openCustomer = async (id: string) => {
    if (!projectId) return;
    try { setCustomerDetail(await getBillingCustomer(projectId, id)); }
    catch (error) { showErrorNotification(error instanceof Error ? error.message : "Customer not found"); }
  };

  const openRefundCase = async (id: string) => {
    if (!projectId) return;
    try {
      const detail = await getBillingRefundCase(projectId, id);
      setRefundCaseDetail(detail);
      const defaultDefinition = detail.action_definitions[0];
      setRefundActionType(defaultDefinition?.action_type || "");
      setRefundEvidenceType(defaultDefinition?.recommended_evidence_type || "customer_context");
      setRefundActionPayloads(Object.fromEntries(detail.actions.map((action) => {
        let parsed: Record<string, unknown> = {};
        try {
          const value = JSON.parse(String(action.payload || "{}"));
          if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Record<string, unknown>;
        } catch {}
        if (!Object.keys(parsed).length) {
          parsed = detail.action_definitions.find((definition) => definition.action_type === String(action.action_type))?.default_payload || {};
        }
        return [String(action.id), JSON.stringify(parsed, null, 2)];
      })));
    }
    catch (error) { showErrorNotification(error instanceof Error ? error.message : "Refund case not found"); }
  };

  const createRefundAction = async () => {
    if (!projectId || !refundCaseDetail) return;
    const definition = refundCaseDetail.action_definitions.find((item) => item.action_type === refundActionType);
    if (!definition) return;
    await run(async () => {
      await createBillingRefundAction(projectId, refundCaseDetail.refund_case.id, refundActionType, definition.default_payload);
      await openRefundCase(refundCaseDetail.refund_case.id);
    }, "Provider action created as a draft", false);
  };

  const saveAndApproveRefundAction = async (action: Record<string, any>) => {
    if (!projectId || !refundCaseDetail) return;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(refundActionPayloads[String(action.id)] || "{}") as Record<string, unknown>;
    } catch {
      showErrorNotification("The action payload must be a valid JSON object");
      return;
    }
    await run(async () => {
      await updateBillingRefundAction(projectId, refundCaseDetail.refund_case.id, String(action.id), payload);
      await approveBillingRefundAction(projectId, refundCaseDetail.refund_case.id, String(action.id));
      await openRefundCase(refundCaseDetail.refund_case.id);
    }, "Action approved and queued for the provider", false);
  };

  const addRefundEvidence = async () => {
    if (!projectId || !refundCaseDetail || !refundEvidenceContent.trim()) return;
    await run(async () => {
      await createBillingRefundEvidence(projectId, refundCaseDetail.refund_case.id, {
        evidence_type: refundEvidenceType,
        content: refundEvidenceContent.trim(),
      });
      setRefundEvidenceContent("");
      setRefundCaseDetail(await getBillingRefundCase(projectId, refundCaseDetail.refund_case.id));
    }, "Evidence added as a draft", false);
  };

  const createPaywall = async () => {
    const offering = overview?.offerings[0];
    if (!projectId || !paywallId.trim() || !offering) return;
    await run(async () => {
      const created = await createBillingPaywall(projectId, {
        identifier: paywallId,
        display_name: paywallId,
        offering_id: offering.id,
        configuration: {
          schema_version: 1,
          theme: { accent_color: paywallAccent, background_color: "#FFFFFF", text_color: "#111827" },
          components: [
            { type: "title", text: paywallTitle },
            { type: "subtitle", text: paywallSubtitle },
            { type: "packages" },
            { type: "purchase_button", text: "Continue" },
            { type: "restore_button", text: "Restore purchases" },
          ],
        },
      });
      await publishBillingPaywall(projectId, created.id, created.draft_version_id);
    }, "Paywall created and published");
  };

  const createRule = async () => {
    const placement = placements[0];
    const offering = overview?.offerings[0];
    if (!projectId || !placement || !offering) return;
    await run(() => createBillingTargetingRule(projectId, {
      placement_id: placement.id,
      display_name: `Country ${ruleCountry.toUpperCase()}`,
      priority: targeting.length,
      state: "live",
      conditions: [{ field: "country", operator: "equals", value: ruleCountry.toUpperCase() }],
      offering_id: offering.id,
    }), "Targeting rule activated");
  };

  const createExperiment = async () => {
    const placement = placements[0];
    const control = overview?.offerings[0];
    const variant = overview?.offerings[1];
    if (!projectId || !placement || !control || !variant) return;
    await run(() => createBillingExperiment(projectId, {
      placement_id: placement.id,
      display_name: experimentName,
      variants: [
        { identifier: "control", offering_id: control.id, weight: 5000, is_control: true },
        { identifier: "variant_b", offering_id: variant.id, weight: 5000 },
      ],
    }), "Experiment created as a draft");
  };

  const saveWebConnection = async () => {
    if (!projectId || !providerSecret.trim()) return;
    await run(() => createBillingConnection(projectId, {
      provider: "stripe",
      environment: projectType === "test" ? "sandbox" : "production",
      display_name: "Stripe Billing",
      secret_configuration: { secret_key: providerSecret, webhook_secret: providerWebhookSecret },
      public_configuration: {},
    }), "Web connection saved");
    setProviderSecret("");
    setProviderWebhookSecret("");
  };

  const addProduct = async () => {
    if (!projectId || !productId.trim()) return;
    const action = store === "apple" || store === "google"
      ? () => createProduct(projectId, { store, store_product_id: productId.trim(), product_type: productType, display_name: productId.trim(), entitlement_ids: overview?.entitlements.map((item) => item.id) || [] })
      : () => createBillingProviderProduct(projectId, { provider: store, store_product_id: productId.trim(), provider_price_id: productId.trim(), product_type: productType, display_name: productId.trim(), environment: projectType === "test" ? "sandbox" : "production" });
    await run(action, "Product added");
    setProductId("");
  };

  const metrics = overview?.metrics;
  const metricCards: Array<[string, string | number, LucideIcon]> = [
    ["Verified revenue", money(metrics?.revenue_micros), CreditCard],
    ["Paying customers", metrics?.paying_customers ?? 0, Users],
    ["Trials", metrics?.trials ?? 0, FlaskConical],
    ["Refunds", metrics?.refunds ?? 0, RefreshCw],
  ];

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <AppHeader titleOverride="Purchases" />
      <main className="flex-1 space-y-6 overflow-auto p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold">OpenGrow Purchases 2.0</h1>
              <Badge variant="secondary">Full Access</Badge>
              {health && statusBadge(health.status)}
            </div>
            <p className="text-sm text-muted-foreground">Monetization, subscriptions, paywalls, customers, and experiments across every supported platform.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void syncProducts()} disabled={syncing || loading}>
              <CloudDownload className="mr-2 h-4 w-4" />{syncing ? "Synchronizing…" : "Synchronize stores"}
            </Button>
            <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
          </div>
        </div>

        {health?.status === "degraded" && (
          <Alert variant="destructive">
            <Activity />
            <AlertTitle>Purchases needs attention</AlertTitle>
            <AlertDescription>Open Diagnostics to identify failed events or webhook deliveries.</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 md:grid-cols-4">
          {metricCards.map(([label, value, Icon]) => (
            <Card key={label}><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{label}</CardTitle></CardHeader><CardContent className="flex items-center justify-between"><span className="text-2xl font-semibold">{value}</span><Icon className="h-5 w-5 text-muted-foreground" /></CardContent></Card>
          ))}
        </div>

        <Tabs defaultValue="overview">
          <TabsList className="h-auto flex-wrap justify-start">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="stores">Stores</TabsTrigger>
            <TabsTrigger value="products">Products</TabsTrigger>
            <TabsTrigger value="entitlements">Entitlements</TabsTrigger>
            <TabsTrigger value="offerings">Offerings</TabsTrigger>
            <TabsTrigger value="paywalls">Paywalls</TabsTrigger>
            <TabsTrigger value="customers">Customers</TabsTrigger>
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
            <TabsTrigger value="subscriptions">Subscriptions</TabsTrigger>
            <TabsTrigger value="refunds">Refund Center</TabsTrigger>
            <TabsTrigger value="growth">Growth</TabsTrigger>
            <TabsTrigger value="integrations">Integrations</TabsTrigger>
            <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid gap-3 md:grid-cols-5">
              {[
                ["MRR", money(analytics?.summary?.mrr_micros)],
                ["ARR", money(analytics?.summary?.arr_micros)],
                ["Active subscriptions", String(analytics?.summary?.active_subscriptions || 0)],
                ["Churn", `${(Number(analytics?.summary?.churn_rate || 0) * 100).toFixed(1)}%`],
                ["Realized LTV", money(analytics?.summary?.realized_ltv_micros)],
              ].map(([label, value]) => <Card key={label}><CardContent className="pt-5"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-xl font-semibold">{value}</div></CardContent></Card>)}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5" />30-day activity</CardTitle></CardHeader><CardContent>
                {analytics?.series.length ? <Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Revenue</TableHead><TableHead>Purchases</TableHead><TableHead>Renewals</TableHead><TableHead>Refunds</TableHead></TableRow></TableHeader><TableBody>{analytics.series.slice(-14).map((row) => <TableRow key={String(row.date)}><TableCell>{String(row.date)}</TableCell><TableCell>{money(row.revenue_micros)}</TableCell><TableCell>{String(row.purchases || 0)}</TableCell><TableCell>{String(row.renewals || 0)}</TableCell><TableCell>{String(row.refunds || 0)}</TableCell></TableRow>)}</TableBody></Table> : <p className="text-sm text-muted-foreground">Charts will appear after the first verified events.</p>}
              </CardContent></Card>
              <Card><CardHeader><CardTitle>Paywall funnel</CardTitle></CardHeader><CardContent className="space-y-3">
                {analytics?.paywall_funnel.length ? analytics.paywall_funnel.map((item) => <div key={item.event_type} className="flex items-center justify-between rounded-md border p-3"><span>{item.event_type}</span><span className="text-xl font-semibold">{item.count}</span></div>) : <p className="text-sm text-muted-foreground">Impressions, purchases, and conversions are collected automatically by SDK v2.</p>}
              </CardContent></Card>
            </div>
          </TabsContent>

          <TabsContent value="stores" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              {connections.map((connection) => (
                <Card key={`${connection.provider}-${connection.environment}`}>
                  <CardHeader><div className="flex items-center justify-between"><CardTitle className="flex items-center gap-2"><Store className="h-5 w-5" />{connection.display_name}</CardTitle>{statusBadge(connection.status)}</div></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {Object.entries(connection.capabilities || {}).map(([name, capability]) => <div key={name} className="flex items-center justify-between rounded-md border p-2"><span>{name}</span>{statusBadge(capability.status)}</div>)}
                    </div>
                    {connection.last_error_message && <p className="text-sm text-destructive">{connection.last_error_code}: {connection.last_error_message}</p>}
                    <div className="flex items-center justify-between text-xs text-muted-foreground"><span>Last test: {date(connection.last_tested_at)}</span><Button variant="outline" size="sm" onClick={() => projectId && void run(() => testBillingConnection(projectId, connection.provider, connection.environment), `${connection.display_name} verified`)}>Test connection</Button></div>
                  </CardContent>
                </Card>
              ))}
              {!connections.length && <Card><CardContent className="pt-6 text-sm text-muted-foreground">No store connection is configured.</CardContent></Card>}
            </div>
            <Card><CardHeader><CardTitle>Add Stripe</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-3"><Input type="password" value={providerSecret} onChange={(event) => setProviderSecret(event.target.value)} placeholder="Stripe secret key (sk_…)" autoComplete="new-password" /><Input type="password" value={providerWebhookSecret} onChange={(event) => setProviderWebhookSecret(event.target.value)} placeholder="Stripe webhook secret (whsec_…)" autoComplete="new-password" /><Button onClick={() => void saveWebConnection()}>Encrypt and save Stripe</Button></CardContent></Card>
          </TabsContent>

          <TabsContent value="products" className="space-y-4">
            <Card><CardHeader><CardTitle>App Store, Google Play, and Stripe catalog</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-2"><Button variant="outline" disabled={syncing} onClick={() => void syncProducts()}><CloudDownload className={`mr-2 h-4 w-4 ${syncing ? "animate-pulse" : ""}`} />{syncing ? "Importing…" : "Import Apple & Google"}</Button><Input className="max-w-sm" value={productId} onChange={(event) => setProductId(event.target.value)} placeholder="Product ID or Stripe Price ID" /><select className="rounded-md border bg-background px-3" value={store} onChange={(event) => setStore(event.target.value)}><option value="apple">App Store</option><option value="google">Google Play</option><option value="stripe">Stripe</option></select><select className="rounded-md border bg-background px-3" value={productType} onChange={(event) => setProductType(event.target.value)}><option value="subscription">Subscription</option><option value="non_consumable">Lifetime</option><option value="consumable">Consumable</option></select><Button onClick={() => void addProduct()}>Add</Button></CardContent></Card>
            <Card><CardContent className="pt-6"><Table><TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Store</TableHead><TableHead>Type</TableHead><TableHead>Environment</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader><TableBody>{overview?.products.map((product) => <TableRow key={product.id}><TableCell><div className="font-medium">{product.display_name}</div><div className="text-xs text-muted-foreground">{product.store_product_id}</div></TableCell><TableCell>{product.store}</TableCell><TableCell>{product.product_type}</TableCell><TableCell>{product.environment}</TableCell><TableCell>{product.active ? statusBadge("active") : statusBadge("archived")}</TableCell><TableCell><Button variant="outline" size="sm" onClick={() => projectId && void run(() => archiveBillingProduct(projectId, product.id), "Product archived")}>Archive</Button></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
          </TabsContent>

          <TabsContent value="entitlements" className="space-y-4">
            <Card><CardHeader><CardTitle>Access rights</CardTitle></CardHeader><CardContent className="flex gap-2"><Input className="max-w-sm" value={entitlementId} onChange={(event) => setEntitlementId(event.target.value)} placeholder="premium" /><Button onClick={() => projectId && entitlementId.trim() && void run(() => createEntitlement(projectId, { identifier: entitlementId.trim(), display_name: entitlementId.trim() }), "Entitlement created")}>Create</Button></CardContent></Card>
            <div className="grid gap-3 md:grid-cols-2">{overview?.entitlements.map((item) => <Card key={item.id}><CardContent className="flex items-center justify-between pt-6"><div><div className="font-medium">{item.display_name}</div><div className="text-xs text-muted-foreground">{item.identifier}</div></div><Button variant="outline" size="sm" onClick={() => projectId && void run(() => archiveBillingEntitlement(projectId, item.id), "Entitlement archived")}>Archive</Button></CardContent></Card>)}</div>
          </TabsContent>

          <TabsContent value="offerings" className="space-y-4">
            <Card><CardHeader><CardTitle>Offerings and packages</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-2"><Input className="max-w-xs" value={offeringId} onChange={(event) => setOfferingId(event.target.value)} placeholder="default" /><Button onClick={() => projectId && void run(() => createOffering(projectId, { identifier: offeringId, display_name: offeringId, placement: "default", is_current: !overview?.offerings.length }), "Offering created")}>Create offering</Button><Input className="max-w-xs" value={packageId} onChange={(event) => setPackageId(event.target.value)} placeholder="monthly" /><Button variant="outline" disabled={!overview?.offerings.length || !overview?.products.length} onClick={() => projectId && overview?.offerings[0] && void run(() => createBillingPackage(projectId, overview?.offerings[0]?.id || "", { identifier: packageId, package_type: packageId, product_ids: overview?.products.map((item) => item.id) || [] }), "Package created")}>Add package</Button></CardContent></Card>
            <div className="grid gap-3 md:grid-cols-2">{overview?.offerings.map((item) => <Card key={item.id}><CardContent className="flex items-center justify-between pt-6"><div><div className="font-medium">{item.display_name}</div><div className="text-xs text-muted-foreground">{item.identifier} {item.is_current ? "· current" : ""}</div></div><Button variant="outline" size="sm" onClick={() => projectId && void run(() => archiveBillingOffering(projectId, item.id), "Offering archived")}>Archive</Button></CardContent></Card>)}</div>
          </TabsContent>

          <TabsContent value="paywalls" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
              <Card><CardHeader><CardTitle>Remote paywalls</CardTitle></CardHeader><CardContent className="space-y-3">{paywalls.length ? paywalls.map((item) => <div key={item.id} className="flex items-center justify-between rounded-md border p-3"><div><div className="font-medium">{item.display_name}</div><div className="text-xs text-muted-foreground">{item.identifier} · Offering {item.offering_identifier || "not assigned"}</div></div><div className="flex items-center gap-2">{item.active_version ? <Badge>v{item.active_version}</Badge> : <Badge variant="outline">Draft</Badge>}</div></div>) : <p className="text-sm text-muted-foreground">Create a remotely managed paywall. Publishing it does not require a new app release.</p>}</CardContent></Card>
              <Card><CardHeader><CardTitle>Preview and publish</CardTitle></CardHeader><CardContent className="space-y-3"><Input value={paywallId} onChange={(event) => setPaywallId(event.target.value)} placeholder="premium" /><Input value={paywallTitle} onChange={(event) => setPaywallTitle(event.target.value)} /><Input value={paywallSubtitle} onChange={(event) => setPaywallSubtitle(event.target.value)} /><div className="flex gap-2"><Input type="color" className="w-16" value={paywallAccent} onChange={(event) => setPaywallAccent(event.target.value)} /><Input value={paywallAccent} onChange={(event) => setPaywallAccent(event.target.value)} /></div><div className="rounded-xl border p-5 text-center" style={{ borderColor: paywallAccent }}><PanelTop className="mx-auto mb-3 h-8 w-8" style={{ color: paywallAccent }} /><h3 className="text-xl font-semibold">{paywallTitle}</h3><p className="mt-1 text-sm text-muted-foreground">{paywallSubtitle}</p><div className="my-4 rounded-md border p-3">Selected package</div><div className="rounded-md p-2 text-white" style={{ backgroundColor: paywallAccent }}>Continue</div></div><Button className="w-full" disabled={!overview?.offerings.length} onClick={() => void createPaywall()}>Create and publish</Button></CardContent></Card>
            </div>
          </TabsContent>

          <TabsContent value="customers" className="space-y-4">
            <Card><CardHeader><CardTitle>Customer search</CardTitle></CardHeader><CardContent className="flex gap-2"><Input value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} placeholder="App User ID or alias" onKeyDown={(event) => event.key === "Enter" && void searchCustomers()} /><Button onClick={() => void searchCustomers()}>Search</Button></CardContent></Card>
            <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
              <Card><CardContent className="space-y-2 pt-6">{customers.map((customer) => <button key={customer.id} className="w-full rounded-md border p-3 text-left hover:bg-muted" onClick={() => void openCustomer(customer.id)}><div className="flex items-center justify-between"><span className="font-medium">{customer.primary_app_user_id}</span>{customer.blocked ? statusBadge("blocked") : null}</div><div className="text-xs text-muted-foreground">{customer.aliases || "No alias"}</div></button>)}{!customers.length && <p className="text-sm text-muted-foreground">Run a search to display customers.</p>}</CardContent></Card>
              <Card><CardHeader><CardTitle>Customer details</CardTitle></CardHeader><CardContent className="space-y-4">{customerDetail ? <><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-semibold">{customerDetail.customer.primary_app_user_id}</div><div className="text-xs text-muted-foreground">Last activity: {date(customerDetail.customer.last_seen_at)}</div></div><Button variant="outline" onClick={() => projectId && void run(async () => { await setBillingCustomerBlocked(projectId, customerDetail.customer.id, !customerDetail.customer.blocked); await openCustomer(customerDetail.customer.id); }, customerDetail.customer.blocked ? "Customer unblocked" : "Customer blocked", false)}>{customerDetail.customer.blocked ? "Unblock" : "Block"}</Button></div><div><h4 className="mb-2 text-sm font-medium">Entitlements</h4><div className="space-y-2">{Object.entries(customerDetail.customer_info.entitlements || {}).map(([key, value]) => <div key={key} className="flex items-center justify-between rounded-md border p-2"><span>{key}</span><div className="flex items-center gap-2">{statusBadge(value.status)}<span className="text-xs text-muted-foreground">{date(value.expires_at)}</span></div></div>)}</div></div><div className="flex flex-wrap gap-2">{overview?.entitlements.map((item) => <Button key={item.id} size="sm" variant="outline" onClick={() => projectId && void run(async () => { await grantBillingEntitlement(projectId, customerDetail.customer.id, item.id); await openCustomer(customerDetail.customer.id); }, `${item.identifier} granted`, false)}>Grant {item.identifier}</Button>)}</div><div><h4 className="mb-2 text-sm font-medium">Balances</h4><div className="flex flex-wrap gap-2">{Object.entries(customerDetail.customer_info.balances || {}).map(([key, value]) => <Badge key={key} variant="outline">{key}: {value}</Badge>)}</div></div></> : <p className="text-sm text-muted-foreground">Select a customer to review history and administer access rights.</p>}</CardContent></Card>
            </div>
          </TabsContent>

          <TabsContent value="transactions"><Card><CardContent className="pt-6"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Customer</TableHead><TableHead>Product</TableHead><TableHead>Store</TableHead><TableHead>Event</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{transactions.map((item) => <TableRow key={item.id}><TableCell>{date(item.purchased_at || item.created_at)}</TableCell><TableCell>{item.primary_app_user_id || "Anonymous"}</TableCell><TableCell>{item.store_product_id || item.product_name || "—"}</TableCell><TableCell>{item.store} · {item.environment}</TableCell><TableCell>{item.event_type}</TableCell><TableCell>{money(item.price_micros, item.currency || "")}</TableCell><TableCell>{statusBadge(item.status)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card></TabsContent>

          <TabsContent value="subscriptions"><Card><CardContent className="pt-6"><Table><TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Product</TableHead><TableHead>Store</TableHead><TableHead>Period</TableHead><TableHead>Expiration</TableHead><TableHead>Renews</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{subscriptions.map((item) => <TableRow key={item.id}><TableCell>{item.primary_app_user_id || "Anonymous"}</TableCell><TableCell>{item.store_product_id || item.product_name || "—"}</TableCell><TableCell>{item.store}</TableCell><TableCell>{item.period_type}</TableCell><TableCell>{date(item.expires_at)}</TableCell><TableCell>{item.will_renew ? "Yes" : "No"}</TableCell><TableCell>{statusBadge(item.status)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card></TabsContent>

          <TabsContent value="refunds" className="space-y-4">
            <Alert><ShieldAlert /><AlertTitle>Human approval required</AlertTitle><AlertDescription>OpenGrow prepares evidence and provider actions. Nothing is sent to Apple, Google, or Stripe before an administrator approves it.</AlertDescription></Alert>
            <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
              <Card><CardHeader><CardTitle>Refund and dispute cases</CardTitle></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Deadline</TableHead><TableHead>Customer</TableHead><TableHead>Store</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader><TableBody>{refundCases.map((item) => <TableRow key={item.id}><TableCell>{date(item.deadline_at)}</TableCell><TableCell><div>{item.primary_app_user_id || "—"}</div><div className="text-xs text-muted-foreground">{item.store_product_id || item.provider_case_id}</div></TableCell><TableCell>{item.provider} · {item.environment}</TableCell><TableCell>{item.case_type}</TableCell><TableCell>{statusBadge(item.status)}</TableCell><TableCell><Button size="sm" variant="outline" onClick={() => void openRefundCase(item.id)}>Open</Button></TableCell></TableRow>)}{!refundCases.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No refund case received.</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
              <div className="space-y-4">
                <Card><CardHeader><CardTitle>Details and evidence</CardTitle></CardHeader><CardContent className="space-y-3">{refundCaseDetail ? <><div className="flex items-center justify-between"><span className="font-medium">{refundCaseDetail.refund_case.provider_case_id}</span>{statusBadge(refundCaseDetail.refund_case.status)}</div><div className="text-sm text-muted-foreground">{refundCaseDetail.refund_case.reason || refundCaseDetail.refund_case.case_type}</div><Input value={refundEvidenceType} onChange={(event) => setRefundEvidenceType(event.target.value)} placeholder="Evidence type" /><textarea className="min-h-28 w-full rounded-md border bg-background px-3 py-2 text-sm" value={refundEvidenceContent} onChange={(event) => setRefundEvidenceContent(event.target.value)} placeholder="Factual context, access history, and consumption details…" /><Button className="w-full" onClick={() => void addRefundEvidence()}>Add as draft</Button>{refundCaseDetail.evidence.map((evidence) => <div key={String(evidence.id)} className="rounded-md border p-3 text-sm"><div className="flex items-center justify-between"><span className="font-medium">{String(evidence.evidence_type)}</span>{statusBadge(evidence.review_status)}</div><p className="mt-2 whitespace-pre-wrap text-muted-foreground">{String(evidence.content || evidence.file_key || "")}</p>{evidence.review_status === "draft" && <div className="mt-2 flex gap-2"><Button size="sm" onClick={() => projectId && void run(async () => { await reviewBillingRefundEvidence(projectId, refundCaseDetail.refund_case.id, String(evidence.id), true); await openRefundCase(refundCaseDetail.refund_case.id); }, "Evidence approved", false)}>Approve</Button><Button size="sm" variant="outline" onClick={() => projectId && void run(async () => { await reviewBillingRefundEvidence(projectId, refundCaseDetail.refund_case.id, String(evidence.id), false); await openRefundCase(refundCaseDetail.refund_case.id); }, "Evidence rejected", false)}>Reject</Button></div>}</div>)}</> : <p className="text-sm text-muted-foreground">Open a case to prepare its response.</p>}</CardContent></Card>
                {refundCaseDetail && <Card><CardHeader><CardTitle>Provider actions</CardTitle></CardHeader><CardContent className="space-y-3"><div className="flex gap-2"><select className="min-h-9 flex-1 rounded-md border bg-background px-3 text-sm" value={refundActionType} onChange={(event) => { const definition = refundCaseDetail.action_definitions.find((item) => item.action_type === event.target.value); setRefundActionType(event.target.value); if (definition) setRefundEvidenceType(definition.recommended_evidence_type); }}>{refundCaseDetail.action_definitions.map((definition) => <option key={definition.action_type} value={definition.action_type}>{definition.action_type}</option>)}</select><Button size="sm" variant="outline" disabled={!refundActionType} onClick={() => void createRefundAction()}>Prepare</Button></div>{refundCaseDetail.actions.map((action) => <div key={String(action.id)} className="rounded-md border p-3 text-sm"><div className="flex items-center justify-between"><span>{String(action.action_type)}</span>{statusBadge(action.status)}</div>{["draft", "failed"].includes(String(action.status)) && <><textarea className="mt-2 min-h-36 w-full rounded-md border bg-background px-3 py-2 font-mono text-xs" value={refundActionPayloads[String(action.id)] || "{}"} onChange={(event) => setRefundActionPayloads((current) => ({ ...current, [String(action.id)]: event.target.value }))} /><p className="mt-1 text-xs text-muted-foreground">Apple requires explicit consent that is separate from ATT. Stripe evidence must be approved above.</p><Button className="mt-2 w-full" size="sm" onClick={() => void saveAndApproveRefundAction(action)}>{action.status === "failed" ? "Correct and retry" : "Approve and send"}</Button></>}{action.last_error && <p className="mt-2 text-xs text-destructive">{String(action.last_error)}</p>}{action.sent_at && <p className="mt-2 text-xs text-muted-foreground">Sent on {date(action.sent_at)}</p>}</div>)}{!refundCaseDetail.actions.length && <p className="text-sm text-muted-foreground">No action has been prepared. Choose a provider action above.</p>}</CardContent></Card>}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="growth" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-3">
              <Card><CardHeader><CardTitle>Placements</CardTitle></CardHeader><CardContent className="space-y-3"><Input value={placementId} onChange={(event) => setPlacementId(event.target.value)} /><Button className="w-full" disabled={!overview?.offerings.length} onClick={() => projectId && overview?.offerings[0] && void run(() => createBillingPlacement(projectId, { identifier: placementId, display_name: placementId, default_offering_id: overview?.offerings[0]?.id || "" }), "Placement created")}>Create</Button>{placements.map((item) => <div key={item.id} className="rounded-md border p-2 text-sm"><div className="font-medium">{item.identifier}</div><div className="text-xs text-muted-foreground">{item.default_offering_identifier || "No offering"}</div></div>)}</CardContent></Card>
              <Card><CardHeader><CardTitle>Targeting</CardTitle></CardHeader><CardContent className="space-y-3"><Input value={ruleCountry} maxLength={2} onChange={(event) => setRuleCountry(event.target.value)} placeholder="Country (CH)" /><Button className="w-full" disabled={!placements.length || !overview?.offerings.length} onClick={() => void createRule()}>Create country rule</Button>{targeting.map((item) => <div key={item.id} className="rounded-md border p-2 text-sm"><div className="flex items-center justify-between"><span className="font-medium">{item.display_name}</span>{statusBadge(item.state)}</div><div className="text-xs text-muted-foreground">{item.placement_identifier} → {item.offering_identifier}</div><Button className="mt-2" size="sm" variant="outline" onClick={() => projectId && void run(() => updateBillingTargetingRule(projectId, item.id, { state: item.state === "live" ? "inactive" : "live" }), item.state === "live" ? "Rule deactivated" : "Rule activated")}>{item.state === "live" ? "Deactivate" : "Activate"}</Button></div>)}</CardContent></Card>
              <Card><CardHeader><CardTitle>A/B experiments</CardTitle></CardHeader><CardContent className="space-y-3"><Input value={experimentName} onChange={(event) => setExperimentName(event.target.value)} /><Button className="w-full" disabled={!placements.length || (overview?.offerings.length || 0) < 2} onClick={() => void createExperiment()}>Create 50/50 test</Button>{experiments.map((item) => <div key={item.id} className="rounded-md border p-2 text-sm"><div className="flex items-center justify-between"><span className="font-medium">{item.display_name}</span>{statusBadge(item.state)}</div><div className="text-xs text-muted-foreground">{item.variants.length} variants · {item.placement_identifier}</div><Button className="mt-2" size="sm" variant="outline" disabled={item.state === "stopped"} onClick={() => projectId && void run(() => updateBillingExperiment(projectId, item.id, { state: item.state === "running" ? "paused" : "running" }), item.state === "running" ? "Experiment paused" : "Experiment started")}>{item.state === "running" ? "Pause" : "Start"}</Button></div>)}</CardContent></Card>
            </div>
          </TabsContent>

          <TabsContent value="integrations" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Webhook className="h-5 w-5" />Webhook deliveries</CardTitle></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Endpoint</TableHead><TableHead>Event</TableHead><TableHead>Attempts</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader><TableBody>{deliveries.map((item) => <TableRow key={item.id}><TableCell>{date(item.created_at)}</TableCell><TableCell>{item.endpoint_name || "—"}</TableCell><TableCell>{item.event_type || "—"}</TableCell><TableCell>{item.attempts || 0}</TableCell><TableCell>{statusBadge(item.status)}</TableCell><TableCell>{item.status === "failed" && <Button size="sm" variant="outline" onClick={() => projectId && void run(() => replayBillingWebhookDelivery(projectId, item.id), "Replay queued")}>Replay</Button>}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
              <div className="space-y-4"><Card><CardHeader><CardTitle className="flex items-center gap-2"><Coins className="h-5 w-5" />Virtual currencies</CardTitle></CardHeader><CardContent className="space-y-3"><Input value={currencyCode} onChange={(event) => setCurrencyCode(event.target.value.toUpperCase())} /><Button className="w-full" onClick={() => projectId && void run(() => createBillingVirtualCurrency(projectId, { code: currencyCode, display_name: currencyCode }), "Currency created")}>Create</Button>{virtualCurrencies.map((item) => <div key={String(item.id)} className="rounded-md border p-2"><div className="font-medium">{String(item.display_name)}</div><div className="text-xs text-muted-foreground">{String(item.code)}</div></div>)}</CardContent></Card><Card><CardHeader><CardTitle>R2 exports</CardTitle></CardHeader><CardContent className="space-y-2"><Button className="w-full" variant="outline" onClick={() => projectId && void run(() => createBillingExport(projectId, "transactions"), "Export queued")}>Export transactions CSV</Button>{exports.slice(0, 5).map((item) => <div key={String(item.id)} className="flex items-center justify-between text-xs"><span>{String(item.dataset)}</span>{statusBadge(item.status)}</div>)}</CardContent></Card></div>
            </div>
          </TabsContent>

          <TabsContent value="diagnostics" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" />Events</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><div className="flex justify-between"><span>Last event</span><span>{date(health?.events?.last_event_at)}</span></div><div className="flex justify-between"><span>Pending</span><span>{String(health?.events?.pending_events || 0)}</span></div><div className="flex justify-between"><span>Failures</span><span>{String(health?.events?.failed_events || 0)}</span></div></CardContent></Card>
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><RefreshCw className="h-5 w-5" />Subscriptions</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><div className="flex justify-between"><span>Last projection</span><span>{date(health?.subscriptions?.last_reconciled_at)}</span></div><div className="flex justify-between"><span>Billing issues</span><span>{String(health?.subscriptions?.billing_issues || 0)}</span></div></CardContent></Card>
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><PlugZap className="h-5 w-5" />Webhooks</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><div className="flex justify-between"><span>Pending</span><span>{String(health?.deliveries?.pending_deliveries || 0)}</span></div><div className="flex justify-between"><span>Failures</span><span>{String(health?.deliveries?.failed_deliveries || 0)}</span></div></CardContent></Card>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default PurchasesPage;
