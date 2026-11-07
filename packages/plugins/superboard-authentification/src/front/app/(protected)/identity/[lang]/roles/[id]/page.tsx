"use client";

import { useParams } from "@superboard/front-ui/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import Breadcrumb from "../../../../../../identity/components/Breadcrumb.js";
import DeleteButton from "../../../../../../identity/components/DeleteButton.js";
import FieldError from "../../../../../../identity/components/FieldError.js";
import LoadingPage from "../../../../../../identity/components/LoadingPage.js";
import PageTitle from "../../../../../../identity/components/PageTitle.js";
import {
	PropertyLabel,
	PropertyList,
	PropertyRow,
	PropertyValue,
} from "../../../../../../identity/components/PropertyList.js";
import RequiredProperty from "../../../../../../identity/components/RequiredProperty.js";
import SaveButton from "../../../../../../identity/components/SaveButton.js";
import SubmitError from "../../../../../../identity/components/SubmitError.js";
import { Input } from "../../../../../../identity/components/ui/input.js";
import UserTable from "../../../../../../identity/components/UserTable.js";
import { useRouter } from "../../../../../../identity/i18n/navigation.js";
import { useAuth } from "../../../../../../identity/melody-react.js";
import {
	useDeleteApiV1RolesByIdMutation,
	useGetApiV1RolesByIdQuery,
	usePutApiV1RolesByIdMutation,
	useGetApiV1RolesByIdUsersQuery,
} from "../../../../../../identity/services/auth/api.js";
import { routeTool, accessTool, dataTool } from "../../../../../../identity/tools/index.js";
import useEditRole from "../useEditRole.js";

const Page = () => {
	const { id } = useParams();

	const t = useTranslations();
	const router = useRouter();

	const { data, isLoading } = useGetApiV1RolesByIdQuery({ id: Number(id) });
	const [updateRole, { isLoading: isUpdating }] = usePutApiV1RolesByIdMutation();
	const [deleteRole, { isLoading: isDeleting }] = useDeleteApiV1RolesByIdMutation();

	const { userInfo } = useAuth();
	const canReadUser = accessTool.isAllowedAccess(accessTool.Access.ReadUser, userInfo?.roles);

	const { data: roleUsers } = useGetApiV1RolesByIdUsersQuery({ id: Number(id) });
	const users = roleUsers?.users ?? [];

	const canWriteRole = accessTool.isAllowedAccess(accessTool.Access.WriteRole, userInfo?.roles);

	const role = data?.role;
	const isSystemRole = dataTool.isSystemRole(role?.name ?? "");

	const { values, errors, onChange } = useEditRole(role);
	const [showErrors, setShowErrors] = useState(false);

	const handleSave = async () => {
		if (Object.values(errors).some((val) => !!val)) {
			setShowErrors(true);
			return;
		}

		await updateRole({
			id: Number(id),
			putRoleReq: values,
		});
	};

	const handleDelete = async () => {
		await deleteRole({ id: Number(id) });

		router.push(routeTool.Internal.Roles);
	};

	if (isLoading) return <LoadingPage />;

	if (!role) return null;

	return (
		<section>
			<Breadcrumb
				page={{ label: role.name }}
				parent={{
					href: routeTool.Internal.Roles,
					label: t("roles.title"),
				}}
			/>
			<section>
				<PropertyList>
					<PropertyRow>
						<PropertyLabel>
							<RequiredProperty title={t("roles.name")} />
						</PropertyLabel>
						<PropertyValue>
							<Input
								data-testid="nameInput"
								disabled={!canWriteRole || isSystemRole}
								onChange={(e) => onChange("name", e.target.value)}
								value={values.name}
							/>
							{showErrors && <FieldError error={errors.name} />}
						</PropertyValue>
					</PropertyRow>
					<PropertyRow>
						<PropertyLabel>{t("common.note")}</PropertyLabel>
						<PropertyValue>
							<Input
								data-testid="noteInput"
								disabled={!canWriteRole || isSystemRole}
								onChange={(e) => onChange("note", e.target.value)}
								value={values.note}
							/>
						</PropertyValue>
					</PropertyRow>
					<PropertyRow>
						<PropertyLabel>{t("common.createdAt")}</PropertyLabel>
						<PropertyValue>{t("common.utcTime", { time: role.createdAt })}</PropertyValue>
					</PropertyRow>
					<PropertyRow>
						<PropertyLabel>{t("common.updatedAt")}</PropertyLabel>
						<PropertyValue>{t("common.utcTime", { time: role.updatedAt })}</PropertyValue>
					</PropertyRow>
				</PropertyList>
			</section>
			<SubmitError />
			{canWriteRole && !isSystemRole && (
				<section className="mt-8 flex items-center justify-end gap-4">
					<SaveButton
						isLoading={isUpdating}
						disabled={!values.name || (values.name === role.name && values.note === role.note)}
						onClick={handleSave}
					/>
					<DeleteButton
						isLoading={isDeleting}
						disabled={isUpdating}
						confirmDeleteTitle={t("common.deleteConfirm", { item: values.name })}
						onConfirmDelete={handleDelete}
					/>
				</section>
			)}
			{canReadUser && (
				<section className="mt-12">
					<PageTitle className="mb-6" title={t("roles.users")} />
					<UserTable loadedUsers={users} />
				</section>
			)}
		</section>
	);
};

export default Page;
