import { cn } from "@superboard/front-ui/lib/utils.js";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@superboard/front-ui/ui/alert-dialog.js";
import { buttonVariants } from "@superboard/front-ui/ui/button.js";
import { useId, type ComponentProps, type ReactNode } from "react";

export function SettingsCard({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			className={cn("divide-y divide-kumo-line rounded-lg border border-kumo-line", className)}
			{...props}
		/>
	);
}

export function SettingsGroup({
	title,
	description,
	children,
}: {
	title: ReactNode;
	description?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="space-y-3">
			<div className="space-y-1">
				<h3 className="text-base font-semibold">{title}</h3>
				{description && <p className="text-sm text-kumo-subtle">{description}</p>}
			</div>
			<SettingsCard>{children}</SettingsCard>
		</section>
	);
}

export function SettingsField({
	label,
	description,
	children,
}: {
	label: ReactNode;
	description?: ReactNode;
	children(id: string): ReactNode;
}) {
	const id = useId();
	return (
		<div className="space-y-2">
			<label htmlFor={id} className="block text-sm font-medium">
				{label}
			</label>
			{children(id)}
			{description && <p className="text-xs text-kumo-subtle">{description}</p>}
		</div>
	);
}

export function ConfirmDialog({
	open,
	title,
	description,
	confirm,
	cancel,
	onConfirm,
	onClose,
}: {
	open: boolean;
	title: ReactNode;
	description: ReactNode;
	confirm: ReactNode;
	cancel: ReactNode;
	onConfirm(): void;
	onClose(): void;
}) {
	return (
		<AlertDialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription>{description}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>{cancel}</AlertDialogCancel>
					<AlertDialogAction
						className={buttonVariants({ variant: "destructive" })}
						onClick={onConfirm}
					>
						{confirm}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
