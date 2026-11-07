"use client";

import { ADMIN_ROLE, OWNER_ROLE } from "@superboard/front-ui/constants/OptionsConstants.js";
import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import {
	showGenericError,
	showSuccessNotification,
} from "@superboard/front-ui/lib/Notifications.js";

import { useDeleteInstanceMutation } from "../../hooks/mutations/useInstanceMutations.js";
import { useInstancesQuery } from "../../hooks/queries/useInstanceQueries.js";
import { useSettingsI18n } from "../../i18n.js";
import DangerZoneSection from "./DangerZoneSection.js";

export default function ProjectAdvancedSection() {
	const { t } = useSettingsI18n();
	const { selectedInstance, setSelectedInstance } = useProjectSelection();
	const instancesQuery = useInstancesQuery();
	const deleteInstanceMutation = useDeleteInstanceMutation();
	const role = selectedInstance?.role;
	const canDelete = role === OWNER_ROLE || role === ADMIN_ROLE;

	const handleDeleteInstance = async () => {
		if (!selectedInstance) return;
		try {
			await deleteInstanceMutation.mutateAsync(selectedInstance.id);
			showSuccessNotification(t("danger.deleted"));
			const result = await instancesQuery.refetch();
			const lastInstance = result.data?.at(-1);
			if (lastInstance) setSelectedInstance(lastInstance);
		} catch {
			showGenericError();
		}
	};

	return (
		<div className="flex max-w-3xl flex-col gap-8 py-4">
			{canDelete ? (
				<DangerZoneSection handleRemoveProject={() => void handleDeleteInstance()} />
			) : (
				<section className="space-y-1">
					<h2 className="text-base font-semibold">{t("danger.title")}</h2>
					<p className="text-sm text-kumo-subtle">{t("danger.adminOnly")}</p>
				</section>
			)}
		</div>
	);
}
