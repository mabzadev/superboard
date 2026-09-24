"use client";

import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import {
	showErrorNotification,
	showSuccessNotification,
} from "@superboard/front-ui/lib/Notifications.js";
import {
	EmptyProject,
	ModulePage,
	moduleErrorMessage,
} from "@superboard/front-ui/modules/ModulePage.js";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@superboard/front-ui/ui/card.js";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@superboard/front-ui/ui/dialog.js";
import { Input } from "@superboard/front-ui/ui/input.js";
import { Switch } from "@superboard/front-ui/ui/switch.js";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@superboard/front-ui/ui/table.js";
import { Tabs, TabsList, TabsTrigger } from "@superboard/front-ui/ui/tabs.js";
import { Archive, Check, Eye, Pencil, Plus, RefreshCw, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useMonetizationI18n } from "../../../i18n.js";
import {
	archiveEntitlement,
	archiveOffering,
	archiveProduct,
	createEntitlement,
	createOffering,
	createPackage,
	createProduct,
	createPurchase,
	createRefund,
	getEntitlements,
	getOfferings,
	getPackages,
	getPurchase,
	getProducts,
	getProductStatistics,
	getPurchases,
	getSubscriptions,
	updateEntitlement,
	updateOffering,
	updatePackage,
	updateProduct,
	updateSubscription,
	type Entitlement,
	type Offering,
	type Product,
	type ProductPackage,
	type ProductStatistics,
	type Purchase,
	type PurchaseDetail,
	type Subscription,
} from "../../api/products/productsService.js";

const selectClass = "h-9 w-full rounded-md border bg-background px-3 text-sm";
const asIdentifier = (value: string) => value.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
const enabled = (value: number | boolean) => value === true || value === 1;
const money = (micros = 0, currency = "USD") =>
	new Intl.NumberFormat(undefined, { style: "currency", currency }).format(micros / 1_000_000);
const dateTime = (value?: string | null) => (value ? new Date(value).toLocaleString() : "—");
const defaultFrom = () => new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

