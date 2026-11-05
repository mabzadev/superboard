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
import { usePathname, useRouter, useSearchParams } from "@superboard/front-ui/navigation";
import { Alert, AlertDescription, AlertTitle } from "@superboard/front-ui/ui/alert.js";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { Button } from "@superboard/front-ui/ui/button.js";
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
import { ChevronLeft, RefreshCw, Search, ShieldBan, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { useMonetizationI18n } from "../../../i18n.js";
import {
	deleteBillingCustomer,
	getBillingCustomer,
	getBillingOverview,
	grantBillingEntitlement,
	mergeBillingCustomers,
	revokeBillingEntitlement,
	searchBillingCustomers,
	setBillingCustomerBlocked,
	type BillingCustomerDetail,
	type BillingCustomerSummary,
	type BillingOverview,
} from "../../api/billing/billingService.js";
import { amountText, formatMoney } from "./ConvertedAmount.js";

const selectClass = "h-9 w-full rounded-md border bg-background px-3 text-sm";
const columnLabels: Record<string, string> = {
	store_product_id: "Store product",
	store: "Store",
	status: "Status",
	expires_at: "Expires",
	store_transaction_id: "Transaction ID",
	event_type: "Event",
	created_at: "Created",
	paywall_id: "Paywall",
	placement_identifier: "Placement",
	occurred_at: "Occurred",
	details: "Details",
	amount: "Amount",
};
const columnFormats: Record<string, "date" | "store" | "status" | "event"> = {
	store: "store",
	status: "status",
	event_type: "event",
	expires_at: "date",
	created_at: "date",
	occurred_at: "date",
};
const contextFields = [
	["Country", "country"],
	["Language", "language"],
	["Platform", "platform"],
	["App version", "app_version"],
	["SDK version", "sdk_version"],
] as const;

export default function BillingCustomersPage() {
	const { t, locale } = useMonetizationI18n();
	const { selectedProject } = useProjectSelection();
	const router = useRouter();
	const pathname = usePathname();
	const search = useSearchParams();
	const selectedCustomerId = search.get("customer");
	const [query, setQuery] = useState("");
	const [customers, setCustomers] = useState<BillingCustomerSummary[]>([]);
	const [overview, setOverview] = useState<BillingOverview | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		if (!selectedProject) return;
		setLoading(true);
		try {
			const [page, billing] = await Promise.all([
				searchBillingCustomers(selectedProject.id, query.trim()),
				getBillingOverview(selectedProject.id),
			]);
			setCustomers(page.data);
			setOverview(billing);
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause, locale));
		} finally {
			setLoading(false);
		}
	}, [locale, query, selectedProject]);

	useEffect(() => {
		Promise.resolve()
			.then(load)
			.catch((cause: unknown) => {
				setError(moduleErrorMessage(cause, locale));
			});
	}, [load, locale]);

	const showCustomer = (customerId: string | null) => {
		const next = new URLSearchParams(search);
		if (customerId) next.set("customer", customerId);
		else next.delete("customer");
		const value = next.toString();
		router.push(value ? `${pathname}?${value}` : pathname);
	};

	return (
		<ModulePage
			title={t("Customers")}
			description={t(
				"Application identities, subscriptions, entitlements, balances, transactions and paywall activity.",
			)}
			error={error}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : selectedCustomerId ? (
				<CustomerDetail
					key={`${selectedProject.id}:${selectedCustomerId}`}
					projectId={selectedProject.id}
					customerId={selectedCustomerId}
					overview={overview}
					onBack={() => {
						showCustomer(null);
					}}
					onChange={load}
				/>
			) : (
				<div className="space-y-4">
					<div className="flex flex-wrap items-center gap-2">
						<div className="relative min-w-64 flex-1">
							<Search className="absolute start-3 top-2.5 size-4 text-muted-foreground" />
							<Input
								type="search"
								className="ps-9"
								value={query}
								aria-label={t("App user ID or alias")}
								placeholder={t("App user ID or alias")}
								onChange={(event) => {
									setQuery(event.currentTarget.value);
								}}
							/>
						</div>
						<Button
							variant="outline"
							disabled={loading}
							onClick={() => {
								void load();
							}}
						>
							<RefreshCw className={loading ? "animate-spin" : ""} />
							{t("Refresh")}
						</Button>
					</div>
					<p className="text-sm text-muted-foreground">
						{customers.length === 1
							? t("1 customer")
							: t("{count} customers", { count: customers.length.toLocaleString(locale) })}
					</p>
					<div className="overflow-x-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t("Identity")}</TableHead>
									<TableHead>{t("Subscriptions")}</TableHead>
									<TableHead>{t("Transactions")}</TableHead>
									<TableHead>{t("Last seen")}</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{customers.map((customer) => (
									<CustomerRow
										key={customer.id}
										customer={customer}
										onOpen={() => {
											showCustomer(customer.id);
										}}
									/>
								))}
								{!loading && customers.length === 0 && (
									<TableRow>
										<TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
											{t("No customer matches this search.")}
										</TableCell>
									</TableRow>
								)}
							</TableBody>
						</Table>
					</div>
				</div>
			)}
		</ModulePage>
	);
}

