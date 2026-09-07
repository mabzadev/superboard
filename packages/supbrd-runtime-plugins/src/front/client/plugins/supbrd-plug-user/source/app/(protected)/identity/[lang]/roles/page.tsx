"use client";

import { useTranslations } from "next-intl";

import Breadcrumb from "../../../../../identity/components/Breadcrumb.js";
import CreateButton from "../../../../../identity/components/CreateButton.js";
import EditLink from "../../../../../identity/components/EditLink.js";
import LoadingPage from "../../../../../identity/components/LoadingPage.js";
import SystemLabel from "../../../../../identity/components/SystemLabel.js";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "../../../../../identity/components/ui/table.js";
import { useAuth } from "../../../../../identity/melody-react.js";
import { type Role, useGetApiV1RolesQuery } from "../../../../../identity/services/auth/api.js";
import { routeTool, accessTool, dataTool } from "../../../../../identity/tools/index.js";

const Page = () => {
	const t = useTranslations();

	const { userInfo } = useAuth();
	const canWriteRole = accessTool.isAllowedAccess(accessTool.Access.WriteRole, userInfo?.roles);

	const { data, isLoading } = useGetApiV1RolesQuery();
	const roles = data?.roles ?? [];

	const renderEditButton = (role: Role) => (
		<EditLink viewOnly={!canWriteRole} href={`${routeTool.Internal.Roles}/${role.id}`} />
	);

	if (isLoading) return <LoadingPage />;

	return (
		<section>
			<Breadcrumb
				page={{ label: t("roles.title") }}
				action={canWriteRole && <CreateButton href={`${routeTool.Internal.Roles}/new`} />}
			/>
			<Table>
				<TableHeader className="md:hidden">
					<TableRow>
						<TableHead>{t("roles.role")}</TableHead>
					</TableRow>
				</TableHeader>
				<TableHeader className="max-md:hidden">
					<TableRow>
						<TableHead>{t("roles.name")}</TableHead>
						<TableHead>{t("common.note")}</TableHead>
						<TableHead />
					</TableRow>
				</TableHeader>
				<TableBody className="divide-y md:hidden">
					{roles.map((role) => (
						<TableRow key={role.id} data-testid="roleRow">
							<TableCell>
								<section className="flex justify-between items-center">
									<div className="flex flex-col gap-2">
										<div className="flex items-center gap-2">
											{role.name}
											{dataTool.isSystemRole(role.name) && <SystemLabel />}
										</div>
										<p className="md:hidden">{role.note}</p>
									</div>
									<div className="md:hidden">{renderEditButton(role)}</div>
								</section>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
				<TableBody className="divide-y max-md:hidden">
					{roles.map((role) => (
						<TableRow key={role.id} data-testid="roleRow">
							<TableCell>
								<div className="flex items-center gap-2">
									{role.name}
									{dataTool.isSystemRole(role.name) && <SystemLabel />}
								</div>
							</TableCell>
							<TableCell>{role.note}</TableCell>
							<TableCell>{renderEditButton(role)}</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</section>
	);
};

export default Page;
