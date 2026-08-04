"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  BarChart3,
  CloudDownload,
  Coins,
  Copy,
  CreditCard,
  FlaskConical,
  PanelTop,
  PlugZap,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  configureBillingLegacySource,
  configureAppleNotificationConfiguration,
  completeBillingCertificationRun,
  createBillingCertificationRun,
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
  disableBillingLegacySource,
  getBillingAnalytics,
  getAppleNotificationConfiguration,
  getBillingConnections,
  getBillingCertificationRuns,
  getBillingCustomer,
  getBillingExperiments,
  getBillingExports,
  getBillingHealth,
  getBillingLegacyInventory,
  getBillingOverview,
  getBillingPaywalls,
  getBillingProviderEvents,
  getBillingPlacements,
  getBillingRefundCase,
  getBillingRefundCases,
  getBillingReleaseGate,
  getBillingSubscriptions,
  getBillingTargeting,
  getBillingTransactions,
  getBillingVirtualCurrencies,
  getBillingWebhookDeliveries,
  grantBillingEntitlement,
  mapBillingProductsToEntitlement,
  publishBillingPaywall,
  replayBillingWebhookDelivery,
  replayBillingProviderEvent,
  recordBillingCertificationObservation,
  rotateBillingCertificationDeviceChallenge,
  reviewBillingRefundEvidence,
  searchBillingCustomers,
  setBillingCustomerBlocked,
  startBillingLegacyInventory,
  syncBillingProducts,
  testBillingConnection,
  testBillingLegacySource,
  updateBillingExperiment,
  updateBillingRefundAction,
  updateBillingReleaseGateCheck,
  updateBillingTargetingRule,
  type BillingAnalytics,
  type BillingCertificationReferenceType,
  type BillingCertificationRun,
  type BillingConnection,
  type BillingExperiment,
  type BillingHealth,
  type BillingLegacyInventory,
  type BillingOverview,
  type BillingPaywall,
  type BillingProviderEvent,
  type BillingPlacement,
  type BillingRefundCase,
  type BillingRefundCaseDetail,
  type BillingReleaseGate,
  type BillingSubscription,
  type BillingTargetingRule,
  type BillingTransaction,
  type AppleNotificationConfiguration,
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
  const destructive = [
    "failed", "invalid", "error", "degraded", "refunded", "revoked", "expired", "billing_issue", "missed", "lost",
    "unmatched_customer", "missing_product", "missing_verified_subscription", "unsupported_provider",
    "approval_required", "availability_required", "sync_required",
  ].includes(value);
  return <Badge variant={destructive ? "destructive" : ["active", "connected", "healthy", "passed", "approved", "purchasable"].includes(value) ? "default" : "outline"}>{value.replaceAll("_", " ")}</Badge>;
};

const productProviderReadiness = (product: BillingOverview["products"][number]) => {
  if (product.store === "stripe" || product.product_type !== "subscription") return null;
  let metadata: Record<string, unknown> = {};
  if (typeof product.metadata === "string") {
    try { metadata = JSON.parse(product.metadata) as Record<string, unknown>; } catch { metadata = {}; }
  } else if (product.metadata && typeof product.metadata === "object") {
    metadata = product.metadata;
  }
  if (metadata.provider_approved === true && metadata.provider_purchasable === true) return "purchasable";
  if (metadata.provider_approved === true) return "availability_required";
  if (metadata.source === "app_store_connect" || metadata.source === "google_play") return "approval_required";
  return "sync_required";
};

