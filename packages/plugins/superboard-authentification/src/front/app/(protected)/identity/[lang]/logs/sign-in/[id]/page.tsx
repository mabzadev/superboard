"use client";

import { useParams } from "@superboard/front-ui/navigation";
import { useTranslations } from "next-intl";

import Breadcrumb from "../../../../../../../identity/components/Breadcrumb.js";
import LoadingPage from "../../../../../../../identity/components/LoadingPage.js";
import {
	PropertyLabel,
	PropertyList,
	PropertyRow,
	PropertyValue,
} from "../../../../../../../identity/components/PropertyList.js";
import { useGetApiV1LogsSignInByIdQuery } from "../../../../../../../identity/services/auth/api.js";
import { routeTool } from "../../../../../../../identity/tools/index.js";
const Page = () => {
	const { id } = useParams();

	const t = useTranslations();
	const { data, isLoading } = useGetApiV1LogsSignInByIdQuery({ id: Number(id) });
	const log = data?.log;

	if (isLoading) return <LoadingPage />;

	if (!log) return null;

	return (
		<section>
			<Breadcrumb
				page={{ label: t("logs.signInLog") }}
				parent={{
					href: routeTool.Internal.Logs,
					label: t("logs.title"),
				}}
			/>
			<section>
				<PropertyList>
					<PropertyRow>
						<PropertyLabel>{t("logs.userId")}</PropertyLabel>
						<PropertyValue>{log.userId}</PropertyValue>
					</PropertyRow>
					<PropertyRow>
						<PropertyLabel>{t("logs.ip")}</PropertyLabel>
						<PropertyValue>{log.ip}</PropertyValue>
					</PropertyRow>
					<PropertyRow>
						<PropertyLabel>{t("logs.detail")}</PropertyLabel>
						<PropertyValue>{log.detail}</PropertyValue>
					</PropertyRow>
					<PropertyRow>
						<PropertyLabel>{t("common.createdAt")}</PropertyLabel>
						<PropertyValue>{t("common.utcTime", { time: log.createdAt })}</PropertyValue>
					</PropertyRow>
					<PropertyRow>
						<PropertyLabel>{t("common.updatedAt")}</PropertyLabel>
						<PropertyValue>{t("common.utcTime", { time: log.updatedAt })}</PropertyValue>
					</PropertyRow>
				</PropertyList>
			</section>
		</section>
	);
};

export default Page;
