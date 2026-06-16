"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, Circle, Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { handleCopyText } from "@/lib/copyTextHelper";
import { sslValidationTxtRecordsFor } from "@/lib/dnsTxtRecords";
import type { CustomDomain, CustomDomainPreflight } from "@/types";

// Cloudflare occasionally serializes cleared TXT fields as "" instead of
// null; both mean "nothing to publish", so normalize before gating on them.
function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export const DnsRow = ({
  label,
  value,
  copyable = false,
}: {
  label: string;
  value: string;
  copyable?: boolean;
}) => {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current);
    },
    []
  );

  const handleCopy = () => {
    handleCopyText(value);
    setCopied(true);
    if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5 border-b border-sidebar-border last:border-b-0">
      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider w-12 shrink-0">
        {label}
      </span>
      <code className="text-xs sm:text-sm font-mono break-all flex-1 min-w-0 text-foreground">
        {value}
      </code>
      {copyable && (
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 h-7 gap-1.5"
          onClick={handleCopy}
          aria-label={`Copy ${label}`}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-valid-green" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          <span className="text-xs">{copied ? "Copied" : "Copy"}</span>
        </Button>
      )}
    </div>
  );
};

export const TxtRecordBlock = ({
  title,
  description,
  name,
  value,
}: {
  title: string;
  description?: React.ReactNode;
  name: string;
  value: string;
}) => (
  <div className="flex flex-col gap-1.5">
    <span className="text-xs font-medium text-foreground">{title}</span>
    {description !== undefined && (
      <p className="text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>
    )}
    <div className="rounded-lg border border-sidebar-border bg-background overflow-hidden">
      <DnsRow label="Type" value="TXT" />
      <DnsRow label="Host" value={name} copyable />
      <DnsRow label="Value" value={value} copyable />
    </div>
  </div>
);

const StepIcon = ({ done }: { done: boolean }) =>
  done ? (
    <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600 shrink-0" />
  ) : (
    <Circle className="mt-0.5 h-4 w-4 text-muted-foreground shrink-0" />
  );

// True once every checklist step (ownership TXT, SSL cert, CNAME) is
// satisfied. Exposed so parents can derive their own status headers without
// re-deriving the gating rules.
export function dnsSetupStepsComplete(
  domain: CustomDomain,
  preflight: CustomDomainPreflight | null | undefined
): boolean {
  const ownershipVerified =
    blankToNull(domain.ownership_verification_txt_name) == null &&
    blankToNull(domain.ownership_verification_txt_value) == null;
  return (
    domain.ssl_status === "active" &&
    ownershipVerified &&
    preflight?.cname_matches === true
  );
}

export interface DnsSetupChecklistProps {
  domain: CustomDomain;
  preflight?: CustomDomainPreflight | null;
  preflightPending?: boolean;
}

/**
 * The three-step DNS verification checklist shared by the migration wizard
 * (DnsVerifyStep) and the custom domain dialog:
 *
 *   1. Hostname ownership — Cloudflare Hostname Pre-Validation TXT, present
 *      only while unverified (the pair goes back to null once it resolves).
 *   2. SSL certificate — ACME challenge TXT records ([] right after create
 *      until the refresh job fills them in; can rotate or grow mid-setup).
 *      "pending_deployment" means validation already passed and the cert is
 *      rolling out — nothing left to add.
 *   3. CNAME — only opens once the cert can actually serve, so customers
 *      don't flip traffic onto a hostname that would error.
 *
 * Each TXT pair may never appear at all (e.g. the zone is already on
 * Cloudflare), so every block is independently conditional.
 */