export function PurchasesPage() {
	const { t, locale } = useMonetizationI18n();
	const { selectedProject } = useProjectSelection();
	const [items, setItems] = useState<Purchase[]>([]);
	const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
	const [products, setProducts] = useState<Product[]>([]);
	const [statistics, setStatistics] = useState<ProductStatistics | null>(null);
	const [purchaseDetail, setPurchaseDetail] = useState<PurchaseDetail>();
	const [filters, setFilters] = useState({
		from: defaultFrom(),
		to: today(),
		status: "",
		customer_id: "",
		product_id: "",
		store: "",
	});
	const [customerId, setCustomerId] = useState("");
	const [productId, setProductId] = useState("");
	const [store, setStore] = useState("manual");
	const [transactionId, setTransactionId] = useState("");
	const [price, setPrice] = useState("0");
	const [currency, setCurrency] = useState("USD");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		if (!selectedProject) return;
		setLoading(true);
		try {
			const [purchases, catalog, stats, activeSubscriptions] = await Promise.all([
				getPurchases(selectedProject.id, {
					status: filters.status,
					customer_id: filters.customer_id.trim(),
					product_id: filters.product_id,
					store: filters.store,
					from: filters.from,
					to: filters.to,
				}),
				getProducts(selectedProject.id),
				getProductStatistics(selectedProject.id, {
					from: filters.from,
					to: filters.to,
					product_id: filters.product_id,
					platform: filters.store,
				}),
				getSubscriptions(selectedProject.id, {
					customer_id: filters.customer_id.trim(),
				}),
			]);
			setItems(purchases);
			setProducts(catalog);
			setStatistics(stats);
			setSubscriptions(activeSubscriptions);
			setProductId(
				(current) => current || catalog.find((item) => item.status === "active")?.id || "",
			);
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause));
		} finally {
			setLoading(false);
		}
	}, [filters, selectedProject]);

	useEffect(() => void load(), [load]);

	const recordPurchase = async () => {
		if (!selectedProject || !customerId || !productId || !transactionId) return;
		try {
			await createPurchase(selectedProject.id, {
				financial_customer_id: customerId,
				product_id: productId,
				store,
				environment: "sandbox",
				external_transaction_id: transactionId,
				original_transaction_id: transactionId,
				status: "active",
				purchased_at: new Date().toISOString(),
				purchased_price_micros: Math.round(Number(price) * 1_000_000),
				currency: currency.toUpperCase(),
				payload: { source: "dashboard" },
			});
			setTransactionId("");
			showSuccessNotification(t("Sandbox purchase recorded"));
			await load();
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		}
	};

	const refund = async (purchase: Purchase) => {
		if (!selectedProject) return;
		try {
			await createRefund(selectedProject.id, purchase.id, {
				status: "completed",
				amount_micros: purchase.purchased_price_micros,
				currency: purchase.currency,
				reason: "Dashboard refund",
				requested_at: new Date().toISOString(),
				completed_at: new Date().toISOString(),
				metadata: { source: "dashboard" },
			});
			showSuccessNotification(t("Purchase refunded"));
			await load();
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		}
	};

	const showPurchase = async (purchaseId: string) => {
		if (!selectedProject) return;
		try {
			setPurchaseDetail(await getPurchase(selectedProject.id, purchaseId));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		}
	};

	const changeSubscription = async (subscription: Subscription, status: Subscription["status"]) => {
		if (!selectedProject) return;
		try {
			await updateSubscription(selectedProject.id, subscription.id, {
				status,
				current_period_started_at: subscription.current_period_started_at,
				current_period_ends_at: subscription.current_period_ends_at,
				auto_renew: status === "active",
				cancelled_at: status === "cancelled" ? new Date().toISOString() : null,
			});
			showSuccessNotification(
				status === "active" ? t("Subscription restored") : t("Subscription cancelled"),
			);
			await load();
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		}
	};

	const totals = statistics?.totals;
	return (
		<ModulePage
			title={t("Purchases")}
			description={t("Purchases, subscriptions, restorations, refunds and financial history.")}
			error={error}
		>
			<a href={`/monetization/settings?tab=general&lang=${locale}`}>{t("Purchase settings")}</a>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<div className="space-y-6">
					<Card>
						<CardHeader>
							<CardTitle>{t("Filters")}</CardTitle>
							<CardDescription>
								{t("Results stay scoped to the selected project and environment.")}
							</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
							<LabeledInput
								label={t("From")}
								type="date"
								value={filters.from}
								onChange={(from) => setFilters((value) => ({ ...value, from }))}
							/>
							<LabeledInput
								label={t("To")}
								type="date"
								value={filters.to}
								onChange={(to) => setFilters((value) => ({ ...value, to }))}
							/>
							<LabeledInput
								label={t("Financial customer")}
								value={filters.customer_id}
								placeholder={t("customer_123")}
								onChange={(customer_id) => setFilters((value) => ({ ...value, customer_id }))}
							/>
							<LabeledSelect
								label={t("Product")}
								value={filters.product_id}
								onChange={(product_id) => setFilters((value) => ({ ...value, product_id }))}
								options={products.map((item) => ({
									value: item.id,
									label: item.display_name,
								}))}
								empty={t("All products")}
							/>
							<LabeledSelect
								label={t("Store")}
								value={filters.store}
								onChange={(store) => setFilters((value) => ({ ...value, store }))}
								options={["apple", "google", "stripe", "manual"].map((value) => ({
									value,
									label: t(value),
								}))}
								empty={t("All stores")}
							/>
							<LabeledSelect
								label={t("Status")}
								value={filters.status}
								onChange={(status) => setFilters((value) => ({ ...value, status }))}
								options={["pending", "active", "expired", "cancelled", "refunded", "failed"].map(
									(value) => ({ value, label: value }),
								)}
								empty={t("All statuses")}
							/>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>{t("Revenue by product and platform")}</CardTitle>
							<CardDescription>
								{t(
									"Legacy Revenue metrics reassigned to Purchases, calculated server-side for the selected period.",
								)}
							</CardDescription>
						</CardHeader>
						<CardContent className="overflow-x-auto">
							<DataTable
								headers={[
									t("Product"),
									t("Platform"),
									t("Units sold"),
									t("First-time purchases"),
									t("Total revenue"),
									t("Cancellations"),
								]}
								empty={t("No product revenue in this period.")}
							>
								{(statistics?.by_product_platform ?? []).map((row) => (
									<TableRow key={`${row.product_id}:${row.platform}:${row.currency}`}>
										<TableCell>
											<b>{row.product_name}</b>
										</TableCell>
										<TableCell className="capitalize">
											{row.platform}
											<span className="block text-xs text-muted-foreground">{row.store}</span>
										</TableCell>
										<TableCell>{Number(row.units_sold).toLocaleString(locale)}</TableCell>
										<TableCell>{Number(row.first_time_purchases).toLocaleString(locale)}</TableCell>
										<TableCell>
											{money(Number(row.revenue_micros), row.currency || "USD")}
										</TableCell>
										<TableCell>{Number(row.cancellations).toLocaleString(locale)}</TableCell>
									</TableRow>
								))}
							</DataTable>
						</CardContent>
					</Card>

					<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
						<Metric label={t("Purchases")} value={String(totals?.purchases ?? 0)} />
						<Metric
							label={t("Active subscriptions")}
							value={String(totals?.active_subscriptions ?? 0)}
						/>
						<Metric label={t("Gross revenue")} value={money(totals?.gross_revenue_micros)} />
						<Metric label={t("Refunded")} value={money(totals?.refunded_micros)} />
						<Metric label={t("Net revenue")} value={money(totals?.net_revenue_micros)} />
						<Metric label={t("Refunds")} value={String(totals?.refunds ?? 0)} />
					</div>

					<Card>
						<CardHeader className="flex-row items-center justify-between gap-3">
							<div>
								<CardTitle>{t("Revenue timeline")}</CardTitle>
								<CardDescription>{t("Daily volume and gross revenue.")}</CardDescription>
							</div>
							<Button
								variant="outline"
								size="icon"
								aria-label={t("Refresh purchases")}
								disabled={loading}
								onClick={() => void load()}
							>
								<RefreshCw className={loading ? "animate-spin" : ""} />
							</Button>
						</CardHeader>
						<CardContent>
							<DataTable
								headers={[t("Date"), t("Purchases"), t("Revenue")]}
								empty={t("No financial activity in this period.")}
							>
								{(statistics?.series ?? []).map((row) => (
									<TableRow key={row.bucket}>
										<TableCell>{row.bucket}</TableCell>
										<TableCell>{row.purchases.toLocaleString(locale)}</TableCell>
										<TableCell>{money(row.revenue_micros)}</TableCell>
									</TableRow>
								))}
							</DataTable>
						</CardContent>
					</Card>

					<div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
						<Card>
							<CardHeader>
								<CardTitle>{t("Record sandbox purchase")}</CardTitle>
								<CardDescription>
									{t(
										"Validate catalog, entitlement and subscription flows without touching a live store.",
									)}
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-3">
								<Input
									placeholder={t("Financial customer ID")}
									value={customerId}
									onChange={(event) => setCustomerId(event.target.value)}
								/>
								<select
									aria-label={t("Product")}
									className={selectClass}
									value={productId}
									onChange={(event) => setProductId(event.target.value)}
								>
									<option value="">{t("Select a product")}</option>
									{products
										.filter((item) => item.status === "active")
										.map((item) => (
											<option key={item.id} value={item.id}>
												{item.display_name}
											</option>
										))}
								</select>
								<select
									aria-label={t("Store")}
									className={selectClass}
									value={store}
									onChange={(event) => setStore(event.target.value)}
								>
									<option value="manual">{t("Manual")}</option>
									<option value="apple">{t("Apple")}</option>
									<option value="google">{t("Google")}</option>
									<option value="stripe">{t("Stripe")}</option>
								</select>
								<Input
									placeholder={t("External transaction ID")}
									value={transactionId}
									onChange={(event) => setTransactionId(event.target.value)}
								/>
								<div className="grid grid-cols-[1fr_90px] gap-2">
									<Input
										type="number"
										min="0"
										step="0.01"
										placeholder={t("Price")}
										value={price}
										onChange={(event) => setPrice(event.target.value)}
									/>
									<Input
										aria-label={t("Currency")}
										maxLength={3}
										value={currency}
										onChange={(event) => setCurrency(event.target.value.toUpperCase())}
									/>
								</div>
								<Button
									className="w-full"
									disabled={!customerId || !productId || !transactionId || Number(price) < 0}
									onClick={() => void recordPurchase()}
								>
									<Plus />
									{t("Record purchase")}
								</Button>
							</CardContent>
						</Card>
						<Card>
							<CardHeader>
								<CardTitle>{t("Purchase history")}</CardTitle>
								<CardDescription>
									{t("{count} matching transactions", { count: items.length })}
								</CardDescription>
							</CardHeader>
							<CardContent className="overflow-x-auto">
								<DataTable
									headers={[
										t("Product"),
										t("Customer"),
										t("Store"),
										t("Status"),
										t("Purchased"),
										t("Expires"),
										t("Amount"),
										"",
									]}
									empty={t("No purchases match these filters.")}
								>
									{items.map((item) => (
										<TableRow key={item.id}>
											<TableCell>
												<b>{item.product_name || item.product_identifier || item.product_id}</b>
												<code className="block max-w-40 truncate text-xs text-muted-foreground">
													{item.external_transaction_id}
												</code>
											</TableCell>
											<TableCell>{item.external_customer_id}</TableCell>
											<TableCell className="capitalize">
												{item.store}
												<span className="block text-xs text-muted-foreground">
													{item.environment}
												</span>
											</TableCell>
											<TableCell>
												<StatusBadge status={item.status} />
											</TableCell>
											<TableCell>{dateTime(item.purchased_at)}</TableCell>
											<TableCell>{dateTime(item.expires_at)}</TableCell>
											<TableCell>
												{money(item.purchased_price_micros, item.currency || "USD")}
											</TableCell>
											<TableCell>
												<div className="flex gap-1">
													<Button
														variant="ghost"
														size="icon"
														aria-label={t("View purchase {transaction}", {
															transaction: item.external_transaction_id,
														})}
														onClick={() => void showPurchase(item.id)}
													>
														<Eye />
													</Button>
													<Button
														variant="outline"
														size="sm"
														disabled={item.status === "refunded"}
														onClick={() => void refund(item)}
													>
														<RotateCcw />
														{t("Refund")}
													</Button>
												</div>
											</TableCell>
										</TableRow>
									))}
								</DataTable>
							</CardContent>
						</Card>
					</div>

					{purchaseDetail && (
						<Card>
							<CardHeader className="flex-row items-start justify-between gap-3">
								<div>
									<CardTitle>{t("Purchase detail")}</CardTitle>
									<CardDescription>
										{purchaseDetail.external_transaction_id} · {purchaseDetail.external_customer_id}
									</CardDescription>
								</div>
								<Button
									variant="ghost"
									size="icon"
									aria-label={t("Close purchase detail")}
									onClick={() => setPurchaseDetail(undefined)}
								>
									<X />
								</Button>
							</CardHeader>
							<CardContent className="grid gap-6 lg:grid-cols-2">
								<div>
									<p className="mb-2 text-sm font-medium">{t("Granted entitlements")}</p>
									<div className="space-y-2">
										{purchaseDetail.entitlements.map((item) => (
											<div key={item.id} className="rounded-md border p-3">
												<b>{item.display_name}</b>
												<code className="ml-2 text-xs text-muted-foreground">
													{item.identifier}
												</code>
											</div>
										))}
										{!purchaseDetail.entitlements.length && (
											<p className="text-sm text-muted-foreground">
												{t("No entitlement was granted.")}
											</p>
										)}
									</div>
								</div>
								<div>
									<p className="mb-2 text-sm font-medium">{t("Refund history")}</p>
									<div className="space-y-2">
										{purchaseDetail.refunds.map((item) => (
											<div
												key={item.id}
												className="flex items-center justify-between rounded-md border p-3"
											>
												<span>
													<StatusBadge status={item.status} />
													<span className="ml-2 text-xs text-muted-foreground">
														{item.reason || t("No reason")}
													</span>
												</span>
												<b>
													{money(
														item.amount_micros,
														item.currency || purchaseDetail.currency || "USD",
													)}
												</b>
											</div>
										))}
										{!purchaseDetail.refunds.length && (
											<p className="text-sm text-muted-foreground">{t("No refunds recorded.")}</p>
										)}
									</div>
								</div>
							</CardContent>
						</Card>
					)}

					<Card>
						<CardHeader>
							<CardTitle>{t("Subscriptions")}</CardTitle>
							<CardDescription>
								{t("Current periods, renewals, cancellation and restoration state.")}
							</CardDescription>
						</CardHeader>
						<CardContent className="overflow-x-auto">
							<DataTable
								headers={[
									t("Product"),
									t("Customer"),
									t("Status"),
									t("Period end"),
									t("Renewal"),
									t("Updated"),
									"",
								]}
								empty={t("No subscriptions match this customer.")}
							>
								{subscriptions.map((item) => (
									<TableRow key={item.id}>
										<TableCell>
											{item.product_name || item.product_identifier || item.product_id}
										</TableCell>
										<TableCell>{item.external_customer_id}</TableCell>
										<TableCell>
											<StatusBadge status={item.status} />
										</TableCell>
										<TableCell>{dateTime(item.current_period_ends_at)}</TableCell>
										<TableCell>{enabled(item.auto_renew) ? t("Auto-renew") : t("Off")}</TableCell>
										<TableCell>{dateTime(item.updated_at)}</TableCell>
										<TableCell>
											{item.status === "cancelled" || item.status === "expired" ? (
												<Button
													size="sm"
													variant="outline"
													onClick={() => void changeSubscription(item, "active")}
												>
													<RotateCcw />
													{t("Restore")}
												</Button>
											) : (
												<Button
													size="sm"
													variant="outline"
													onClick={() => void changeSubscription(item, "cancelled")}
												>
													<X />
													{t("Cancel")}
												</Button>
											)}
										</TableCell>
									</TableRow>
								))}
							</DataTable>
						</CardContent>
					</Card>
				</div>
			)}
		</ModulePage>
	);
}

