import { useTranslations } from "next-intl";
import { useState } from "react";

import RequiredProperty from "../../../../../../identity/components/RequiredProperty.js";
import SaveButton from "../../../../../../identity/components/SaveButton.js";
import SubmitError from "../../../../../../identity/components/SubmitError.js";
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogFooter,
	AlertDialogCancel,
} from "../../../../../../identity/components/ui/alert-dialog.js";
import { Input } from "../../../../../../identity/components/ui/input.js";
import { usePostApiV1OrgGroupsMutation } from "../../../../../../identity/services/auth/api.js";

const CreateOrgGroupModal = ({
	orgId,
	show,
	onClose,
}: {
	orgId: number;
	show: boolean;
	onClose: () => void;
}) => {
	const t = useTranslations();

	const [name, setName] = useState("");

	const [postOrgGroup, { isLoading: isPostingOrgGroup }] = usePostApiV1OrgGroupsMutation();

	const handleSave = async () => {
		const res = await postOrgGroup({
			postOrgGroupReq: {
				orgId,
				name,
			},
		});

		if (res.data?.orgGroup) {
			setName("");
			onClose();
		}
	};

	return (
		<AlertDialog open={show}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{t("orgGroups.new")}</AlertDialogTitle>
				</AlertDialogHeader>
				<section>
					<RequiredProperty title={t("orgGroups.name")} />
					<Input data-testid="nameInput" onChange={(e) => setName(e.target.value)} value={name} />
				</section>
				<SubmitError />
				<AlertDialogFooter className="flex gap-2">
					<AlertDialogCancel onClick={onClose}>{t("orgGroups.cancel")}</AlertDialogCancel>
					<SaveButton onClick={handleSave} disabled={!name} isLoading={isPostingOrgGroup} />
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
};

export default CreateOrgGroupModal;
