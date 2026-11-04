import { useState } from "react";

import { useComponentI18n } from "../../lib/component-i18n.js";
import { Button } from "../ui/button.js";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
	DialogFooter,
} from "../ui/dialog.js";

type ActionConfirmProps = {
	open: boolean;
	setOpen: (e: boolean) => void;
	onConfirm: () => void | Promise<void>;

	title?: string;
	description?: string;
	confirmText?: string;
	cancelText?: string;
	showCloseButton?: boolean;
};

const ActionConfirm = ({
	open,
	setOpen,
	onConfirm,
	title,
	description,
	confirmText,
	cancelText,
	showCloseButton = true,
}: ActionConfirmProps) => {
	const t = useComponentI18n();
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
			<DialogContent showCloseButton={showCloseButton}>
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

export default ActionConfirm;
