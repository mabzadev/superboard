"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCustomDomainPreflightQuery,
  useCustomDomainsQuery,
} from "@/hooks/queries/useConfigurationQueries";
import { useMigrationSourceQuery } from "@/hooks/queries/useMigrationQueries";
import { useRemoveCustomDomainMutation } from "@/hooks/mutations/useConfigurationMutations";
import {
  useCreateMigrationMutation,
  useDeleteMigrationSourceMutation,
  useTestMigrationSourceMutation,
} from "@/hooks/mutations/useMigrationMutations";
import { showErrorNotification } from "@/lib/Notifications";
import { CUSTOM_DOMAIN_PREFLIGHT_POLL_MS } from "@/lib/customDomainStatus";
import { migrationErrorToCopy } from "@/lib/migrationErrorToCopy";
import { ApiError } from "@/lib/ApiError";
import { getApiErrorStatus } from "@/lib/apiErrorHelpers";
import { deriveStep } from "./deriveStep";
import { useLocalAttestation } from "./useLocalAttestation";
import CancelMigrationButton from "./CancelMigrationButton";
import StartStep from "./steps/StartStep";
import DnsVerifyStep from "./steps/DnsVerifyStep";
import CutoverStep from "./steps/CutoverStep";
import ManagementView from "./steps/ManagementView";
import type {
  CustomDomain,
  MigrationCredentials,
  MigrationProvider,
  MigrationTestOutcome,
  MigrationTestResponse,
} from "@/types";

interface MigrationWizardProps {
  projectId: string;
  onIdleCancel?: () => void;
  onMigrationCancelled?: () => void;
}

