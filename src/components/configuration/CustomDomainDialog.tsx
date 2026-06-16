"use client";

import { useCallback, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  AlertCircle,
  ArrowRight,
  Loader2,
  ExternalLink,
  Sparkles,
  Trash2,
} from "lucide-react";
import iosIcon from "@/assets/icons/generic/Apple.svg";
import iosIconDark from "@/assets/icons/generic/Apple_dark_mode.svg";
import androidIcon from "@/assets/icons/generic/Android.svg";
import androidIconDark from "@/assets/icons/generic/Android_dark_mode.svg";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import DeleteConfirm from "@/components/common/delete-confirm";
import DnsSetupChecklist, {
  DnsRow,
} from "@/components/common/dns-setup-checklist";
import { cn } from "@/lib/utils";
import { config } from "@/lib/config";
import { showRetryableError } from "@/lib/Notifications";
import { getApiErrorStatus, getApiErrorMessage } from "@/lib/apiErrorHelpers";
import {
  CUSTOM_DOMAIN_PREFLIGHT_POLL_MS,
  isCustomDomainFailedLike,
  isCustomDomainInFlight,
  isLegacyCustomDomainPayload,
  preflightCnameVerdict,
} from "@/lib/customDomainStatus";
import {
  normalizeVerificationErrors,
  setupVerificationNotices,
} from "@/lib/verificationErrors";
import {
  useCustomDomainQuery,
  useCustomDomainPreflightQuery,
} from "@/hooks/queries/useConfigurationQueries";
import {
  useAddCustomDomainMutation,
  useRemoveCustomDomainMutation,
} from "@/hooks/mutations/useConfigurationMutations";

// Light client check: ASCII, valid hostname, >= 3 labels (i.e. a subdomain,
// not an apex). The server's 422 remains authoritative.
function isLikelySubdomain(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (!/^[\x00-\x7F]+$/.test(v)) return false;
  return /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.){2,}[a-z]{2,}$/i.test(v);
}

function defaultMessageForStatus(status: number | undefined): string {
  switch (status) {
    case 402:
      return "Using your own subdomain requires a paid plan.";
    case 409:
      return "A custom subdomain is already configured for this project.";
    case 422:
      return "Invalid subdomain. Enter a subdomain you control, e.g. links.acme.com (ASCII only).";
    default:
      return "Something went wrong, please try again.";
  }
}

type InlineError = { status: number; message: string };

const VerificationErrors = ({ value }: { value: unknown }) => {
  const errors = normalizeVerificationErrors(value);
  if (errors.length === 0) return null;
  // Rendered as a single muted subtitle (the API returns one string with its
  // own separators), not a bullet list.
  return (
    <p className="text-xs text-muted-foreground leading-relaxed">
      {errors.join(" ")}
    </p>
  );
};

// Mid-setup Cloudflare notices: redundant "point the CNAME" chatter is
// filtered out (the checklist already says it); anything else renders in a
// labeled box so it reads as status, not as an unexplained error string.
const SetupNotices = ({ value }: { value: unknown }) => {
  const notices = setupVerificationNotices(value);
  if (notices.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
      <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
        Cloudflare reported
      </span>
      {notices.map((notice, index) => (
        <p
          key={index}
          className="text-xs leading-relaxed text-muted-foreground"
        >
          {notice}
        </p>
      ))}
    </div>
  );
};

const UpsellBody = ({ onViewPlans }: { onViewPlans: () => void }) => (
  <div className="flex flex-col gap-4">
    <div className="flex flex-col gap-2 rounded-xl border border-sidebar-border bg-muted/30 p-5">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="h-4 w-4 text-muted-foreground" />
        Using your own subdomain requires a paid plan.
      </div>
      <span className="text-sm text-muted-foreground leading-relaxed">
        Get your links on your own subdomain instead of the grovs one, with SSL
        included.
      </span>
    </div>
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={onViewPlans}>
        View plans
      </Button>
      <Button asChild variant="outline" size="sm">
        <a href={`mailto:${config.supportEmail}`}>Contact us</a>
      </Button>
    </div>
  </div>
);

