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
import { Label } from "@superboard/front-ui/ui/label.js";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@superboard/front-ui/ui/table.js";
import { Eye, Plus, RefreshCw, RotateCcw, Search, X } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";

import { useMonetizationI18n } from "../../../i18n.js";
import {
	createPurchase,
	createRefund,
	getPurchase,
	getProducts,
	getProductStatistics,
	getPurchases,
	getSubscriptions,
	updateSubscription,
	type Product,
	type ProductStatistics,
	type Purchase,
	type PurchaseDetail,
	type Subscription,
} from "../../api/products/productsService.js";
import { BillingLedgerMigration } from "./BillingLedgerMigration.js";
import { ConvertedAmount } from "./ConvertedAmount.js";

const selectClass = "h-9 w-full rounded-md border bg-background px-3 text-sm";
const filterSelectClass = "h-[34px] rounded-md border bg-background px-3 text-sm";
const enabled = (value: number | boolean) => value === true || value === 1;
const decimal = (amount: number, locale?: string) =>
	new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
		amount,
	);
const money = (micros = 0, currency?: string | null, locale?: string) => {
	const amount = micros / 1_000_000;
	if (!currency) return decimal(amount, locale);
	try {
		return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
	} catch {
		return `${decimal(amount, locale)} ${currency}`;
	}
};
const dateTime = (value?: string | null, locale?: string) =>
	value ? new Date(value).toLocaleString(locale) : "—";
const shortDate = (value?: string | null, locale?: string) =>
	value ? new Date(value).toLocaleDateString(locale, { dateStyle: "medium" }) : "—";
const shortDateTime = (value?: string | null, locale?: string) =>
	value ? new Date(value).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : "—";
const defaultFrom = () => new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);
const purchaseStatuses = ["pending", "active", "expired", "cancelled", "refunded", "failed"];
const storeLabels: Record<string, string> = {
	apple: "Apple",
	google: "Google",
	stripe: "Stripe",
	manual: "Manual",
};
const environmentLabels: Record<string, string> = {
	sandbox: "Sandbox",
	production: "Production",
};

