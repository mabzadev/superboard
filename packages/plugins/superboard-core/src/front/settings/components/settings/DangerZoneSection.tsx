import DeleteConfirm from "@superboard/front-ui/common/delete-confirm.js";
import { SettingsActions } from "@superboard/front-ui/settings-form";
import { Button } from "@superboard/front-ui/ui/button.js";

import { useSettingsI18n } from "../../i18n.js";

const DangerZoneSection = ({ handleRemoveProject }: { handleRemoveProject: () => void }) => {
	const { t } = useSettingsI18n();
	return (
		<section className="space-y-3">
			<div className="space-y-1">
				<h2 className="text-base font-semibold text-destructive">{t("danger.title")}</h2>
				<p className="text-sm text-kumo-subtle">{t("danger.description")}</p>
			</div>
			<div className="space-y-3 rounded-lg border border-destructive/30 p-4">
				<div className="space-y-0.5">
					<p className="text-sm font-medium">{t("danger.deleteTitle")}</p>
					<p className="text-xs text-kumo-subtle">{t("danger.deleteDescription")}</p>
				</div>
				<SettingsActions>
					<DeleteConfirm
						onConfirm={handleRemoveProject}
						title={t("danger.confirmTitle")}
						description={t("danger.deleteDescription")}
						confirmText={t("danger.delete")}
					>
						<Button variant="destructive" size="sm">
							{t("danger.delete")}
						</Button>
					</DeleteConfirm>
				</SettingsActions>
			</div>
		</section>
	);
};

export default DangerZoneSection;