type ProductForm = {
	identifier: string;
	name: string;
	description: string;
	type: Product["product_type"];
	status: Product["status"];
};
type PackageForm = {
	identifier: string;
	name: string;
	description: string;
	productId: string;
	position: number;
	active: boolean;
};
type OfferingForm = {
	identifier: string;
	name: string;
	description: string;
	placement: string;
	priority: number;
	packageIds: string[];
	active: boolean;
};
const emptyProduct = (): ProductForm => ({
	identifier: "",
	name: "",
	description: "",
	type: "subscription",
	status: "active",
});
const emptyPackage = (): PackageForm => ({
	identifier: "",
	name: "",
	description: "",
	productId: "",
	position: 0,
	active: true,
});
const emptyOffering = (): OfferingForm => ({
	identifier: "",
	name: "",
	description: "",
	placement: "default",
	priority: 100,
	packageIds: [],
	active: true,
});

export function ProductsPage() {
	const { t, locale } = useMonetizationI18n();
	const { selectedProject } = useProjectSelection();
	const [products, setProducts] = useState<Product[]>([]);
	const [productForm, setProductForm] = useState<ProductForm>(emptyProduct);
	const [editing, setEditing] = useState<{ id: string }>();
	const [modal, setModal] = useState<{
		isEdit: boolean;
		platform?: "ios" | "android" | "test";
	} | null>(null);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		if (!selectedProject) return;
		try {
			const catalog = await getProducts(selectedProject.id);
			setProducts(catalog);
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause));
		}
	}, [selectedProject]);

	useEffect(() => {
		let active = true;
		if (!selectedProject) return;
		getProducts(selectedProject.id)
			.then((catalog) => {
				if (!active) return;
				setProducts(catalog);
				setError(null);
			})
			.catch((cause: unknown) => {
				if (!active) return;
				setError(moduleErrorMessage(cause));
			});
		return () => {
			active = false;
		};
	}, [selectedProject]);

	const run = async (action: () => Promise<unknown>, success: string, reset?: () => void) => {
		try {
			await action();
			reset?.();
			setEditing(undefined);
			setModal(null);
			showSuccessNotification(success);
			await load();
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		}
	};

	const saveProduct = () =>
		selectedProject &&
		run(
			() =>
				editing
					? updateProduct(selectedProject.id, editing.id, {
							identifier: productForm.identifier,
							display_name: productForm.name,
							description: productForm.description || null,
							product_type: productForm.type,
							status: productForm.status,
						})
					: createProduct(selectedProject.id, {
							identifier: productForm.identifier,
							display_name: productForm.name,
							description: productForm.description || null,
							product_type: productForm.type,
							status: productForm.status,
						}),
			editing ? t("Product updated") : t("Product created"),
			() => setProductForm(emptyProduct()),
		);

	const startProductEdit = (item: Product) => {
		setEditing({ id: item.id });
		setProductForm({
			identifier: item.identifier,
			name: item.display_name,
			description: item.description || "",
			type: item.product_type,
			status: item.status,
		});
		setModal({ isEdit: true });
	};

	const openCreateModal = (platform?: "ios" | "android" | "test") => {
		setEditing(undefined);
		setProductForm({
			identifier:
				platform === "ios"
					? "apple_"
					: platform === "android"
						? "google_"
						: platform === "test"
							? "test_"
							: "",
			name: platform === "test" ? "Special Test Product" : "",
			description: platform === "test" ? "Sandbox / simulator test product" : "",
			type: "subscription",
			status: "active",
		});
		setModal({ isEdit: false, platform });
	};

	const cancelEdit = () => {
		setEditing(undefined);
		setModal(null);
		setProductForm(emptyProduct());
	};

	const isIosProduct = (item: Product) => {
		const text = `${item.identifier} ${item.display_name}`.toLowerCase();
		return text.includes("apple") || text.includes("ios");
	};

	const isAndroidProduct = (item: Product) => {
		if (isIosProduct(item)) return false;
		const text = `${item.identifier} ${item.display_name}`.toLowerCase();
		return text.includes("google") || text.includes("android") || text.includes("play");
	};

	const isTestProduct = (item: Product) => {
		return !isIosProduct(item) && !isAndroidProduct(item);
	};

	const iosProducts = products.filter(isIosProduct);
	const androidProducts = products.filter(isAndroidProduct);
	const testProducts = products.filter(isTestProduct);

	return (
		<ModulePage
			title={t("Products")}
			description={t("Manage the store product catalog.")}
			error={error}
		>
			<a href={`/monetization/settings?tab=products&lang=${locale}`}>{t("Product settings")}</a>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<Trans>
					<div className="space-y-8">
						<div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
							<div className="flex items-center gap-2">
								<Badge variant="outline">iOS ({iosProducts.length})</Badge>
								<Badge variant="outline">Android ({androidProducts.length})</Badge>
								<Badge variant="outline">Test ({testProducts.length})</Badge>
							</div>
							<div className="flex items-center gap-2">
								<Button
									size="sm"
									onClick={() => {
										openCreateModal();
									}}
								>
									<Plus className="size-4" />
									{t("Product")}
								</Button>
							</div>
						</div>

						{/* 1. iOS Section */}
						<div className="space-y-4">
							<CatalogTable
								title={t("iOS (Apple App Store)")}
								headers={[t("Product"), t("Identifier"), t("Type"), t("Status"), ""]}
								empty={t("No iOS products configured.")}
								action={
									<Button
										size="sm"
										variant="outline"
										onClick={() => {
											openCreateModal("ios");
										}}
									>
										<Plus className="size-4" />
										{t("New iOS product")}
									</Button>
								}
							>
								{iosProducts.map((item) => (
									<TableRow key={item.id}>
										<TableCell>
											<b>{item.display_name}</b>
											{item.description && (
												<span className="block text-xs text-muted-foreground">
													{item.description}
												</span>
											)}
										</TableCell>
										<TableCell>
											<code>{item.identifier}</code>
										</TableCell>
										<TableCell className="capitalize">
											{t(
												item.product_type === "subscription"
													? "Subscription"
													: item.product_type === "non_consumable"
														? "Non-consumable"
														: "Consumable",
											)}
										</TableCell>
										<TableCell>
											<StatusBadge status={item.status} />
										</TableCell>
										<TableCell>
											<RowActions
												onEdit={() => startProductEdit(item)}
												onArchive={
													item.status !== "archived"
														? () =>
																selectedProject &&
																void run(
																	() => archiveProduct(selectedProject.id, item.id),
																	t("Product archived"),
																)
														: undefined
												}
											/>
										</TableCell>
									</TableRow>
								))}
							</CatalogTable>
						</div>

						{/* 2. Android Section */}
						<div className="space-y-4">
							<CatalogTable
								title={t("Android (Google Play)")}
								headers={[t("Product"), t("Identifier"), t("Type"), t("Status"), ""]}
								empty={t("No Android products configured.")}
								action={
									<Button
										size="sm"
										variant="outline"
										onClick={() => {
											openCreateModal("android");
										}}
									>
										<Plus className="size-4" />
										{t("New Android product")}
									</Button>
								}
							>
								{androidProducts.map((item) => (
									<TableRow key={item.id}>
										<TableCell>
											<b>{item.display_name}</b>
											{item.description && (
												<span className="block text-xs text-muted-foreground">
													{item.description}
												</span>
											)}
										</TableCell>
										<TableCell>
											<code>{item.identifier}</code>
										</TableCell>
										<TableCell className="capitalize">
											{t(
												item.product_type === "subscription"
													? "Subscription"
													: item.product_type === "non_consumable"
														? "Non-consumable"
														: "Consumable",
											)}
										</TableCell>
										<TableCell>
											<StatusBadge status={item.status} />
										</TableCell>
										<TableCell>
											<RowActions
												onEdit={() => {
													startProductEdit(item);
												}}
												onArchive={
													item.status !== "archived"
														? () =>
																selectedProject &&
																void run(
																	() => archiveProduct(selectedProject.id, item.id),
																	t("Product archived"),
																)
														: undefined
												}
											/>
										</TableCell>
									</TableRow>
								))}
							</CatalogTable>
						</div>

						{/* 3. Test Section */}
						<div className="space-y-4">
							<Card className="border-primary/30 bg-muted/20">
								<CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
									<div>
										<CardTitle className="text-base font-semibold">
											{t("Special Test Product")}
										</CardTitle>
										<CardDescription>
											{t(
												"Dedicated sandbox products allow simulation of purchases and entitlements in development and test environments.",
											)}
										</CardDescription>
									</div>
									<Button
										size="sm"
										onClick={() => {
											openCreateModal("test");
										}}
									>
										<Plus className="size-4" />
										{t("Create Special Test Product")}
									</Button>
								</CardHeader>
							</Card>

							<CatalogTable
								title={t("Test & Sandbox Products")}
								headers={[t("Product"), t("Identifier"), t("Type"), t("Status"), ""]}
								empty={t("No test products configured yet.")}
								action={
									<Button
										size="sm"
										variant="outline"
										onClick={() => {
											openCreateModal("test");
										}}
									>
										<Plus className="size-4" />
										{t("New test product")}
									</Button>
								}
							>
								{testProducts.map((item) => (
									<TableRow key={item.id}>
										<TableCell>
											<b>{item.display_name}</b>
											{item.description && (
												<span className="block text-xs text-muted-foreground">
													{item.description}
												</span>
											)}
										</TableCell>
										<TableCell>
											<code>{item.identifier}</code>
										</TableCell>
										<TableCell className="capitalize">
											{t(
												item.product_type === "subscription"
													? "Subscription"
													: item.product_type === "non_consumable"
														? "Non-consumable"
														: "Consumable",
											)}
										</TableCell>
										<TableCell>
											<StatusBadge status={item.status} />
										</TableCell>
										<TableCell>
											<RowActions
												onEdit={() => {
													startProductEdit(item);
												}}
												onArchive={
													item.status !== "archived"
														? () =>
																selectedProject &&
																void run(
																	() => archiveProduct(selectedProject.id, item.id),
																	t("Product archived"),
																)
														: undefined
												}
											/>
										</TableCell>
									</TableRow>
								))}
							</CatalogTable>
						</div>

						{/* Product Dialog */}
						<Dialog
							open={modal !== null}
							onOpenChange={(open) => {
								if (!open) cancelEdit();
							}}
						>
							<DialogContent className="sm:max-w-lg">
								<DialogHeader>
									<DialogTitle>
										{modal?.isEdit ? t("Edit product") : t("Create product")}
									</DialogTitle>
									<DialogDescription>{t("A purchasable catalog item")}</DialogDescription>
								</DialogHeader>

								<div className="space-y-4 py-2">
									<LabeledInput
										label={t("Identifier")}
										placeholder={t("e.g. premium_monthly")}
										value={productForm.identifier}
										onChange={(val) => {
											setProductForm((prev) => ({
												...prev,
												identifier: asIdentifier(val),
											}));
										}}
									/>
									<LabeledInput
										label={t("Display name")}
										placeholder={t("e.g. Premium Monthly")}
										value={productForm.name}
										onChange={(val) => {
											setProductForm((prev) => ({ ...prev, name: val }));
										}}
									/>
									<LabeledInput
										label={t("Description")}
										placeholder={t("Optional description")}
										value={productForm.description}
										onChange={(val) => {
											setProductForm((prev) => ({ ...prev, description: val }));
										}}
									/>
									<label className="block space-y-1 text-xs">
										<span className="font-medium">{t("Product type")}</span>
										<select
											aria-label={t("Product type")}
											className={selectClass}
											value={productForm.type}
											onChange={(event) => {
												setProductForm((prev) => ({
													...prev,
													type: event.target.value as Product["product_type"],
												}));
											}}
										>
											<option value="subscription">{t("Subscription")}</option>
											<option value="non_consumable">{t("Non-consumable")}</option>
											<option value="consumable">{t("Consumable")}</option>
										</select>
									</label>
									<label className="block space-y-1 text-xs">
										<span className="font-medium">{t("Status")}</span>
										<select
											aria-label={t("Status")}
											className={selectClass}
											value={productForm.status}
											onChange={(event) => {
												setProductForm((prev) => ({
													...prev,
													status: event.target.value as Product["status"],
												}));
											}}
										>
											<option value="draft">{t("Draft")}</option>
											<option value="active">{t("Active")}</option>
											<option value="archived">{t("Archived")}</option>
										</select>
									</label>
									<DialogFooter className="pt-2">
										<Button variant="outline" onClick={cancelEdit}>
											{t("Cancel")}
										</Button>
										<Button
											disabled={!productForm.identifier || !productForm.name}
											onClick={() => void saveProduct()}
										>
											{modal?.isEdit ? <Check className="size-4" /> : <Plus className="size-4" />}
											{modal?.isEdit ? t("Save product") : t("Create product")}
										</Button>
									</DialogFooter>
								</div>
							</DialogContent>
						</Dialog>
					</div>
				</Trans>
			)}
		</ModulePage>
	);
}

