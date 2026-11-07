"use client";

import { useTranslations } from "next-intl";

import Breadcrumb from "../../../../../identity/components/Breadcrumb.js";
import ClientTypeLabel from "../../../../../identity/components/ClientTypeLabel.js";
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
import { useGetApiV1AppsQuery } from "../../../../../identity/services/auth/api.js";
import { routeTool, accessTool } from "../../../../../identity/tools/index.js";

const Page = () => {
	const t = useTranslations();

	const { data, isLoading } = useGetApiV1AppsQuery();

	const { userInfo } = useAuth();
	const canWriteApp = accessTool.isAllowedAccess(accessTool.Access.WriteApp, userInfo?.roles);

	const apps = data?.apps ?? [];

	if (isLoading) return <LoadingPage />;

	return (
		<section>
			<Breadcrumb
				page={{ label: t("apps.title") }}
				action={canWriteApp && <CreateButton href={`${routeTool.Internal.Apps}/new`} />}
			/>
			<Table className="break-all">
				<TableHeader className="md:hidden">
					<TableRow>
						<TableHead>{t("apps.app")}</TableHead>
					</TableRow>
				</TableHeader>
				<TableHeader className="max-md:hidden">
					<TableRow>
						<TableHead>{t("apps.name")}</TableHead>
						<TableHead>{t("apps.clientId")}</TableHead>
						<TableHead>{t("apps.status")}</TableHead>
						<TableHead>{t("apps.type")}</TableHead>
						<TableHead />
					</TableRow>
				</TableHeader>
				<TableBody className="divide-y md:hidden">
					{apps.map((app) => (
						<TableRow key={app.id}>
							<TableCell>
								<div className="flex items-center justify-between">
									<div className="flex flex-col gap-2">
										{app.name}
										{app.clientId}
										<div className="flex items-center gap-2">
											<EntityStatusLabel isEnabled={app.isActive} />
											<ClientTypeLabel type={app.type} />
										</div>
									</div>
									<EditLink viewOnly={!canWriteApp} href={`${routeTool.Internal.Apps}/${app.id}`} />
								</div>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
				<TableBody className="divide-y max-md:hidden">
					{apps.map((app) => (
						<TableRow key={app.id} data-testid="appRow">
							<TableCell>{app.name}</TableCell>
							<TableCell>{app.clientId}</TableCell>
							<TableCell>
								<EntityStatusLabel isEnabled={app.isActive} />
							</TableCell>
							<TableCell>
								<ClientTypeLabel type={app.type} />
							</TableCell>
							<TableCell>
								<EditLink viewOnly={!canWriteApp} href={`${routeTool.Internal.Apps}/${app.id}`} />
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</section>
	);
};

export default Page;