function CustomerRow({
	customer,
	onOpen,
}: {
	customer: BillingCustomerSummary;
	onOpen: () => void;
}) {
	const { t, locale, date } = useMonetizationI18n();
	return (
		<TableRow className="cursor-pointer" onClick={onOpen}>
			<TableCell>
				<div className="flex items-center gap-2">
					<Button
						variant="link"
						className="h-auto max-w-48 justify-start truncate px-0 py-0 font-mono text-xs text-foreground"
						onClick={(event) => {
							event.stopPropagation();
							onOpen();
						}}
					>
						{customer.primary_app_user_id}
					</Button>
					{Boolean(customer.blocked) && <Badge variant="destructive">{t("Blocked")}</Badge>}
					{Boolean(customer.anonymous) && <Badge variant="outline">{t("Anonymous")}</Badge>}
				</div>
				<code className="block max-w-48 truncate text-xs text-muted-foreground">{customer.id}</code>
			</TableCell>
			<TableCell>
				{Number(customer.active_subscription_count || 0).toLocaleString(locale)}
			</TableCell>
			<TableCell>{Number(customer.transaction_count || 0).toLocaleString(locale)}</TableCell>
			<TableCell>{date(customer.last_seen_at)}</TableCell>
		</TableRow>
	);
}

function CustomerDetail({
	projectId,
	customerId,
	overview,
	onBack,
	onChange,
}: {
	projectId: string;
	customerId: string;
	overview: BillingOverview | null;
	onBack: () => void;
	onChange: () => Promise<void>;
}) {
	const { t, locale, code, date, region, language } = useMonetizationI18n();
	const [detail, setDetail] = useState<BillingCustomerDetail | null>(null);
	const [failure, setFailure] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [grantId, setGrantId] = useState("");
	const [grantExpiry, setGrantExpiry] = useState("");
	const [mergeTarget, setMergeTarget] = useState("");
	const [mergeConfirmation, setMergeConfirmation] = useState("");
	const [deleteConfirmation, setDeleteConfirmation] = useState("");
	const transfer = (event: Record<string, unknown>) => {
		const parties = transferParties(event);
		return parties ? t("From {from} to {to}", parties) : null;
	};

	const refresh = useCallback(async () => {
		setDetail(await getBillingCustomer(projectId, customerId));
		setFailure(null);
	}, [customerId, projectId]);

	useEffect(() => {
		Promise.resolve()
			.then(refresh)
			.catch((cause: unknown) => {
				setFailure(moduleErrorMessage(cause, locale));
			});
	}, [locale, refresh]);

	const mutate = async (operation: () => Promise<unknown>, message: string) => {
		setBusy(true);
		try {
			await operation();
			showSuccessNotification(message);
			await Promise.all([onChange(), refresh()]);
			setGrantId("");
			setGrantExpiry("");
			setMergeTarget("");
			setMergeConfirmation("");
			setDeleteConfirmation("");
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		} finally {
			setBusy(false);
		}
	};

	const leave = async (operation: () => Promise<unknown>, message: string) => {
		setBusy(true);
		try {
			await operation();
			showSuccessNotification(message);
			onBack();
			await onChange();
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		} finally {
			setBusy(false);
		}
	};

	const back = (
		<Button variant="ghost" size="sm" onClick={onBack}>
			<ChevronLeft className="rtl:-scale-x-100" />
			{t("All customers")}
		</Button>
	);

	if (!detail)
		return (
			<div className="space-y-6">
				{back}
				{failure ? (
					<Alert variant="destructive">
						<AlertTitle>{t("Unable to load this customer")}</AlertTitle>
						<AlertDescription>{failure}</AlertDescription>
					</Alert>
				) : (
					<p role="status" className="text-sm text-muted-foreground">
						{t("Loading customer…")}
					</p>
				)}
			</div>
		);

	const { customer, customer_info: info } = detail;
	const spent = detail.total_spent;
	const transactionRows = detail.transactions.map((row) => ({
		...row,
		amount: amountText(
			{
				micros: typeof row.price_micros === "number" ? row.price_micros : null,
				currency: text(row, "currency") || null,
				displayMicros:
					typeof row.display_price_micros === "number" ? row.display_price_micros : null,
				displayCurrency: text(row, "display_currency") || null,
				rateDate: text(row, "usd_rate_date") || null,
			},
			t,
			locale,
		),
	}));
	const clientContext = sdkContext(customer.attributes);
	const activeEntitlements = Object.values(info.entitlements).filter(
		(entitlement) => entitlement.is_active,
	);

	return (
		<div className="max-w-4xl space-y-6">
			{back}
			<article className="space-y-6">
				<header className="flex flex-wrap items-start justify-between gap-3">
					<div className="min-w-0">
						<h2 className="flex flex-wrap items-center gap-2 break-all text-xl font-semibold">
							{customer.primary_app_user_id}
							{Boolean(customer.blocked) && <Badge variant="destructive">{t("Blocked")}</Badge>}
							{Boolean(customer.anonymous) && <Badge variant="outline">{t("Anonymous")}</Badge>}
						</h2>
						<p className="break-all font-mono text-sm text-muted-foreground">{customer.id}</p>
					</div>
					<Button
						variant={customer.blocked ? "outline" : "destructive"}
						disabled={busy}
						onClick={() => {
							const blocked = !customer.blocked;
							void mutate(
								() => setBillingCustomerBlocked(projectId, customer.id, blocked),
								t(blocked ? "Customer blocked" : "Customer unblocked"),
							);
						}}
					>
						{customer.blocked ? <ShieldCheck /> : <ShieldBan />}
						{t(customer.blocked ? "Unblock" : "Block")}
					</Button>
				</header>

				<dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
					{contextFields.map(([label, key]) => {
						const value = clientContext[key];
						return (
							<Fact key={key} label={t(label)}>
								{typeof value !== "string" || !value
									? "—"
									: key === "country"
										? region(value)
										: key === "language"
											? language(value)
											: key === "platform"
												? code("platform", value)
												: value}
							</Fact>
						);
					})}
					{spent && (
						<Fact label={t("Total spent")}>
							{formatMoney(spent.amount_micros, spent.currency, locale)}
							{spent.unconverted_purchases > 0 && (
								<span className="block text-xs font-normal text-muted-foreground">
									{spent.unconverted_purchases === 1
										? t("1 purchase awaiting conversion is not included.")
										: t("{count} purchases awaiting conversion are not included.", {
												count: spent.unconverted_purchases.toLocaleString(locale),
											})}
								</span>
							)}
						</Fact>
					)}
					<Fact label={t("First seen")}>{date(customer.first_seen_at)}</Fact>
					<Fact label={t("Last seen")}>{date(customer.last_seen_at)}</Fact>
					<Fact label={t("Aliases")}>
						{info.aliases.length ? info.aliases.join(", ") : t("No aliases")}
					</Fact>
					<Fact label={t("CustomerInfo proof")}>
						{`${info.signature_algorithm} · ${info.signature_key_id}`}
					</Fact>
				</dl>

				<Section title={t("Entitlements and subscriptions")}>
					<div className="space-y-2">
						{activeEntitlements.map((entitlement) => (
							<div
								key={entitlement.identifier}
								className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
							>
								<div>
									<strong>{entitlement.identifier}</strong>
									<p className="text-xs text-muted-foreground">
										{[
											code("status", entitlement.status),
											code("store", entitlement.store || "manual"),
											entitlement.expires_at
												? t("expires {date}", { date: date(entitlement.expires_at) })
												: t("no expiry"),
											entitlement.verification
												? code("verification", entitlement.verification)
												: t("unknown proof"),
										].join(" · ")}
									</p>
								</div>
								{entitlement.verification === "admin" && (
									<Button
										size="sm"
										variant="outline"
										disabled={busy}
										onClick={() => {
											const promotion = overview?.entitlements.find(
												(candidate) => candidate.identifier === entitlement.identifier,
											);
											if (!promotion) return;
											void mutate(
												() => revokeBillingEntitlement(projectId, customer.id, promotion.id),
												t("Promotional entitlement revoked"),
											);
										}}
									>
										{t("Revoke promotion")}
									</Button>
								)}
							</div>
						))}
						{activeEntitlements.length === 0 && (
							<p className="text-sm text-muted-foreground">{t("No active entitlement.")}</p>
						)}
					</div>
					<div className="grid gap-2 sm:grid-cols-[1fr_190px_auto]">
						<select
							aria-label={t("Promotional entitlement")}
							className={selectClass}
							value={grantId}
							onChange={(event) => {
								setGrantId(event.target.value);
							}}
						>
							<option value="">{t("Select entitlement")}</option>
							{(overview?.entitlements ?? [])
								.filter((item) => Boolean(item.active))
								.map((item) => (
									<option key={item.id} value={item.id}>
										{item.display_name} ({item.identifier})
									</option>
								))}
						</select>
						<Input
							aria-label={t("Promotion expiry")}
							type="datetime-local"
							value={grantExpiry}
							onChange={(event) => {
								setGrantExpiry(event.currentTarget.value);
							}}
						/>
						<Button
							disabled={busy || !grantId}
							onClick={() => {
								void mutate(
									() =>
										grantBillingEntitlement(
											projectId,
											customer.id,
											grantId,
											grantExpiry ? new Date(grantExpiry).toISOString() : null,
										),
									t("Promotional entitlement granted"),
								);
							}}
						>
							{t("Grant promotion")}
						</Button>
					</div>
					<RecordTable
						title={t("Subscriptions")}
						rows={info.subscriptions}
						columns={["store_product_id", "store", "status", "expires_at"]}
					/>
					<div>
						<h4 className="mb-2 text-sm font-semibold">{t("Virtual balances")}</h4>
						<div className="flex flex-wrap gap-2">
							{Object.entries(info.balances).map(([currency, balance]) => (
								<Badge key={currency} variant="secondary">
									{currency}: {Number(balance).toLocaleString(locale)}
								</Badge>
							))}
							{Object.keys(info.balances).length === 0 && (
								<span className="text-sm text-muted-foreground">{t("No virtual balance.")}</span>
							)}
						</div>
					</div>
				</Section>

				<Section title={t("Financial and paywall history")}>
					<RecordTable
						title={t("Transactions")}
						rows={transactionRows}
						columns={[
							"store",
							"store_transaction_id",
							"event_type",
							"status",
							"created_at",
							"amount",
						]}
					/>
					<RecordTable
						title={t("Paywall events")}
						rows={detail.paywall_events}
						columns={["event_type", "paywall_id", "placement_identifier", "occurred_at"]}
					/>
					<details>
						<summary className="cursor-pointer text-sm font-semibold">
							{t("All billing events ({count})", { count: detail.events.length })}
						</summary>
						<div className="mt-3">
							<RecordTable
								rows={detail.events.map((event) => ({ ...event, details: transfer(event) }))}
								columns={["event_type", "status", "store", "occurred_at", "details"]}
							/>
						</div>
					</details>
				</Section>

				<Section title={t("Identity operations")}>
					<p className="text-sm text-muted-foreground">
						{t("Merge and deletion are audited and require explicit confirmation.")}
					</p>
					<div className="grid gap-2 sm:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="billing-merge-target">{t("Target customer ID")}</Label>
							<Input
								id="billing-merge-target"
								value={mergeTarget}
								onChange={(event) => {
									setMergeTarget(event.currentTarget.value);
								}}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="billing-merge-confirmation">{t("Type MERGE")}</Label>
							<Input
								id="billing-merge-confirmation"
								value={mergeConfirmation}
								onChange={(event) => {
									setMergeConfirmation(event.currentTarget.value);
								}}
							/>
						</div>
						<Button
							variant="outline"
							disabled={
								busy ||
								!mergeTarget.trim() ||
								mergeTarget.trim() === customer.id ||
								mergeConfirmation !== "MERGE"
							}
							onClick={() => {
								leave(
									() => mergeBillingCustomers(projectId, customer.id, mergeTarget.trim()),
									t("Customer identities merged"),
								).catch(() => undefined);
							}}
						>
							{t("Merge into target")}
						</Button>
					</div>
					<div className="rounded-md border border-destructive/40 p-4">
						<Label htmlFor="billing-delete-confirmation">
							{t("Type the exact customer ID to delete")}
						</Label>
						<Input
							id="billing-delete-confirmation"
							className="mt-2 font-mono"
							value={deleteConfirmation}
							placeholder={customer.id}
							onChange={(event) => {
								setDeleteConfirmation(event.currentTarget.value);
							}}
						/>
						<p className="mt-2 text-xs text-muted-foreground">
							{t(
								"Transactions, subscriptions and events are retained without a customer link; aliases, balances and promotional rights are removed.",
							)}
						</p>
						<Button
							className="mt-3"
							variant="destructive"
							disabled={busy || deleteConfirmation !== customer.id}
							onClick={() => {
								leave(
									() => deleteBillingCustomer(projectId, customer.id),
									t("Billing customer deleted"),
								).catch(() => undefined);
							}}
						>
							<Trash2 />
							{t("Delete billing customer")}
						</Button>
					</div>
				</Section>
			</article>
		</div>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="space-y-4 border-t pt-5">
			<h3 className="text-base font-semibold">{title}</h3>
			{children}
		</section>
	);
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div>
			<dt className="text-xs text-muted-foreground">{label}</dt>
			<dd className="mt-1 break-all text-sm font-medium">{children}</dd>
		</div>
	);
}

