"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRightLeft,
  Check,
  ChevronDown,
  Info,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  credentialsSchemaFor,
  migrationOldHostSchema,
} from "@/schemas/migration";
import CredentialsFields, {
  APPSFLYER_EMPTY,
  BRANCH_EMPTY,
  type AppsflyerValues,
  type BranchValues,
} from "../CredentialsFields";
import type { MigrationCredentials, MigrationProvider } from "@/types";
import type { CustomDomainPreflight } from "@/types";

interface StartStepProps {
  onSubmit: (values: {
    provider: MigrationProvider;
    hostname: string;
    credentials: MigrationCredentials;
  }) => void | Promise<void>;
  isSubmitting?: boolean;
  disabledUntilSeconds?: number;
  hostnameFieldError?: string | null;
  onHostnameChange?: (hostname: string) => void;
  preflight?: CustomDomainPreflight | null;
  preflightLoading?: boolean;
  /**
   * Optional cancel slot rendered alongside the submit button. Hosted by the
   * wizard so the same affordance (in no-confirm mode here) is available on
   * the empty card.
   */
  cancelSlot?: React.ReactNode;
}

const PROVIDER_OPTIONS: Array<{
  value: MigrationProvider;
  label: string;
  description: string;
}> = [
  {
    value: "branch",
    label: "Branch",
    description: "Migrate links currently served by Branch.io.",
  },
  {
    value: "appsflyer",
    label: "AppsFlyer",
    description: "Migrate links currently served by AppsFlyer.",
  },
];

