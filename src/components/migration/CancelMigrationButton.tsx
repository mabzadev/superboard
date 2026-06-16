"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import SelectableConfirmTarget from "@/components/common/selectable-confirm-target";

interface CancelMigrationButtonProps {
  /**
   * If null/undefined, the wizard hasn't created the custom domain yet —
   * Cancel just clears local draft state via `onCancel` without confirmation.
   * If set, Cancel opens an AlertDialog that requires typing the hostname
   * to confirm the destructive teardown.
   */
  hostname?: string | null;
  /**
   * Called when Cancel is confirmed:
   *  - in no-confirm mode (no hostname): fired immediately on click
   *  - in confirm mode (hostname set): fired after the user types the hostname
   *    and clicks "Cancel migration" in the dialog
   */
  onCancel: () => void | Promise<void>;
  /** When true, disables the trigger and shows a spinner inside the dialog action. */
  isCancelling?: boolean;
  buttonVariant?: React.ComponentProps<typeof Button>["variant"];
}

/**
 * Subtle "Cancel migration" link rendered on every onboarding step.
 *
 *  - Before the custom domain is created, Cancel just clears the in-memory
 *    draft (no network call, no confirmation — nothing was persisted).
 *  - After the custom domain exists, Cancel opens a type-to-confirm dialog
 *    that triggers the teardown (DELETE /custom_domains?purpose=migration
 *    cascades the source if any) and resets local attestations.
 *
 * NOT rendered on the managed/post-onboarding view — that already has its
 * own destructive zone in ManagementView.
 */
const CancelMigrationButton = ({
  hostname,
  onCancel,
  isCancelling = false,
  buttonVariant = "ghost",
}: CancelMigrationButtonProps) => {
  const needsConfirm = typeof hostname === "string" && hostname.length > 0;
  const [open, setOpen] = useState(false);
  const [confirmHost, setConfirmHost] = useState("");

  // Reset the typed value whenever the dialog transitions open. We don't reset
  // on close so the field doesn't visibly flicker during the close animation.
  useEffect(() => {
    if (open) setConfirmHost("");
  }, [open]);

  const handleTriggerClick = () => {
    if (!needsConfirm) {
      void onCancel();
      return;
    }
    setOpen(true);
  };

  const canConfirm =
    needsConfirm &&
    confirmHost.trim().toLowerCase() === (hostname ?? "").toLowerCase() &&
    !isCancelling;

  const handleConfirm = async () => {
    if (!canConfirm) return;
    await onCancel();
    setOpen(false);
  };

  return (
    <>
      <Button
        type="button"
        variant={buttonVariant}
        size="sm"
        onClick={handleTriggerClick}
        disabled={isCancelling}
        className={
          buttonVariant === "ghost"
            ? "text-muted-foreground hover:text-foreground"
            : undefined
        }
      >
        {isCancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        {isCancelling ? "Cancelling migration" : "Cancel migration"}
      </Button>

      {needsConfirm && (
        <AlertDialog
          open={open}
          onOpenChange={(next) => {
            if (!isCancelling) setOpen(next);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel migration?</AlertDialogTitle>
              <AlertDialogDescription>
                This will delete the migration domain and lose any progress.
                Type the hostname to confirm.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cancel-migration-confirm">
                Type <SelectableConfirmTarget value={hostname ?? ""} /> to
                confirm
              </Label>
              <Input
                id="cancel-migration-confirm"
                type="text"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                value={confirmHost}
                onChange={(event) => setConfirmHost(event.target.value)}
                placeholder={hostname ?? undefined}
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isCancelling}>
                Keep migration
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={handleConfirm}
                disabled={!canConfirm}
              >
                {isCancelling && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                Cancel migration
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
};

export default CancelMigrationButton;
