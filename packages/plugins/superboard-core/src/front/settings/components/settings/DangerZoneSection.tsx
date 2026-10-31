import DeleteConfirm from "@superboard/front-ui/common/delete-confirm.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import { AlertTriangle, Trash2 } from "lucide-react";

import { useSettingsI18n } from "../../i18n.js";

const DangerZoneSection = ({ handleRemoveProject }: { handleRemoveProject: () => void }) => {
	const { t } = useSettingsI18n();
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-0.5">
				<h2 className="text-sm font-semibold text-destructive">{t("danger.title")}</h2>
				<span className="text-xs text-muted-foreground">{t("danger.description")}</span>
			</div>

			<div className="rounded-xl border border-destructive/20 overflow-hidden">
				<div className="px-5 py-5 flex items-center gap-4 bg-gradient-to-r from-destructive/5 to-destructive/[0.02]">
					<div className="flex items-center justify-center h-11 w-11 rounded-xl shrink-0 bg-destructive/10 ring-1 ring-destructive/15">
						<AlertTriangle className="h-5 w-5 text-destructive" />
					</div>
					<div className="flex flex-col gap-0.5 flex-1 min-w-0">
						<span className="text-sm font-semibold">{t("danger.deleteTitle")}</span>
						<span className="text-xs text-muted-foreground leading-snug">
							{t("danger.deleteDescription")}
						</span>
					</div>
					<DeleteConfirm onConfirm={handleRemoveProject}>
						<Button
							variant="outline"
							size="sm"
							className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive shrink-0"
						>
							<Trash2 className="h-3.5 w-3.5" />
							{t("danger.delete")}
						</Button>
					</DeleteConfirm>
				</div>
			</div>
		</div>
	);
};

export default DangerZoneSection;
