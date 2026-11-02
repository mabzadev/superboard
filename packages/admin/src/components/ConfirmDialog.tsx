import { Button, Dialog } from "@cloudflare/kumo";
import { useLingui } from "@lingui/react/macro";
import * as React from "react";

import { DialogError, getMutationError } from "./DialogError.js";

export interface ConfirmDialogProps {
	open: boolean;
	onClose: () => void;
	title: string;
	description: React.ReactNode;
	confirmLabel: string;
	pendingLabel: string;
	variant?: "destructive" | "primary";
	compact?: boolean;
	preventCloseWhilePending?: boolean;
	confirmDisabled?: boolean;
	isPending: boolean;
	error: unknown;
	onConfirm: () => void;
	children?: React.ReactNode;
}

export function ConfirmDialog({
	open,
	onClose,
	title,
	description,
	confirmLabel,
	pendingLabel,
	variant = "destructive",
	compact = false,
	preventCloseWhilePending = false,
	confirmDisabled = false,
	isPending,
	error,
	onConfirm,
	children,
}: ConfirmDialogProps) {
	const { t } = useLingui();
	const closeLocked = preventCloseWhilePending && isPending;
	return (
		<Dialog.Root
			open={open}
			onOpenChange={(nextOpen) => !nextOpen && !closeLocked && onClose()}
			disablePointerDismissal
		>
			<Dialog className={compact ? "max-w-md px-5 pt-5 pb-4" : "p-6"} size="sm">
				<div className={compact ? "grid gap-1.5" : undefined}>
					<Dialog.Title
						className={compact ? "text-lg font-semibold leading-6" : "text-lg font-semibold"}
					>
						{title}
					</Dialog.Title>
					<Dialog.Description
						className={
							compact ? "text-sm leading-5 text-pretty text-kumo-subtle" : "text-kumo-subtle"
						}
					>
						{description}
					</Dialog.Description>
				</div>
				{children}
				<DialogError message={getMutationError(error)} className="mt-3" />
				<div className={`${compact ? "mt-5" : "mt-6"} flex justify-end gap-2`}>
					<Button variant="secondary" disabled={closeLocked} onClick={onClose}>
						{t`Cancel`}
					</Button>
					<Button variant={variant} disabled={isPending || confirmDisabled} onClick={onConfirm}>
						{isPending ? pendingLabel : confirmLabel}
					</Button>
				</div>
			</Dialog>
		</Dialog.Root>
	);
}