const ProviderDropdown = ({
  value,
  onChange,
}: {
  value: MigrationProvider | null;
  onChange: (value: MigrationProvider) => void;
}) => {
  const [open, setOpen] = useState(false);
  const selected = PROVIDER_OPTIONS.find((option) => option.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Select source platform"
          className={cn(
            "flex w-full items-center gap-3 rounded-lg border border-sidebar-border bg-secondary px-3 py-2.5 text-left transition-all",
            "hover:bg-muted focus-visible:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-primary/10 focus-visible:outline-none"
          )}
        >
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">
              {selected?.label ?? "Select source platform"}
            </span>
            <span className="text-xs text-muted-foreground">
              {selected?.description ?? "Branch or AppsFlyer"}
            </span>
          </div>
          <Separator orientation="vertical" className="ml-auto h-6" />
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-1"
      >
        {PROVIDER_OPTIONS.map((option) => {
          const isSelected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors",
                isSelected ? "bg-accent" : "hover:bg-accent/50"
              )}
            >
              <div className="flex min-w-0 flex-col">
                <span className="text-sm">{option.label}</span>
                <span className="text-xs text-muted-foreground">
                  {option.description}
                </span>
              </div>
              {isSelected && (
                <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />
              )}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
};

/**
 * The combined first step of the migration wizard.
 *
 * Customers enter provider + credentials + old subdomain in a single form
 * so they can walk away while SSL provisions. The wizard stashes the
 * credentials in React state (in-memory only, never persisted) and
 * automatically arms the migration once the domain becomes active.
 */
const StartStep = ({
  onSubmit,
  isSubmitting = false,
  disabledUntilSeconds,
  hostnameFieldError,
  onHostnameChange,
  preflight,
  preflightLoading = false,
  cancelSlot,
}: StartStepProps) => {
  const [provider, setProvider] = useState<MigrationProvider | null>(null);
  const [hostname, setHostname] = useState("");
  const [branchValues, setBranchValues] = useState<BranchValues>(BRANCH_EMPTY);
  const [appsflyerValues, setAppsflyerValues] =
    useState<AppsflyerValues>(APPSFLYER_EMPTY);
  const [showBranchKey, setShowBranchKey] = useState(false);
  const [showApiToken, setShowApiToken] = useState(false);
  const [touched, setTouched] = useState(false);

  const hostnameValidation = useMemo(() => {
    const trimmed = hostname.trim();
    if (trimmed.length === 0) {
      return { ok: false as const, error: null as string | null };
    }
    const result = migrationOldHostSchema.safeParse(trimmed);
    if (result.success) {
      return { ok: true as const, error: null, value: result.data };
    }
    return {
      ok: false as const,
      error: result.error.issues[0]?.message ?? "Invalid hostname",
    };
  }, [hostname]);

  const credentialsParsed = useMemo<{
    ok: boolean;
    value: MigrationCredentials | null;
  }>(() => {
    if (provider === null) return { ok: false, value: null };
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

  const canSubmit =
    provider !== null &&
    hostnameValidation.ok &&
    credentialsParsed.ok &&
    !isSubmitting &&
    !(typeof disabledUntilSeconds === "number" && disabledUntilSeconds > 0);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    if (
      !canSubmit ||
      provider === null ||
      !hostnameValidation.ok ||
      credentialsParsed.value === null
    ) {
      return;
    }
    void onSubmit({
      provider,
      hostname: hostnameValidation.value,
      credentials: credentialsParsed.value,
    });
  };

  const showHostnameError =
    touched && hostname.trim().length > 0 && !hostnameValidation.ok;
  const oldHostLabel =
    provider === "branch"
      ? "Branch subdomain"
      : provider === "appsflyer"
        ? "AppsFlyer subdomain"
        : "Provider subdomain";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-3">
        <Label>Which provider are you migrating from?</Label>
        <ProviderDropdown value={provider} onChange={setProvider} />
      </div>

      {provider !== null && (
        <CredentialsFields
          provider={provider}
          idPrefix="start"
          branchValues={branchValues}
          appsflyerValues={appsflyerValues}
          showBranchKey={showBranchKey}
          showApiToken={showApiToken}
          onBranchChange={setBranchValues}
          onAppsflyerChange={setAppsflyerValues}
          onToggleBranchKey={() => setShowBranchKey((v) => !v)}
          onToggleApiToken={() => setShowApiToken((v) => !v)}
        />
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="migration-old-host">{oldHostLabel}</Label>
        <Input
          id="migration-old-host"
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="old.acme.com"
          value={hostname}
          aria-invalid={showHostnameError ? true : undefined}
          aria-describedby={
            showHostnameError ? "migration-old-host-error" : undefined
          }
          onChange={(event) => {
            const next = event.target.value.toLowerCase();
            setHostname(next);
            onHostnameChange?.(next);
            if (!touched) setTouched(true);
          }}
          onBlur={() => setTouched(true)}
        />
        {showHostnameError && hostnameValidation.error && (
          <p
            id="migration-old-host-error"
            className="flex items-center gap-1.5 text-xs text-destructive"
          >
            <AlertCircle className="h-3 w-3" />
            {hostnameValidation.error}
          </p>
        )}
        {!showHostnameError && hostnameFieldError && (
          <p className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertCircle className="h-3 w-3" />
            {hostnameFieldError}
          </p>
        )}
        {!showHostnameError && !hostnameFieldError && preflightLoading && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Checking DNS…
          </p>
        )}
        {!showHostnameError && !hostnameFieldError && preflight && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            {preflight.cname_matches
              ? "✓ CNAME already points to Grovs"
              : preflight.dns_error
                ? "Couldn't resolve — that's fine, you'll set it up later"
                : preflight.cname_actual
                  ? `Currently points to: ${preflight.cname_actual} (you'll flip this in step 4)`
                  : "CNAME is not pointing to Grovs yet; you'll flip this in step 4"}
          </p>
        )}
        <p className="text-xs text-muted-foreground leading-relaxed">
          Submit this subdomain before changing DNS. We provision SSL first;
          traffic moves only after DNS points this host to Grovs.
        </p>
      </div>

      <div className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-amber-900 dark:text-amber-200">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">
            Migration only works for custom provider subdomains.
          </p>
          <p className="text-xs leading-relaxed">
            Use this only if your Branch or AppsFlyer links already run on a
            subdomain you control. You will point that subdomain to Grovs. When
            someone opens an old link, Grovs looks it up with your provider
            credentials, creates the matching Grovs link, and redirects the
            visitor. Traffic stays with your current provider until DNS points
            to Grovs; after DNS is active and credentials verify, Grovs serves
            those requests.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        {cancelSlot}
        <Button type="submit" disabled={!canSubmit}>
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowRightLeft className="h-4 w-4" />
          )}
          {typeof disabledUntilSeconds === "number" && disabledUntilSeconds > 0
            ? `Try again in ${disabledUntilSeconds}s`
            : isSubmitting
              ? "Starting migration"
              : "Start migration"}
        </Button>
      </div>
    </form>
  );
};

export default StartStep;