export function OfferingsPage() {
	const { t } = useMonetizationI18n();
	const { selectedProject } = useProjectSelection();
	const [products, setProducts] = useState<Product[]>([]);
	const [packages, setPackages] = useState<ProductPackage[]>([]);
	const [offerings, setOfferings] = useState<Offering[]>([]);
	const [packageForm, setPackageForm] = useState<PackageForm>(emptyPackage);
	const [offeringForm, setOfferingForm] = useState<OfferingForm>(emptyOffering);
	const [editing, setEditing] = useState<{
		kind: "package" | "offering";
		id: string;
	}>();
	const [modal, setModal] = useState<{
		kind: "package" | "offering";
		isEdit: boolean;
		platform?: "ios" | "android" | "test";
	} | null>(null);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		if (!selectedProject) return;
		try {
			const [catalog, configuredPackages, configuredOfferings] = await Promise.all([
				getProducts(selectedProject.id),
				getPackages(selectedProject.id),
				getOfferings(selectedProject.id),
			]);
			setProducts(catalog);
			setPackages(configuredPackages);
			setOfferings(configuredOfferings);
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause));
		}
	}, [selectedProject]);
	useEffect(() => void load(), [load]);

	const run = async (action: () => Promise<unknown>, success: string, reset?: () => void) => {
		try {
			await action();
			reset?.();
			setEditing(undefined);
			setModal(null);
			showSuccessNotification(success);
			await load();
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		}
	};
	const savePackage = () =>
		selectedProject &&
		run(
			() =>
				editing?.kind === "package"
					? updatePackage(selectedProject.id, editing.id, {
							identifier: packageForm.identifier,
							display_name: packageForm.name,
							description: packageForm.description || null,
							product_id: packageForm.productId || null,
							position: packageForm.position,
							active: packageForm.active,
						})
					: createPackage(selectedProject.id, {
							identifier: packageForm.identifier,
							display_name: packageForm.name,
							description: packageForm.description || null,
							product_id: packageForm.productId || null,
							position: packageForm.position,
							active: packageForm.active,
						}),
			editing ? t("Package updated") : t("Package created"),
			() => setPackageForm(emptyPackage()),
		);
	const saveOffering = () =>
		selectedProject &&
		run(
			() =>
				editing?.kind === "offering"
					? updateOffering(selectedProject.id, editing.id, {
							identifier: offeringForm.identifier,
							display_name: offeringForm.name,
							description: offeringForm.description || null,
							placement: offeringForm.placement,
							priority: offeringForm.priority,
							active: offeringForm.active,
							package_ids: offeringForm.packageIds,
						})
					: createOffering(selectedProject.id, {
							identifier: offeringForm.identifier,
							display_name: offeringForm.name,
							description: offeringForm.description || null,
							placement: offeringForm.placement,
							priority: offeringForm.priority,
							active: offeringForm.active,
							package_ids: offeringForm.packageIds,
						}),
			editing ? t("Offering updated") : t("Offering created"),
			() => setOfferingForm(emptyOffering()),
		);
	const openCreateModal = (kind: "package" | "offering", platform?: "ios" | "android" | "test") => {
		setEditing(undefined);
		if (kind === "package") {
			setPackageForm({
				identifier:
					platform === "ios"
						? "apple_"
						: platform === "android"
							? "google_"
							: platform === "test"
								? "test_package"
								: "",
				name: platform === "test" ? "Special Test Package" : "",
				description: platform === "test" ? "Sandbox / simulator test package" : "",
				productId: "",
				position: 0,
				active: true,
			});
		} else if (kind === "offering") {
			setOfferingForm({
				identifier: platform === "test" ? "test_default" : "",
				name: platform === "test" ? "Test Offering" : "",
				description: "",
				placement:
					platform === "ios"
						? "ios"
						: platform === "android"
							? "android"
							: platform === "test"
								? "test"
								: "default",
				priority: 100,
				packageIds: [],
				active: true,
			});
		}
		setModal({ kind, isEdit: false, platform });
	};
	const cancelEdit = () => {
		setEditing(undefined);
		setModal(null);
		setPackageForm(emptyPackage());
		setOfferingForm(emptyOffering());
	};

	return (
		<ModulePage
			title={t("Offerings")}
			description={t("Manage packages and SDK-resolved offerings.")}
			error={error}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<Trans>
					<div className="space-y-8">
						<div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
							<div className="flex items-center gap-2">
								<Badge variant="outline">
									{offerings.length} {t("Offerings")}
								</Badge>
							</div>
							<div className="flex items-center gap-2">
								<Button
									size="sm"
									onClick={() => {
										openCreateModal("offering");
									}}
								>
									<Plus className="size-4" />
									{t("Offering")}
								</Button>
							</div>
						</div>

						{/* Offerings Section */}
						<div className="space-y-4">
							<CatalogTable
								title={t("Offerings (SDK Placements)")}
								headers={[
									t("Offering"),
									t("Identifier"),
									t("Placement"),
									t("Priority"),
									t("Packages"),
									t("State"),
									"",
								]}
								empty={t("No offerings configured.")}
								action={
									<Button
										size="sm"
										onClick={() => {
											openCreateModal("offering");
										}}
									>
										<Plus className="size-4" />
										{t("New offering")}
									</Button>
								}
							>
								{offerings.map((item) => (
									<TableRow key={item.id}>
										<TableCell>
											<b>{item.display_name}</b>
											{item.description && (
												<span className="block text-xs text-muted-foreground">
													{item.description}
												</span>
											)}
										</TableCell>
										<TableCell>
											<code>{item.identifier}</code>
										</TableCell>
										<TableCell>{item.placement}</TableCell>
										<TableCell>{item.priority}</TableCell>
										<TableCell>
											{item.package_ids?.length ?? 0} {t("Packages")}
										</TableCell>
										<TableCell>
											<StatusBadge status={enabled(item.active) ? "active" : "archived"} />
										</TableCell>
										<TableCell>
											<RowActions
												onEdit={() => {
													setEditing({ kind: "offering", id: item.id });
													setOfferingForm({
														identifier: item.identifier,
														name: item.display_name,
														description: item.description || "",
														placement: item.placement,
														priority: item.priority,
														packageIds: item.package_ids || [],
														active: enabled(item.active),
													});
													setModal({ kind: "offering", isEdit: true });
												}}
												onArchive={
													enabled(item.active)
														? () =>
																selectedProject &&
																void run(
																	() => archiveOffering(selectedProject.id, item.id),
																	t("Offering archived"),
																)
														: undefined
												}
											/>
										</TableCell>
									</TableRow>
								))}
							</CatalogTable>
						</div>

						{/* Dialog modal for creating / editing */}
						<Dialog
							open={modal !== null}
							onOpenChange={(open) => {
								if (!open) cancelEdit();
							}}
						>
							<DialogContent className="sm:max-w-lg">
								<DialogHeader>
									<DialogTitle>
										{modal?.isEdit
											? modal.kind === "package"
												? t("Edit package")
												: t("Edit offering")
											: modal?.kind === "package" && modal.platform === "test"
												? t("Create special test package")
												: modal?.kind === "package"
													? t("Create package")
													: t("Create offering")}
									</DialogTitle>
									<DialogDescription>
										{modal?.kind === "package" &&
											(modal.platform === "test"
												? t("Special package for testing without store credentials")
												: t("Connect a product to an offering"))}
										{modal?.kind === "offering" && t("Resolve packages for an SDK placement")}
									</DialogDescription>
								</DialogHeader>

								{modal?.kind === "package" && (
									<div className="space-y-4 py-2">
										<LabeledInput
											label={t("Identifier")}
											placeholder={t("e.g. demo_premium_apple_1m")}
											value={packageForm.identifier}
											onChange={(val) => {
												setPackageForm((prev) => ({
													...prev,
													identifier: asIdentifier(val),
												}));
											}}
										/>
										<LabeledInput
											label={t("Display name")}
											placeholder={t("e.g. Premium iOS — 1 mois")}
											value={packageForm.name}
											onChange={(val) => {
												setPackageForm((prev) => ({ ...prev, name: val }));
											}}
										/>
										<LabeledInput
											label={t("Description")}
											placeholder={t("Optional description")}
											value={packageForm.description}
											onChange={(val) => {
												setPackageForm((prev) => ({ ...prev, description: val }));
											}}
										/>
										<label className="block space-y-1 text-xs">
											<span className="font-medium">{t("Package product")}</span>
											<select
												aria-label={t("Package product")}
												className={selectClass}
												value={packageForm.productId}
												onChange={(event) => {
													setPackageForm((prev) => ({
														...prev,
														productId: event.target.value,
													}));
												}}
											>
												<option value="">{t("No product (standalone / test package)")}</option>
												{products
													.filter((item) => item.status === "active")
													.map((item) => (
														<option key={item.id} value={item.id}>
															{item.display_name} ({item.identifier})
														</option>
													))}
											</select>
										</label>
										<LabeledInput
											label={t("Position")}
											type="number"
											min="0"
											value={String(packageForm.position)}
											onChange={(val) => {
												setPackageForm((prev) => ({
													...prev,
													position: Number(val),
												}));
											}}
										/>
										<div className="flex items-center gap-2 pt-1 text-sm">
											<Switch
												id="package-active"
												checked={packageForm.active}
												onCheckedChange={(active) => {
													setPackageForm((prev) => ({ ...prev, active }));
												}}
											/>
											<label htmlFor="package-active">{t("Active")}</label>
										</div>
										<DialogFooter className="pt-2">
											<Button variant="outline" onClick={cancelEdit}>
												{t("Cancel")}
											</Button>
											<Button
												disabled={!packageForm.identifier || !packageForm.name}
												onClick={() => void savePackage()}
											>
												{modal.isEdit ? <Check className="size-4" /> : <Plus className="size-4" />}
												{modal.isEdit ? t("Save package") : t("Create package")}
											</Button>
										</DialogFooter>
									</div>
								)}

								{modal?.kind === "offering" && (
									<div className="space-y-4 py-2">
										<LabeledInput
											label={t("Identifier")}
											placeholder={t("e.g. demo_default")}
											value={offeringForm.identifier}
											onChange={(val) => {
												setOfferingForm((prev) => ({
													...prev,
													identifier: asIdentifier(val),
												}));
											}}
										/>
										<LabeledInput
											label={t("Display name")}
											placeholder={t("e.g. Default Offering")}
											value={offeringForm.name}
											onChange={(val) => {
												setOfferingForm((prev) => ({ ...prev, name: val }));
											}}
										/>
										<LabeledInput
											label={t("Description")}
											placeholder={t("Optional description")}
											value={offeringForm.description}
											onChange={(val) => {
												setOfferingForm((prev) => ({ ...prev, description: val }));
											}}
										/>
										<LabeledInput
											label={t("Placement")}
											placeholder={t("e.g. default, ios, android, test")}
											value={offeringForm.placement}
											onChange={(val) => {
												setOfferingForm((prev) => ({
													...prev,
													placement: asIdentifier(val),
												}));
											}}
										/>
										<LabeledInput
											label={t("Priority")}
											type="number"
											min="0"
											value={String(offeringForm.priority)}
											onChange={(val) => {
												setOfferingForm((prev) => ({
													...prev,
													priority: Number(val),
												}));
											}}
										/>
										<div className="space-y-1">
											<span className="text-xs font-medium">{t("Included Packages")}</span>
											<div className="max-h-36 space-y-2 overflow-auto rounded-md border p-3">
												{packages
													.filter((item) => enabled(item.active))
													.map((item) => (
														<label key={item.id} className="flex items-center gap-2 text-sm">
															<input
																type="checkbox"
																checked={offeringForm.packageIds.includes(item.id)}
																onChange={(event) =>
																	setOfferingForm((value) => ({
																		...value,
																		packageIds: event.target.checked
																			? [...value.packageIds, item.id]
																			: value.packageIds.filter((id) => id !== item.id),
																	}))
																}
															/>
															{item.display_name} ({item.identifier})
														</label>
													))}
											</div>
										</div>
										<div className="flex items-center gap-2 pt-1 text-sm">
											<Switch
												id="offering-active"
												checked={offeringForm.active}
												onCheckedChange={(active) => {
													setOfferingForm((prev) => ({ ...prev, active }));
												}}
											/>
											<label htmlFor="offering-active">{t("Active")}</label>
										</div>
										<DialogFooter className="pt-2">
											<Button variant="outline" onClick={cancelEdit}>
												{t("Cancel")}
											</Button>
											<Button
												disabled={
													!offeringForm.identifier || !offeringForm.name || !offeringForm.placement
												}
												onClick={() => void saveOffering()}
											>
												{modal.isEdit ? <Check className="size-4" /> : <Plus className="size-4" />}
												{modal.isEdit ? t("Save offering") : t("Create offering")}
											</Button>
										</DialogFooter>
									</div>
								)}
							</DialogContent>
						</Dialog>
					</div>
				</Trans>
			)}
		</ModulePage>
	);
}

