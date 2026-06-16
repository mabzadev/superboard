"use client";

import { AlertCircle, CheckCircle2, Clock, Copy, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { handleCopyText } from "@/lib/copyTextHelper";
import type {
  CustomDomain,
  CustomDomainPreflight,
  MigrationHealth,
  MigrationTestOutcome,
} from "@/types";

interface CutoverStepProps {
  domain: CustomDomain;
  testPending: boolean;
  lastTestOutcome?: MigrationTestOutcome;
  preflight?: CustomDomainPreflight | null;
  preflightPending?: boolean;
  sourceHealth?: MigrationHealth;
}

// Same row primitive as DnsVerifyStep so the visual rhythm of the wizard
// stays consistent across DNS and cutover screens.
const DnsRow = ({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: () => void;
}) => (
  <div className="flex items-center gap-3 px-3.5 py-2.5 border-b border-sidebar-border last:border-b-0">
    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider w-12 shrink-0">
      {label}
    </span>
    <code className="text-xs sm:text-sm font-mono break-all flex-1 min-w-0 text-foreground">
      {value}
    </code>
    <Button
      variant="ghost"
      size="sm"
      className="shrink-0 h-7 gap-1.5"
      onClick={onCopy}
      aria-label={`Copy ${label}`}
    >
      <Copy className="h-3.5 w-3.5" />
      <span className="text-xs">Copy</span>
    </Button>
  </div>
);

// Outcome → user-facing alert. The success path uses the default variant so it
// reads as a positive confirmation; everything else is informational rather
// than destructive (the test action can be retried).
const OutcomeBanner = ({ outcome }: { outcome: MigrationTestOutcome }) => {
  switch (outcome) {
    case "credentials_ok":
      return null;
    case "credentials_invalid":
      return (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Provider rejected these credentials.</AlertTitle>
          <AlertDescription>
            <p className="leading-relaxed">
              Rotate the credentials in Settings → Migration before you flip
              DNS, or old links will stop resolving.
            </p>
          </AlertDescription>
        </Alert>
      );
    case "upstream_rate_limited":
      return (
        <Alert>
          <Clock />
          <AlertTitle>Provider is rate-limiting us.</AlertTitle>
        </Alert>
      );
    case "upstream_unreachable":
      return (
        <Alert>
          <AlertCircle />
          <AlertTitle>Couldn&apos;t reach the provider.</AlertTitle>
        </Alert>
      );
    case "unexpected_success":
      return (
        <Alert>
          <AlertCircle />
          <AlertTitle>Inconclusive result — please contact support.</AlertTitle>
        </Alert>
      );
    default:
      return null;
  }
};

const CutoverStep = ({
  domain,
  testPending,
  lastTestOutcome,
  preflight,
  preflightPending = false,
  sourceHealth,
}: CutoverStepProps) => {
  const sslReady = domain.ssl_status === "active" || domain.status === "active";
  const credentialsReady = lastTestOutcome === "credentials_ok";
  const sourceReady = sourceHealth === "healthy";
  const canFlip = sslReady && credentialsReady && sourceReady;
  const cnameActual = preflight?.cname_actual ?? null;
  const cnameMatches = Boolean(preflight?.cname_matches);
  const pendingPrerequisites = [
    !sslReady ? "SSL" : null,
    !credentialsReady ? "credentials" : null,
    !sourceReady ? "source health" : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold leading-tight">Waiting for DNS</h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Traffic moves gradually as DNS resolvers refresh.
        </p>
      </div>

      {!canFlip && (
        <div className="inline-flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
          Preparing migration: {pendingPrerequisites.join(", ")}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="text-sm font-medium">Update this DNS record</div>
        <div className="rounded-lg border border-sidebar-border bg-background overflow-hidden">
          <DnsRow
            label="Type"
            value="CNAME"
            onCopy={() => handleCopyText("CNAME")}
          />
          <DnsRow
            label="Name"
            value={domain.hostname}
            onCopy={() => handleCopyText(domain.hostname)}
          />
          <DnsRow
            label="Target"
            value={domain.cname_target}
            onCopy={() => handleCopyText(domain.cname_target)}
          />
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Lower TTL to 60s before flipping.
        </p>
      </div>

      {cnameMatches ? (
        <Alert className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 />
          <AlertTitle>Cutover complete.</AlertTitle>
        </Alert>
      ) : (
        <div className="inline-flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-400">
          <Loader2
            className={
              preflightPending
                ? "mt-0.5 h-3.5 w-3.5 animate-spin shrink-0"
                : "mt-0.5 h-3.5 w-3.5 shrink-0"
            }
          />
          <div className="flex flex-col gap-0.5">
            <span>Waiting for DNS to point at Grovs.</span>
            <span className="font-normal opacity-90">
              {preflight?.dns_error
                ? "Could not resolve yet."
                : cnameActual
                  ? `Currently points to ${cnameActual}.`
                  : "Check again after you update the CNAME."}
            </span>
          </div>
        </div>
      )}

      {lastTestOutcome !== undefined && (
        <OutcomeBanner outcome={lastTestOutcome} />
      )}

      {testPending && (
        <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Checking credentials...
        </div>
      )}
    </div>
  );
};

export default CutoverStep;
