"use client";

import { useParams } from "@superboard/front-ui/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import Breadcrumb from "../../../../../../identity/components/Breadcrumb.js";
import DeleteButton from "../../../../../../identity/components/DeleteButton.js";
import FieldError from "../../../../../../identity/components/FieldError.js";
import LoadingPage from "../../../../../../identity/components/LoadingPage.js";
import PageTitle from "../../../../../../identity/components/PageTitle.js";
import RequiredProperty from "../../../../../../identity/components/RequiredProperty.js";
import SaveButton from "../../../../../../identity/components/SaveButton.js";
import SubmitError from "../../../../../../identity/components/SubmitError.js";
import { Input } from "../../../../../../identity/components/ui/input.js";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "../../../../../../identity/components/ui/table.js";
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
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="max-md:w-24 md:w-48">{t("common.property")}</TableHead>
							<TableHead>{t("common.value")}</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody className="divide-y">
						<TableRow>
							<TableCell>
								<RequiredProperty title={t("roles.name")} />
							</TableCell>
							<TableCell>
								<Input
									data-testid="nameInput"
									disabled={!canWriteRole || isSystemRole}
									onChange={(e) => onChange("name", e.target.value)}
									value={values.name}
								/>
								{showErrors && <FieldError error={errors.name} />}
							</TableCell>
						</TableRow>
						<TableRow>
							<TableCell>{t("common.note")}</TableCell>
							<TableCell>
								<Input
									data-testid="noteInput"
									disabled={!canWriteRole || isSystemRole}
									onChange={(e) => onChange("note", e.target.value)}
									value={values.note}
								/>
							</TableCell>
						</TableRow>
						<TableRow>
							<TableCell>{t("common.createdAt")}</TableCell>
							<TableCell>{role.createdAt} UTC</TableCell>
						</TableRow>
						<TableRow>
							<TableCell>{t("common.updatedAt")}</TableCell>
							<TableCell>{role.updatedAt} UTC</TableCell>
						</TableRow>
					</TableBody>
				</Table>
			</section>
			<SubmitError />
			{canWriteRole && !isSystemRole && (
				<section className="flex items-center gap-4 mt-8">
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
					<UserTable orgId={null} loadedUsers={users} />
				</section>
			)}
		</section>
	);
};

export default Page;
