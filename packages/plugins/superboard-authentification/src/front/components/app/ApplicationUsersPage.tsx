"use client";

import { useFrontContext, usePluginEnabled } from "@superboard/front-ui/context";
import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { LinkButton } from "@superboard/front-ui/kumo";
import {
	EmptyProject,
	ModulePage,
	moduleErrorMessage,
} from "@superboard/front-ui/modules/ModulePage.js";
import { Alert, AlertDescription, AlertTitle } from "@superboard/front-ui/ui/alert.js";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@superboard/front-ui/ui/card.js";
import { Input } from "@superboard/front-ui/ui/input.js";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@superboard/front-ui/ui/table.js";
import {
	ChevronLeft,
	ChevronRight,
	Eye,
	KeyRound,
	RefreshCw,
	Search,
	ShieldCheck,
	Users,
} from "lucide-react";
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

const PAGE_SIZE = 50;
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
	const [securityRevision, setSecurityRevision] = useState(0);
	const [actionRevision, setActionRevision] = useState(0);
	const { selectedInstance, selectedProject } = useProjectSelection();
	const billingEnabled = usePluginEnabled("supbrd-plugmod-billing");
	const [searchDraft, setSearchDraft] = useState("");
	const [query, setQuery] = useState("");
	const [offset, setOffset] = useState(0);
	const [page, setPage] = useState<ApplicationUserPage>(emptyPage);
	const [detail, setDetail] = useState<ApplicationUserDetail | null>(null);
	const [commerce, setCommerce] = useState<CommerceState>({ status: "idle" });
	const [loading, setLoading] = useState(false);
	const [detailLoading, setDetailLoading] = useState(false);
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
			setError(moduleErrorMessage(cause));
		} finally {
			setLoading(false);
		}
	}, [administrator, offset, query, selectedProject]);

	useEffect(() => {
		Promise.resolve()
			.then(load)
			.catch((cause: unknown) => {
				setError(moduleErrorMessage(cause));
			});
	}, [load]);

	const inspect = useCallback(
		async (userId: string) => {
			if (!selectedProject || !administrator) return;
			setDetailLoading(true);
			setDetail(null);
			setCommerce({ status: "loading" });
			try {
				const identity = await getApplicationUser(selectedProject.id, userId);
				setDetail(identity);
				if (!billingEnabled) {
					setCommerce({ status: "idle" });
					return;
				}
				try {
					const customers = await searchBillingCustomers(selectedProject.id, userId);
					const customer = commerceCustomerForUser(customers.data, userId);
					if (!customer) {
						setCommerce({ status: "none" });
					} else {
						setCommerce({
							status: "available",
							detail: await getBillingCustomer(selectedProject.id, customer.id),
						});
					}
				} catch (cause) {
					setCommerce({
						status: "unavailable",
						message: moduleErrorMessage(cause),
					});
				}
			} catch (cause) {
				setCommerce({ status: "idle" });
				setError(moduleErrorMessage(cause));
			} finally {
				setDetailLoading(false);
			}
		},
		[administrator, selectedProject, billingEnabled],
	);

	const submitSearch = () => {
		setOffset(0);
		setQuery(searchDraft.trim());
	};

	return (
		<ModulePage
			title={t("Application users")}
			description={t(
				"Authentication, linked Google or Apple identities, sessions, subscriptions, entitlements and paywall activity.",
			)}
			error={error}
		>
			<LinkButton href={`/auth?lang=${locale}`}>{t("All authentication views")}</LinkButton>
			{!selectedProject ? (
				<EmptyProject />
			) : !administrator ? (
				<Alert>
					<ShieldCheck />
					<AlertTitle>{t("Administrator access required")}</AlertTitle>
					<AlertDescription>
						{t(
							"Application identity and purchase state contains personal data and is available only to project owners and administrators.",
						)}
					</AlertDescription>
				</Alert>
			) : (
				<div className="space-y-6">
					<Card>
						<CardHeader>
							<CardTitle>{t("Account search")}</CardTitle>
							<CardDescription>
								{t(
									"Data comes from the Identity Worker and D1 database configured for this deployment target. Passwords, tokens and provider subject identifiers are never returned.",
								)}
							</CardDescription>
						</CardHeader>
						<CardContent className="flex flex-wrap gap-2">
							<div className="relative min-w-64 flex-1">
								<Search className="absolute start-3 top-2.5 size-4 text-muted-foreground" />
								<Input
									className="ps-9"
									value={searchDraft}
									placeholder={t("Email, user ID, name or auth provider")}
									onChange={(event) => {
										setSearchDraft(event.currentTarget.value);
									}}
									onKeyDown={(event) => {
										if (event.key === "Enter") submitSearch();
									}}
								/>
							</div>
							<Button disabled={loading} onClick={submitSearch}>
								{t("Search")}
							</Button>
							<Button variant="outline" disabled={loading} onClick={() => void load()}>
								<RefreshCw className={loading ? "animate-spin" : ""} />
								{t("Refresh")}
							</Button>
						</CardContent>
					</Card>

					<div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)]">
						<Card>
							<CardHeader>
								<CardTitle className="flex items-center gap-2">
									<Users className="size-5" />
									{t("Users")}
								</CardTitle>
								<CardDescription>
									{t("{count} active application accounts, including users without a purchase.", {
										count: page.meta.total.toLocaleString(locale),
									})}
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4 overflow-x-auto">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>{t("Account")}</TableHead>
											<TableHead>{t("Authentication")}</TableHead>
											<TableHead>{t("Sessions")}</TableHead>
											<TableHead>{t("Created")}</TableHead>
											<TableHead />
										</TableRow>
									</TableHeader>
									<TableBody>
										{page.data.map((user) => (
											<UserRow key={user.id} user={user} onInspect={() => void inspect(user.id)} />
										))}
										{!loading && page.data.length === 0 && (
											<TableRow>
												<TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
													{t("No application user matches this search.")}
												</TableCell>
											</TableRow>
										)}
									</TableBody>
								</Table>
								<div className="flex items-center justify-between gap-3">
									<span className="text-xs text-muted-foreground">
										{page.meta.total
											? t("{start}–{end} of {total}", {
													start: page.meta.offset + 1,
													end: Math.min(page.meta.offset + page.data.length, page.meta.total),
													total: page.meta.total,
												})
											: t("0 users")}
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
											<ChevronLeft />
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
											<ChevronRight />
										</Button>
									</div>
								</div>
							</CardContent>
						</Card>

						<div className="grid content-start gap-4">
							{detail && (
								<ApplicationUserActions
									key={`${selectedProject.id}:${detail.id}:${actionRevision}`}
									projectRef={selectedProject.id}
									userId={detail.id}
									name={detail.name ?? ""}
									onChange={async () => {
										await load();
										setSecurityRevision((current) => current + 1);
										setDetail(await getApplicationUser(selectedProject.id, detail.id));
									}}
								/>
							)}
							<ApplicationUserDetailPanel
								detail={detail}
								commerce={commerce}
								loading={detailLoading}
							/>
							{detail && (
								<ApplicationUserSecurity
									key={`${selectedProject.id}:${detail.id}:${securityRevision}`}
									projectRef={selectedProject.id}
									userId={detail.id}
									onChange={async () => {
										await load();
										setActionRevision((current) => current + 1);
										setDetail(await getApplicationUser(selectedProject.id, detail.id));
									}}
								/>
							)}
						</div>
					</div>
				</div>
			)}
		</ModulePage>
	);
}