export function EntitlementsPage() {
	const { t } = useMonetizationI18n();
	const { selectedProject } = useProjectSelection();
	const [products, setProducts] = useState<Product[]>([]);
	const [items, setItems] = useState<Entitlement[]>([]);
	const [form, setForm] = useState({
		identifier: "",
		name: "",
		description: "",
		productIds: [] as string[],
		active: true,
	});
	const [editingId, setEditingId] = useState<string>();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [state, setState] = useState<"all" | "active" | "archived">("all");
	const [error, setError] = useState<string | null>(null);
	const load = useCallback(async () => {
		if (!selectedProject) return;
		try {
			const [catalog, entitlements] = await Promise.all([
				getProducts(selectedProject.id),
				getEntitlements(selectedProject.id),
			]);
			setProducts(catalog);
			setItems(entitlements);
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause));
		}
	}, [selectedProject]);
	useEffect(() => void load(), [load]);
	const reset = () => {
		setEditingId(undefined);
		setForm({
			identifier: "",
			name: "",
			description: "",
			productIds: [],
			active: true,
		});
	};
	const save = async () => {
		if (!selectedProject) return;
		try {
			const payload = {
				identifier: form.identifier,
				display_name: form.name,
				description: form.description || null,
				active: form.active,
				product_ids: form.productIds,
			};
			if (editingId) await updateEntitlement(selectedProject.id, editingId, payload);
			else await createEntitlement(selectedProject.id, payload);
			showSuccessNotification(editingId ? t("Entitlement updated") : t("Entitlement created"));
			reset();
			setDialogOpen(false);
			await load();
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		}
	};
	const edit = (item: Entitlement) => {
		setEditingId(item.id);
		setForm({
			identifier: item.identifier,
			name: item.display_name,
			description: item.description || "",
			productIds: item.product_ids || item.products?.map(({ id }) => id) || [],
			active: enabled(item.active),
		});
		setDialogOpen(true);
	};
	const productNames = useMemo(
		() => new Map(products.map((item) => [item.id, item.display_name])),
		[products],
	);
	const visible = items.filter((item) => {
		const active = enabled(item.active);
		return state === "all" || (state === "active" ? active : !active);
	});
	return (
		<ModulePage
			title={t("Entitlements")}
			description={t(
				'An entitlement represents a level of access, features, or content that a customer is "entitled" to. Many projects only have one entitlement, for example, "Pro access".',
			)}
			error={error}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<Trans>
					<div className="space-y-4">
						<Card>
							<CardContent className="space-y-4 pt-6">
								<div className="flex items-center justify-between gap-4">
									<Tabs
										value={state}
										onValueChange={(val) => {
											if (val === "all" || val === "active" || val === "archived") setState(val);
										}}
									>
										<TabsList>
											<TabsTrigger value="all">{t("All")}</TabsTrigger>
											<TabsTrigger value="active">{t("Active")}</TabsTrigger>
											<TabsTrigger value="archived">{t("Inactive")}</TabsTrigger>
										</TabsList>
									</Tabs>
									<Button
										onClick={() => {
											reset();
											setDialogOpen(true);
										}}
									>
										<Plus className="me-2 size-4" />
										{t("Add entitlement")}
									</Button>
								</div>

								<div className="overflow-x-auto">
									<DataTable
										headers={[
											t("Identifier"),
											t("Display Name"),
											t("Products"),
											t("Created"),
											t("Actions"),
										]}
										empty={t("No entitlements configured.")}
									>
										{visible.map((item) => (
											<TableRow key={item.id}>
												<TableCell>
													<code className="font-semibold">{item.identifier}</code>
												</TableCell>
												<TableCell>
													<b>{item.display_name}</b>
													{item.description ? (
														<span className="block text-xs text-muted-foreground">
															{item.description}
														</span>
													) : null}
												</TableCell>
												<TableCell>
													<div className="flex max-w-72 flex-wrap gap-1">
														{(item.product_ids || item.products?.map(({ id }) => id) || []).length >
														0 ? (
															(item.product_ids || item.products?.map(({ id }) => id) || []).map(
																(id) => (
																	<Badge key={id} variant="outline">
																		{productNames.get(id) || id}
																	</Badge>
																),
															)
														) : (
															<span className="text-xs text-muted-foreground">
																{t("No products")}
															</span>
														)}
													</div>
												</TableCell>
												<TableCell className="text-muted-foreground text-sm">
													{dateTime(item.created_at)}
												</TableCell>
												<TableCell className="text-end">
													<RowActions
														onEdit={() => edit(item)}
														onArchive={
															enabled(item.active)
																? () => {
																		if (!selectedProject) return;
																		archiveEntitlement(selectedProject.id, item.id)
																			.then(() => {
																				showSuccessNotification(t("Entitlement archived"));
																				return load();
																			})
																			.catch((cause: unknown) => {
																				showErrorNotification(moduleErrorMessage(cause));
																			});
																	}
																: undefined
														}
													/>
												</TableCell>
											</TableRow>
										))}
									</DataTable>
								</div>
							</CardContent>
						</Card>

						<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
							<DialogContent className="sm:max-w-lg">
								<DialogHeader>
									<DialogTitle>
										{editingId ? t("Edit entitlement") : t("Create entitlement")}
									</DialogTitle>
									<DialogDescription>
										{t("Identifiers are stable public keys exposed to the SDK.")}
									</DialogDescription>
								</DialogHeader>
								<div className="space-y-4 py-2">
									<div className="space-y-1.5">
										<label
											htmlFor="entitlement-identifier"
											className="text-xs font-medium text-muted-foreground"
										>
											{t("Identifier")}
										</label>
										<Input
											id="entitlement-identifier"
											placeholder={t("Identifier (e.g. premium)")}
											value={form.identifier}
											onChange={(event) =>
												setForm((value) => ({
													...value,
													identifier: asIdentifier(event.target.value),
												}))
											}
										/>
									</div>
									<div className="space-y-1.5">
										<label
											htmlFor="entitlement-display-name"
											className="text-xs font-medium text-muted-foreground"
										>
											{t("Display name")}
										</label>
										<Input
											id="entitlement-display-name"
											placeholder={t("Display name (e.g. Premium access)")}
											value={form.name}
											onChange={(event) => {
												setForm((value) => ({ ...value, name: event.target.value }));
											}}
										/>
									</div>
									<div className="space-y-1.5">
										<label
											htmlFor="entitlement-description"
											className="text-xs font-medium text-muted-foreground"
										>
											{t("Description")}
										</label>
										<Input
											id="entitlement-description"
											placeholder={t("Description (optional)")}
											value={form.description}
											onChange={(event) =>
												setForm((value) => ({
													...value,
													description: event.target.value,
												}))
											}
										/>
									</div>
									<div className="space-y-1.5">
										<span className="text-xs font-medium text-muted-foreground">
											{t("Products")}
										</span>
										<div className="max-h-52 space-y-2 overflow-auto rounded-md border p-3">
											{products
												.filter((item) => item.status === "active")
												.map((item) => (
													<label
														key={item.id}
														className="flex items-center gap-2 text-sm cursor-pointer"
													>
														<input
															type="checkbox"
															checked={form.productIds.includes(item.id)}
															onChange={(event) =>
																setForm((value) => ({
																	...value,
																	productIds: event.target.checked
																		? [...value.productIds, item.id]
																		: value.productIds.filter((id) => id !== item.id),
																}))
															}
														/>
														<span>{item.display_name}</span>
													</label>
												))}
											{products.filter((item) => item.status === "active").length === 0 && (
												<p className="text-xs text-muted-foreground">
													{t("No active products available.")}
												</p>
											)}
										</div>
									</div>
									<div className="flex items-center gap-2 text-sm pt-1">
										<Switch
											id="entitlement-active"
											checked={form.active}
											onCheckedChange={(active) => setForm((value) => ({ ...value, active }))}
										/>
										<label htmlFor="entitlement-active" className="cursor-pointer">
											{t("Active")}
										</label>
									</div>
								</div>
								<DialogFooter className="pt-2">
									<Button
										variant="outline"
										onClick={() => {
											reset();
											setDialogOpen(false);
										}}
									>
										{t("Cancel")}
									</Button>
									<Button disabled={!form.identifier || !form.name} onClick={() => void save()}>
										{editingId ? t("Save entitlement") : t("Create entitlement")}
									</Button>
								</DialogFooter>
							</DialogContent>
						</Dialog>
					</div>
				</Trans>
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
function Trans({ children }: { children: React.ReactNode }) {
	return <>{children}</>;
}
function CatalogTable({
	title,
	headers,
	empty,
	action,
	children,
}: {
	title: React.ReactNode;
	headers: React.ReactNode[];
	empty: React.ReactNode;
	action?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<Card>
			<CardHeader
				className={action ? "flex flex-row items-center justify-between space-y-0 pb-4" : undefined}
			>
				<CardTitle>{title}</CardTitle>
				{action}
			</CardHeader>
			<CardContent className="overflow-x-auto">
				<DataTable headers={headers} empty={empty}>
					{children}
				</DataTable>
			</CardContent>
		</Card>
	);
}
function DataTable({
	headers,
	empty,
	children,
}: {
	headers: React.ReactNode[];
	empty: React.ReactNode;
	children: React.ReactNode;
}) {
	const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
	return (
		<Table>
			<TableHeader>
				<TableRow>
					{headers.map((header) => (
						<TableHead key={typeof header === "string" && header ? header : "actions"}>
							{header}
						</TableHead>
					))}
				</TableRow>
			</TableHeader>
			<TableBody>
				{hasChildren ? (
					children
				) : (
					<TableRow>
						<TableCell colSpan={headers.length} className="py-10 text-center text-muted-foreground">
							{empty}
						</TableCell>
					</TableRow>
				)}
			</TableBody>
		</Table>
	);
}

function StatusBadge({ status }: { status: string }) {
	const { t } = useMonetizationI18n();
	const destructive = ["failed", "refunded", "cancelled", "expired", "archived"].includes(status);
	const positive = ["active", "succeeded", "trialing", "grace_period"].includes(status);
	return (
		<Badge
			variant={destructive ? "destructive" : positive ? "default" : "outline"}
			className="capitalize"
		>
			{t(status).replaceAll("_", " ")}
		</Badge>
	);
}
function RowActions({ onEdit, onArchive }: { onEdit: () => void; onArchive?: () => void }) {
	return (
		<div className="flex justify-end gap-1">
			<Button variant="ghost" size="icon" aria-label="Edit" onClick={onEdit}>
				<Pencil />
			</Button>
			{onArchive && (
				<Button variant="ghost" size="icon" aria-label="Archive" onClick={onArchive}>
					<Archive />
				</Button>
			)}
		</div>
	);
}
function LabeledInput({
	label,
	value,
	onChange,
	...props
}: { label: string; value: string; onChange: (value: string) => void } & Omit<
	React.ComponentProps<typeof Input>,
	"value" | "onChange"
>) {
	return (
		<label className="space-y-1 text-xs">
			{label}
			<Input value={value} onChange={(event) => onChange(event.target.value)} {...props} />
		</label>
	);
}
function LabeledSelect({
	label,
	value,
	onChange,
	options,
	empty,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	options: Array<{ value: string; label: string }>;
	empty: string;
}) {
	return (
		<label className="space-y-1 text-xs">
			{label}
			<select
				className={selectClass}
				value={value}
				onChange={(event) => onChange(event.target.value)}
			>
				<option value="">{empty}</option>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
		</label>
	);
}
