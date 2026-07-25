"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, Package, RefreshCw, ShieldCheck, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import AppHeader from "@/components/layout/app-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProjectSelection } from "@/context/useProjectSelection";
import {
  createEntitlement,
  createBillingPackage,
  createOffering,
  createProduct,
  getBillingOverview,
  searchBillingCustomers,
  testBillingCredentials,
  updateBillingSettings,
  type BillingOverview,
} from "@/api/billing/billingService";
import { showErrorNotification, showSuccessNotification } from "@/lib/Notifications";

const PurchasesPage = () => {
  const { selectedProject } = useProjectSelection();
  const [overview, setOverview] = useState<BillingOverview>();
  const [loading, setLoading] = useState(false);
  const [entitlementId, setEntitlementId] = useState("premium");
  const [productId, setProductId] = useState("");
  const [store, setStore] = useState<"apple" | "google">("apple");
  const [productType, setProductType] = useState("subscription");
  const [customerQuery, setCustomerQuery] = useState("");
  const [offeringId, setOfferingId] = useState("default");
  const [packageId, setPackageId] = useState("monthly");
  const [customers, setCustomers] = useState<Array<Record<string, unknown>>>([]);
  const [credentialTests, setCredentialTests] = useState<
    Partial<Record<"ios" | "android", "passed" | "failed">>
  >({});

  const load = useCallback(async () => {
    if (!selectedProject?.id) return;
    setLoading(true);
    try {
      setOverview(await getBillingOverview(selectedProject.id));
    } catch (error) {
      showErrorNotification(error instanceof Error ? error.message : "Unable to load Purchases");
    } finally {
      setLoading(false);
    }
  }, [selectedProject?.id]);

  useEffect(() => { void load(); }, [load]);

  const enable = async () => {
    if (!selectedProject?.id) return;
    await updateBillingSettings(selectedProject.id, { purchases_enabled: true, restore_behavior: "transfer" });
    showSuccessNotification("OpenGrow Purchases enabled");
    await load();
  };

  const addEntitlement = async () => {
    if (!selectedProject?.id || !entitlementId.trim()) return;
    await createEntitlement(selectedProject.id, { identifier: entitlementId.trim(), display_name: entitlementId.trim() });
    setEntitlementId("");
    await load();
  };

  const addProduct = async () => {
    if (!selectedProject?.id || !productId.trim()) return;
    await createProduct(selectedProject.id, {
      store,
      store_product_id: productId.trim(),
      product_type: productType,
      display_name: productId.trim(),
      entitlement_ids: overview?.entitlements.map((value) => value.id) ?? [],
    });
    setProductId("");
    await load();
  };

  const searchCustomers = async () => {
    if (!selectedProject?.id) return;
    const result = await searchBillingCustomers(selectedProject.id, customerQuery);
    setCustomers(result.data ?? []);
  };

  const testCredentials = async (platform: "ios" | "android") => {
    if (!selectedProject?.id) return;
    try {
      await testBillingCredentials(selectedProject.id, platform);
      setCredentialTests((current) => ({ ...current, [platform]: "passed" }));
      showSuccessNotification(`${platform === "ios" ? "App Store" : "Google Play"} credentials verified`);
    } catch (error) {
      setCredentialTests((current) => ({ ...current, [platform]: "failed" }));
      showErrorNotification(error instanceof Error ? error.message : "Credential test failed");
    }
  };

  const addOffering = async () => {
    if (!selectedProject?.id || !offeringId.trim()) return;
    await createOffering(selectedProject.id, {
      identifier: offeringId.trim(),
      display_name: offeringId.trim(),
      placement: "default",
      is_current: overview?.offerings.length === 0,
    });
    await load();
  };

  const addPackage = async () => {
    if (!selectedProject?.id || !overview?.offerings[0] || !packageId.trim()) return;
    await createBillingPackage(selectedProject.id, overview.offerings[0].id, {
      identifier: packageId.trim(),
      package_type: packageId.trim(),
      product_ids: overview.products.map((value) => value.id),
    });
    setPackageId("");
    showSuccessNotification("Package created and mapped to the store products");
  };

  const metrics = overview?.metrics;
  const metricCards: Array<[string, string | number, LucideIcon]> = [
    ["Revenu vérifié", `${(Number(metrics?.revenue_micros ?? 0) / 1_000_000).toFixed(2)}`, CreditCard],
    ["Clients payants", metrics?.paying_customers ?? 0, Users],
    ["Essais", metrics?.trials ?? 0, Package],
    ["Remboursements", metrics?.refunds ?? 0, RefreshCw],
  ];
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <AppHeader titleOverride="Purchases" />
      <main className="flex-1 overflow-auto p-6 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">OpenGrow Purchases</h1>
            <p className="text-sm text-muted-foreground">Produits, droits, offres et clients vérifiés par Apple et Google.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void testCredentials("ios")}>Tester Apple</Button>
            <Button variant="outline" onClick={() => void testCredentials("android")}>Tester Google</Button>
            <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Actualiser</Button>
            {!overview?.settings?.purchases_enabled && <Button onClick={() => void enable()}><ShieldCheck className="mr-2 h-4 w-4" />Activer</Button>}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          {metricCards.map(([label, value, Icon]) => (
            <Card key={String(label)}><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{String(label)}</CardTitle></CardHeader><CardContent className="flex items-center justify-between"><span className="text-2xl font-semibold">{String(value)}</span><Icon className="h-5 w-5 text-muted-foreground" /></CardContent></Card>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {(["ios", "android"] as const).map((platform) => {
            const value = overview?.credentials?.[platform];
            const label = platform === "ios" ? "App Store Connect" : "Google Play";
            const detail =
              platform === "ios"
                ? value && "key_id" in value
                  ? value.key_id
                  : null
                : value && "client_email" in value
                  ? value.client_email
                  : null;
            return (
              <Card key={platform}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{label}</CardTitle>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-4">
                  <div>
                    <div className={value?.configured ? "text-sm text-emerald-600" : "text-sm text-amber-600"}>
                      {value?.configured ? "Identifiants configurés" : "Configuration requise"}
                    </div>
                    {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
                    {credentialTests[platform] && (
                      <div className={credentialTests[platform] === "passed" ? "text-xs text-emerald-600" : "text-xs text-destructive"}>
                        Dernier test : {credentialTests[platform] === "passed" ? "réussi" : "échoué"}
                      </div>
                    )}
                  </div>
                  <Button variant="outline" onClick={() => void testCredentials(platform)}>
                    Tester
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Tabs defaultValue="catalog">
          <TabsList><TabsTrigger value="catalog">Catalogue</TabsTrigger><TabsTrigger value="entitlements">Entitlements</TabsTrigger><TabsTrigger value="offerings">Offres</TabsTrigger><TabsTrigger value="customers">Clients</TabsTrigger></TabsList>
          <TabsContent value="catalog" className="space-y-4">
            <Card><CardHeader><CardTitle>Ajouter un produit store</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-2"><Input className="max-w-sm" value={productId} onChange={(event) => setProductId(event.target.value)} placeholder="com.app.premium.monthly" /><select className="rounded-md border bg-background px-3" value={store} onChange={(event) => setStore(event.target.value as "apple" | "google")}><option value="apple">App Store</option><option value="google">Google Play</option></select><select className="rounded-md border bg-background px-3" value={productType} onChange={(event) => setProductType(event.target.value)}><option value="subscription">Abonnement</option><option value="non_consumable">Lifetime</option><option value="consumable">Consommable</option></select><Button onClick={() => void addProduct()}>Ajouter</Button></CardContent></Card>
            <Card><CardContent className="pt-6 space-y-2">{overview?.products.map((product) => <div key={product.id} className="flex justify-between rounded-md border p-3"><div><div className="font-medium">{product.display_name}</div><div className="text-xs text-muted-foreground">{product.store_product_id}</div></div><div className="text-sm">{product.store} · {product.product_type} · {product.environment}</div></div>)}</CardContent></Card>
          </TabsContent>
          <TabsContent value="entitlements" className="space-y-4">
            <Card><CardHeader><CardTitle>Créer un droit</CardTitle></CardHeader><CardContent className="flex gap-2"><Input className="max-w-sm" value={entitlementId} onChange={(event) => setEntitlementId(event.target.value)} placeholder="premium" /><Button onClick={() => void addEntitlement()}>Créer</Button></CardContent></Card>
            <Card><CardContent className="pt-6 space-y-2">{overview?.entitlements.map((item) => <div key={item.id} className="rounded-md border p-3"><div className="font-medium">{item.display_name}</div><div className="text-xs text-muted-foreground">{item.identifier}</div></div>)}</CardContent></Card>
          </TabsContent>
          <TabsContent value="offerings" className="space-y-4"><Card><CardHeader><CardTitle>Créer une offre</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-2"><Input className="max-w-sm" value={offeringId} onChange={(event) => setOfferingId(event.target.value)} placeholder="default" /><Button onClick={() => void addOffering()}>Créer l’offre</Button><Input className="max-w-sm" value={packageId} onChange={(event) => setPackageId(event.target.value)} placeholder="monthly" /><Button variant="outline" onClick={() => void addPackage()} disabled={!overview?.offerings.length || !overview?.products.length}>Ajouter le package</Button></CardContent></Card><Card><CardContent className="pt-6 space-y-2">{overview?.offerings.length ? overview.offerings.map((item) => <div key={item.id} className="rounded-md border p-3">{item.display_name} {item.is_current ? "· actuelle" : ""}</div>) : <p className="text-sm text-muted-foreground">Créez une offre, puis mappez ses packages aux produits Apple et Google.</p>}</CardContent></Card></TabsContent>
          <TabsContent value="customers" className="space-y-4"><Card><CardHeader><CardTitle>Rechercher un client</CardTitle></CardHeader><CardContent className="flex gap-2"><Input value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} placeholder="App User ID" /><Button onClick={() => void searchCustomers()}>Rechercher</Button></CardContent></Card><Card><CardContent className="pt-6 space-y-2">{customers.map((customer) => <div key={String(customer.id)} className="rounded-md border p-3"><div className="font-medium">{String(customer.primary_app_user_id)}</div><div className="text-xs text-muted-foreground">{String(customer.aliases ?? "")}</div></div>)}</CardContent></Card></TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default PurchasesPage;
