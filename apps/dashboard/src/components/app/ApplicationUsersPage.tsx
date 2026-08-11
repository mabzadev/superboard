"use client";

import { useCallback, useEffect, useState } from "react";
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
import {
  getApplicationUser,
  getApplicationUsers,
  type ApplicationUser,
  type ApplicationUserDetail,
  type ApplicationUserPage,
} from "@/api/identity/applicationUsersService";
import {
  getBillingCustomer,
  searchBillingCustomers,
  type BillingCustomerDetail,
  type BillingCustomerSummary,
} from "@/api/billing/billingService";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useProjectSelection } from "@/context/useProjectSelection";
import {
  EmptyProject,
  ModulePage,
  moduleErrorMessage,
} from "@/components/modules/ModulePage";

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
  const { selectedInstance, selectedProject } = useProjectSelection();
  const [searchDraft, setSearchDraft] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<ApplicationUserPage>(emptyPage);
  const [detail, setDetail] = useState<ApplicationUserDetail | null>(null);
  const [commerce, setCommerce] = useState<CommerceState>({ status: "idle" });
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const administrator = new Set(["owner", "admin"]).has(
    selectedInstance?.role || ""
  );

  const load = useCallback(async () => {
    if (!selectedProject || !administrator) return;
    setLoading(true);
    try {
      setPage(
        await getApplicationUsers(selectedProject.id, {
          query,
          limit: PAGE_SIZE,
          offset,
        })
      );
      setError(null);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [administrator, offset, query, selectedProject]);

  useEffect(() => {
    void load();
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
        try {
          const customers = await searchBillingCustomers(
            selectedProject.id,
            userId
          );
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
    [administrator, selectedProject]
  );

  const submitSearch = () => {
    setOffset(0);
    setQuery(searchDraft.trim());
  };

  return (
    <ModulePage
      title="Application users"
      description="Authentication, linked Google or Apple identities, sessions, subscriptions, entitlements and paywall activity."
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : !administrator ? (
        <Alert>
          <ShieldCheck />
          <AlertTitle>Administrator access required</AlertTitle>
          <AlertDescription>
            Application identity and purchase state contains personal data and
            is available only to project owners and administrators.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Account search</CardTitle>
              <CardDescription>
                Data comes from the Identity Worker and D1 database configured
                for this deployment target. Passwords, tokens and provider
                subject identifiers are never returned.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <div className="relative min-w-64 flex-1">
                <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  value={searchDraft}
                  placeholder="Email, user ID, name or auth provider"
                  onChange={(event) =>
                    setSearchDraft(event.currentTarget.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") submitSearch();
                  }}
                />
              </div>
              <Button disabled={loading} onClick={submitSearch}>
                Search
              </Button>
              <Button
                variant="outline"
                disabled={loading}
                onClick={() => void load()}
              >
                <RefreshCw className={loading ? "animate-spin" : ""} />
                Refresh
              </Button>
            </CardContent>
          </Card>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)]">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="size-5" />
                  Users
                </CardTitle>
                <CardDescription>
                  {page.meta.total.toLocaleString()} active application
                  accounts, including users without a purchase.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead>Authentication</TableHead>
                      <TableHead>Sessions</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {page.data.map((user) => (
                      <UserRow
                        key={user.id}
                        user={user}
                        onInspect={() => void inspect(user.id)}
                      />
                    ))}
                    {!loading && page.data.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="py-10 text-center text-muted-foreground"
                        >
                          No application user matches this search.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">
                    {page.meta.total
                      ? `${page.meta.offset + 1}–${Math.min(
                          page.meta.offset + page.data.length,
                          page.meta.total
                        )} of ${page.meta.total}`
                      : "0 users"}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label="Previous users"
                      disabled={loading || offset === 0}
                      onClick={() =>
                        setOffset((current) => Math.max(0, current - PAGE_SIZE))
                      }
                    >
                      <ChevronLeft />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label="Next users"
                      disabled={loading || !page.meta.has_more}
                      onClick={() =>
                        setOffset((current) => current + PAGE_SIZE)
                      }
                    >
                      <ChevronRight />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <ApplicationUserDetailPanel
              detail={detail}
              commerce={commerce}
              loading={detailLoading}
            />
          </div>
        </div>
      )}
    </ModulePage>
  );
}

function UserRow({
  user,
  onInspect,
}: {
  user: ApplicationUser;
  onInspect: () => void;
}) {
  return (
    <TableRow>
      <TableCell>
        <p className="max-w-64 truncate font-medium">
          {user.name || user.email || "Anonymous user"}
        </p>
        <p className="max-w-64 truncate text-xs text-muted-foreground">
          {user.email || user.id}
        </p>
      </TableCell>
      <TableCell>
        <AuthMethodBadges user={user} />
      </TableCell>
      <TableCell>{user.active_session_count.toLocaleString()} active</TableCell>
      <TableCell>{date(user.created_at)}</TableCell>
      <TableCell>
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Inspect ${user.email || user.id}`}
          onClick={onInspect}
        >
          <Eye />
        </Button>
      </TableCell>
    </TableRow>
  );
}

function AuthMethodBadges({ user }: { user: ApplicationUser }) {
  return (
    <div className="flex max-w-56 flex-wrap gap-1">
      {user.auth_methods.map((method) => (
        <Badge key={method} variant="outline" className="capitalize">
          {method}
        </Badge>
      ))}
      {user.anonymous && <Badge variant="secondary">Anonymous</Badge>}
      {user.email && (
        <Badge variant={user.email_verified ? "secondary" : "destructive"}>
          {user.email_verified ? "Email verified" : "Email unverified"}
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
  if (!detail) {
    return (
      <Card>
        <CardContent className="flex min-h-80 items-center justify-center p-8 text-center text-sm text-muted-foreground">
          {loading
            ? "Loading identity and purchase state…"
            : "Select a user to inspect authentication, entitlements, subscriptions and paywall activity."}
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>
            {detail.name || detail.email || "Anonymous user"}
          </CardTitle>
          <CardDescription className="break-all font-mono">
            {detail.id}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Value label="Email" value={detail.email || "Not provided"} />
            <Value
              label="Email state"
              value={
                detail.email
                  ? detail.email_verified
                    ? "Verified"
                    : "Unverified"
                  : "Not applicable"
              }
            />
            <Value
              label="Active sessions"
              value={String(detail.sessions.active)}
            />
            <Value
              label="Last authentication"
              value={date(detail.sessions.last_authenticated_at)}
            />
          </div>
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <KeyRound className="size-4" /> Linked authentication
            </h3>
            <div className="space-y-2">
              {detail.identities.map((identity) => (
                <div
                  key={`${identity.provider}:${identity.linked_at}`}
                  className="rounded-md border p-3 text-sm"
                >
                  <strong className="capitalize">{identity.provider}</strong>
                  <p className="text-xs text-muted-foreground">
                    {identity.provider_email || "No provider email"} · linked{" "}
                    {date(identity.linked_at)}
                  </p>
                </div>
              ))}
              {detail.password_configured && (
                <div className="rounded-md border p-3 text-sm">
                  <strong>Password</strong>
                  <p className="text-xs text-muted-foreground">
                    Configured; credential material is never exposed.
                  </p>
                </div>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Sessions: {detail.sessions.total} total · {detail.sessions.active}{" "}
            active · {detail.sessions.revoked} revoked ·{" "}
            {detail.sessions.expired} expired
          </p>
        </CardContent>
      </Card>
      <CommercePanel state={commerce} />
    </div>
  );
}

function CommercePanel({ state }: { state: CommerceState }) {
  if (state.status === "idle" || state.status === "loading") {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          {state.status === "loading"
            ? "Loading subscriptions, entitlements and paywall activity…"
            : "Purchase state has not been loaded."}
        </CardContent>
      </Card>
    );
  }
  if (state.status === "none") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Purchases and paywall</CardTitle>
          <CardDescription>
            No financial customer exists for this user.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          This is a valid free account. It remains visible even without a
          subscription, entitlement or paywall event.
        </CardContent>
      </Card>
    );
  }
  if (state.status === "unavailable") {
    return (
      <Alert>
        <AlertTitle>Purchase state unavailable</AlertTitle>
        <AlertDescription>
          Identity remains authoritative and available. Billing may be disabled
          for this target or temporarily unavailable: {state.message}
        </AlertDescription>
      </Alert>
    );
  }
  const info = state.detail.customer_info;
  const entitlements = Object.values(info.entitlements);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Purchases and paywall</CardTitle>
        <CardDescription>
          Server-verified state from the optional Billing capability.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Value
            label="Active subscriptions"
            value={String(info.active_subscriptions.length)}
          />
          <Value
            label="Paywall events"
            value={String(state.detail.paywall_events.length)}
          />
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold">Entitlements</h3>
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
              <span className="text-sm text-muted-foreground">
                No entitlement.
              </span>
            )}
          </div>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold">
            Recent paywall activity
          </h3>
          <div className="space-y-2">
            {state.detail.paywall_events.slice(0, 10).map((event, index) => (
              <div
                key={String(event.id || index)}
                className="rounded-md border p-3 text-sm"
              >
                <strong>{String(event.event_type || "event")}</strong>
                <p className="text-xs text-muted-foreground">
                  {String(event.placement_identifier || "unknown placement")} ·{" "}
                  {date(event.occurred_at)}
                </p>
              </div>
            ))}
            {state.detail.paywall_events.length === 0 && (
              <span className="text-sm text-muted-foreground">
                No paywall activity.
              </span>
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

function date(value: unknown): string {
  if (typeof value !== "string" || !value) return "Never";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function commerceCustomerForUser(
  users: BillingCustomerSummary[],
  userId: string
) {
  return users.find(
    (candidate) =>
      candidate.primary_app_user_id === userId ||
      (candidate.aliases || "").split(",").includes(userId)
  );
}
