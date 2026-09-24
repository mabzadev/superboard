import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

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
import { usePutApiV1OrgGroupsByIdMutation } from "../../../../../../identity/services/auth/api.js";

const UpdateOrgGroupModal = ({
	id,
	show,
	initialName,
	onClose,
}: {
	id: number;
	initialName: string;
	show: boolean;
	onClose: () => void;
}) => {
	const t = useTranslations();

	const [name, setName] = useState(initialName);

	const [updateOrgGroup, { isLoading: isUpdatingOrgGroup }] = usePutApiV1OrgGroupsByIdMutation();

	useEffect(() => {
		setName(initialName);
	}, [initialName]);

	const handleSave = async () => {
		const res = await updateOrgGroup({
			id,
			putOrgGroupReq: { name },
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
					<AlertDialogTitle>{t("orgGroups.update")}</AlertDialogTitle>
				</AlertDialogHeader>
				<section>
					<RequiredProperty title={t("orgGroups.name")} />
					<Input data-testid="nameInput" onChange={(e) => setName(e.target.value)} value={name} />
				</section>
				<SubmitError />
				<AlertDialogFooter className="flex gap-2">
					<AlertDialogCancel onClick={onClose}>{t("orgGroups.cancel")}</AlertDialogCancel>
					<SaveButton onClick={handleSave} disabled={!name} isLoading={isUpdatingOrgGroup} />
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
};

export default UpdateOrgGroupModal;