const DnsSetupChecklist = ({
  domain,
  preflight = null,
  preflightPending = false,
}: DnsSetupChecklistProps) => {
  const sslIssued = domain.ssl_status === "active";
  const sslDeploying = domain.ssl_status === "pending_deployment";
  const ownershipTxtName = blankToNull(domain.ownership_verification_txt_name);
  const ownershipTxtValue = blankToNull(
    domain.ownership_verification_txt_value
  );
  const ownershipVerified =
    ownershipTxtName == null && ownershipTxtValue == null;
  const sslTxtRecords = sslValidationTxtRecordsFor(domain);
  const showSslTxtBlock =
    !sslIssued && !sslDeploying && sslTxtRecords.length > 0;
  const showSslPlaceholder =
    !sslIssued && !sslDeploying && sslTxtRecords.length === 0;
  // Cert issuance is the only real gate for flipping DNS: once the cert is
  // deployed the hostname can serve. Ownership deliberately does NOT gate this
  // step — on zones whose DNS is already on Cloudflare, the pre-validation TXT
  // can never activate the hostname ("custom hostname does not CNAME to this
  // zone"); activation happens via the CNAME itself, so withholding the CNAME
  // until ownership verifies would deadlock the setup. On non-Cloudflare zones
  // CF refuses to issue the cert until the ownership TXT resolves, so
  // sslIssued already implies ownership is done there.
  const canConfigureCname = sslIssued;
  const ownershipAwaitingCname = sslIssued && !ownershipVerified;
  const cnameMatches = preflight?.cname_matches === true;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <StepIcon done={ownershipVerified} />
        <div className="flex flex-1 flex-col gap-2 min-w-0">
          <span className="text-sm font-medium">
            Hostname ownership verified
          </span>
          {!ownershipVerified && ownershipTxtName && ownershipTxtValue && (
            <TxtRecordBlock
              title="Add this TXT record at your DNS"
              name={ownershipTxtName}
              value={ownershipTxtValue}
            />
          )}
          {ownershipAwaitingCname && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              If this hostname&apos;s DNS is already on Cloudflare, this TXT
              can&apos;t pre-verify it — ownership completes once the CNAME
              below is in place.
            </p>
          )}
        </div>
      </div>

      <div className="flex items-start gap-2">
        <StepIcon done={sslIssued} />
        <div className="flex flex-1 flex-col gap-2 min-w-0">
          <span className="text-sm font-medium">SSL certificate issued</span>
          {showSslTxtBlock && (
            <div className="flex flex-col gap-3">
              <p className="text-xs leading-relaxed text-muted-foreground">
                Add the TXT record{sslTxtRecords.length === 1 ? "" : "s"} below
                at your DNS. If an _acme-challenge record already exists,
                replace its value or add another one with the same name.
              </p>
              {sslTxtRecords.map((record, index) => (
                <TxtRecordBlock
                  key={`${record.name}:${record.value}`}
                  title={
                    sslTxtRecords.length === 1
                      ? "SSL validation TXT"
                      : `SSL validation TXT ${index + 1}`
                  }
                  name={record.name}
                  value={record.value}
                />
              ))}
            </div>
          )}
          {sslDeploying && (
            <div className="inline-flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-400">
              <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin shrink-0" />
              <div className="flex flex-col gap-0.5">
                <span>SSL validated — certificate deploying.</span>
                <span className="font-normal opacity-90">
                  Nothing to add right now; this usually takes a couple of
                  minutes.
                </span>
              </div>
            </div>
          )}
          {showSslPlaceholder && (
            <div className="inline-flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-400">
              <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin shrink-0" />
              <div className="flex flex-col gap-0.5">
                <span>Preparing SSL validation TXT.</span>
                <span className="font-normal opacity-90">
                  The DNS record will appear here when Grovs creates it.
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-start gap-2">
        <StepIcon done={cnameMatches} />
        <div className="flex flex-1 flex-col gap-2 min-w-0">
          <span className="text-sm font-medium">CNAME pointing to Grovs</span>
          {canConfigureCname && !cnameMatches && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                Add this record at your DNS provider
              </span>
              <div className="rounded-lg border border-sidebar-border bg-background overflow-hidden">
                <DnsRow label="Type" value="CNAME" />
                <DnsRow label="Host" value={domain.hostname} copyable />
                <DnsRow label="Value" value={domain.cname_target} copyable />
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Names vary by provider — your DNS UI may call{" "}
                <span className="font-medium">Host</span> &quot;Name&quot; or
                &quot;Subdomain&quot;, and{" "}
                <span className="font-medium">Value</span> &quot;Target&quot; or
                &quot;Points to&quot;.
              </p>
              <span className="text-xs text-muted-foreground">
                {preflightPending
                  ? "Checking DNS..."
                  : preflight?.cname_actual
                    ? `Currently points to ${preflight.cname_actual}.`
                    : "Waiting for DNS to point at Grovs."}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DnsSetupChecklist;
