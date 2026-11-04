"use client";

import { useFrontContext, usePluginEnabled } from "@superboard/front-ui/context";
import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { EmptyProject, moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import { usePathname, useRouter, useSearchParams } from "@superboard/front-ui/navigation";
import { Alert, AlertDescription, AlertTitle } from "@superboard/front-ui/ui/alert.js";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import { Input } from "@superboard/front-ui/ui/input.js";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@superboard/front-ui/ui/table.js";
import { ChevronLeft, ChevronRight, KeyRound, Search, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
	getBillingCustomer,
	searchBillingCustomers,
	type BillingCustomerDetail,
	type BillingCustomerSummary,
} from "../../api/billing/billingService.js";
import {
	getApplicationUser,
	getApplicationUsers,
	type ApplicationUser,
	type ApplicationUserDetail,
	type ApplicationUserPage,
} from "../../api/identity/applicationUsersService.js";
import { useApplicationUsersI18n } from "../../application-users-i18n.js";
import ApplicationUserActions from "../../ApplicationUserActions.js";
import ApplicationUserSecurity from "../../ApplicationUserSecurity.js";
import ApplicationUserSheet, {
	dateOnly,
	dateTime,
	SessionState,
	SheetSection,
	signInMethods,
} from "./ApplicationUserSheet.js";

const PAGE_SIZE = 50;
const SEARCH_DELAY_MS = 300;
const emptyPage: ApplicationUserPage = {
	data: [],
	meta: { total: 0, limit: PAGE_SIZE, offset: 0, has_more: false },
};

type CommerceState =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "none" }
	| { status: "available"; detail: BillingCustomerDetail }
	| { status: "unavailable"; message: string };

