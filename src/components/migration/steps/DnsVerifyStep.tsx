"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import DnsSetupChecklist, {
  dnsSetupStepsComplete,
} from "@/components/common/dns-setup-checklist";
import { isCustomDomainFailedLike } from "@/lib/customDomainStatus";
import { normalizeVerificationErrors } from "@/lib/verificationErrors";
import type { CustomDomain, CustomDomainPreflight } from "@/types";

interface DnsVerifyStepProps {
  domain: CustomDomain;
  preflight?: CustomDomainPreflight | null;
  preflightPending?: boolean;
  onRecheck: () => void;
  recheckPending: boolean;
  retryAfterSeconds?: number;
}

const DnsVerifyStep = ({
  domain,
  preflight,
  preflightPending = false,
  onRecheck,
  recheckPending,
  retryAfterSeconds,
}: DnsVerifyStepProps) => {
  const errors = normalizeVerificationErrors(domain.verification_errors);
  const isFailedLike = isCustomDomainFailedLike(domain);
  const isPendingLike =
    !isFailedLike && !dnsSetupStepsComplete(domain, preflight);
  const statusLabel = isFailedLike
    ? "Setup failed"
    : isPendingLike
      ? "Checking setup"
      : "Setup complete";

  // Two reasons a recheck can be unavailable: a request is already in flight,
  // or the server told us (via Retry-After) to back off. The countdown takes
  // precedence in the label since it carries more information than "pending".
  const countingDown =
    typeof retryAfterSeconds === "number" && retryAfterSeconds > 0;
  const recheckDisabled = recheckPending || countingDown;
  const recheckLabel = countingDown
    ? `Try again in ${retryAfterSeconds}s`
    : recheckPending
      ? "Rechecking…"
      : "Recheck";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1.5">
        {isPendingLike && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600 dark:text-amber-500 shrink-0" />
        )}
        {isFailedLike && (
          <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
        )}
        <span className="text-sm font-medium leading-tight text-muted-foreground">
          {statusLabel}
        </span>
      </div>

      <DnsSetupChecklist
        domain={domain}
        preflight={preflight}
        preflightPending={preflightPending}
      />

      {isPendingLike && (
        <div className="inline-flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-400">
          <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin shrink-0" />
          <div className="flex flex-col gap-0.5">
            <span>Waiting for setup to complete.</span>
            <span className="font-normal opacity-90">
              Grovs will refresh this automatically as DNS updates.
            </span>
          </div>
        </div>
      )}

      {isFailedLike && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>SSL didn&apos;t issue within 72h.</AlertTitle>
          <AlertDescription>
            {errors.length > 0 ? (
              <ul className="list-disc pl-4 space-y-0.5">
                {errors.map((message, index) => (
                  <li key={index} className="leading-relaxed">
                    {message}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="leading-relaxed">
                Verify the TXT record is correct, then start over to re-create
                the challenge.
              </p>
            )}
            <div className="pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={recheckDisabled}
                onClick={onRecheck}
              >
                {recheckPending && !countingDown && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                {recheckLabel}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
};

export default DnsVerifyStep;
