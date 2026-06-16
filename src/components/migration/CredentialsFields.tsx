"use client";

import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { MigrationProvider } from "@/types";

export type BranchValues = { branch_key: string };
export type AppsflyerValues = { onelink_id: string; api_token: string };

export const BRANCH_EMPTY: BranchValues = { branch_key: "" };
export const APPSFLYER_EMPTY: AppsflyerValues = {
  onelink_id: "",
  api_token: "",
};

interface CredentialsFieldsProps {
  provider: MigrationProvider;
  /** Unique prefix for input ids so multiple instances (e.g. start vs rotate) coexist on screen. */
  idPrefix: string;
  branchValues: BranchValues;
  appsflyerValues: AppsflyerValues;
  showBranchKey: boolean;
  showApiToken: boolean;
  onBranchChange: (next: BranchValues) => void;
  onAppsflyerChange: (next: AppsflyerValues) => void;
  onToggleBranchKey: () => void;
  onToggleApiToken: () => void;
  /** Aria-describedby/aria-invalid wiring for form-level errors. */
  invalid?: boolean;
  errorId?: string;
}

/**
 * Shared credentials inputs for Branch / AppsFlyer. Used by StartStep,
 * CredentialsStep (fallback), and RotateCredentialsDialog. Keeps the
 * show-password toggle and helper copy identical everywhere.
 */
const CredentialsFields = ({
  provider,
  idPrefix,
  branchValues,
  appsflyerValues,
  showBranchKey,
  showApiToken,
  onBranchChange,
  onAppsflyerChange,
  onToggleBranchKey,
  onToggleApiToken,
  invalid = false,
  errorId,
}: CredentialsFieldsProps) => {
  if (provider === "branch") {
    const id = `${idPrefix}-branch-key`;
    return (
      <div className="flex flex-col gap-2">
        <Label htmlFor={id}>Branch key</Label>
        <div className="relative">
          <Input
            id={id}
            type={showBranchKey ? "text" : "password"}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="key_live_... or key_test_..."
            value={branchValues.branch_key}
            aria-invalid={invalid ? true : undefined}
            aria-describedby={invalid && errorId ? errorId : undefined}
            onChange={(event) =>
              onBranchChange({ branch_key: event.target.value })
            }
            className="pr-10"
          />
          <button
            type="button"
            onClick={onToggleBranchKey}
            aria-label={showBranchKey ? "Hide branch key" : "Show branch key"}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
          >
            {showBranchKey ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Grovs uses this key to look up the original Branch link when someone
          opens an old URL, then creates the matching Grovs link before
          redirecting. Find it under Account Settings → Branch Key.
        </p>
      </div>
    );
  }

  const onelinkId = `${idPrefix}-onelink-id`;
  const tokenId = `${idPrefix}-api-token`;
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={onelinkId}>OneLink ID</Label>
        <Input
          id={onelinkId}
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="abc123"
          value={appsflyerValues.onelink_id}
          aria-invalid={invalid ? true : undefined}
          onChange={(event) =>
            onAppsflyerChange({
              ...appsflyerValues,
              onelink_id: event.target.value,
            })
          }
        />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Grovs uses this AppsFlyer OneLink ID to match incoming legacy links
          before creating the corresponding Grovs link.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={tokenId}>API token</Label>
        <div className="relative">
          <Input
            id={tokenId}
            type={showApiToken ? "text" : "password"}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="••••••••"
            value={appsflyerValues.api_token}
            aria-invalid={invalid ? true : undefined}
            aria-describedby={invalid && errorId ? errorId : undefined}
            onChange={(event) =>
              onAppsflyerChange({
                ...appsflyerValues,
                api_token: event.target.value,
              })
            }
            className="pr-10"
          />
          <button
            type="button"
            onClick={onToggleApiToken}
            aria-label={showApiToken ? "Hide API token" : "Show API token"}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
          >
            {showApiToken ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Grovs uses this token to read the original AppsFlyer link details
          during migration. In AppsFlyer, open your account menu and go to
          Security Center → Manage your AppsFlyer API tokens (on older
          dashboards: Settings → API tokens), then copy the V2.0 token.
        </p>
      </div>
    </>
  );
};

export default CredentialsFields;