function UserRow({ user, onInspect }: { user: ApplicationUser; onInspect: () => void }) {
	const { t, locale } = useApplicationUsersI18n();
	return (
		<TableRow>
			<TableCell>
				<p className="max-w-64 truncate font-medium">
					{user.name || user.email || t("Anonymous user")}
				</p>
				<p className="max-w-64 truncate text-xs text-muted-foreground">{user.email || user.id}</p>
			</TableCell>
			<TableCell>
				<AuthMethodBadges user={user} />
			</TableCell>
			<TableCell>
				{t("{count} active", { count: user.active_session_count.toLocaleString(locale) })}
			</TableCell>
			<TableCell>{date(user.created_at, locale)}</TableCell>
			<TableCell>
				<Button
					size="icon"
					variant="ghost"
					aria-label={t("Inspect {user}", { user: user.email || user.id })}
					onClick={onInspect}
				>
					<Eye />
				</Button>
			</TableCell>
		</TableRow>
	);
}

function AuthMethodBadges({ user }: { user: ApplicationUser }) {
	const { t } = useApplicationUsersI18n();
	return (
		<div className="flex max-w-56 flex-wrap gap-1">
			{user.auth_methods.map((method) => (
				<Badge
					key={
						method === "password" ? t("Password") : method === "anonymous" ? t("Anonymous") : method
					}
					variant="outline"
					className="capitalize"
				>
					{method === "password" ? t("Password") : method === "anonymous" ? t("Anonymous") : method}
				</Badge>
			))}
			{user.anonymous && <Badge variant="secondary">{t("Anonymous")}</Badge>}
			{user.email && (
				<Badge variant={user.email_verified ? "secondary" : "destructive"}>
					{user.email_verified ? t("Email verified") : t("Email unverified")}
				</Badge>
			)}
		</div>
	);
}