const PurchasesPage = () => {
  const { selectedProject, projectType } = useProjectSelection();
  const projectId = selectedProject?.id;
  const [overview, setOverview] = useState<BillingOverview>();
  const [connections, setConnections] = useState<BillingConnection[]>([]);
  const [appleNotifications, setAppleNotifications] = useState<AppleNotificationConfiguration>();
  const [transactions, setTransactions] = useState<BillingTransaction[]>([]);
  const [subscriptions, setSubscriptions] = useState<BillingSubscription[]>([]);
  const [paywalls, setPaywalls] = useState<BillingPaywall[]>([]);
  const [placements, setPlacements] = useState<BillingPlacement[]>([]);
  const [targeting, setTargeting] = useState<BillingTargetingRule[]>([]);
  const [experiments, setExperiments] = useState<BillingExperiment[]>([]);
  const [analytics, setAnalytics] = useState<BillingAnalytics>();
  const [health, setHealth] = useState<BillingHealth>();
  const [providerEvents, setProviderEvents] = useState<BillingProviderEvent[]>([]);
  const [releaseGate, setReleaseGate] = useState<BillingReleaseGate>();
  const [certificationRuns, setCertificationRuns] = useState<BillingCertificationRun[]>([]);
  const [legacyInventory, setLegacyInventory] = useState<BillingLegacyInventory>();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [virtualCurrencies, setVirtualCurrencies] = useState<Array<Record<string, unknown>>>([]);
  const [exports, setExports] = useState<Array<Record<string, unknown>>>([]);
  const [refundCases, setRefundCases] = useState<BillingRefundCase[]>([]);
  const [refundCaseDetail, setRefundCaseDetail] = useState<BillingRefundCaseDetail>();
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [customerDetail, setCustomerDetail] = useState<CustomerDetail>();
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [configuringAppleNotifications, setConfiguringAppleNotifications] = useState(false);
  const [appleNotificationDialogOpen, setAppleNotificationDialogOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("overview");

  const [entitlementId, setEntitlementId] = useState("premium");
  const [productId, setProductId] = useState("");
  const [store, setStore] = useState("apple");
  const [productType, setProductType] = useState("subscription");
  const [offeringId, setOfferingId] = useState("default");
  const [packageId, setPackageId] = useState("weekly");
  const [packageType, setPackageType] = useState("weekly");
  const [packageOfferingId, setPackageOfferingId] = useState("");
  const [packageProductIds, setPackageProductIds] = useState<string[]>([]);
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
  const [gateBuild, setGateBuild] = useState("");
  const [gateDevice, setGateDevice] = useState("");
  const [gateOsVersion, setGateOsVersion] = useState("");
  const [gateAppVersion, setGateAppVersion] = useState("");
  const [gateSdkVersion, setGateSdkVersion] = useState("");
  const [gatePlatform, setGatePlatform] = useState<"ios" | "android" | "web" | "cross_platform">("ios");
  const [gateEnvironment, setGateEnvironment] = useState<"sandbox" | "production">("sandbox");
  const [selectedCertificationRunId, setSelectedCertificationRunId] = useState("");
  const [certificationDeviceToken, setCertificationDeviceToken] = useState("");
  const [certificationDeviceTokenExpiresAt, setCertificationDeviceTokenExpiresAt] = useState("");
  const [certificationDeviceEndpoint, setCertificationDeviceEndpoint] = useState("");
  const [gateReferences, setGateReferences] = useState<Record<string, string>>({});
  const [gateReferenceTypes, setGateReferenceTypes] = useState<Record<string, BillingCertificationReferenceType>>({});
  const [gateNotes, setGateNotes] = useState("");
  const [legacyProjectId, setLegacyProjectId] = useState("");
  const [legacyApiKey, setLegacyApiKey] = useState("");

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const appleNotificationRequest = getAppleNotificationConfiguration(projectId);
      const [
        nextOverview,
        nextConnections,
        nextAppleNotifications,
        nextTransactions,
        nextSubscriptions,
        nextPaywalls,
        nextPlacements,
        nextTargeting,
        nextExperiments,
        nextAnalytics,
        nextHealth,
        nextProviderEvents,
        nextDeliveries,
        nextCurrencies,
        nextExports,
        nextRefundCases,
        nextReleaseGate,
        nextCertificationRuns,
        nextLegacyInventory,
      ] = await Promise.allSettled([
        getBillingOverview(projectId),
        getBillingConnections(projectId),
        appleNotificationRequest,
        getBillingTransactions(projectId),
        getBillingSubscriptions(projectId),
        getBillingPaywalls(projectId),
        getBillingPlacements(projectId),
        getBillingTargeting(projectId),
        getBillingExperiments(projectId),
        getBillingAnalytics(projectId),
        getBillingHealth(projectId),
        getBillingProviderEvents(projectId),
        getBillingWebhookDeliveries(projectId),
        getBillingVirtualCurrencies(projectId),
        getBillingExports(projectId),
        getBillingRefundCases(projectId),
        appleNotificationRequest.catch(() => undefined).then(() => getBillingReleaseGate(projectId)),
        getBillingCertificationRuns(projectId),
        getBillingLegacyInventory(projectId),
      ]);
      const failures: string[] = [];
      const failed = (name: string, reason: unknown) => failures.push(`${name}: ${reason instanceof Error ? reason.message : "unable to load"}`);
      if (nextOverview.status === "fulfilled") setOverview(nextOverview.value); else failed("Overview", nextOverview.reason);
      if (nextConnections.status === "fulfilled") setConnections(nextConnections.value.data || []); else failed("Stores", nextConnections.reason);
      if (nextAppleNotifications.status === "fulfilled") setAppleNotifications(nextAppleNotifications.value); else failed("Apple notifications", nextAppleNotifications.reason);
      if (nextTransactions.status === "fulfilled") setTransactions(nextTransactions.value.data || []); else failed("Transactions", nextTransactions.reason);
      if (nextSubscriptions.status === "fulfilled") setSubscriptions(nextSubscriptions.value.data || []); else failed("Subscriptions", nextSubscriptions.reason);
      if (nextPaywalls.status === "fulfilled") setPaywalls(nextPaywalls.value.data || []); else failed("Paywalls", nextPaywalls.reason);
      if (nextPlacements.status === "fulfilled") setPlacements(nextPlacements.value.data || []); else failed("Placements", nextPlacements.reason);
      if (nextTargeting.status === "fulfilled") setTargeting(nextTargeting.value.data || []); else failed("Targeting", nextTargeting.reason);
      if (nextExperiments.status === "fulfilled") setExperiments(nextExperiments.value.data || []); else failed("Experiments", nextExperiments.reason);
      if (nextAnalytics.status === "fulfilled") setAnalytics(nextAnalytics.value); else failed("Analytics", nextAnalytics.reason);
      if (nextHealth.status === "fulfilled") setHealth(nextHealth.value); else failed("Diagnostics", nextHealth.reason);
      if (nextProviderEvents.status === "fulfilled") setProviderEvents(nextProviderEvents.value.data || []); else failed("Provider events", nextProviderEvents.reason);
      if (nextDeliveries.status === "fulfilled") setDeliveries(nextDeliveries.value.data || []); else failed("Webhooks", nextDeliveries.reason);
      if (nextCurrencies.status === "fulfilled") setVirtualCurrencies(nextCurrencies.value.data || []); else failed("Currencies", nextCurrencies.reason);
      if (nextExports.status === "fulfilled") setExports(nextExports.value.data || []); else failed("Exports", nextExports.reason);
      if (nextRefundCases.status === "fulfilled") setRefundCases(nextRefundCases.value.data || []); else failed("Refund Center", nextRefundCases.reason);
      if (nextReleaseGate.status === "fulfilled") setReleaseGate(nextReleaseGate.value); else failed("Release gate", nextReleaseGate.reason);
      if (nextCertificationRuns.status === "fulfilled") {
        setCertificationRuns(nextCertificationRuns.value.runs || []);
        setSelectedCertificationRunId((current) => nextCertificationRuns.value.runs.some((item) => item.id === current && item.status === "running")
          ? current
          : nextCertificationRuns.value.runs.find((item) => item.status === "running")?.id || "");
      } else failed("Certification runs", nextCertificationRuns.reason);
      if (nextLegacyInventory.status === "fulfilled") {
        setLegacyInventory(nextLegacyInventory.value);
        if (nextLegacyInventory.value.source?.external_project_id) {
          setLegacyProjectId(nextLegacyInventory.value.source.external_project_id);
        }
      } else failed("Legacy inventory", nextLegacyInventory.reason);
      if (failures.length) showErrorNotification(failures.join(" · "));
    } catch (error) {
      showErrorNotification(error instanceof Error ? error.message : "Unable to load Purchases");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    setPackageId("weekly");
    setPackageType("weekly");
    setPackageOfferingId("");
    setPackageProductIds([]);
  }, [projectId]);

  const run = async <T,>(action: () => Promise<T>, success: string, refresh = true): Promise<T | undefined> => {
    try {
      const result = await action();
      showSuccessNotification(success);
      if (refresh) await load();
      return result;
    } catch (error) {
      showErrorNotification(error instanceof Error ? error.message : "The action failed");
      return undefined;
    }
  };

  const applyAppleNotificationConfiguration = async () => {
    if (!projectId) return;
    setConfiguringAppleNotifications(true);
    try {
      const result = await configureAppleNotificationConfiguration(projectId);
      setAppleNotifications(result.data);
      setAppleNotificationDialogOpen(false);
      showSuccessNotification(result.changed
        ? "App Store Server Notifications now point to the verified V2 ingress"
        : "App Store Server Notifications were already configured");
      await load();
    } catch (error) {
      showErrorNotification(error instanceof Error ? error.message : "Unable to configure App Store Server Notifications");
    } finally {
      setConfiguringAppleNotifications(false);
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const section = params.get("section");
    const supported = new Set(["overview", "stores", "products", "entitlements", "offerings", "paywalls", "customers", "transactions", "subscriptions", "refunds", "growth", "integrations", "diagnostics"]);
    if (section && supported.has(section)) setActiveSection(section);
    const refundCaseId = params.get("case");
    if (refundCaseId) void openRefundCase(refundCaseId);
  // The source link is evaluated again when the selected project changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

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
    if (!projectId || !providerSecret.trim() || !providerWebhookSecret.trim()) return;
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

  const mapActiveProductsToPremium = async () => {
    const entitlement = overview?.entitlements.find((item) => item.identifier === "premium" && item.active);
    const productIds = overview?.products.filter((item) => item.active && item.product_type === "subscription").map((item) => item.id) || [];
    if (!projectId || !entitlement || productIds.length === 0) return;
    await run(
      () => mapBillingProductsToEntitlement(projectId, entitlement.id, productIds),
      "Active subscription products mapped to Premium",
    );
  };

  const addPackage = async () => {
    const offering = overview?.offerings.find((item) => item.id === packageOfferingId)
      || overview?.offerings.find((item) => item.is_current)
      || overview?.offerings[0];
    if (!projectId || !offering || !packageId.trim() || packageProductIds.length === 0) return;
    await run(
      () => createBillingPackage(projectId, offering.id, {
        identifier: packageId.trim(),
        package_type: packageType,
        product_ids: packageProductIds,
      }),
      "Package created",
    );
    setPackageProductIds([]);
  };

  const resetGateCheck = async (checkKey: string) => {
    if (!projectId) return;
    await run(() => updateBillingReleaseGateCheck(projectId, checkKey, {
      status: "pending",
      evidence: {},
      notes: gateNotes.trim(),
    }), "Check reset");
  };

  const startCertificationRun = async () => {
    if (!projectId || !gateBuild.trim()) return;
    const created = await run(() => createBillingCertificationRun(projectId, {
      platform: gatePlatform,
      environment: gateEnvironment,
      build_number: gateBuild.trim(),
      device_model: gateDevice.trim(),
      os_version: gateOsVersion.trim(),
      app_version: gateAppVersion.trim(),
      sdk_version: gateSdkVersion.trim(),
      notes: gateNotes.trim(),
    }), "Certification run started");
    if (created) {
      setCertificationDeviceToken(created.device_claim_token || "");
      setCertificationDeviceTokenExpiresAt(created.device_claim_expires_at || "");
      setCertificationDeviceEndpoint(created.device_result_endpoint || "");
      const runs = await getBillingCertificationRuns(projectId);
      setCertificationRuns(runs.runs || []);
      setSelectedCertificationRunId(created.id);
    }
  };

  const rotateCertificationDeviceChallenge = async () => {
    if (!projectId || !selectedCertificationRunId) return;
    const challenge = await run(
      () => rotateBillingCertificationDeviceChallenge(projectId, selectedCertificationRunId),
      "Device challenge rotated",
      false,
    );
    if (!challenge) return;
    setCertificationDeviceToken(challenge.device_claim_token);
    setCertificationDeviceTokenExpiresAt(challenge.device_claim_expires_at);
    setCertificationDeviceEndpoint(challenge.device_result_endpoint);
  };

  const finishCertificationRun = async (status: "completed" | "failed" | "cancelled") => {
    if (!projectId || !selectedCertificationRunId) return;
    await run(
      () => completeBillingCertificationRun(projectId, selectedCertificationRunId, status),
      status === "completed" ? "Certification run completed" : `Certification run ${status}`,
    );
  };

  const recordCertificationResult = async (check: BillingReleaseGate["checks"][number], outcome: "passed" | "failed") => {
    if (!projectId || !selectedCertificationRunId) return;
    const referenceType = gateReferenceTypes[check.key] || check.reference_types[0];
    const referenceId = (gateReferences[check.key] || "").trim();
    if (!referenceType || !referenceId) {
      showErrorNotification("Select a reference type and enter a reference before recording the result");
      return;
    }
    await run(() => recordBillingCertificationObservation(projectId, selectedCertificationRunId, {
      check_key: check.key,
      outcome,
      reference_type: referenceType,
      reference_id: referenceId,
      notes: gateNotes.trim(),
    }), outcome === "passed" ? "Immutable certification result recorded" : "Certification failure recorded");
  };

  const connectLegacySource = async () => {
    if (!projectId || !legacyProjectId.trim() || !legacyApiKey.trim()) return;
    const connected = await run(async () => {
      await configureBillingLegacySource(projectId, {
        external_project_id: legacyProjectId.trim(),
        api_key: legacyApiKey.trim(),
      });
      await testBillingLegacySource(projectId);
      return true;
    }, "Legacy source connected");
    if (connected) setLegacyApiKey("");
  };

  const startLegacyInventory = async () => {
    if (!projectId) return;
    await run(
      () => startBillingLegacyInventory(projectId, projectType === "test" ? "sandbox" : "production"),
      "Verified legacy inventory queued",
    );
  };

  const metrics = overview?.metrics;
  const metricCards: Array<[string, string | number, LucideIcon]> = [
    ["Verified revenue", money(metrics?.revenue_micros), CreditCard],
    ["Paying customers", metrics?.paying_customers ?? 0, Users],
    ["Trials", metrics?.trials ?? 0, FlaskConical],
    ["Refunds", metrics?.refunds ?? 0, RefreshCw],
  ];

  const activeSubscriptionProducts = overview?.products.filter((item) => item.active && item.product_type === "subscription") || [];
  const premiumEntitlement = overview?.entitlements.find((item) => item.identifier === "premium" && item.active);
  const premiumProductIds = new Set((overview?.product_entitlements || [])
    .filter((item) => item.entitlement_id === premiumEntitlement?.id)
    .map((item) => item.product_id));
  const latestLegacyRun = legacyInventory?.runs[0];
  const legacyRunActive = latestLegacyRun?.status === "queued" || latestLegacyRun?.status === "running";
  const selectedCertificationRun = certificationRuns.find((item) => item.id === selectedCertificationRunId && item.status === "running");
  const terminalRefundCase = Boolean(refundCaseDetail && ["won", "lost", "closed"].includes(refundCaseDetail.refund_case.status));

  useEffect(() => {
    if (!legacyRunActive) return;
    const interval = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(interval);
  }, [legacyRunActive, load]);

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

        <Tabs value={activeSection} onValueChange={setActiveSection}>
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
            {appleNotifications && (
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <CardTitle>App Store Server Notifications</CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">Provider-signed V2 events must reach Billing directly before the purchase release gate can pass.</p>
                    </div>
                    {statusBadge(appleNotifications.ready ? "connected" : "configuration_required")}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {(["production", "sandbox"] as const).map((environment) => {
                    const currentUrl = appleNotifications.current[`${environment}_url`];
                    const requiredUrl = appleNotifications.required[`${environment}_url`];
                    const urlMatches = appleNotifications.checks[`${environment}_url`];
                    const versionMatches = appleNotifications.checks[`${environment}_version`];
                    return (
                      <div key={environment} className="rounded-md border p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="font-medium capitalize">{environment}</span>
                          {statusBadge(urlMatches && versionMatches ? "connected" : "configuration_required")}
                        </div>
                        <div className="grid gap-2 text-xs">
                          <div><span className="text-muted-foreground">Current destination</span><code className="mt-1 block break-all rounded bg-muted p-2">{currentUrl || "Not configured"}</code></div>
                          {!urlMatches && <div><span className="text-muted-foreground">Required URL</span><code className="mt-1 block break-all rounded bg-muted p-2">{requiredUrl}</code></div>}
                          <div className="flex items-center justify-between"><span>Notification version</span><span>{appleNotifications.current[`${environment}_version`] || "Not configured"} → V2</span></div>
                        </div>
                      </div>
                    );
                  })}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">The server verifies Apple’s signed payload before persisting or queueing any financial event.</p>
                    <Button disabled={appleNotifications.ready} onClick={() => setAppleNotificationDialogOpen(true)}>
                      {appleNotifications.ready ? "V2 endpoints configured" : "Configure V2 endpoints"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
            <Card><CardHeader><CardTitle>Add Stripe</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-3"><Input type="password" value={providerSecret} onChange={(event) => setProviderSecret(event.target.value)} placeholder={projectType === "test" ? "Stripe test secret key (sk_test_…)" : "Stripe live secret key (sk_live_…)"} autoComplete="new-password" /><Input type="password" value={providerWebhookSecret} onChange={(event) => setProviderWebhookSecret(event.target.value)} placeholder="Stripe webhook signing secret (whsec_…)" autoComplete="new-password" /><Button disabled={!providerSecret.trim() || !providerWebhookSecret.trim()} onClick={() => void saveWebConnection()}>Encrypt and save Stripe</Button></CardContent></Card>
          </TabsContent>

          <TabsContent value="products" className="space-y-4">
            <Card><CardHeader><CardTitle>App Store, Google Play, and Stripe catalog</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-2"><Button variant="outline" disabled={syncing} onClick={() => void syncProducts()}><CloudDownload className={`mr-2 h-4 w-4 ${syncing ? "animate-pulse" : ""}`} />{syncing ? "Importing…" : "Import Apple & Google"}</Button><Input className="max-w-sm" value={productId} onChange={(event) => setProductId(event.target.value)} placeholder={store === "stripe" ? "Stripe Price ID (price_…)" : "Store product ID"} /><select className="rounded-md border bg-background px-3" value={store} onChange={(event) => setStore(event.target.value)}><option value="apple">App Store</option><option value="google">Google Play</option><option value="stripe">Stripe</option></select><select className="rounded-md border bg-background px-3" value={productType} onChange={(event) => setProductType(event.target.value)}><option value="subscription">Subscription</option><option value="non_consumable">Lifetime</option><option value="consumable">Consumable</option></select><Button onClick={() => void addProduct()}>{store === "stripe" ? "Verify and import" : "Add"}</Button></CardContent></Card>
            <Card><CardContent className="pt-6"><Table><TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Store</TableHead><TableHead>Type</TableHead><TableHead>Environment</TableHead><TableHead>Catalog status</TableHead><TableHead>Provider readiness</TableHead><TableHead /></TableRow></TableHeader><TableBody>{overview?.products.map((product) => { const readiness = productProviderReadiness(product); return <TableRow key={product.id}><TableCell><div className="font-medium">{product.display_name}</div><div className="text-xs text-muted-foreground">{product.store_product_id}</div></TableCell><TableCell>{product.store}</TableCell><TableCell>{product.product_type}</TableCell><TableCell>{product.environment}</TableCell><TableCell>{product.active ? statusBadge("active") : statusBadge("archived")}</TableCell><TableCell>{readiness ? statusBadge(readiness) : "—"}</TableCell><TableCell><Button variant="outline" size="sm" onClick={() => projectId && void run(() => archiveBillingProduct(projectId, product.id), "Product archived")}>Archive</Button></TableCell></TableRow>; })}</TableBody></Table></CardContent></Card>
          </TabsContent>

          <TabsContent value="entitlements" className="space-y-4">
            <Card><CardHeader><CardTitle>Access rights</CardTitle></CardHeader><CardContent className="flex gap-2"><Input className="max-w-sm" value={entitlementId} onChange={(event) => setEntitlementId(event.target.value)} placeholder="premium" /><Button onClick={() => projectId && entitlementId.trim() && void run(() => createEntitlement(projectId, { identifier: entitlementId.trim(), display_name: entitlementId.trim() }), "Entitlement created")}>Create</Button></CardContent></Card>
            {premiumEntitlement && <Card><CardHeader><CardTitle>Premium product mapping</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm text-muted-foreground">Every active subscription product must grant the Premium entitlement after server verification.</p><div className="flex items-center justify-between gap-3"><span className="text-sm">{premiumProductIds.size} of {activeSubscriptionProducts.length} active products mapped</span><Button disabled={!activeSubscriptionProducts.length || activeSubscriptionProducts.every((item) => premiumProductIds.has(item.id))} onClick={() => void mapActiveProductsToPremium()}>Map active products</Button></div></CardContent></Card>}
            <div className="grid gap-3 md:grid-cols-2">{overview?.entitlements.map((item) => <Card key={item.id}><CardContent className="flex items-center justify-between pt-6"><div><div className="font-medium">{item.display_name}</div><div className="text-xs text-muted-foreground">{item.identifier}</div></div><Button variant="outline" size="sm" onClick={() => projectId && void run(() => archiveBillingEntitlement(projectId, item.id), "Entitlement archived")}>Archive</Button></CardContent></Card>)}</div>
          </TabsContent>

          <TabsContent value="offerings" className="space-y-4">
            <Card><CardHeader><CardTitle>Create an offering</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-2"><Input className="max-w-xs" value={offeringId} onChange={(event) => setOfferingId(event.target.value)} placeholder="default" /><Button onClick={() => projectId && void run(() => createOffering(projectId, { identifier: offeringId, display_name: offeringId, placement: "default", is_current: !overview?.offerings.length }), "Offering created")}>Create offering</Button></CardContent></Card>
            <Card><CardHeader><CardTitle>Create a package</CardTitle></CardHeader><CardContent className="space-y-4"><div className="grid gap-3 md:grid-cols-3"><Input value={packageId} onChange={(event) => setPackageId(event.target.value)} placeholder="Package identifier" /><select className="rounded-md border bg-background px-3" value={packageType} onChange={(event) => setPackageType(event.target.value)}><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="two_month">Two months</option><option value="three_month">Three months</option><option value="six_month">Six months</option><option value="annual">Annual</option><option value="lifetime">Lifetime</option><option value="custom">Custom</option></select><select className="rounded-md border bg-background px-3" value={packageOfferingId || overview?.offerings.find((item) => item.is_current)?.id || overview?.offerings[0]?.id || ""} onChange={(event) => setPackageOfferingId(event.target.value)}><option value="" disabled>Select an offering</option>{overview?.offerings.map((item) => <option key={item.id} value={item.id}>{item.display_name}{item.is_current ? " (current)" : ""}</option>)}</select></div><div className="grid gap-2 md:grid-cols-2">{activeSubscriptionProducts.map((product) => <label key={product.id} className="flex items-start gap-3 rounded-md border p-3 text-sm"><input type="checkbox" className="mt-1" checked={packageProductIds.includes(product.id)} onChange={(event) => setPackageProductIds((current) => event.target.checked ? [...current, product.id] : current.filter((id) => id !== product.id))} /><span><span className="block font-medium">{product.display_name}</span><span className="block text-xs text-muted-foreground">{product.store} · {product.store_product_id}</span></span></label>)}</div><Button variant="outline" disabled={!overview?.offerings.length || !packageId.trim() || !packageProductIds.length} onClick={() => void addPackage()}>Create package with selected products</Button></CardContent></Card>
            <div className="grid gap-3 md:grid-cols-2">{overview?.offerings.map((item) => <Card key={item.id}><CardContent className="flex items-start justify-between gap-3 pt-6"><div><div className="font-medium">{item.display_name}</div><div className="text-xs text-muted-foreground">{item.identifier} {item.is_current ? "· current" : ""}</div><div className="mt-2 space-y-1">{overview.packages.filter((entry) => entry.offering_id === item.id).map((entry) => <div key={entry.id} className="text-xs">{entry.identifier} · {entry.package_type} · {entry.product_ids.length} product(s)</div>)}</div></div><Button variant="outline" size="sm" onClick={() => projectId && void run(() => archiveBillingOffering(projectId, item.id), "Offering archived")}>Archive</Button></CardContent></Card>)}</div>
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
            <Alert>
              <ShieldAlert />
              <AlertTitle>Human approval required</AlertTitle>
              <AlertDescription>
                OpenGrow prepares evidence and provider actions. Nothing is sent to Apple, Google, or Stripe before an administrator approves it.
              </AlertDescription>
            </Alert>

            <div className="grid gap-4 xl:grid-cols-[1fr_440px]">
              <Card>
                <CardHeader><CardTitle>Refund and dispute cases</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Deadline</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Store</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {refundCases.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>{date(item.deadline_at)}</TableCell>
                          <TableCell>
                            <div>{item.primary_app_user_id || "—"}</div>
                            <div className="text-xs text-muted-foreground">{item.store_product_id || item.provider_case_id}</div>
                          </TableCell>
                          <TableCell>{item.provider} · {item.environment}</TableCell>
                          <TableCell>{item.case_type.replaceAll("_", " ")}</TableCell>
                          <TableCell>{statusBadge(item.status)}</TableCell>
                          <TableCell><Button size="sm" variant="outline" onClick={() => void openRefundCase(item.id)}>Open</Button></TableCell>
                        </TableRow>
                      ))}
                      {!refundCases.length && (
                        <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No refund case received.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <div className="space-y-4">
                <Card>
                  <CardHeader><CardTitle>Details and evidence</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    {refundCaseDetail ? (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{refundCaseDetail.refund_case.provider_case_id}</span>
                          {statusBadge(refundCaseDetail.refund_case.status)}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {refundCaseDetail.refund_case.reason || refundCaseDetail.refund_case.case_type.replaceAll("_", " ")}
                        </div>
                        {terminalRefundCase && (
                          <Alert>
                            <ShieldCheck />
                            <AlertTitle>Terminal case</AlertTitle>
                            <AlertDescription>Evidence and provider actions are locked because the provider has resolved this case.</AlertDescription>
                          </Alert>
                        )}
                        <Input
                          value={refundEvidenceType}
                          onChange={(event) => setRefundEvidenceType(event.target.value)}
                          placeholder="Evidence type"
                          disabled={terminalRefundCase}
                        />
                        <textarea
                          className="min-h-28 w-full rounded-md border bg-background px-3 py-2 text-sm"
                          value={refundEvidenceContent}
                          onChange={(event) => setRefundEvidenceContent(event.target.value)}
                          maxLength={20_000}
                          placeholder="Factual context, access history, and consumption details…"
                          disabled={terminalRefundCase}
                        />
                        <div className="text-right text-xs text-muted-foreground">{refundEvidenceContent.length}/20,000</div>
                        <Button className="w-full" disabled={terminalRefundCase || !refundEvidenceContent.trim()} onClick={() => void addRefundEvidence()}>
                          Add as draft
                        </Button>
                        {refundCaseDetail.evidence.map((evidence) => (
                          <div key={String(evidence.id)} className="rounded-md border p-3 text-sm">
                            <div className="flex items-center justify-between">
                              <span className="font-medium">{String(evidence.evidence_type).replaceAll("_", " ")}</span>
                              {statusBadge(evidence.review_status)}
                            </div>
                            <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{String(evidence.content || evidence.file_key || "")}</p>
                            {evidence.review_status === "draft" && !terminalRefundCase && (
                              <div className="mt-2 flex gap-2">
                                <Button size="sm" onClick={() => projectId && void run(async () => {
                                  await reviewBillingRefundEvidence(projectId, refundCaseDetail.refund_case.id, String(evidence.id), true);
                                  await openRefundCase(refundCaseDetail.refund_case.id);
                                }, "Evidence approved", false)}>Approve</Button>
                                <Button size="sm" variant="outline" onClick={() => projectId && void run(async () => {
                                  await reviewBillingRefundEvidence(projectId, refundCaseDetail.refund_case.id, String(evidence.id), false);
                                  await openRefundCase(refundCaseDetail.refund_case.id);
                                }, "Evidence rejected", false)}>Reject</Button>
                              </div>
                            )}
                          </div>
                        ))}
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">Open a case to prepare its response.</p>
                    )}
                  </CardContent>
                </Card>

                {refundCaseDetail && (
                  <Card>
                    <CardHeader><CardTitle>Provider actions</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex gap-2">
                        <select
                          className="min-h-9 flex-1 rounded-md border bg-background px-3 text-sm"
                          value={refundActionType}
                          disabled={terminalRefundCase}
                          onChange={(event) => {
                            const definition = refundCaseDetail.action_definitions.find((item) => item.action_type === event.target.value);
                            setRefundActionType(event.target.value);
                            if (definition) setRefundEvidenceType(definition.recommended_evidence_type);
                          }}
                        >
                          {refundCaseDetail.action_definitions.map((definition) => (
                            <option key={definition.action_type} value={definition.action_type}>{definition.action_type.replaceAll("_", " ")}</option>
                          ))}
                        </select>
                        <Button size="sm" variant="outline" disabled={terminalRefundCase || !refundActionType} onClick={() => void createRefundAction()}>
                          Prepare
                        </Button>
                      </div>
                      {refundCaseDetail.actions.map((action) => (
                        <div key={String(action.id)} className="rounded-md border p-3 text-sm">
                          <div className="flex items-center justify-between">
                            <span>{String(action.action_type).replaceAll("_", " ")}</span>
                            {statusBadge(action.status)}
                          </div>
                          {["draft", "failed"].includes(String(action.status)) && !terminalRefundCase && (
                            <>
                              <textarea
                                className="mt-2 min-h-36 w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
                                value={refundActionPayloads[String(action.id)] || "{}"}
                                onChange={(event) => setRefundActionPayloads((current) => ({
                                  ...current,
                                  [String(action.id)]: event.target.value,
                                }))}
                              />
                              <p className="mt-1 text-xs text-muted-foreground">
                                Apple requires explicit consent that is separate from ATT. Stripe evidence must be approved above.
                              </p>
                              <Button className="mt-2 w-full" size="sm" onClick={() => void saveAndApproveRefundAction(action)}>
                                {action.status === "failed" ? "Correct and retry" : "Approve and send"}
                              </Button>
                            </>
                          )}
                          {action.last_error && <p className="mt-2 text-xs text-destructive">{String(action.last_error)}</p>}
                          {action.sent_at && <p className="mt-2 text-xs text-muted-foreground">Sent on {date(action.sent_at)}</p>}
                        </div>
                      ))}
                      {!refundCaseDetail.actions.length && (
                        <p className="text-sm text-muted-foreground">
                          {terminalRefundCase ? "No provider action was recorded before this case became terminal." : "No action has been prepared. Choose a provider action above."}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}

                {refundCaseDetail && (
                  <Card>
                    <CardHeader><CardTitle>Deadlines and audit</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <h4 className="text-sm font-medium">Deadlines</h4>
                        {refundCaseDetail.deadlines.map((deadline) => (
                          <div key={String(deadline.id)} className="flex items-center justify-between rounded-md border p-2 text-sm">
                            <div>
                              <div>{String(deadline.deadline_type).replaceAll("_", " ")}</div>
                              <div className="text-xs text-muted-foreground">{date(deadline.due_at)}</div>
                            </div>
                            {statusBadge(deadline.status)}
                          </div>
                        ))}
                        {!refundCaseDetail.deadlines.length && <p className="text-xs text-muted-foreground">No provider deadline was supplied.</p>}
                      </div>
                      <div className="space-y-2">
                        <h4 className="text-sm font-medium">Immutable audit</h4>
                        {refundCaseDetail.audit_events.map((event) => (
                          <div key={String(event.id)} className="rounded-md border p-2 text-sm">
                            <div className="flex items-center justify-between gap-2">
                              <span>{String(event.event_type).replaceAll(".", " ").replaceAll("_", " ")}</span>
                              <span className="text-xs text-muted-foreground">{date(event.occurred_at)}</span>
                            </div>
                            <div className="text-xs text-muted-foreground">{String(event.actor_type || "system")}</div>
                          </div>
                        ))}
                        {!refundCaseDetail.audit_events.length && <p className="text-xs text-muted-foreground">No audit event has been recorded.</p>}
                      </div>
                    </CardContent>
                  </Card>
                )}
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
            <Alert variant={releaseGate?.ready ? "default" : "destructive"}>
              {releaseGate?.ready ? <ShieldCheck /> : <ShieldAlert />}
              <AlertTitle>{releaseGate?.ready ? "Purchases release gate passed" : "Purchases release gate is closed"}</AlertTitle>
              <AlertDescription>{releaseGate?.ready
                ? "Publication and legacy dependency removal are allowed by the verified backend policy."
                : `${releaseGate?.progress.passed || 0}/${releaseGate?.progress.total || 0} device and provider checks passed. Publication and legacy dependency removal remain blocked.`}</AlertDescription>
            </Alert>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Server className="h-5 w-5" />Billing Worker</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><div className="flex justify-between"><span>Dedicated routing</span><span>{releaseGate?.prerequisites.find((item) => item.key === "dedicated_billing_execution")?.passed ? "Ready" : "Blocked"}</span></div><div className="flex justify-between"><span>Worker readiness</span><span>{releaseGate?.operational_policy?.billing_worker?.ready_for_traffic ? "Ready" : "Blocked"}</span></div><div className="flex justify-between"><span>Credential copies</span><span>{releaseGate?.operational_policy?.billing_worker?.credential_copies_ready ? "Ready" : "Blocked"}</span></div><div className="flex justify-between"><span>Credential decryption</span><span>{releaseGate?.operational_policy?.billing_worker?.credential_decryption_ready ? "Ready" : "Blocked"}</span></div><div className="flex justify-between"><span>Signing authority</span><span>{releaseGate?.operational_policy?.billing_worker?.signing_authority_ready ? "Ready" : "Blocked"}</span></div><div className="flex justify-between"><span>Stale-work window</span><span>{releaseGate?.operational_policy?.stale_after_minutes ? `${releaseGate.operational_policy.stale_after_minutes} min` : "—"}</span></div></CardContent></Card>
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" />Events</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><div className="flex justify-between"><span>Last event</span><span>{date(health?.events?.last_event_at)}</span></div><div className="flex justify-between"><span>Pending</span><span>{String(health?.events?.pending_events || 0)}</span></div><div className="flex justify-between"><span>Failures</span><span>{String(health?.events?.failed_events || 0)}</span></div></CardContent></Card>
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><RefreshCw className="h-5 w-5" />Subscriptions</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><div className="flex justify-between"><span>Last provider verification</span><span>{date(health?.subscriptions?.last_reconciled_at)}</span></div><div className="flex justify-between"><span>Billing issues</span><span>{String(health?.subscriptions?.billing_issues || 0)}</span></div><div className="flex justify-between"><span>Verification failures</span><span>{String(health?.subscriptions?.verification_failures || 0)}</span></div><div className="flex justify-between"><span>Stale verifications</span><span>{String(health?.subscriptions?.stale_verifications || 0)}</span></div></CardContent></Card>
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><PlugZap className="h-5 w-5" />Webhooks</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><div className="flex justify-between"><span>Pending</span><span>{String(health?.deliveries?.pending_deliveries || 0)}</span></div><div className="flex justify-between"><span>Failures</span><span>{String(health?.deliveries?.failed_deliveries || 0)}</span></div></CardContent></Card>
            </div>
            <Card><CardHeader><CardTitle>Automated prerequisites</CardTitle></CardHeader><CardContent className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{releaseGate?.prerequisites.map((item) => <div key={item.key} className="rounded-md border p-3"><div className="flex items-center justify-between gap-2"><span className="font-medium">{item.label}</span><Badge variant={item.passed ? "default" : "destructive"}>{item.passed ? "passed" : "blocked"}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{item.detail}</p></div>)}</CardContent></Card>
            <Card><CardHeader><CardTitle>Provider event journal</CardTitle></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Received</TableHead><TableHead>Provider</TableHead><TableHead>Event</TableHead><TableHead>Attempts</TableHead><TableHead>Status</TableHead><TableHead>Error</TableHead><TableHead /></TableRow></TableHeader><TableBody>{providerEvents.map((item) => <TableRow key={item.id}><TableCell>{date(item.received_at)}</TableCell><TableCell>{item.store} · {item.environment}</TableCell><TableCell>{item.event_type || item.external_event_id}</TableCell><TableCell>{item.attempts}</TableCell><TableCell>{statusBadge(item.status)}</TableCell><TableCell className="max-w-sm truncate text-xs text-muted-foreground">{item.error_message || "—"}</TableCell><TableCell>{item.status === "failed" && Boolean(item.replay_available) && <Button size="sm" variant="outline" onClick={() => projectId && void run(() => replayBillingProviderEvent(projectId, item.id), "Provider event replay queued")}>Replay</Button>}</TableCell></TableRow>)}</TableBody></Table>{!providerEvents.length && <p className="py-6 text-center text-sm text-muted-foreground">No provider event has been received.</p>}</CardContent></Card>
            <Card>
              <CardHeader><CardTitle>Verified legacy subscription migration</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Inventory the existing RevenueCat project with a read-only V2 secret key. Access is imported only after a matching Apple, Google Play, or Stripe subscription has been verified by OpenGrow.
                </p>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <Input placeholder="RevenueCat project ID" value={legacyProjectId} onChange={(event) => setLegacyProjectId(event.target.value)} />
                  <Input type="password" autoComplete="off" placeholder="RevenueCat V2 secret key" value={legacyApiKey} onChange={(event) => setLegacyApiKey(event.target.value)} />
                  <Button disabled={legacyRunActive || !legacyProjectId.trim() || !legacyApiKey.trim()} onClick={() => void connectLegacySource()}>Save and test</Button>
                  <Button variant="outline" disabled={legacyInventory?.source?.status !== "connected" || legacyRunActive} onClick={() => void startLegacyInventory()}>
                    {legacyRunActive ? "Inventory running" : "Run verified inventory"}
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span>Connection: {statusBadge(legacyInventory?.source?.status || "not_configured")}</span>
                  {legacyInventory?.source?.status === "connected" && <Button size="sm" variant="ghost" onClick={() => projectId && void run(() => testBillingLegacySource(projectId), "Legacy connection verified")}>Retest</Button>}
                  {legacyInventory?.source && legacyInventory.source.status !== "disabled" && <Button size="sm" variant="ghost" disabled={legacyRunActive} onClick={() => projectId && void run(() => disableBillingLegacySource(projectId), "Legacy credentials destroyed")}>Disconnect and destroy key</Button>}
                  <span className="text-xs text-muted-foreground">The secret is encrypted separately for the API and Billing execution domains.</span>
                </div>
                {latestLegacyRun && <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
                  {([
                    ["Status", latestLegacyRun.status],
                    ["Customers", latestLegacyRun.customers_scanned],
                    ["Active", latestLegacyRun.active_subscriptions],
                    ["Matched", latestLegacyRun.matched_subscriptions],
                    ["Unresolved", latestLegacyRun.unresolved_subscriptions],
                    ["Unsupported", latestLegacyRun.unsupported_subscriptions],
                  ] as Array<[string, string | number]>).map(([label, value]) => <div key={label} className="rounded-md border p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 font-medium">{String(value)}</div></div>)}
                </div>}
                {latestLegacyRun && <p className="text-xs text-muted-foreground">Run reference: {latestLegacyRun.id}</p>}
                {latestLegacyRun?.last_error_message && <p className="text-sm text-destructive">{latestLegacyRun.last_error_message}</p>}
                {legacyInventory?.unresolved.length ? <Table>
                  <TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Store</TableHead><TableHead>Product</TableHead><TableHead>Expiration</TableHead><TableHead>Resolution</TableHead></TableRow></TableHeader>
                  <TableBody>{legacyInventory.unresolved.map((item) => <TableRow key={item.external_subscription_id}>
                    <TableCell><div>{item.app_user_id || "Unmatched"}</div><div className="text-xs text-muted-foreground">{item.external_customer_id}</div></TableCell>
                    <TableCell>{item.provider} · {item.environment}</TableCell>
                    <TableCell>{item.store_product_id || "Unknown"}</TableCell>
                    <TableCell>{date(item.source_expires_at)}</TableCell>
                    <TableCell><div>{statusBadge(item.resolution_status)}</div><div className="mt-1 max-w-md text-xs text-muted-foreground">{item.resolution_detail}</div></TableCell>
                  </TableRow>)}</TableBody>
                </Table> : latestLegacyRun?.status === "completed" && <p className="text-sm text-muted-foreground">No unresolved active legacy subscription remains.</p>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><FlaskConical className="h-5 w-5" />Immutable certification runs</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <Alert><ShieldCheck /><AlertTitle>Evidence is linked to a run</AlertTitle><AlertDescription>Passed checks require an immutable observation from a completed run. Transaction and event references are verified against Billing records before they are accepted.</AlertDescription></Alert>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <select aria-label="Certification platform" className="h-9 rounded-md border bg-background px-3 text-sm" value={gatePlatform} onChange={(event) => setGatePlatform(event.target.value as typeof gatePlatform)}>
                    <option value="ios">iOS</option><option value="android">Android</option><option value="web">Web</option><option value="cross_platform">Cross-platform</option>
                  </select>
                  <select aria-label="Certification environment" className="h-9 rounded-md border bg-background px-3 text-sm" value={gateEnvironment} onChange={(event) => setGateEnvironment(event.target.value as typeof gateEnvironment)}>
                    <option value="sandbox">Sandbox / test</option><option value="production">Production inventory</option>
                  </select>
                  <Input placeholder="Build number" value={gateBuild} onChange={(event) => setGateBuild(event.target.value)} />
                  <Input placeholder="App version" value={gateAppVersion} onChange={(event) => setGateAppVersion(event.target.value)} />
                  <Input placeholder="Device model" value={gateDevice} onChange={(event) => setGateDevice(event.target.value)} />
                  <Input placeholder="OS version" value={gateOsVersion} onChange={(event) => setGateOsVersion(event.target.value)} />
                  <Input placeholder="Purchases SDK version" value={gateSdkVersion} onChange={(event) => setGateSdkVersion(event.target.value)} />
                  <Input placeholder="Run notes" value={gateNotes} onChange={(event) => setGateNotes(event.target.value)} />
                </div>
                <Button disabled={!gateBuild.trim()} onClick={() => void startCertificationRun()}><FlaskConical className="mr-2 h-4 w-4" />Start certification run</Button>
                <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
                  <label className="grid gap-1 text-sm">Active run<select className="h-9 rounded-md border bg-background px-3" value={selectedCertificationRunId} onChange={(event) => { setSelectedCertificationRunId(event.target.value); setCertificationDeviceToken(""); setCertificationDeviceTokenExpiresAt(""); setCertificationDeviceEndpoint(""); }}><option value="">Select a running certification</option>{certificationRuns.filter((item) => item.status === "running").map((item) => <option key={item.id} value={item.id}>{item.platform} · build {item.build_number} · {date(item.started_at)}</option>)}</select></label>
                  <div className="flex items-end gap-2"><Button variant="outline" disabled={!selectedCertificationRun} onClick={() => void rotateCertificationDeviceChallenge()}>Generate device token</Button><Button variant="outline" disabled={!selectedCertificationRun} onClick={() => void finishCertificationRun("completed")}>Complete run</Button><Button variant="ghost" disabled={!selectedCertificationRun} onClick={() => void finishCertificationRun("cancelled")}>Cancel</Button></div>
                </div>
                {certificationDeviceToken && selectedCertificationRun && <Alert><ShieldCheck /><AlertTitle>Authenticated device challenge</AlertTitle><AlertDescription><p>Use this one-time dashboard value in the FlutterFlow or Web certification action. It is bound to the active run, expires at {date(certificationDeviceTokenExpiresAt)}, and is never shown again after leaving this selection.</p><div className="mt-3 grid gap-2"><div className="flex gap-2"><Input readOnly value={selectedCertificationRun.id} aria-label="Certification run ID" /><Button variant="outline" size="icon" aria-label="Copy certification run ID" onClick={() => void navigator.clipboard.writeText(selectedCertificationRun.id)}><Copy className="h-4 w-4" /></Button></div><div className="flex gap-2"><Input readOnly type="password" value={certificationDeviceToken} aria-label="Device challenge" /><Button variant="outline" size="icon" aria-label="Copy device challenge" onClick={() => void navigator.clipboard.writeText(certificationDeviceToken)}><Copy className="h-4 w-4" /></Button></div>{certificationDeviceEndpoint && <code className="block break-all rounded bg-muted p-2 text-xs">{certificationDeviceEndpoint}</code>}</div></AlertDescription></Alert>}
                {certificationRuns.slice(0, 5).map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"><div><span className="font-medium">{item.platform} build {item.build_number}</span><div className="text-xs text-muted-foreground">{item.environment} · {item.observation_count || 0} observations · {item.device_result_count || 0} authenticated device results · {item.id}</div></div>{statusBadge(item.status)}</div>)}
              </CardContent>
            </Card>
            {[...new Set(releaseGate?.checks.map((check) => check.group) || [])].map((group) => <Card key={group}><CardHeader><CardTitle>{group}</CardTitle></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Scenario</TableHead><TableHead>Evidence</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Review</TableHead></TableRow></TableHeader><TableBody>{releaseGate?.checks.filter((check) => check.group === group).map((check) => <TableRow key={check.key}><TableCell><div className="font-medium">{check.label}</div><div className="max-w-2xl text-xs text-muted-foreground">{check.description}</div><div className="mt-1 text-xs text-muted-foreground">Required evidence: {check.required_evidence.join(", ")}</div></TableCell><TableCell><div className="text-xs">{check.verified_at ? date(check.verified_at) : "Not verified"}</div>{Object.entries(check.evidence).map(([key, value]) => <div key={key} className="max-w-sm truncate text-xs text-muted-foreground" title={String(value)}><span className="font-medium">{key}:</span> {String(value)}</div>)}{check.status === "passed" && !check.evidence_valid && <div className="text-xs text-destructive">Missing evidence: {check.missing_evidence.join(", ")}</div>}{check.notes && <div className="max-w-xs truncate text-xs text-muted-foreground">{check.notes}</div>}{selectedCertificationRun && <div className="mt-2 grid gap-2"><select aria-label={`${check.label} reference type`} className="h-8 rounded-md border bg-background px-2 text-xs" value={gateReferenceTypes[check.key] || check.reference_types[0]} onChange={(event) => setGateReferenceTypes((current) => ({ ...current, [check.key]: event.target.value as BillingCertificationReferenceType }))}>{check.reference_types.map((item) => <option key={item} value={item}>{item === "test_run" ? "authenticated device result" : item.replaceAll("_", " ")}</option>)}</select><Input className="h-8 text-xs" placeholder={(gateReferenceTypes[check.key] || check.reference_types[0]) === "test_run" ? "Authenticated device result ID" : "Verified Billing record ID"} value={gateReferences[check.key] || ""} onChange={(event) => setGateReferences((current) => ({ ...current, [check.key]: event.target.value }))} /></div>}</TableCell><TableCell>{statusBadge(check.status === "passed" && !check.evidence_valid ? "invalid" : check.status)}</TableCell><TableCell><div className="flex justify-end gap-1"><Button size="sm" variant="outline" disabled={!selectedCertificationRun} onClick={() => void recordCertificationResult(check, "passed")}>Pass</Button><Button size="sm" variant="outline" disabled={!selectedCertificationRun} onClick={() => void recordCertificationResult(check, "failed")}>Fail</Button>{check.status !== "pending" && <Button size="sm" variant="ghost" onClick={() => void resetGateCheck(check.key)}>Reset</Button>}</div></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>)}
          </TabsContent>
        </Tabs>
        <Dialog open={appleNotificationDialogOpen} onOpenChange={setAppleNotificationDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Switch App Store notifications to Billing?</DialogTitle>
              <DialogDescription>
                This updates both production and sandbox URLs in App Store Connect. New V2 purchase, renewal, expiration, and refund events will be delivered directly to the verified Billing ingress.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <Alert variant="destructive">
                <ShieldAlert />
                <AlertTitle>Live Store configuration</AlertTitle>
                <AlertDescription>The previous notification destinations will be replaced. The change is recorded in the immutable administrator audit log.</AlertDescription>
              </Alert>
              {appleNotifications && (
                <div className="space-y-2">
                  <code className="block break-all rounded bg-muted p-2 text-xs">{appleNotifications.required.production_url}</code>
                  <code className="block break-all rounded bg-muted p-2 text-xs">{appleNotifications.required.sandbox_url}</code>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" disabled={configuringAppleNotifications} onClick={() => setAppleNotificationDialogOpen(false)}>Cancel</Button>
              <Button disabled={configuringAppleNotifications} onClick={() => void applyAppleNotificationConfiguration()}>
                {configuringAppleNotifications ? "Configuring…" : "Confirm and configure V2"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
};

export default PurchasesPage;
