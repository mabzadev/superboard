"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useCustomDomainPreflightQuery,
  useCustomDomainsQuery,
} from "@/hooks/queries/useConfigurationQueries";
import { useMigrationSourceQuery } from "@/hooks/queries/useMigrationQueries";
import { useSubscriptionQuery } from "@/hooks/queries/usePaymentsQueries";
import { useCreateSubscriptionMutation } from "@/hooks/mutations/usePaymentsMutations";
import { useProjectSelection } from "@/context/useProjectSelection";
import { isFeatureOff } from "@/lib/apiErrorHelpers";
import { queryKeys } from "@/lib/queryKeys";
import { ApiError } from "@/lib/ApiError";
import { showErrorNotification } from "@/lib/Notifications";
import { config } from "@/lib/config";
import ScaleUpDialog from "@/components/settings/ScaleUpDialog";
import MigrationWizard from "./MigrationWizard";

interface MigrationEntryProps {
  projectId: string | undefined;
}

const MigrationUpsell = ({ onViewPlans }: { onViewPlans: () => void }) => (
  <div className="flex flex-col gap-4">
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="h-4 w-4 text-muted-foreground" />
        Migration requires a paid plan.
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Grovs needs to serve your old Branch or AppsFlyer hostname, verify DNS,
        and create matching Grovs links on demand. This is available on paid
        plans.
      </p>
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

const MigrationEntry = ({ projectId }: MigrationEntryProps) => {
  const [open, setOpen] = useState(false);
  const [scaleUpOpen, setScaleUpOpen] = useState(false);
  const { selectedInstance } = useProjectSelection();
  const subscriptionQuery = useSubscriptionQuery(selectedInstance?.id);
  const hasPaidPlan = !!subscriptionQuery.data?.subscription;
  const createSubscriptionMutation = useCreateSubscriptionMutation(
    selectedInstance?.id
  );
  const domainsQuery = useCustomDomainsQuery(projectId);
  const sourceQuery = useMigrationSourceQuery(projectId);
  const queryClient = useQueryClient();

  // Mirror CustomDomainSetup: closing the wizard popup reconciles the card
  // immediately instead of leaving the status bubble to wait out the next
  // poll tick.
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next && projectId) {
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.customDomains(projectId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.migrationSource(projectId),
      });
    }
  };

  const migrationDomain = useMemo(
    () => (domainsQuery.data ?? []).find((d) => d.purpose === "migration"),
    [domainsQuery.data]
  );
  const preflightQuery = useCustomDomainPreflightQuery(
    projectId,
    migrationDomain?.hostname,
    {
      enabled:
        Boolean(projectId) &&
        migrationDomain?.status === "active" &&
        Boolean(sourceQuery.data),
      refetchInterval:
        migrationDomain?.status === "active" && sourceQuery.data
          ? 15000
          : false,
    }
  );

  if (!projectId) return null;

  if (sourceQuery.isError && isFeatureOff(sourceQuery.error, 503)) {
    return null;
  }

  const hasMigrationProgress = Boolean(migrationDomain || sourceQuery.data);
  const migrationHostname =
    migrationDomain?.hostname ?? sourceQuery.data?.old_host;
  const migrationStatus =
    migrationDomain?.status ??
    (sourceQuery.data?.enabled ? "enabled" : "paused");
  const migrationIsLive =
    migrationDomain?.status === "active" &&
    Boolean(sourceQuery.data) &&
    preflightQuery.data?.cname_matches === true;
  const migrationIsReadyForDns =
    migrationDomain?.status === "active" &&
    Boolean(sourceQuery.data) &&
    preflightQuery.data?.cname_matches !== true;
  const migrationStatusLabel = (() => {
    if (migrationDomain?.ssl_status === "pending_deployment") {
      return "Deploying SSL";
    }
    if (
      migrationDomain?.ssl_status === "pending_validation" ||
      migrationStatus === "pending" ||
      migrationStatus === "provisioning"
    ) {
      return "Waiting for SSL";
    }
    if (migrationIsLive) {
      return "Active";
    }
    if (migrationIsReadyForDns) return "Ready — waiting for DNS";
    return migrationStatus.replace("_", " ");
  })();
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

  const handleViewPlans = () => {
    handleOpenChange(false);
    setScaleUpOpen(true);
  };

  const dialogBody =
    hasPaidPlan || hasMigrationProgress ? (
      <MigrationWizard
        projectId={projectId}
        onIdleCancel={() => handleOpenChange(false)}
        onMigrationCancelled={() => handleOpenChange(false)}
      />
    ) : (
      <MigrationUpsell onViewPlans={handleViewPlans} />
    );

  return (
    <div id="migration" className="flex flex-col gap-2">
      {hasMigrationProgress ? (
        <div className="flex items-center justify-between rounded-md border border-sidebar-border bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <Badge variant="outline" className="gap-1.5 shrink-0">
              {migrationStatus === "pending" ||
              migrationStatus === "provisioning" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ArrowRightLeft className="h-3 w-3" />
              )}
              Migration
            </Badge>
            <span className="text-sm font-medium truncate">
              {migrationHostname}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground capitalize">
              {migrationStatusLabel}
            </span>
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              {migrationIsLive ? "Manage" : "View setup"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="w-fit gap-2"
            onClick={() => setOpen(true)}
          >
            <ArrowRightLeft className="h-4 w-4" />
            Migrate from another platform
          </Button>
          <span className="text-xs text-muted-foreground leading-relaxed">
            Move an existing Branch or AppsFlyer subdomain to Grovs. Old links
            are recreated on demand and redirected after you point the hostname
            here.
          </span>
        </div>
      )}
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:!max-w-[49vw]">
          {hasMigrationProgress ? (
            <DialogHeader>
              <DialogTitle>
                {migrationIsLive ? "Manage migration" : "Migration setup"}
              </DialogTitle>
              <DialogDescription>
                {migrationIsLive
                  ? "Migration is active."
                  : "Continue configuring the migration."}
              </DialogDescription>
            </DialogHeader>
          ) : (
            <DialogHeader>
              <DialogTitle>Migrate from another platform</DialogTitle>
              <DialogDescription>
                Move an existing Branch or AppsFlyer subdomain to Grovs without
                breaking old links.
              </DialogDescription>
            </DialogHeader>
          )}
          {dialogBody}
        </DialogContent>
      </Dialog>
      <ScaleUpDialog
        open={scaleUpOpen}
        onOpenChange={setScaleUpOpen}
        handleUpgrade={handleUpgrade}
      />
    </div>
  );
};

export default MigrationEntry;