function ApplicationUserDetailPanel({
	detail,
	commerce,
	loading,
}: {
	detail: ApplicationUserDetail | null;
	commerce: CommerceState;
	loading: boolean;
}) {
	const { t, locale } = useApplicationUsersI18n();
	if (!detail) {
		return (
			<Card>
				<CardContent className="flex min-h-80 items-center justify-center p-8 text-center text-sm text-muted-foreground">
					{loading
						? t("Loading identity and purchase state…")
						: t(
								"Select a user to inspect authentication, entitlements, subscriptions and paywall activity.",
							)}
				</CardContent>
			</Card>
		);
	}
	return (
		<div className="space-y-4">
			<Card>
				<CardHeader>
					<CardTitle>{detail.name || detail.email || t("Anonymous user")}</CardTitle>
					<CardDescription className="break-all font-mono">{detail.id}</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid gap-3 sm:grid-cols-2">
						<Value label={t("Email")} value={detail.email || t("Not provided")} />
						<Value
							label={t("Email state")}
							value={
								detail.email
									? detail.email_verified
										? t("Verified")
										: t("Unverified")
									: t("Not applicable")
							}
						/>
						<Value label={t("Active sessions")} value={String(detail.sessions.active)} />
						<Value
							label={t("Last authentication")}
							value={date(detail.sessions.last_authenticated_at, locale)}
						/>
					</div>
					<div>
						<h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
							<KeyRound className="size-4" /> {t("Linked authentication")}
						</h3>
						<div className="space-y-2">
							{detail.identities.map((identity) => (
								<div
									key={`${identity.provider}:${identity.linked_at}`}
									className="rounded-md border p-3 text-sm"
								>
									<strong className="capitalize">
										{identity.provider === "anonymous" ? t("Anonymous") : identity.provider}
									</strong>
									<p className="text-xs text-muted-foreground">
										{t("{email} · linked {date}", {
											email: identity.provider_email || t("No provider email"),
											date: date(identity.linked_at, locale),
										})}
									</p>
								</div>
							))}
							{detail.password_configured && (
								<div className="rounded-md border p-3 text-sm">
									<strong>{t("Password")}</strong>
									<p className="text-xs text-muted-foreground">
										{t("Configured; credential material is never exposed.")}
									</p>
								</div>
							)}
						</div>
					</div>
					<p className="text-xs text-muted-foreground">
						{t(
							"Sessions: {total} total · {active} active · {revoked} revoked · {expired} expired",
							{
								total: detail.sessions.total,
								active: detail.sessions.active,
								revoked: detail.sessions.revoked,
								expired: detail.sessions.expired,
							},
						)}
					</p>
				</CardContent>
			</Card>
			<CommercePanel state={commerce} />
		</div>
	);
}

function CommercePanel({ state }: { state: CommerceState }) {
	const { t, locale } = useApplicationUsersI18n();
	if (state.status === "idle" || state.status === "loading") {
		return (
			<Card>
				<CardContent className="p-6 text-sm text-muted-foreground">
					{state.status === "loading"
						? t("Loading subscriptions, entitlements and paywall activity…")
						: t("Purchase state has not been loaded.")}
				</CardContent>
			</Card>
		);
	}
	if (state.status === "none") {
		return (
			<Card>
				<CardHeader>
					<CardTitle>{t("Purchases and paywall")}</CardTitle>
					<CardDescription>{t("No financial customer exists for this user.")}</CardDescription>
				</CardHeader>
				<CardContent className="text-sm text-muted-foreground">
					{t(
						"This is a valid free account. It remains visible even without a subscription, entitlement or paywall event.",
					)}
				</CardContent>
			</Card>
		);
	}
	if (state.status === "unavailable") {
		return (
			<Alert>
				<AlertTitle>{t("Purchase state unavailable")}</AlertTitle>
				<AlertDescription>
					{t("Identity is available. Purchase details are temporarily unavailable: {message}", {
						message: state.message,
					})}
				</AlertDescription>
			</Alert>
		);
	}
	const info = state.detail.customer_info;
	const entitlements = Object.values(info.entitlements);
	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("Purchases and paywall")}</CardTitle>
				<CardDescription>
					{t("Server-verified state from the optional Billing capability.")}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="grid gap-3 sm:grid-cols-2">
					<Value
						label={t("Active subscriptions")}
						value={String(info.active_subscriptions.length)}
					/>
					<Value label={t("Paywall events")} value={String(state.detail.paywall_events.length)} />
				</div>
				<div>
					<h3 className="mb-2 text-sm font-semibold">{t("Entitlements")}</h3>
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
				</div>
				<div>
					<h3 className="mb-2 text-sm font-semibold">{t("Recent paywall activity")}</h3>
					<div className="space-y-2">
						{state.detail.paywall_events.slice(0, 10).map((event, index) => (
							<div
								key={displayValue(event.id, String(index))}
								className="rounded-md border p-3 text-sm"
							>
								<strong>{displayValue(event.event_type, t("event"))}</strong>
								<p className="text-xs text-muted-foreground">
									{displayValue(event.placement_identifier, t("unknown placement"))} ·{" "}
									{date(event.occurred_at, locale)}
								</p>
							</div>
						))}
						{state.detail.paywall_events.length === 0 && (
							<span className="text-sm text-muted-foreground">{t("No paywall activity.")}</span>
						)}
					</div>
				</div>
			</CardContent>
		</Card>
	);
}

function Value({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<p className="text-xs text-muted-foreground">{label}</p>
			<p className="break-words text-sm font-medium">{value}</p>
		</div>
	);
}

function date(value: unknown, locale: string): string {
	if (typeof value !== "string" || !value) return locale === "fr" ? "Jamais" : "Never";
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString(locale);
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
