import { useTranslations } from "next-intl";
import { useState } from "react";

import {
	useGetApiV1AppsQuery,
	useGetApiV1RolesQuery,
	usePostApiV1UsersInvitationsMutation,
} from "../services/auth/api.js";
import { configSignal } from "../signals/index.js";
import { typeTool } from "../tools/index.js";
import useSignalValue from "../useSignalValue.js";
import FieldError from "./FieldError.js";
import { InviteLocaleField, InviteRedirectFields } from "./InviteDeliveryFields.js";
import SubmitError from "./SubmitError.js";
import SwitchRow from "./SwitchRow.js";
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogFooter,
	AlertDialogCancel,
} from "./ui/alert-dialog.js";
import { Button } from "./ui/button.js";
import { Input } from "./ui/input.js";
import { Label } from "./ui/label.js";

const InviteUserModal = ({
	show,
	onClose,
	onInvited,
}: {
	show: boolean;
	onClose: () => void;
	onInvited: () => void;
}) => {
	const t = useTranslations();
	const configs = useSignalValue(configSignal);

	const supportedLocales: string[] = configs.SUPPORTED_LOCALES ?? [];

	const { data: rolesData } = useGetApiV1RolesQuery();
	const roles = rolesData?.roles ?? [];

	const { data: appsData } = useGetApiV1AppsQuery();
	const spaApps =
		appsData?.apps?.filter((app) => app.type === typeTool.ClientType.SPA && app.isActive) ?? [];

	const [postInvitation, { isLoading }] = usePostApiV1UsersInvitationsMutation();

	const [email, setEmail] = useState("");
	const [firstName, setFirstName] = useState("");
	const [lastName, setLastName] = useState("");
	const [locale, setLocale] = useState("");
	const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
	const [selectedAppId, setSelectedAppId] = useState<number | null>(null);
	const [signinUrl, setSigninUrl] = useState("");
	const [showErrors, setShowErrors] = useState(false);

	const emailError = email.trim() ? undefined : t("common.fieldIsRequired");

	const handleToggleRole = (roleName: string) => {
		setSelectedRoles((prev) =>
			prev.includes(roleName) ? prev.filter((r) => r !== roleName) : [...prev, roleName],
		);
	};

	const handleSubmit = async () => {
		if (emailError) {
			setShowErrors(true);
			return;
		}

		const res = await postInvitation({
			body: {
				email: email.trim(),
				firstName: firstName.trim() || undefined,
				lastName: lastName.trim() || undefined,
				locale: locale || undefined,
				roles: selectedRoles.length ? selectedRoles : undefined,
				signinUrl: signinUrl || undefined,
			},
		});

		if (res.data?.user) {
			onInvited();
		}
	};

	const handleClose = () => {
		setEmail("");
		setFirstName("");
		setLastName("");
		setLocale("");
		setSelectedRoles([]);
		setSelectedAppId(null);
		setSigninUrl("");
		setShowErrors(false);
		onClose();
	};

	return (
		<AlertDialog open={show}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{t("users.inviteUser")}</AlertDialogTitle>
				</AlertDialogHeader>
				<section className="flex flex-col gap-4">
					<div className="flex flex-col gap-1">
						<Label htmlFor="invite-email">
							{t("users.email")}
							<span className="text-red-500 ms-1">*</span>
						</Label>
						<Input
							id="invite-email"
							data-testid="inviteEmail"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							placeholder={t("users.email")}
						/>
						{showErrors && emailError && <FieldError error={emailError} />}
					</div>
					{configs.ENABLE_NAMES && (
						<>
							<div className="flex flex-col gap-1">
								<Label htmlFor="invite-firstName">{t("users.firstName")}</Label>
								<Input
									id="invite-firstName"
									data-testid="inviteFirstName"
									value={firstName}
									onChange={(e) => setFirstName(e.target.value)}
									placeholder={t("users.firstName")}
								/>
							</div>
							<div className="flex flex-col gap-1">
								<Label htmlFor="invite-lastName">{t("users.lastName")}</Label>
								<Input
									id="invite-lastName"
									data-testid="inviteLastName"
									value={lastName}
									onChange={(e) => setLastName(e.target.value)}
									placeholder={t("users.lastName")}
								/>
							</div>
						</>
					)}
					<InviteLocaleField
						locale={locale}
						supportedLocales={supportedLocales}
						testIdPrefix="invite"
						onLocaleChange={setLocale}
					/>
					{roles.length > 0 && (
						<div className="flex flex-col gap-2">
							<Label>{t("users.roles")}</Label>
							<div className="flex flex-col gap-3">
								{roles.map((role) => (
									<SwitchRow
										key={role.id}
										id={`invite-role-${role.id}`}
										data-testid={`inviteRole-${role.name}`}
										label={role.name}
										checked={selectedRoles.includes(role.name)}
										onClick={() => handleToggleRole(role.name)}
									/>
								))}
							</div>
						</div>
					)}
					<InviteRedirectFields
						selectedAppId={selectedAppId}
						signinUrl={signinUrl}
						spaApps={spaApps}
						testIdPrefix="invite"
						onSelectedAppIdChange={setSelectedAppId}
						onSigninUrlChange={setSigninUrl}
					/>
				</section>
				<SubmitError />
				<AlertDialogFooter>
					<AlertDialogCancel onClick={handleClose} disabled={isLoading}>
						{t("common.cancel")}
					</AlertDialogCancel>
					<Button data-testid="confirmInvite" onClick={handleSubmit} disabled={isLoading}>
						{t("users.sendInvite")}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
};

export default InviteUserModal;
