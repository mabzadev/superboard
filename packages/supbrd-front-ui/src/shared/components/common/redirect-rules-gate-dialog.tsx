"use client";

import { useRouter, useSearchParams } from "@superboard/front-ui/navigation";
import { PencilRuler } from "lucide-react";

import { useComponentI18n } from "../../lib/component-i18n.js";
import { Button } from "../ui/button.js";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog.js";

const RedirectRulesGateDialog = ({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) => {
	const t = useComponentI18n();
	const router = useRouter();
	const searchParams = useSearchParams();

	const handleGoToRules = () => {
		onOpenChange(false);
		const query = searchParams.toString();
		router.push(`/dynamic-links/redirect-rules${query ? `?${query}` : ""}`);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[420px] p-0 gap-0 border-sidebar-border">
				<DialogHeader className="sr-only">
					<DialogTitle>{t("redirectRules.title")}</DialogTitle>
					<DialogDescription>{t("redirectRules.description")}</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col items-center text-center px-8 pt-8 pb-6 gap-4">
					<div className="flex items-center justify-center h-12 w-12 rounded-xl bg-muted">
						<PencilRuler className="h-5 w-5 text-muted-foreground" />
					</div>
					<div className="flex flex-col gap-1.5">
						<h3 className="text-base font-semibold tracking-tight">{t("redirectRules.heading")}</h3>
						<p className="text-sm text-muted-foreground leading-relaxed">
							{t("redirectRules.body")}
						</p>
					</div>
				</div>

				<div className="flex flex-col gap-2 px-8 pb-8">
					<Button onClick={handleGoToRules}>
						<PencilRuler className="h-3.5 w-3.5" />
						{t("redirectRules.configure")}
					</Button>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						{t("redirectRules.later")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
};

export default RedirectRulesGateDialog;
