"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  HelpCircle,
  Loader2,
  WifiOff,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { credentialsSchemaFor } from "@/schemas/migration";
import CredentialsFields, {
  APPSFLYER_EMPTY,
  BRANCH_EMPTY,
  type AppsflyerValues,
  type BranchValues,
} from "./CredentialsFields";
import type {
  MigrationCredentials,
  MigrationProvider,
  MigrationTestOutcome,
  MigrationTestResponse,
} from "@/types";

interface RotateCredentialsDialogProps {
  provider: MigrationProvider;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (
    credentials: MigrationCredentials
  ) => Promise<MigrationTestResponse>;
  isSubmitting: boolean;
}

/**
 * Dialog wrapping the same credentials form as CredentialsStep. The parent
 * passes an `onSubmit` that performs the PATCH + chained /test call and
 * returns the test outcome — the dialog itself just collects credentials
 * and surfaces the outcome in the same vocabulary as CredentialsStep.
 *
 * Form state resets each time the dialog is opened. Submitting an outcome
 * is purely local; the parent decides when to actually close the dialog
 * (typically after credentials_ok).
 */
const RotateCredentialsDialog = ({
  provider,
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
}: RotateCredentialsDialogProps) => {
  const [branchValues, setBranchValues] = useState<BranchValues>(BRANCH_EMPTY);
  const [appsflyerValues, setAppsflyerValues] =
    useState<AppsflyerValues>(APPSFLYER_EMPTY);
  const [showBranchKey, setShowBranchKey] = useState(false);
  const [showApiToken, setShowApiToken] = useState(false);
  const [outcome, setOutcome] = useState<MigrationTestOutcome | null>(null);

  // Reset everything when the dialog transitions open. We intentionally do
  // NOT reset on close so the outcome banner persists if the parent keeps
  // the dialog mounted (it doesn't — but defensive).
  useEffect(() => {
    if (isOpen) {
      setBranchValues(BRANCH_EMPTY);
      setAppsflyerValues(APPSFLYER_EMPTY);
      setShowBranchKey(false);
      setShowApiToken(false);
      setOutcome(null);
    }
  }, [isOpen]);

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
      // Parent already surfaced the toast and reset isSubmitting; swallow
      // the rejection here so it doesn't bubble as an unhandled promise.
    }
  };

  const invalidMessage =
    outcome === "credentials_invalid"
      ? "Provider rejected these credentials. Double-check the values and try again."
      : null;

  const handleOpenChange = (open: boolean) => {
    if (!open) onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rotate migration credentials</DialogTitle>
          <DialogDescription>
            Enter the new {provider === "branch" ? "Branch" : "AppsFlyer"}{" "}
            credentials. We&apos;ll verify them with the provider before saving.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-5"
          noValidate
        >
          {outcome === "credentials_ok" && (
            <Alert>
              <CheckCircle2 />
              <AlertTitle>Credentials verified.</AlertTitle>
              <AlertDescription>
                <p className="leading-relaxed">
                  Migration is healthy again. Old links resolve through Grovs.
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
                Couldn&apos;t reach the provider. Retry in a moment.
              </AlertTitle>
              <AlertDescription>
                <p className="leading-relaxed">
                  Network blip — retry submitting the credentials.
                </p>
              </AlertDescription>
            </Alert>
          )}

          {outcome === "unexpected_success" && (
            <Alert>
              <HelpCircle />
              <AlertTitle>
                Inconclusive result — please contact support.
              </AlertTitle>
              <AlertDescription>
                <p className="leading-relaxed">
                  We got an unexpected response from the provider. Reach out so
                  we can investigate.
                </p>
              </AlertDescription>
            </Alert>
          )}

          <CredentialsFields
            provider={provider}
            idPrefix="rotate"
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
            errorId="rotate-credentials-error"
          />

          {invalidMessage !== null && (
            <p
              id="rotate-credentials-error"
              className={cn(
                "flex items-start gap-1.5 text-xs text-destructive leading-relaxed"
              )}
            >
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              {invalidMessage}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isSubmitting ? "Rotating…" : "Rotate credentials"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default RotateCredentialsDialog;
