"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  HelpCircle,
  Info,
  WifiOff,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { credentialsSchemaFor } from "@/schemas/migration";
import CredentialsFields, {
  APPSFLYER_EMPTY,
  BRANCH_EMPTY,
  type AppsflyerValues,
  type BranchValues,
} from "../CredentialsFields";
import type {
  MigrationCredentials,
  MigrationProvider,
  MigrationTestOutcome,
  MigrationTestResponse,
} from "@/types";

interface CredentialsStepProps {
  provider: MigrationProvider;
  oldHost: string;
  onSubmit: (
    credentials: MigrationCredentials
  ) => Promise<MigrationTestResponse>;
  isSubmitting: boolean;
}

const CredentialsStep = ({
  provider,
  oldHost,
  onSubmit,
  isSubmitting,
}: CredentialsStepProps) => {
  const [branchValues, setBranchValues] = useState<BranchValues>(BRANCH_EMPTY);
  const [appsflyerValues, setAppsflyerValues] =
    useState<AppsflyerValues>(APPSFLYER_EMPTY);
  const [showBranchKey, setShowBranchKey] = useState(false);
  const [showApiToken, setShowApiToken] = useState(false);
  // Local outcome state — set after the awaited test response, cleared on edit.
  // We track outcome here rather than reacting purely to a parent prop so the
  // banner survives until either the next submit attempt or the user edits a
  // field. (Parent re-render via deriveStep replaces this component on
  // credentials_ok, so the success banner is only briefly visible — that's
  // intentional, per spec.)
  const [outcome, setOutcome] = useState<MigrationTestOutcome | null>(null);

  // Build the parsed-and-validated credentials object (or null when invalid),
  // mirroring ProviderStep's per-render safeParse pattern.
  const parsed = useMemo<{
    ok: boolean;
    value: MigrationCredentials | null;
  }>(() => {
    const schema = credentialsSchemaFor(provider);
    const raw =
      provider === "branch"
        ? { branch_key: branchValues.branch_key.trim() }
        : {
            onelink_id: appsflyerValues.onelink_id.trim(),
            api_token: appsflyerValues.api_token.trim(),
          };
    const result = schema.safeParse(raw);
    if (result.success) {
      return { ok: true, value: result.data as MigrationCredentials };
    }
    return { ok: false, value: null };
  }, [provider, branchValues, appsflyerValues]);

  const canSubmit = parsed.ok && !isSubmitting;

  const clearOutcomeOnEdit = () => {
    if (outcome !== null) setOutcome(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || parsed.value === null) return;
    try {
      const response = await onSubmit(parsed.value);
      setOutcome(response.outcome);
    } catch {
      // Wizard already surfaced the toast and reset isSubmitting; swallow
      // the rejection here so it doesn't bubble as an unhandled promise.
    }
  };

  // The credentials_invalid surface is rendered inline beneath the form
  // (per spec: "form-level field error") rather than as a top banner.
  const invalidMessage =
    outcome === "credentials_invalid"
      ? "Provider rejected these credentials. Double-check the values and try again."
      : null;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
      <div className="rounded-lg border border-sidebar-border bg-muted/40 px-4 py-3">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Migrating from
        </p>
        <p className="text-sm font-medium leading-relaxed">
          <span className="font-mono">{oldHost}</span>
          <span className="text-muted-foreground">
            {" "}
            ({provider === "branch" ? "Branch" : "AppsFlyer"})
          </span>
        </p>
      </div>

      {outcome === "credentials_ok" && (
        <Alert>
          <CheckCircle2 />
          <AlertTitle>
            Credentials verified — your migration is armed.
          </AlertTitle>
          <AlertDescription>
            <p className="leading-relaxed">
              You can flip DNS to Grovs whenever you&apos;re ready.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {outcome === "upstream_rate_limited" && (
        <Alert>
          <Clock />
          <AlertTitle>
            Provider is rate-limiting us. Try again in a minute.
          </AlertTitle>
          <AlertDescription>
            <p className="leading-relaxed">
              We&apos;ll re-verify the same credentials — no changes needed.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {outcome === "upstream_unreachable" && (
        <Alert>
          <WifiOff />
          <AlertTitle>
            Couldn&apos;t reach the provider. Try the Test button or retry.
          </AlertTitle>
          <AlertDescription>
            <p className="leading-relaxed">
              The provider didn&apos;t respond. Network blip — retry in a
              moment.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {outcome === "unexpected_success" && (
        <Alert>
          <HelpCircle />
          <AlertTitle>Inconclusive result — please contact support.</AlertTitle>
          <AlertDescription>
            <p className="leading-relaxed">
              We got an unexpected response from the provider. Reach out so we
              can investigate.
            </p>
          </AlertDescription>
        </Alert>
      )}

      <CredentialsFields
        provider={provider}
        idPrefix="migration"
        branchValues={branchValues}
        appsflyerValues={appsflyerValues}
        showBranchKey={showBranchKey}
        showApiToken={showApiToken}
        onBranchChange={(next) => {
          setBranchValues(next);
          clearOutcomeOnEdit();
        }}
        onAppsflyerChange={(next) => {
          setAppsflyerValues(next);
          clearOutcomeOnEdit();
        }}
        onToggleBranchKey={() => setShowBranchKey((v) => !v)}
        onToggleApiToken={() => setShowApiToken((v) => !v)}
        invalid={invalidMessage !== null}
        errorId="migration-credentials-error"
      />

      {invalidMessage !== null && (
        <p
          id="migration-credentials-error"
          className={cn(
            "flex items-start gap-1.5 text-xs text-destructive leading-relaxed"
          )}
        >
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          {invalidMessage}
        </p>
      )}

      <Alert>
        <Info />
        <AlertDescription>
          <p className="leading-relaxed">
            We use these credentials to fetch legacy links on demand so old URLs
            keep resolving after you flip DNS.
          </p>
        </AlertDescription>
      </Alert>

      <div className="flex justify-end">
        <Button type="submit" disabled={!canSubmit}>
          {isSubmitting ? "Verifying…" : "Verify & arm migration"}
        </Button>
      </div>
    </form>
  );
};

export default CredentialsStep;
