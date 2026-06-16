"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Globe, Loader2, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getApiErrorStatus } from "@/lib/apiErrorHelpers";
import {
  CUSTOM_DOMAIN_PREFLIGHT_POLL_MS,
  isCustomDomainInFlight,
  isLegacyCustomDomainPayload,
  preflightCnameVerdict,
} from "@/lib/customDomainStatus";
import { ApiError } from "@/lib/ApiError";
import { queryKeys } from "@/lib/queryKeys";
import { showErrorNotification } from "@/lib/Notifications";
import { useProjectSelection } from "@/context/useProjectSelection";
import {
  useCustomDomainsQuery,
  useCustomDomainPreflightQuery,
} from "@/hooks/queries/useConfigurationQueries";
import { useSubscriptionQuery } from "@/hooks/queries/usePaymentsQueries";
import { useInstanceDetailsQuery } from "@/hooks/queries/useInstanceQueries";
import { useCreateSubscriptionMutation } from "@/hooks/mutations/usePaymentsMutations";
import ScaleUpDialog from "@/components/settings/ScaleUpDialog";
import CustomDomainDialog from "./CustomDomainDialog";

const CustomDomainSetup = ({
  projectId,
}: {
  projectId: string | undefined;
}) => {
  const { selectedInstance } = useProjectSelection();
  const subscriptionQuery = useSubscriptionQuery(selectedInstance?.id);
  const hasPaidPlan = !!subscriptionQuery.data?.subscription;
  const planLoading = subscriptionQuery.isLoading;

  // Drive the per-platform "go to app setup" actions off which SDKs are
  // actually integrated, so we don't nag people without a matching app.
  const { data: instanceDetails } = useInstanceDetailsQuery(
    selectedInstance?.id
  );
  const iosIntegrated = instanceDetails?.get_started_setup?.ios_sdk === true;
  const androidIntegrated =
    instanceDetails?.get_started_setup?.android_sdk === true;

  const createSubscriptionMutation = useCreateSubscriptionMutation(
    selectedInstance?.id
  );

  const { data, isError, error } = useCustomDomainsQuery(projectId);
  // The card is scoped to the primary domain; migration rows belong to the
  // separate Migration Source card and must be filtered out here.
  const primary = (data ?? []).find((d) => d.purpose === "primary") ?? null;
  // Cloudflare can mark the hostname "active" from the TXT challenges alone,
  // before the customer points the CNAME. The dialog keeps showing setup in
  // that case, so the card must not claim the domain is live either. Shares
  // the dialog's preflight query key, so there are no duplicate requests
  // while both are mounted.
  const preflightQuery = useCustomDomainPreflightQuery(
    projectId,
    primary?.hostname,
    {
      enabled:
        primary?.status === "active" && !isLegacyCustomDomainPayload(primary),
      refetchInterval: (query) =>
        preflightCnameVerdict(query.state.data) === "matched"
          ? false
          : CUSTOM_DOMAIN_PREFLIGHT_POLL_MS,
    }
  );
  const activeAwaitingCname =
    primary?.status === "active" &&
    preflightCnameVerdict(preflightQuery.data) === "not_pointed";
  const [open, setOpen] = useState(false);
  const [scaleUpOpen, setScaleUpOpen] = useState(false);
  const queryClient = useQueryClient();

  // Closing the popup is the moment the user expects the card to reflect
  // whatever the dialog last knew (the dialog reads the singular endpoint,
  // the card the plural list). Reconcile immediately instead of leaving the
  // bubble to wait out the next poll tick.
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next && projectId) {
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.customDomains(projectId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.customDomain(projectId),
      });
    }
  };

  const handleUpgrade = async () => {
    try {
      const response = await createSubscriptionMutation.mutateAsync();
      window.location.href = response.data.url;
    } catch (err) {
      showErrorNotification(
        err instanceof ApiError
          ? err.message
          : "Something went wrong, please try again"
      );
    }
  };

  // "View plans" -> close this modal and open the in-app Scale Up plans popup.
  const handleViewPlans = () => {
    handleOpenChange(false);
    setScaleUpOpen(true);
  };

  // 404 -> feature unavailable on this deployment -> hide the trigger entirely.
  if (isError && getApiErrorStatus(error) === 404) {
    return null;
  }

  const renderTrigger = () => {
    if (primary?.status === "active" && !activeAwaitingCname) {
      // Mirror the default subdomain field's look; Manage replaces the checkmark.
      return (
        <div className="flex items-center rounded-md border border-sidebar-border bg-muted/30 px-4 py-3">
          <span className="text-sm text-muted-foreground select-none">
            https://
          </span>
          <span className="text-sm font-medium truncate">
            {primary.hostname}
          </span>
          <div className="ml-auto pl-3">
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => setOpen(true)}
            >
              Manage
            </Button>
          </div>
        </div>
      );
    }

    if (
      primary &&
      (isCustomDomainInFlight(primary.status) || activeAwaitingCname)
    ) {
      return (
        <div className="flex items-center justify-between rounded-md border border-sidebar-border bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400 shrink-0">
              <Loader2 className="h-3 w-3 animate-spin" />
              {activeAwaitingCname ? "Verifying" : "Pending"}
            </span>
            <span className="text-sm font-medium truncate">
              {primary.hostname}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => setOpen(true)}
          >
            View setup
          </Button>
        </div>
      );
    }

    if (primary?.status === "failed") {
      return (
        <div className="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <Badge variant="destructive" className="gap-1.5 shrink-0">
              <AlertCircle className="h-3 w-3" />
              Verification failed
            </Badge>
            <span className="text-sm font-medium truncate">
              {primary.hostname}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => setOpen(true)}
          >
            Fix
          </Button>
        </div>
      );
    }

    // None (or still loading) -> the entry-point button.
    return (
      <div className="flex flex-col items-start gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="w-fit gap-2"
          onClick={() => setOpen(true)}
        >
          <Globe className="h-4 w-4" />
          Use your own subdomain
        </Button>
        <span className="text-xs text-muted-foreground leading-relaxed">
          Serve new Grovs links from a branded subdomain you control.
        </span>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {renderTrigger()}
      {open && (
        <CustomDomainDialog
          projectId={projectId}
          hasPaidPlan={hasPaidPlan}
          planLoading={planLoading}
          open={open}
          onOpenChange={handleOpenChange}
          onViewPlans={handleViewPlans}
          iosIntegrated={iosIntegrated}
          androidIntegrated={androidIntegrated}
        />
      )}
      <ScaleUpDialog
        open={scaleUpOpen}
        onOpenChange={setScaleUpOpen}
        handleUpgrade={handleUpgrade}
      />
    </div>
  );
};

export default CustomDomainSetup;
