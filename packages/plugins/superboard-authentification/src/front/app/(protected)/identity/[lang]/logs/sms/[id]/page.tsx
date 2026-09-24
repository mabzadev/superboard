"use client";

import { useParams } from "@superboard/front-ui/navigation";
import { useTranslations } from "next-intl";

import Breadcrumb from "../../../../../../../identity/components/Breadcrumb.js";
import LoadingPage from "../../../../../../../identity/components/LoadingPage.js";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "../../../../../../../identity/components/ui/table.js";
import { useGetApiV1LogsSmsByIdQuery } from "../../../../../../../identity/services/auth/api.js";
import { routeTool } from "../../../../../../../identity/tools/index.js";
const Page = () => {
	const { id } = useParams();

	const t = useTranslations();

	const { data, isLoading } = useGetApiV1LogsSmsByIdQuery({ id: Number(id) });
	const log = data?.log;

	if (isLoading) return <LoadingPage />;

	if (!log) return null;

	return (
		<section>
			<Breadcrumb
				parent={{
					href: routeTool.Internal.Logs,
					label: t("logs.title"),
				}}
				page={{ label: t("logs.smsLog") }}
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
							<TableCell>{t("logs.receiver")}</TableCell>
							<TableCell>{log.receiver}</TableCell>
						</TableRow>
						<TableRow>
							<TableCell>{t("logs.response")}</TableCell>
							<TableCell>{log.response}</TableCell>
						</TableRow>
						<TableRow>
							<TableCell>{t("logs.content")}</TableCell>
							<TableCell>{log.content}</TableCell>
						</TableRow>
						<TableRow>
							<TableCell>{t("common.createdAt")}</TableCell>
							<TableCell>{log.createdAt} UTC</TableCell>
						</TableRow>
						<TableRow>
							<TableCell>{t("common.updatedAt")}</TableCell>
							<TableCell>{log.updatedAt} UTC</TableCell>
						</TableRow>
					</TableBody>
				</Table>
			</section>
		</section>
	);
};

export default Page;
