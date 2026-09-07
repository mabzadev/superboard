"use client";

import { useTranslations } from "next-intl";

import Breadcrumb from "../../../../../identity/components/Breadcrumb.js";
import CreateButton from "../../../../../identity/components/CreateButton.js";
import EditLink from "../../../../../identity/components/EditLink.js";
import EntityStatusLabel from "../../../../../identity/components/EntityStatusLabel.js";
import LoadingPage from "../../../../../identity/components/LoadingPage.js";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "../../../../../identity/components/ui/table.js";
import { useAuth } from "../../../../../identity/melody-react.js";
import {
	type SamlIdp,
	useGetApiV1SamlIdpsQuery,
} from "../../../../../identity/services/auth/api.js";
import { routeTool, accessTool } from "../../../../../identity/tools/index.js";

const Page = () => {
	const t = useTranslations();

	const { userInfo } = useAuth();
	const canWriteRole = accessTool.isAllowedAccess(accessTool.Access.WriteRole, userInfo?.roles);

	const { data, isLoading } = useGetApiV1SamlIdpsQuery();
	const idps = data?.idps ?? [];

	const renderEditButton = (idp: SamlIdp) => {
		return <EditLink href={`${routeTool.Internal.Saml}/${idp.id}`} />;
	};

	if (isLoading) return <LoadingPage />;

	return (
		<section>
			<Breadcrumb
				page={{ label: t("saml.title") }}
				action={canWriteRole && <CreateButton href={`${routeTool.Internal.Saml}/new`} />}
			/>
			<Table>
				<TableHeader className="md:hidden">
					<TableRow>
						<TableHead>{t("saml.idp")}</TableHead>
					</TableRow>
				</TableHeader>
				<TableHeader className="max-md:hidden">
					<TableRow>
						<TableHead>{t("saml.name")}</TableHead>
						<TableHead>{t("saml.status")}</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody className="divide-y md:hidden">
					{idps.map((idp) => (
						<TableRow key={idp.id}>
							<TableCell>
								<section className="flex justify-between items-center">
									<div className="flex flex-col gap-2">
										<div className="flex items-center gap-2">
											{idp.name}
											<EntityStatusLabel isEnabled={idp.isActive} />
										</div>
									</div>
									<div className="md:hidden">{renderEditButton(idp)}</div>
								</section>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
				<TableBody className="divide-y max-md:hidden">
					{idps.map((idp) => (
						<TableRow key={idp.id}>
							<TableCell>
								<div className="flex items-center gap-2">{idp.name}</div>
							</TableCell>
							<TableCell>
								<EntityStatusLabel isEnabled={idp.isActive} />
							</TableCell>
							<TableCell>{renderEditButton(idp)}</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</section>
	);
};

export default Page;
