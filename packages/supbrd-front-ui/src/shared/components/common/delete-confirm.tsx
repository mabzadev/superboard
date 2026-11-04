import { useState, type ReactNode } from "react";

import { useComponentI18n } from "../../lib/component-i18n.js";
import { Button } from "../ui/button.js";
import {
	Dialog,
	DialogTrigger,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
	DialogFooter,
} from "../ui/dialog.js";

type DeleteConfirmProps = {
	onConfirm: () => void | Promise<void>;
	children: ReactNode;
	title?: string;
	description?: string;
	confirmText?: string;
	cancelText?: string;
};

const DeleteConfirm = ({
	onConfirm,
	children,
	title,
	description,
	confirmText,
	cancelText,
}: DeleteConfirmProps) => {
	const t = useComponentI18n();
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);

	const handleConfirm = async () => {
		setLoading(true);
		try {
			await onConfirm();
		} finally {
			setLoading(false);
			setOpen(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<div onClick={() => setOpen(true)}>{children}</div>
			</DialogTrigger>

			<DialogContent>
				<DialogHeader>
					<DialogTitle>{title ?? t("confirm.title")}</DialogTitle>
					<DialogDescription>{description ?? t("confirm.description")}</DialogDescription>
				</DialogHeader>

				<DialogFooter>
					<Button variant="secondary" onClick={() => setOpen(false)} disabled={loading}>
						{cancelText ?? t("confirm.cancel")}
					</Button>
					<Button variant="destructive" onClick={handleConfirm} disabled={loading}>
						{loading ? t("confirm.deleting") : (confirmText ?? t("confirm.delete"))}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

export default DeleteConfirm;