// Best-effort extraction of a Retry-After hint from a 429 ApiError.
// The backend may surface this as `retry_after` (seconds) inside the response
// body. Headers aren't preserved through ApiError, so body is the safest
// source available. Falls back to a conservative 60s default for 429 so the
// UI always offers a countdown rather than blanking out.
function extractRetryAfterSeconds(err: unknown): number | undefined {
  if (!(err instanceof ApiError) || err.status !== 429) return undefined;
  if (err.data && typeof err.data === "object") {
    const data = err.data as Record<string, unknown>;
    const candidate = data.retry_after ?? data.retryAfter;
    if (typeof candidate === "number" && candidate > 0) {
      return Math.floor(candidate);
    }
    if (typeof candidate === "string") {
      const parsed = Number.parseInt(candidate, 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return 60;
}

const MigrationWizard = ({
  projectId,
  onIdleCancel,
  onMigrationCancelled,
}: MigrationWizardProps) => {
  const attestations = useLocalAttestation(projectId);

  const domainsQuery = useCustomDomainsQuery(projectId);
  const sourceQuery = useMigrationSourceQuery(projectId);

  const removeDomainMutation = useRemoveCustomDomainMutation(projectId);
  const createMigrationMutation = useCreateMigrationMutation(projectId);
  const deleteSourceMutation = useDeleteMigrationSourceMutation(projectId);
  const testSourceMutation = useTestMigrationSourceMutation(projectId);

  const [hostnameForPreflight, setHostnameForPreflight] = useState("");
  const [debouncedHostname, setDebouncedHostname] = useState("");
  const [hostnameFieldError, setHostnameFieldError] = useState<string | null>(
    null
  );
  const [billingBlocked, setBillingBlocked] = useState(false);
  const [featureHidden, setFeatureHidden] = useState(false);

  // Retry-After countdown lives at the wizard level so it survives re-renders
  // of the DNS step. We just tick it down with a 1s interval and let zero
  // re-enable the recheck button naturally.
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<
    number | undefined
  >(undefined);

  // Outcome surfaces shared across cutover/managed views (the credentials step
  // owns its own outcome state internally).
  const [lastTestOutcome, setLastTestOutcome] = useState<
    MigrationTestOutcome | undefined
  >(undefined);

  const initialCredentialsTestedRef = useRef<number | null>(null);

  useEffect(() => {
    if (retryAfterSeconds === undefined || retryAfterSeconds <= 0) return;
    const interval = window.setInterval(() => {
      setRetryAfterSeconds((prev) => {
        if (prev === undefined) return undefined;
        if (prev <= 1) return undefined;
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [retryAfterSeconds]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedHostname(hostnameForPreflight.trim().toLowerCase());
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [hostnameForPreflight]);

  const sourceErrorStatus = sourceQuery.isError
    ? getApiErrorStatus(sourceQuery.error)
    : undefined;

  const step = useMemo(
    () =>
      deriveStep({
        domainsLoading: domainsQuery.isLoading,
        sourceLoading: sourceQuery.isLoading,
        domains: domainsQuery.data,
        source: sourceQuery.data,
        sourceErrorStatus,
        attestations: {
          preflightDone: attestations.preflightDone,
        },
      }),
    [
      domainsQuery.isLoading,
      sourceQuery.isLoading,
      domainsQuery.data,
      sourceQuery.data,
      sourceErrorStatus,
      attestations.preflightDone,
    ]
  );

  const migrationRow: CustomDomain | undefined = domainsQuery.data?.find(
    (d) => d.purpose === "migration"
  );

  const activePreflightHostname =
    step === "dns_verify" ||
    step === "dns_failed" ||
    step === "cutover" ||
    step === "managed"
      ? migrationRow?.hostname
      : debouncedHostname;
  const preflightQuery = useCustomDomainPreflightQuery(
    projectId,
    activePreflightHostname,
    {
      enabled:
        step === "dns_verify" ||
        step === "dns_failed" ||
        step === "cutover" ||
        step === "managed" ||
        debouncedHostname.length > 0,
      refetchInterval:
        step === "dns_verify" || step === "cutover" || step === "managed"
          ? CUSTOM_DOMAIN_PREFLIGHT_POLL_MS
          : false,
    }
  );

  const effectiveStep =
    step === "managed" && preflightQuery.data?.cname_matches !== true
      ? "dns_verify"
      : step;

  const handleApiError = useCallback((err: unknown) => {
    showErrorNotification(migrationErrorToCopy(err));
  }, []);

  const runTest = useCallback(
    async (url?: string): Promise<MigrationTestResponse> => {
      const response = await testSourceMutation.mutateAsync(
        url ? { url } : undefined
      );
      const body = response.data;
      setLastTestOutcome(body.outcome);
      return body;
    },
    [testSourceMutation]
  );

  useEffect(() => {
    const source = sourceQuery.data;
    if (!source || initialCredentialsTestedRef.current === source.id) return;
    initialCredentialsTestedRef.current = source.id;
    void runTest().catch(handleApiError);
  }, [handleApiError, runTest, sourceQuery.data]);

  const setSubmitBackoff = useCallback((seconds: number | undefined) => {
    if (seconds !== undefined) setRetryAfterSeconds(seconds);
  }, []);

  const handleStartSubmit = useCallback(
    async ({
      provider,
      hostname,
      credentials,
    }: {
      provider: MigrationProvider;
      hostname: string;
      credentials: MigrationCredentials;
    }) => {
      try {
        setHostnameFieldError(null);
        await createMigrationMutation.mutateAsync({
          hostname,
          provider,
          credentials,
        });
      } catch (err) {
        const status = getApiErrorStatus(err);
        const message =
          err instanceof ApiError
            ? typeof err.data === "string"
              ? err.data
              : typeof err.data === "object"
                ? JSON.stringify(err.data)
                : err.message
            : err instanceof Error
              ? err.message
              : "";
        if (
          (status === 400 || status === 422) &&
          /missing keys|valid bare hostname/i.test(message)
        ) {
          setHostnameFieldError(
            /valid bare hostname/i.test(message)
              ? "Enter a valid bare hostname"
              : "Check the highlighted credential fields"
          );
          return;
        }
        if (status === 402) {
          setBillingBlocked(true);
          return;
        }
        if (status === 503) {
          setFeatureHidden(true);
          return;
        }
        if (status === 409 && /different project/i.test(message)) {
          setHostnameFieldError("This hostname is attached to another project");
          return;
        }
        if (
          status === 409 &&
          /migration source already configured/i.test(message)
        ) {
          void domainsQuery.refetch();
          void sourceQuery.refetch();
          return;
        }
        if (
          status === 422 &&
          /cleanup pending|retry in 1 minute/i.test(message)
        ) {
          setSubmitBackoff(60);
          return;
        }
        if (status === 429) {
          setSubmitBackoff(extractRetryAfterSeconds(err));
          return;
        }
        if (status === 502) {
          showErrorNotification(
            "Cloudflare is having issues — try again in a few seconds."
          );
          return;
        }
        handleApiError(err);
      }
    },
    [
      createMigrationMutation,
      domainsQuery,
      sourceQuery,
      setSubmitBackoff,
      handleApiError,
    ]
  );

  const handleRecheck = useCallback(async () => {
    if (!migrationRow) return;
    try {
      await removeDomainMutation.mutateAsync("migration");
      attestations.clearAll();
    } catch (err) {
      const status = getApiErrorStatus(err);
      if (status === 429) {
        const seconds = extractRetryAfterSeconds(err);
        if (seconds !== undefined) setRetryAfterSeconds(seconds);
      }
      handleApiError(err);
    }
  }, [attestations, removeDomainMutation, migrationRow, handleApiError]);

  const handleRemoveAll = useCallback(async (): Promise<boolean> => {
    try {
      // Source first, then the migration-purpose custom domain.
      // If the source is already gone (404), continue with the domain removal
      // so the user isn't stuck with stale state.
      try {
        await deleteSourceMutation.mutateAsync();
      } catch (err) {
        if (getApiErrorStatus(err) !== 404) throw err;
      }
      await removeDomainMutation.mutateAsync("migration");
      attestations.clearAll();
      onMigrationCancelled?.();
      return true;
    } catch (err) {
      handleApiError(err);
      return false;
    }
  }, [
    deleteSourceMutation,
    removeDomainMutation,
    attestations,
    handleApiError,
    onMigrationCancelled,
  ]);

  // Cancel handlers — split so the no-confirm path (no domain yet) just
  // clears the draft and the confirm path (domain exists) tears everything
  // down via the same cascade as the management view's "remove all".
  const handleCancelNoConfirm = useCallback(() => {
    attestations.clearAll();
    onIdleCancel?.();
  }, [attestations, onIdleCancel]);

  const handleCancelTeardown = useCallback(async () => {
    try {
      try {
        await deleteSourceMutation.mutateAsync();
      } catch (err) {
        // 404 = source already gone; cascade may have removed it.
        if (getApiErrorStatus(err) !== 404) throw err;
      }
      await removeDomainMutation.mutateAsync("migration");
      attestations.clearAll();
      onMigrationCancelled?.();
    } catch (err) {
      handleApiError(err);
    }
  }, [
    deleteSourceMutation,
    removeDomainMutation,
    attestations,
    handleApiError,
    onMigrationCancelled,
  ]);

  const cancelIsPending =
    removeDomainMutation.isPending || deleteSourceMutation.isPending;

  const destructiveCancelButton = (
    <CancelMigrationButton
      hostname={migrationRow?.hostname ?? null}
      onCancel={migrationRow ? handleCancelTeardown : handleCancelNoConfirm}
      isCancelling={cancelIsPending}
      buttonVariant="destructive"
    />
  );

  const startCancelButton = (
    <CancelMigrationButton
      hostname={null}
      onCancel={handleCancelNoConfirm}
      isCancelling={cancelIsPending}
      buttonVariant="outline"
    />
  );

  if (effectiveStep === "feature_off" || featureHidden) return null;

  if (effectiveStep === "loading") {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-10 w-1/4" />
      </div>
    );
  }

  if (effectiveStep === "not_admin") {
    return (
      <Alert>
        <ShieldAlert />
        <AlertTitle>Only project admins can configure migration.</AlertTitle>
        <AlertDescription>
          <p className="leading-relaxed">
            Ask your project admin to set up the migration source from Branch.io
            or AppsFlyer.
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  if (effectiveStep === "start") {
    // No-confirm mode — the cancel button sits inside the form's footer row.
    return (
      <>
        <StartStep
          onSubmit={handleStartSubmit}
          isSubmitting={createMigrationMutation.isPending}
          disabledUntilSeconds={retryAfterSeconds}
          hostnameFieldError={hostnameFieldError}
          onHostnameChange={setHostnameForPreflight}
          preflight={preflightQuery.data ?? null}
          preflightLoading={preflightQuery.isLoading}
          cancelSlot={startCancelButton}
        />
        <AlertDialog open={billingBlocked} onOpenChange={setBillingBlocked}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Custom domains require an active subscription
              </AlertDialogTitle>
              <AlertDialogDescription>
                Upgrade or restore billing before starting a migration.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction
                onClick={() => {
                  window.location.href = "/settings?tab=plan";
                }}
              >
                Open billing
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  const destructiveCancelFooter = (
    <div className="flex justify-end border-t border-sidebar-border pt-3">
      {destructiveCancelButton}
    </div>
  );

  // For every other onboarding step, destructive cancellation sits at the
  // bottom of the modal and opens the hostname confirmation dialog.
  if (effectiveStep === "dns_verify" || effectiveStep === "dns_failed") {
    if (!migrationRow) return null;
    return (
      <div className="flex flex-col gap-4">
        <DnsVerifyStep
          domain={migrationRow}
          preflight={preflightQuery.data ?? null}
          preflightPending={preflightQuery.isFetching}
          onRecheck={handleRecheck}
          recheckPending={removeDomainMutation.isPending}
          retryAfterSeconds={retryAfterSeconds}
        />
        {destructiveCancelFooter}
      </div>
    );
  }

  if (effectiveStep === "cutover") {
    if (!migrationRow) return null;
    return (
      <div className="flex flex-col gap-4">
        <CutoverStep
          domain={migrationRow}
          testPending={testSourceMutation.isPending}
          lastTestOutcome={lastTestOutcome}
          preflight={preflightQuery.data ?? null}
          preflightPending={preflightQuery.isFetching}
          sourceHealth={sourceQuery.data?.health}
        />
        {destructiveCancelFooter}
      </div>
    );
  }

  // step === "managed" — no Cancel link; the management view has its own
  // destructive zone (Remove migration entirely).
  if (!sourceQuery.data) return null;
  return (
    <ManagementView
      source={sourceQuery.data}
      domain={migrationRow ?? null}
      onRemoveAll={handleRemoveAll}
    />
  );
};

export default MigrationWizard;