export default function ApplicationUsersPage() {
	const { locale } = useFrontContext();
	const { t } = useApplicationUsersI18n();
	const router = useRouter();
	const pathname = usePathname();
	const search = useSearchParams();
	const selectedUserId = search.get("user");
	const [securityRevision, setSecurityRevision] = useState(0);
	const [actionRevision, setActionRevision] = useState(0);
	const { selectedInstance, selectedProject } = useProjectSelection();
	const billingEnabled = usePluginEnabled("superboard-billing");
	const [searchDraft, setSearchDraft] = useState("");
	const [query, setQuery] = useState("");
	const [offset, setOffset] = useState(0);
	const [page, setPage] = useState<ApplicationUserPage>(emptyPage);
	const [detail, setDetail] = useState<ApplicationUserDetail | null>(null);
	const [commerce, setCommerce] = useState<CommerceState>({ status: "idle" });
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const administrator = new Set(["owner", "admin"]).has(selectedInstance?.role || "");

	const load = useCallback(async () => {
		if (!selectedProject || !administrator) return;
		setLoading(true);
		try {
			setPage(
				await getApplicationUsers(selectedProject.id, {
					query,
					limit: PAGE_SIZE,
					offset,
				}),
			);
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause, locale));
		} finally {
			setLoading(false);
		}
	}, [administrator, locale, offset, query, selectedProject]);

	useEffect(() => {
		Promise.resolve()
			.then(load)
			.catch((cause: unknown) => {
				setError(moduleErrorMessage(cause, locale));
			});
	}, [load, locale]);

	useEffect(() => {
		const timer = setTimeout(() => {
			setQuery(searchDraft.trim());
			setOffset(0);
		}, SEARCH_DELAY_MS);
		return () => {
			clearTimeout(timer);
		};
	}, [searchDraft]);

	const inspect = useCallback(
		async (userId: string) => {
			if (!selectedProject || !administrator) return;
			setDetail(null);
			setCommerce({ status: billingEnabled ? "loading" : "idle" });
			try {
				setDetail(await getApplicationUser(selectedProject.id, userId));
				if (!billingEnabled) return;
				try {
					const customers = await searchBillingCustomers(selectedProject.id, userId);
					const customer = commerceCustomerForUser(customers.data, userId);
					setCommerce(
						customer
							? {
									status: "available",
									detail: await getBillingCustomer(selectedProject.id, customer.id),
								}
							: { status: "none" },
					);
				} catch (cause) {
					setCommerce({ status: "unavailable", message: moduleErrorMessage(cause, locale) });
				}
			} catch (cause) {
				setCommerce({ status: "idle" });
				setError(moduleErrorMessage(cause, locale));
			}
		},
		[administrator, billingEnabled, locale, selectedProject],
	);

	useEffect(() => {
		if (!selectedUserId) return;
		Promise.resolve()
			.then(() => inspect(selectedUserId))
			.catch((cause: unknown) => {
				setError(moduleErrorMessage(cause, locale));
			});
	}, [inspect, locale, selectedUserId]);

	const showUser = (userId: string | null) => {
		const next = new URLSearchParams(search);
		if (userId) next.set("user", userId);
		else next.delete("user");
		const query = next.toString();
		router.push(query ? `${pathname}?${query}` : pathname);
	};

	if (!selectedProject) return <EmptyProject />;
	if (!administrator)
		return (
			<Alert>
				<ShieldCheck />
				<AlertTitle>{t("Administrator access required")}</AlertTitle>
				<AlertDescription>
					{t(
						"Application identity and purchase state contains personal data and is available only to project owners and administrators.",
					)}
				</AlertDescription>
			</Alert>
		);

	const failure = error && (
		<Alert variant="destructive">
			<AlertTitle>{t("Unable to load users")}</AlertTitle>
			<AlertDescription>{error}</AlertDescription>
		</Alert>
	);

	if (selectedUserId)
		return (
			<div className="max-w-3xl space-y-6">
				<Button
					variant="ghost"
					size="sm"
					onClick={() => {
						showUser(null);
					}}
				>
					<ChevronLeft className="rtl:-scale-x-100" />
					{t("All users")}
				</Button>
				{failure}
				{detail?.id === selectedUserId ? (
					<ApplicationUserSheet key={`${selectedProject.id}:${detail.id}`} detail={detail}>
						<SignInMethods detail={detail} />
						<ApplicationUserSecurity
							key={`security:${selectedProject.id}:${detail.id}:${securityRevision}`}
							projectRef={selectedProject.id}
							userId={detail.id}
							onChange={async () => {
								await load();
								setActionRevision((current) => current + 1);
								setDetail(await getApplicationUser(selectedProject.id, detail.id));
							}}
						/>
						{billingEnabled && <CommercePanel state={commerce} />}
						<ApplicationUserActions
							key={`actions:${selectedProject.id}:${detail.id}:${actionRevision}`}
							projectRef={selectedProject.id}
							userId={detail.id}
							name={detail.name ?? ""}
							onChange={async () => {
								await load();
								setSecurityRevision((current) => current + 1);
								setDetail(await getApplicationUser(selectedProject.id, detail.id));
							}}
						/>
					</ApplicationUserSheet>
				) : (
					!error && (
						<p role="status" className="text-sm text-muted-foreground">
							{t("Loading identity and purchase state…")}
						</p>
					)
				)}
			</div>
		);

	const total = page.meta.total;
	return (
		<div className="space-y-4">
			{failure}
			<p className="text-sm text-muted-foreground">
				{total === 1 ? t("1 user") : t("{count} users", { count: total.toLocaleString(locale) })}
			</p>
			<div className="relative">
				<Search className="absolute start-3 top-2.5 size-4 text-muted-foreground" />
				<Input
					type="search"
					className="ps-9"
					value={searchDraft}
					aria-label={t("Search by name, email or ID")}
					placeholder={t("Search by name, email or ID")}
					onChange={(event) => {
						setSearchDraft(event.currentTarget.value);
					}}
				/>
			</div>
			<div className="overflow-x-auto">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>{t("Person")}</TableHead>
							<TableHead>{t("Sign-in")}</TableHead>
							<TableHead>{t("Session")}</TableHead>
							<TableHead>{t("Signed up")}</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{page.data.map((user) => (
							<UserRow
								key={user.id}
								user={user}
								onOpen={() => {
									showUser(user.id);
								}}
							/>
						))}
						{!loading && page.data.length === 0 && (
							<TableRow>
								<TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
									{t("No application user matches this search.")}
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>
			{total > PAGE_SIZE && (
				<div className="flex items-center justify-between gap-3">
					<span className="text-xs text-muted-foreground">
						{t("{start}–{end} of {total}", {
							start: page.meta.offset + 1,
							end: Math.min(page.meta.offset + page.data.length, total),
							total,
						})}
					</span>
					<div className="flex gap-2">
						<Button
							size="sm"
							variant="outline"
							aria-label={t("Previous users")}
							disabled={loading || offset === 0}
							onClick={() => {
								setOffset((current) => Math.max(0, current - PAGE_SIZE));
							}}
						>
							<ChevronLeft className="rtl:-scale-x-100" />
						</Button>
						<Button
							size="sm"
							variant="outline"
							aria-label={t("Next users")}
							disabled={loading || !page.meta.has_more}
							onClick={() => {
								setOffset((current) => current + PAGE_SIZE);
							}}
						>
							<ChevronRight className="rtl:-scale-x-100" />
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}

function UserRow({ user, onOpen }: { user: ApplicationUser; onOpen: () => void }) {
	const { t, locale } = useApplicationUsersI18n();
	return (
		<TableRow className="cursor-pointer" onClick={onOpen}>
			<TableCell>
				<Button
					variant="link"
					className="h-auto max-w-64 justify-start truncate px-0 py-0 font-medium text-foreground"
					onClick={(event) => {
						event.stopPropagation();
						onOpen();
					}}
				>
					{user.name || user.email || t("Anonymous user")}
				</Button>
				<p className="max-w-64 truncate text-xs text-muted-foreground">{user.email || user.id}</p>
			</TableCell>
			<TableCell>{signInMethods(user, t)}</TableCell>
			<TableCell>
				<SessionState user={user} />
			</TableCell>
			<TableCell>{dateOnly(user.created_at, locale)}</TableCell>
		</TableRow>
	);
}

function SignInMethods({ detail }: { detail: ApplicationUserDetail }) {
	const { t, locale } = useApplicationUsersI18n();
	return (
		<SheetSection title={t("Linked authentication")} icon={<KeyRound className="size-4" />}>
			<ul className="space-y-2 text-sm">
				{detail.identities.map((identity) => (
					<li key={`${identity.provider}:${identity.linked_at}`}>
						<strong className="capitalize">
							{identity.provider === "anonymous" ? t("Anonymous") : identity.provider}
						</strong>
						<span className="text-muted-foreground">
							{" · "}
							{t("{email} · linked {date}", {
								email: identity.provider_email || t("No provider email"),
								date: dateOnly(identity.linked_at, locale),
							})}
						</span>
					</li>
				))}
				{detail.password_configured && (
					<li>
						<strong>{t("Password")}</strong>
						<span className="text-muted-foreground">
							{" · "}
							{t("Configured; credential material is never exposed.")}
						</span>
					</li>
				)}
				{detail.identities.length === 0 && !detail.password_configured && (
					<li className="text-muted-foreground">{t("No sign-in method.")}</li>
				)}
			</ul>
		</SheetSection>
	);
}

function CommercePanel({ state }: { state: CommerceState }) {
	const { t, locale } = useApplicationUsersI18n();
	if (state.status === "idle") return null;
	if (state.status === "loading")
		return (
			<SheetSection title={t("Purchases and paywall")}>
				<p role="status" className="text-sm text-muted-foreground">
					{t("Loading subscriptions, entitlements and paywall activity…")}
				</p>
			</SheetSection>
		);
	if (state.status === "none")
		return (
			<SheetSection title={t("Purchases and paywall")}>
				<p className="text-sm text-muted-foreground">
					{t(
						"This is a valid free account. It remains visible even without a subscription, entitlement or paywall event.",
					)}
				</p>
			</SheetSection>
		);
	if (state.status === "unavailable")
		return (
			<SheetSection title={t("Purchases and paywall")}>
				<p className="text-sm text-muted-foreground">
					{t("Identity is available. Purchase details are temporarily unavailable: {message}", {
						message: state.message,
					})}
				</p>
			</SheetSection>
		);
	const info = state.detail.customer_info;
	const entitlements = Object.values(info.entitlements);
	return (
		<SheetSection title={t("Purchases and paywall")}>
			<p className="text-sm text-muted-foreground">
				{t("{subscriptions} active subscriptions · {events} paywall events", {
					subscriptions: info.active_subscriptions.length,
					events: state.detail.paywall_events.length,
				})}
			</p>
			<div className="flex flex-wrap gap-2">
				{entitlements.map((entitlement) => (
					<Badge
						key={entitlement.identifier}
						variant={entitlement.is_active ? "secondary" : "outline"}
					>
						{entitlement.identifier}: {entitlement.status}
					</Badge>
				))}
				{entitlements.length === 0 && (
					<span className="text-sm text-muted-foreground">{t("No entitlement.")}</span>
				)}
			</div>
			{state.detail.paywall_events.length > 0 && (
				<ul className="space-y-1 text-sm">
					{state.detail.paywall_events.slice(0, 10).map((event, index) => (
						<li key={displayValue(event.id, String(index))}>
							<strong>{displayValue(event.event_type, t("event"))}</strong>
							<span className="text-muted-foreground">
								{" · "}
								{displayValue(event.placement_identifier, t("unknown placement"))} ·{" "}
								{dateTime(event.occurred_at, locale)}
							</span>
						</li>
					))}
				</ul>
			)}
		</SheetSection>
	);
}

export function commerceCustomerForUser(users: BillingCustomerSummary[], userId: string) {
	return users.find(
		(candidate) =>
			candidate.primary_app_user_id === userId ||
			(candidate.aliases || "").split(",").includes(userId),
	);
}

function displayValue(value: unknown, fallback: string): string {
	return typeof value === "string" ? value : typeof value === "number" ? String(value) : fallback;
}