// Per (project + hostname + platform) "visited" flag, persisted in
// localStorage so the row stays hidden after the user has been pointed
// at the setup page. Read once on mount and updated locally; no need
// for cross-tab sync since the dialog is re-mounted on every open.
function useVisited(key: string | null): [boolean, () => void] {
  const [visited, setVisited] = useState(() => {
    if (!key || typeof window === "undefined") return false;
    return window.localStorage.getItem(key) === "1";
  });
  const markVisited = useCallback(() => {
    if (!key || typeof window === "undefined") return;
    window.localStorage.setItem(key, "1");
    setVisited(true);
  }, [key]);
  return [visited, markVisited];
}

const PlatformActionItem = ({
  label,
  subtitle,
  icon,
  onClick,
}: {
  label: string;
  subtitle: string;
  icon: React.ReactNode;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="flex items-center gap-3 rounded-lg border border-sidebar-border bg-background px-3.5 py-3 text-left transition-all group hover:border-foreground/15 w-full"
  >
    <div className="flex items-center justify-center h-8 w-8 rounded-lg shrink-0 border bg-background border-foreground/[0.06]">
      {icon}
    </div>
    <div className="flex flex-col flex-1 min-w-0">
      <span className="text-sm font-medium truncate text-foreground">
        {label}
      </span>
      <span className="text-xs text-muted-foreground truncate">{subtitle}</span>
    </div>
    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-muted-foreground shrink-0 transition-colors" />
  </button>
);

const PlatformSetupActions = ({
  onNavigate,
  iosIntegrated,
  androidIntegrated,
  projectId,
  hostname,
  className,
}: {
  onNavigate: () => void;
  iosIntegrated: boolean;
  androidIntegrated: boolean;
  projectId: string | undefined;
  hostname: string;
  className?: string;
}) => {
  const { resolvedTheme } = useTheme();
  const router = useRouter();
  const baseKey =
    projectId && hostname ? `customDomain:${projectId}:${hostname}` : null;
  const [iosVisited, markIosVisited] = useVisited(
    baseKey ? `${baseKey}:ios:visited` : null
  );
  const [androidVisited, markAndroidVisited] = useVisited(
    baseKey ? `${baseKey}:android:visited` : null
  );

  const showIos = iosIntegrated && !iosVisited;
  const showAndroid = androidIntegrated && !androidVisited;

  if (!showIos && !showAndroid) return null;

  // Mark visited, close the dialog, then push the route. Doing it
  // imperatively (instead of via <Link>) sidesteps any focus/portal
  // teardown that could swallow the navigation as the dialog unmounts.
  const handleClick = (mark: () => void, href: string) => () => {
    mark();
    onNavigate();
    router.push(href);
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {showIos && (
        <PlatformActionItem
          label="iOS app"
          subtitle="Add this subdomain to your associated domains"
          icon={
            <Image
              src={resolvedTheme === "dark" ? iosIconDark : iosIcon}
              alt=""
              width={14}
              height={16}
              className="w-3.5 h-4"
            />
          }
          onClick={handleClick(
            markIosVisited,
            "/developers/ios_setup?step=url_scheme"
          )}
        />
      )}
      {showAndroid && (
        <PlatformActionItem
          label="Android app"
          subtitle="Add this subdomain to your intent filters"
          icon={
            <Image
              src={resolvedTheme === "dark" ? androidIconDark : androidIcon}
              alt=""
              width={16}
              height={16}
              className="w-4 h-4"
            />
          }
          onClick={handleClick(
            markAndroidVisited,
            "/developers/android_setup?step=intent_filters"
          )}
        />
      )}
    </div>
  );
};

const RemoveButton = ({ onConfirm }: { onConfirm: () => Promise<void> }) => (
  <DeleteConfirm
    title="Remove custom subdomain?"
    description="Your links will stop resolving on this subdomain immediately and will fall back to your grovs subdomain. You can add it again later."
    confirmText="Yes, remove subdomain"
    onConfirm={onConfirm}
  >
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
    >
      <Trash2 className="h-3.5 w-3.5" />
      Remove
    </Button>
  </DeleteConfirm>
);

const CustomDomainDialog = ({
  projectId,
  hasPaidPlan,
  planLoading = false,
  open,
  onOpenChange,
  onViewPlans,
  iosIntegrated,
  androidIntegrated,
}: {
  projectId: string | undefined;
  hasPaidPlan: boolean;
  planLoading?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onViewPlans: () => void;
  iosIntegrated: boolean;
  androidIntegrated: boolean;
}) => {
  const { data, isLoading, isError, refetch } = useCustomDomainQuery(projectId);
  const addMutation = useAddCustomDomainMutation(projectId);
  const removeMutation = useRemoveCustomDomainMutation(projectId);

  // Like the migration wizard, the CNAME flip is detected via the preflight
  // endpoint: Cloudflare can mark the hostname + SSL "active" from the TXT
  // challenges alone, before the customer has pointed any traffic at Grovs.
  // Legacy payloads (pre-TXT-contract backends) have no preflight endpoint,
  // so don't poll one that can only 404.
  const isLegacy = !!data && isLegacyCustomDomainPayload(data);
  const inSetup =
    !!data && (isCustomDomainInFlight(data.status) || data.status === "active");
  const preflightQuery = useCustomDomainPreflightQuery(
    projectId,
    data?.hostname,
    {
      enabled: hasPaidPlan && inSetup && !isLegacy,
      // Stop polling once the CNAME is confirmed — there is nothing left for
      // the lookup to detect while the dialog sits open on a live domain.
      refetchInterval: (query) =>
        preflightCnameVerdict(query.state.data) === "matched"
          ? false
          : CUSTOM_DOMAIN_PREFLIGHT_POLL_MS,
    }
  );
  const preflight = preflightQuery.data ?? null;
  // "not_pointed" requires a real DNS answer (NXDOMAIN counts; resolver
  // timeouts don't) — see preflightCnameVerdict. Anything inconclusive lets
  // an "active" domain render as live, matching the previous behavior on
  // deploys without the preflight endpoint.
  const cnameKnownNotPointed =
    preflightCnameVerdict(preflight) === "not_pointed";
  // Distinguish "preflight hasn't answered yet" (first open) from "preflight
  // unavailable" so the live view doesn't flash before the first response.
  const preflightSettling =
    data?.status === "active" && !isLegacy && preflightQuery.isLoading;
  const failedLike = !!data && isCustomDomainFailedLike(data);
  const inDnsSetup =
    !!data &&
    (isCustomDomainInFlight(data.status) ||
      (data.status === "active" && cnameKnownNotPointed));

  // The parent mounts this dialog only while open, so local input/error state
  // starts fresh on every open (no stale draft or error on reopen).
  const [hostname, setHostname] = useState("");
  const [inlineError, setInlineError] = useState<InlineError | null>(null);

  const submitHostname = async (value: string) => {
    setInlineError(null);
    try {
      await addMutation.mutateAsync({ hostname: value, purpose: "primary" });
      setHostname("");
      // GET is invalidated by the mutation; the dialog transitions to Pending.
    } catch (err) {
      const status = getApiErrorStatus(err);
      if (status === 502) {
        showRetryableError(
          getApiErrorMessage(
            err,
            "Temporary error reaching Cloudflare. Please try again."
          ),
          () => submitHostname(value)
        );
        return;
      }
      setInlineError({
        status: status ?? 0,
        message: getApiErrorMessage(err, defaultMessageForStatus(status)),
      });
      if (status === 409) refetch();
    }
  };

  const handleRemove = async () => {
    try {
      await removeMutation.mutateAsync("primary");
      onOpenChange(false);
    } catch {
      // Surfaced generically; GET reconciles on next load.
    }
  };

  const renderInlineError = () => {
    if (!inlineError) return null;
    if (inlineError.status === 402) {
      return (
        <div className="flex flex-col gap-2 rounded-xl border border-sidebar-border bg-muted/30 p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            {inlineError.message}
          </div>
          <button
            type="button"
            onClick={onViewPlans}
            className="text-sm text-blue-600 dark:text-blue-400 underline underline-offset-4 hover:opacity-80 transition-opacity w-fit text-left"
          >
            View plans
          </button>
        </div>
      );
    }
    return (
      <Badge variant="destructive" className="w-fit gap-1.5 py-1 px-2.5">
        <AlertCircle className="h-3 w-3" />
        {inlineError.message}
      </Badge>
    );
  };

  const renderBody = () => {
    // Wait until the plan is known so a subscriber never flashes the upsell.
    if (planLoading) {
      return <div className="h-24 rounded-md bg-muted/50 animate-pulse" />;
    }

    // No paid plan -> upsell immediately (before any setup).
    if (!hasPaidPlan) {
      return <UpsellBody onViewPlans={onViewPlans} />;
    }

    if (isLoading) {
      return <div className="h-24 rounded-md bg-muted/50 animate-pulse" />;
    }

    // 404 is handled by the trigger (hidden); treat any load error gracefully.
    if (isError) {
      return (
        <div className="flex items-center justify-between rounded-md border border-sidebar-border bg-muted/30 px-4 py-3">
          <span className="text-sm text-muted-foreground">
            Couldn&apos;t load custom subdomain settings.
          </span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      );
    }

    // First open on an "active" domain: wait for the initial preflight
    // answer instead of flashing the live view and flipping to setup a
    // round-trip later.
    if (preflightSettling) {
      return <div className="h-24 rounded-md bg-muted/50 animate-pulse" />;
    }

    // ===== Active (CNAME confirmed, or preflight inconclusive/unavailable) =====
    if (data?.status === "active" && !cnameKnownNotPointed && !failedLike) {
      return (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 rounded-xl border border-sidebar-border bg-muted/30 px-4 py-3">
            <a
              href={`https://${data.hostname}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center min-w-0 group"
            >
              <span className="text-sm text-muted-foreground select-none">
                https://
              </span>
              <span className="text-sm font-medium truncate group-hover:underline underline-offset-4">
                {data.hostname}
              </span>
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0 ml-1.5" />
            </a>
            <div className="ml-auto">
              <RemoveButton onConfirm={handleRemove} />
            </div>
          </div>
          <PlatformSetupActions
            onNavigate={() => onOpenChange(false)}
            iosIntegrated={iosIntegrated}
            androidIntegrated={androidIntegrated}
            projectId={projectId}
            hostname={data.hostname}
          />
        </div>
      );
    }

    // ===== Suspended (mid-removal) =====
    // The backend leaves a row "suspended" only while it is being torn down
    // (CustomDomainProvisioningService.destroy holds it suspended during the
    // Cloudflare DELETE; orphans are reaped within minutes). Nothing to fix —
    // just say what's happening instead of pretending verification failed.
    if (data?.status === "suspended") {
      return (
        <div className="flex items-center gap-3 rounded-xl border border-sidebar-border bg-muted/30 px-4 py-3">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium truncate">
              {data.hostname}
            </span>
            <span className="text-xs text-muted-foreground">
              This subdomain is being removed. It will disappear from here
              shortly.
            </span>
          </div>
        </div>
      );
    }

    // ===== Failed-like (status failed, or SSL didn't issue) =====
    if (data && failedLike) {
      return (
        <div className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Badge variant="destructive" className="gap-1.5">
                <AlertCircle className="h-3 w-3" />
                Verification failed
              </Badge>
              <span className="text-sm font-medium">{data.hostname}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={addMutation.isPending}
                onClick={() => submitHostname(data.hostname)}
              >
                Retry
              </Button>
              <RemoveButton onConfirm={handleRemove} />
            </div>
          </div>
          <VerificationErrors value={data.verification_errors} />
        </div>
      );
    }

    // ===== Setup in progress (pending / provisioning / active awaiting CNAME) =====
    // The hostname lives in the dialog title (with the amber chip, same
    // language as the page card), so the body starts straight with the
    // checklist — flat on the dialog background, like the migration wizard.
    if (data && inDnsSetup) {
      return (
        <div className="flex flex-col gap-5">
          {isLegacy ? (
            // Pre-TXT-contract backend: the CNAME is the only instruction the
            // deploy understands, so render the original CNAME-first body
            // instead of a checklist waiting on TXT data that will never come.
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                Add this record at your DNS provider
              </span>
              <div className="rounded-lg border border-sidebar-border bg-background overflow-hidden">
                <DnsRow label="Type" value="CNAME" />
                <DnsRow label="Host" value={data.hostname} copyable />
                <DnsRow label="Value" value={data.cname_target} copyable />
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Names vary by provider — your DNS UI may call{" "}
                <span className="font-medium">Host</span> &quot;Name&quot; or
                &quot;Subdomain&quot;, and{" "}
                <span className="font-medium">Value</span> &quot;Target&quot; or
                &quot;Points to&quot;.
              </p>
            </div>
          ) : (
            <DnsSetupChecklist
              domain={data}
              preflight={preflight}
              preflightPending={preflightQuery.isFetching}
            />
          )}

          <SetupNotices value={data.verification_errors} />

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
            {isLegacy
              ? "Checking your DNS. This usually takes a few minutes."
              : "We re-check your DNS about once a minute. You don't have to refresh."}
          </div>

          {/* No PlatformSetupActions here: the iOS/Android setup pages only
              list the custom subdomain once the domain is active, so sending
              people there mid-setup lands on a page without the promised
              entry. The actions appear in the live view above instead. */}

          <div className="flex justify-end">
            <RemoveButton onConfirm={handleRemove} />
          </div>
        </div>
      );
    }

    // ===== None =====
    const trimmed = hostname.trim();
    const canSubmit = isLikelySubdomain(trimmed) && !addMutation.isPending;

    return (
      <div className="flex flex-col gap-3">
        <div
          className={cn(
            "flex items-center rounded-md border bg-muted/30 px-3 py-2 transition-all",
            inlineError && inlineError.status === 422
              ? "border-destructive/50 ring-[3px] ring-destructive/10"
              : "border-sidebar-border"
          )}
        >
          <span className="text-sm text-muted-foreground select-none">
            https://
          </span>
          <input
            className="text-sm font-medium bg-transparent outline-none flex-1 px-1"
            placeholder="links.acme.com"
            value={hostname}
            onChange={(e) => {
              setHostname(e.target.value.toLowerCase());
              if (inlineError) setInlineError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit) submitHostname(trimmed);
            }}
          />
        </div>
        {renderInlineError()}
        <Button
          className="w-full gap-1.5"
          disabled={!canSubmit}
          onClick={() => submitHostname(trimmed)}
        >
          {addMutation.isPending && (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          )}
          {addMutation.isPending ? "Adding…" : "Add subdomain"}
        </Button>
      </div>
    );
  };

  const { title, description } = (() => {
    if (planLoading || isLoading) {
      return {
        title: "Use your own subdomain",
        description:
          "Your links will resolve on your own subdomain instead of the grovs one. SSL is included.",
      };
    }
    if (!hasPaidPlan) {
      return {
        title: "Use your own subdomain",
        description:
          "Available on paid plans. Get your links on your own subdomain with SSL included.",
      };
    }
    if (isError) {
      return {
        title: "Use your own subdomain",
        description: "Manage your custom subdomain settings.",
      };
    }
    if (preflightSettling) {
      return {
        title: "Use your own subdomain",
        description:
          "Your links will resolve on your own subdomain instead of the grovs one. SSL is included.",
      };
    }
    if (data?.status === "suspended") {
      return {
        title: "Removing your subdomain",
        description: "This subdomain is being removed.",
      };
    }
    if (failedLike) {
      return {
        title: "Subdomain verification failed",
        description:
          "We couldn't verify the DNS record. Check it and try again.",
      };
    }
    if (inDnsSetup) {
      return {
        // The hostname is the headline; the amber chip mirrors the Pending
        // chip on the page card so both surfaces speak the same language.
        title: (
          <span className="flex items-center gap-2.5 min-w-0">
            <span className="truncate">{data?.hostname}</span>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400 shrink-0">
              <Loader2 className="h-3 w-3 animate-spin" />
              Verifying
            </span>
          </span>
        ),
        description:
          "Add these records at your DNS provider. We check for them automatically.",
      };
    }
    if (data?.status === "active") {
      return {
        title: "Your subdomain",
        description: "Live and serving over HTTPS.",
      };
    }
    return {
      title: "Use your own subdomain",
      description:
        "Your links will resolve on your own subdomain instead of the grovs one. SSL is included.",
    };
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* flex overrides the base grid so the header (and the absolutely
          positioned close button) stay pinned while only the body scrolls. */}
      <DialogContent className="sm:max-w-2xl flex max-h-[85dvh] flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {/* The divider is the scroll container's own top border: it spans the
            full dialog width (-mx-6) and scrolled content slides directly
            beneath it, with no gap under the line. */}
        {/* pt-4 lives inside the scroll area, so the first row gets breathing
            room at rest while scrolled content still slides under the line. */}
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border -mx-6 px-6 pt-4 -mb-6 pb-6">
          {renderBody()}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CustomDomainDialog;
