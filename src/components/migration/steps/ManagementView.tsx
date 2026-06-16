"use client";

import { useState } from "react";
import type { MouseEvent } from "react";
import { Loader2, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import SelectableConfirmTarget from "@/components/common/selectable-confirm-target";
import type { CustomDomain, MigrationSource } from "@/types";

interface ManagementViewProps {
  source: MigrationSource;
  domain: CustomDomain | null;
  onRemoveAll: () => boolean | Promise<boolean>;
  lastVerifiedAt?: string;
}

const PROVIDER_NAME: Record<MigrationSource["provider"], string> = {
  branch: "Branch",
  appsflyer: "AppsFlyer",
};

const ManagementView = ({
  source,
  domain,
  onRemoveAll,
  lastVerifiedAt,
}: ManagementViewProps) => {
  const providerName = PROVIDER_NAME[source.provider];
  const displayHost = source.old_host || domain?.hostname || "";

  const [removeOpen, setRemoveOpen] = useState(false);
  const [confirmHost, setConfirmHost] = useState("");
  const [isRemoving, setIsRemoving] = useState(false);

  const canConfirmRemove =
    confirmHost.trim() === source.old_host &&
    source.old_host.length > 0 &&
    !isRemoving;

  const handleRemoveConfirm = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!canConfirmRemove) return;
    setIsRemoving(true);
    let removed = false;
    try {
      removed = await onRemoveAll();
    } finally {
      setIsRemoving(false);
    }
    if (!removed) return;
    setRemoveOpen(false);
    setConfirmHost("");
  };

  const handleRemoveOpenChange = (open: boolean) => {
    if (isRemoving) return;
    setRemoveOpen(open);
    if (!open) setConfirmHost("");
  };

  const handleRemoveCancel = () => {
    if (isRemoving) return;
    setRemoveOpen(false);
    setConfirmHost("");
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-lg border border-sidebar-border bg-muted/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Migrating from {providerName}
          </p>
          <p className="break-all font-mono text-sm font-medium leading-relaxed">
            {displayHost}
          </p>
        </div>
        <Badge
          variant="outline"
          className="self-start border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 sm:self-auto"
          aria-label="Migration status: Active"
        >
          Active
        </Badge>
      </div>

      {lastVerifiedAt !== undefined && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Last verified {lastVerifiedAt}
        </p>
      )}

      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={() => setRemoveOpen(true)}
          className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Remove migration
        </Button>
      </div>

      <AlertDialog open={removeOpen} onOpenChange={handleRemoveOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove migration?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the migration source and the legacy hostname from
              Grovs. If DNS still points at Grovs after removal, old links will
              stop resolving. To confirm, type the hostname below.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="migration-remove-confirm">
              Type <SelectableConfirmTarget value={source.old_host} /> to
              confirm
            </Label>
            <Input
              id="migration-remove-confirm"
              type="text"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={confirmHost}
              onChange={(event) => setConfirmHost(event.target.value)}
              placeholder={source.old_host}
              disabled={isRemoving}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={handleRemoveCancel}
              disabled={isRemoving}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleRemoveConfirm}
              disabled={!canConfirmRemove}
            >
              {isRemoving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isRemoving ? "Removing..." : "Remove migration"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ManagementView;