export function PurchasesPage() {
	const { t, locale, code, date } = useMonetizationI18n();
	const { selectedProject } = useProjectSelection();
	const fieldId = useId();
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
	const [recording, setRecording] = useState(false);
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
			setError(moduleErrorMessage(cause, locale));
		} finally {
			setLoading(false);
		}
	}, [filters, locale, selectedProject]);

	useEffect(() => {
		Promise.resolve()
			.then(load)
			.catch(() => undefined);
	}, [load]);

	const setFilter = (name: keyof typeof filters, value: string) => {
		setFilters((current) => ({ ...current, [name]: value }));
	};

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
			setRecording(false);
			showSuccessNotification(t("Sandbox purchase recorded"));
			await load();
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
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
			showErrorNotification(moduleErrorMessage(cause, locale));
		}
	};

	const showPurchase = async (purchaseId: string) => {
		if (!selectedProject) return;
		try {
			setPurchaseDetail(await getPurchase(selectedProject.id, purchaseId));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
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
			showErrorNotification(moduleErrorMessage(cause, locale));
		}
	};

	const labelFor = (labels: Record<string, string>, value: string) => {
		const message = labels[value];
		return message ? t(message) : value;
	};
	const totals = statistics?.totals;
	const currencyTotals =
		statistics?.totals_by_currency ?? (totals ? [{ ...totals, currency: null }] : []);
	const displayCurrency = statistics?.display_currency;
	const displayTotals = displayCurrency ? statistics?.totals_in_display_currency : undefined;
	const revenue = (key: "gross_revenue_micros" | "refunded_micros" | "net_revenue_micros") =>
		displayTotals && displayCurrency ? (
			money(displayTotals[key], displayCurrency, locale)
		) : currencyTotals.length ? (
			<Amounts
				amounts={currencyTotals.map((row) => ({ currency: row.currency, micros: row[key] }))}
			/>
		) : (
			"—"
		);
	const awaitingConversion = (count: number, one: string, many: string) =>
		count > 0 ? t(count === 1 ? one : many, { count: count.toLocaleString(locale) }) : null;
	const conversionNotes = displayTotals
		? [
				awaitingConversion(
					displayTotals.unconverted_purchases,
					"1 purchase awaiting conversion is not included in these totals.",
					"{count} purchases awaiting conversion are not included in these totals.",
				),
				awaitingConversion(
					displayTotals.unconverted_refunds,
					"1 refund awaiting conversion is not included in these totals.",
					"{count} refunds awaiting conversion are not included in these totals.",
				),
			].filter((note): note is string => Boolean(note))
		: [];
	const days = revenueDays(statistics);
	return (
		<ModulePage
			title={t("Purchases")}
			description={t("Purchases, subscriptions, restorations, refunds and financial history.")}
			error={error}
		>
			<a
				className="w-fit text-sm underline underline-offset-4"
				href={`/monetization/settings?tab=general&lang=${locale}`}
			>
				{t("Purchase settings")}
			</a>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<div className="space-y-6">
					<BillingLedgerMigration
						key={selectedProject.id}
						projectRef={selectedProject.id}
						onComplete={() => {
							setFilters((value) => ({ ...value, from: "", to: "" }));
						}}
					/>
					<div className="flex flex-wrap items-center gap-2">
						<div className="relative min-w-40 flex-1">
							<Search className="absolute start-3 top-2.5 size-4 text-muted-foreground" />
							<Input
								type="search"
								className="ps-9"
								aria-label={t("Financial customer")}
								placeholder={t("Financial customer")}
								value={filters.customer_id}
								onChange={(event) => {
									setFilter("customer_id", event.currentTarget.value);
								}}
							/>
						</div>
						<Input
							type="date"
							className="w-auto"
							aria-label={t("From")}
							value={filters.from}
							onChange={(event) => {
								setFilter("from", event.currentTarget.value);
							}}
						/>
						<Input
							type="date"
							className="w-auto"
							aria-label={t("To")}
							value={filters.to}
							onChange={(event) => {
								setFilter("to", event.currentTarget.value);
							}}
						/>
						<FilterSelect
							label={t("Product")}
							value={filters.product_id}
							onChange={(value) => {
								setFilter("product_id", value);
							}}
							options={products.map((item) => ({ value: item.id, label: item.display_name }))}
							empty={t("All products")}
						/>
						<FilterSelect
							label={t("Store")}
							value={filters.store}
							onChange={(value) => {
								setFilter("store", value);
							}}
							options={Object.entries(storeLabels).map(([value, message]) => ({
								value,
								label: t(message),
							}))}
							empty={t("All stores")}
						/>
						<FilterSelect
							label={t("Status")}
							value={filters.status}
							onChange={(value) => {
								setFilter("status", value);
							}}
							options={purchaseStatuses.map((value) => ({ value, label: code("status", value) }))}
							empty={t("All statuses")}
						/>
						<Button
							variant="outline"
							size="icon"
							aria-label={t("Refresh purchases")}
							disabled={loading}
							onClick={() => {
								load().catch(() => undefined);
							}}
						>
							<RefreshCw className={loading ? "animate-spin" : ""} />
						</Button>
					</div>

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
										<TableCell>
											{code("platform", row.platform)}
											<span className="block text-xs text-muted-foreground">
												{code("store", row.store)}
											</span>
										</TableCell>
										<TableCell>{Number(row.units_sold).toLocaleString(locale)}</TableCell>
										<TableCell>{Number(row.first_time_purchases).toLocaleString(locale)}</TableCell>
										<TableCell>
											<ConvertedAmount
												micros={Number(row.revenue_micros)}
												currency={row.currency}
												displayMicros={
													row.unconverted_purchases
														? null
														: (row.revenue_in_display_currency_micros ?? null)
												}
												displayCurrency={displayCurrency}
											/>
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
						<Metric label={t("Gross revenue")} value={revenue("gross_revenue_micros")} />
						<Metric label={t("Refunded")} value={revenue("refunded_micros")} />
						<Metric label={t("Net revenue")} value={revenue("net_revenue_micros")} />
						<Metric label={t("Refunds")} value={String(totals?.refunds ?? 0)} />
					</div>
					{displayTotals && displayCurrency && (
						<div className="-mt-3 space-y-1 text-sm text-muted-foreground">
							<p>
								{t("Amounts in {currency}, converted at the exchange rate of each purchase day.", {
									currency: displayCurrency,
								})}
							</p>
							{conversionNotes.map((note) => (
								<p key={note} role="status">
									{note}
								</p>
							))}
						</div>
					)}

					<Card>
						<CardHeader>
							<CardTitle>{t("Revenue timeline")}</CardTitle>
							<CardDescription>{t("Daily volume and gross revenue.")}</CardDescription>
						</CardHeader>
						<CardContent>
							<DataTable
								headers={[t("Date"), t("Purchases"), t("Revenue")]}
								empty={t("No financial activity in this period.")}
							>
								{days.map((day) => (
									<TableRow key={day.bucket}>
										<TableCell>{date(day.bucket)}</TableCell>
										<TableCell>{day.purchases.toLocaleString(locale)}</TableCell>
										<TableCell>
											<Amounts amounts={day.amounts} />
											{day.unconverted > 0 && (
												<span className="block text-xs text-muted-foreground">
													{t("{count} awaiting conversion", {
														count: day.unconverted.toLocaleString(locale),
													})}
												</span>
											)}
										</TableCell>
									</TableRow>
								))}
							</DataTable>
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
							<div className="space-y-1.5">
								<CardTitle>{t("Purchase history")}</CardTitle>
								<CardDescription>
									{t("{count} matching transactions", { count: items.length })}
								</CardDescription>
							</div>
							<Button
								onClick={() => {
									setRecording(true);
								}}
							>
								<Plus />
								{t("Record sandbox purchase")}
							</Button>
						</CardHeader>
						<CardContent className="overflow-x-auto">
							<DataTable
								headers={[
									t("Product"),
									t("Customer"),
									t("Status"),
									t("Purchased"),
									t("Amount"),
									"",
								]}
								empty={t("No purchases match these filters.")}
							>
								{items.map((item) => (
									<TableRow key={item.id}>
										<TableCell>
											<Truncated
												className="font-semibold"
												value={item.product_name || item.product_identifier || item.product_id}
											/>
											<span className="block text-xs text-muted-foreground">
												{labelFor(storeLabels, item.store)} ·{" "}
												{labelFor(environmentLabels, item.environment)}
											</span>
										</TableCell>
										<TableCell>
											<Truncated value={item.external_customer_id} />
											<code
												className="block max-w-36 truncate text-xs text-muted-foreground"
												title={item.external_transaction_id}
											>
												{item.external_transaction_id}
											</code>
										</TableCell>
										<TableCell>
											<StatusBadge status={item.status} />
										</TableCell>
										<TableCell>
											{shortDate(item.purchased_at, locale)}
											{item.expires_at && (
												<span className="block text-xs text-muted-foreground">
													{t("Expires {date}", { date: shortDate(item.expires_at, locale) })}
												</span>
											)}
										</TableCell>
										<TableCell>
											<ConvertedAmount
												micros={item.purchased_price_micros}
												currency={item.currency}
												displayMicros={item.display_price_micros}
												displayCurrency={item.display_currency}
												rateDate={item.usd_rate_date}
											/>
										</TableCell>
										<TableCell>
											<div className="flex justify-end gap-1">
												<Button
													variant="ghost"
													size="icon"
													aria-label={t("View purchase {transaction}", {
														transaction: item.external_transaction_id,
													})}
													onClick={() => {
														showPurchase(item.id).catch(() => undefined);
													}}
												>
													<Eye />
												</Button>
												<Button
													variant="outline"
													size="sm"
													disabled={item.status === "refunded"}
													onClick={() => {
														refund(item).catch(() => undefined);
													}}
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

					{purchaseDetail && (
						<Card>
							<CardHeader className="flex-row items-start justify-between gap-3">
								<CardTitle>{t("Purchase detail")}</CardTitle>
								<Button
									variant="ghost"
									size="icon"
									aria-label={t("Close purchase detail")}
									onClick={() => {
										setPurchaseDetail(undefined);
									}}
								>
									<X />
								</Button>
							</CardHeader>
							<CardContent className="space-y-6">
								<dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
									<Fact label={t("Product")}>
										{purchaseDetail.product_name ||
											purchaseDetail.product_identifier ||
											purchaseDetail.product_id}
									</Fact>
									<Fact label={t("Customer")}>{purchaseDetail.external_customer_id}</Fact>
									<Fact label={t("Transaction ID")}>{purchaseDetail.external_transaction_id}</Fact>
									<Fact label={t("Status")}>
										<StatusBadge status={purchaseDetail.status} />
									</Fact>
									<Fact label={t("Store")}>{labelFor(storeLabels, purchaseDetail.store)}</Fact>
									<Fact label={t("Environment")}>
										{labelFor(environmentLabels, purchaseDetail.environment)}
									</Fact>
									<Fact label={t("Purchased")}>{date(purchaseDetail.purchased_at)}</Fact>
									<Fact label={t("Expires")}>{date(purchaseDetail.expires_at)}</Fact>
									<Fact label={t("Amount")}>
										{money(purchaseDetail.purchased_price_micros, purchaseDetail.currency, locale)}
									</Fact>
									{purchaseDetail.display_currency && (
										<Fact
											label={t("Amount in {currency}", {
												currency: purchaseDetail.display_currency,
											})}
										>
											{purchaseDetail.display_price_micros != null
												? money(
														purchaseDetail.display_price_micros,
														purchaseDetail.display_currency,
														locale,
													)
												: purchaseDetail.usd_rate_date
													? t("No exchange rate for this currency")
													: t("Conversion pending")}
											{purchaseDetail.usd_rate_date && purchaseDetail.usd_rate_source !== null && (
												<span className="block text-xs font-normal text-muted-foreground">
													{t(
														purchaseDetail.usd_rate_source === "currency-api"
															? "Currency API daily rate of {date} (not published by the ECB)"
															: "ECB reference rate of {date}",
														{ date: date(purchaseDetail.usd_rate_date) },
													)}
												</span>
											)}
										</Fact>
									)}
								</dl>
								<section>
									<h3 className="mb-2 text-sm font-medium">{t("Granted entitlements")}</h3>
									<div className="space-y-2">
										{purchaseDetail.entitlements.map((item) => (
											<div key={item.id} className="rounded-md border p-3">
												<b>{item.display_name}</b>
												<code className="ms-2 text-xs text-muted-foreground">
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
								</section>
								<section>
									<h3 className="mb-2 text-sm font-medium">{t("Refund history")}</h3>
									<div className="space-y-2">
										{purchaseDetail.refunds.map((item) => (
											<div
												key={item.id}
												className="flex items-center justify-between rounded-md border p-3"
											>
												<span>
													<StatusBadge status={item.status} />
													<span className="ms-2 text-xs text-muted-foreground">
														{item.reason || t("No reason")}
													</span>
												</span>
												<div className="text-end font-semibold">
													<ConvertedAmount
														micros={item.amount_micros}
														currency={item.currency || purchaseDetail.currency}
														displayMicros={item.display_amount_micros}
														displayCurrency={item.display_currency}
														rateDate={item.usd_rate_date}
													/>
												</div>
											</div>
										))}
										{!purchaseDetail.refunds.length && (
											<p className="text-sm text-muted-foreground">{t("No refunds recorded.")}</p>
										)}
									</div>
								</section>
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
								headers={[t("Product"), t("Customer"), t("Status"), t("Period end"), ""]}
								empty={t("No subscriptions match this customer.")}
							>
								{subscriptions.map((item) => (
									<TableRow key={item.id}>
										<TableCell>
											<Truncated
												value={item.product_name || item.product_identifier || item.product_id}
											/>
										</TableCell>
										<TableCell>
											<Truncated value={item.external_customer_id} />
										</TableCell>
										<TableCell>
											<StatusBadge status={item.status} />
											{item.updated_at && (
												<span
													className="mt-1 block text-xs text-muted-foreground"
													title={dateTime(item.updated_at, locale)}
												>
													{t("Updated {date}", { date: shortDate(item.updated_at, locale) })}
												</span>
											)}
										</TableCell>
										<TableCell>
											{shortDateTime(item.current_period_ends_at, locale)}
											<span className="block text-xs text-muted-foreground">
												{enabled(item.auto_renew) ? t("Auto-renew") : t("Auto-renew off")}
											</span>
										</TableCell>
										<TableCell className="text-end">
											{item.status === "cancelled" || item.status === "expired" ? (
												<Button
													size="sm"
													variant="outline"
													onClick={() => {
														changeSubscription(item, "active").catch(() => undefined);
													}}
												>
													<RotateCcw />
													{t("Restore")}
												</Button>
											) : (
												<Button
													size="sm"
													variant="outline"
													onClick={() => {
														changeSubscription(item, "cancelled").catch(() => undefined);
													}}
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

					<Dialog open={recording} onOpenChange={setRecording}>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>{t("Record sandbox purchase")}</DialogTitle>
								<DialogDescription>
									{t(
										"Validate catalog, entitlement and subscription flows without touching a live store.",
									)}
								</DialogDescription>
							</DialogHeader>
							<form
								className="space-y-4"
								onSubmit={(event) => {
									event.preventDefault();
									recordPurchase().catch(() => undefined);
								}}
							>
								<div className="grid gap-1">
									<Label htmlFor={`${fieldId}-customer`}>{t("Financial customer ID")}</Label>
									<Input
										id={`${fieldId}-customer`}
										required
										value={customerId}
										onChange={(event) => {
											setCustomerId(event.currentTarget.value);
										}}
									/>
								</div>
								<label className="grid gap-1 text-sm font-medium">
									{t("Product")}
									<select
										className={selectClass}
										value={productId}
										onChange={(event) => {
											setProductId(event.currentTarget.value);
										}}
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
								</label>
								<label className="grid gap-1 text-sm font-medium">
									{t("Store")}
									<select
										className={selectClass}
										value={store}
										onChange={(event) => {
											setStore(event.currentTarget.value);
										}}
									>
										<option value="manual">{t("Manual")}</option>
										<option value="apple">{t("Apple")}</option>
										<option value="google">{t("Google")}</option>
										<option value="stripe">{t("Stripe")}</option>
									</select>
								</label>
								<div className="grid gap-1">
									<Label htmlFor={`${fieldId}-transaction`}>{t("External transaction ID")}</Label>
									<Input
										id={`${fieldId}-transaction`}
										required
										value={transactionId}
										onChange={(event) => {
											setTransactionId(event.currentTarget.value);
										}}
									/>
								</div>
								<div className="grid grid-cols-[1fr_90px] gap-2">
									<div className="grid gap-1">
										<Label htmlFor={`${fieldId}-price`}>{t("Price")}</Label>
										<Input
											id={`${fieldId}-price`}
											type="number"
											min="0"
											step="0.01"
											value={price}
											onChange={(event) => {
												setPrice(event.currentTarget.value);
											}}
										/>
									</div>
									<div className="grid gap-1">
										<Label htmlFor={`${fieldId}-currency`}>{t("Currency")}</Label>
										<Input
											id={`${fieldId}-currency`}
											maxLength={3}
											value={currency}
											onChange={(event) => {
												setCurrency(event.currentTarget.value.toUpperCase());
											}}
										/>
									</div>
								</div>
								<DialogFooter>
									<Button
										type="button"
										variant="outline"
										onClick={() => {
											setRecording(false);
										}}
									>
										{t("Cancel")}
									</Button>
									<Button
										type="submit"
										disabled={!customerId || !productId || !transactionId || Number(price) < 0}
									>
										<Plus />
										{t("Record purchase")}
									</Button>
								</DialogFooter>
							</form>
						</DialogContent>
					</Dialog>
				</div>
			)}
		</ModulePage>
	);
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="min-w-0">
			<dt className="text-xs text-muted-foreground">{label}</dt>
			<dd className="mt-1 break-all text-sm font-medium">{children}</dd>
		</div>
	);
}
function Truncated({ value, className = "" }: { value: string; className?: string }) {
	return (
		<span className={`block max-w-36 truncate ${className}`} title={value}>
			{value}
		</span>
	);
}
function Metric({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<Card>
			<CardHeader>
				<CardDescription>{label}</CardDescription>
				<CardTitle>{value}</CardTitle>
			</CardHeader>
		</Card>
	);
}
type Amount = { currency: string | null; micros: number };
function revenueDays(statistics: ProductStatistics | null) {
	const displayCurrency = statistics?.display_currency;
	if (displayCurrency && statistics?.series_in_display_currency)
		return statistics.series_in_display_currency.map((row) => ({
			bucket: row.bucket,
			purchases: row.purchases,
			amounts: [{ currency: displayCurrency, micros: row.revenue_micros }],
			unconverted: row.unconverted_purchases,
		}));
	if (!statistics?.series_by_currency)
		return (statistics?.series ?? []).map((row) => ({
			bucket: row.bucket,
			purchases: row.purchases,
			amounts: [{ currency: null, micros: row.revenue_micros }],
			unconverted: 0,
		}));
	const days = new Map<
		string,
		{ bucket: string; purchases: number; amounts: Amount[]; unconverted: number }
	>();
	for (const row of statistics.series_by_currency) {
		const day = days.get(row.bucket) ?? {
			bucket: row.bucket,
			purchases: 0,
			amounts: [],
			unconverted: 0,
		};
		day.purchases += row.purchases;
		day.amounts.push({ currency: row.currency, micros: row.revenue_micros });
		days.set(row.bucket, day);
	}
	return [...days.values()];
}
function Amounts({ amounts }: { amounts: Amount[] }) {
	const { locale } = useMonetizationI18n();
	return amounts.map((amount) => (
		<span key={amount.currency ?? ""} className="block">
			{money(amount.micros, amount.currency, locale)}
		</span>
	));
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
	const { code } = useMonetizationI18n();
	const destructive = ["failed", "refunded", "cancelled", "expired", "archived"].includes(status);
	const positive = ["active", "succeeded", "trialing", "grace_period"].includes(status);
	return (
		<Badge variant={destructive ? "destructive" : positive ? "default" : "outline"}>
			{code("status", status)}
		</Badge>
	);
}
function FilterSelect({
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
		<select
			aria-label={label}
			className={filterSelectClass}
			value={value}
			onChange={(event) => {
				onChange(event.currentTarget.value);
			}}
		>
			<option value="">{empty}</option>
			{options.map((option) => (
				<option key={option.value} value={option.value}>
					{option.label}
				</option>
			))}
		</select>
	);
}