function RecordTable({
	title,
	rows,
	columns,
}: {
	title?: string;
	rows: Array<Record<string, unknown>>;
	columns: string[];
}) {
	const { t, code, date } = useMonetizationI18n();
	const cell = (column: string, value: unknown) => {
		const format = columnFormats[column];
		if (format === "date")
			return typeof value === "string" || typeof value === "number" ? date(value) : display(value);
		if (format && typeof value === "string") return code(format, value);
		return display(value);
	};
	return (
		<div>
			{title && <h4 className="mb-2 text-sm font-semibold">{title}</h4>}
			<div className="overflow-x-auto rounded-md border">
				<Table>
					<TableHeader>
						<TableRow>
							{columns.map((column) => (
								<TableHead key={column}>{t(columnLabels[column] ?? column)}</TableHead>
							))}
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.slice(0, 100).map((row, index) => (
							<TableRow key={text(row, "id") || `${text(row, columns[0] ?? "id")}:${index}`}>
								{columns.map((column) => {
									const value = cell(column, row[column]);
									return (
										<TableCell key={column} className="max-w-56 truncate" title={value}>
											{value}
										</TableCell>
									);
								})}
							</TableRow>
						))}
						{rows.length === 0 && (
							<TableRow>
								<TableCell
									colSpan={columns.length}
									className="py-6 text-center text-muted-foreground"
								>
									{t("No record.")}
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}

function sdkContext(attributes?: string | null): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(attributes || "{}");
		if (
			parsed &&
			typeof parsed === "object" &&
			"sdk_context" in parsed &&
			parsed.sdk_context &&
			typeof parsed.sdk_context === "object"
		)
			return Object.fromEntries(Object.entries(parsed.sdk_context));
	} catch {
		return {};
	}
	return {};
}

function transferParties(event: Record<string, unknown>) {
	if (event.event_type !== "transferred") return null;
	try {
		const payload: unknown = JSON.parse(text(event, "payload") || "{}");
		if (!payload || typeof payload !== "object") return null;
		const ids = (value: unknown) =>
			Array.isArray(value) ? value.filter((id) => typeof id === "string").join(", ") : "";
		const from = "transferred_from" in payload ? ids(payload.transferred_from) : "";
		const to = "transferred_to" in payload ? ids(payload.transferred_to) : "";
		return from && to ? { from, to } : null;
	} catch {
		return null;
	}
}

function text(record: Record<string, unknown>, key: string) {
	const value = record[key];
	return typeof value === "string" ? value : "";
}

function display(value: unknown) {
	if (value == null || value === "") return "—";
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}
