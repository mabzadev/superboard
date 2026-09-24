"use client";

import { useTranslations } from "next-intl";

import Breadcrumb from "../../../../../identity/components/Breadcrumb.js";
import ConfigBooleanValue from "../../../../../identity/components/ConfigBooleanValue.js";
import CreateButton from "../../../../../identity/components/CreateButton.js";
import EditLink from "../../../../../identity/components/EditLink.js";
import LoadingPage from "../../../../../identity/components/LoadingPage.js";
import { Badge } from "../../../../../identity/components/ui/badge.js";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "../../../../../identity/components/ui/table.js";
import { useAuth } from "../../../../../identity/melody-react.js";
import { useGetApiV1UserAttributesQuery } from "../../../../../identity/services/auth/api.js";
import { routeTool, accessTool } from "../../../../../identity/tools/index.js";

const Page = () => {
	const t = useTranslations();

	const { userInfo } = useAuth();
	const canWriteUserAttribute = accessTool.isAllowedAccess(
		accessTool.Access.WriteUserAttribute,
		userInfo?.roles,
	);

	const { data, isLoading } = useGetApiV1UserAttributesQuery();
	const userAttributes = data?.userAttributes ?? [];

	if (isLoading) return <LoadingPage />;

	return (
		<section>
			<Breadcrumb
				page={{ label: t("userAttributes.title") }}
				action={
					canWriteUserAttribute && (
						<CreateButton href={`${routeTool.Internal.UserAttributes}/new`} />
					)
				}
			/>
			<Table>
				<TableHeader className="md:hidden">
					<TableRow>
						<TableHead>{t("userAttributes.userAttribute")}</TableHead>
					</TableRow>
					<TableRow />
				</TableHeader>
				<TableHeader className="max-md:hidden">
					<TableRow>
						<TableHead>{t("userAttributes.name")}</TableHead>
						<TableHead>{t("userAttributes.includeInSignUpForm")}</TableHead>
						<TableHead>{t("userAttributes.requiredInSignUpForm")}</TableHead>
						<TableHead>{t("userAttributes.includeInIdTokenBody")}</TableHead>
						<TableHead>{t("userAttributes.includeInUserInfo")}</TableHead>
						<TableHead>{t("userAttributes.uniqueAttribute")}</TableHead>
						<TableHead>{t("userAttributes.validation")}</TableHead>
						<TableHead />
					</TableRow>
				</TableHeader>
				<TableBody className="divide-y md:hidden">
					{userAttributes.map((userAttribute) => (
						<TableRow key={userAttribute.id}>
							<TableCell>
								<div className="flex flex-wrap items-center justify-between">
									<div className="flex flex-col gap-2">
										<div className="flex items-center gap-2">{userAttribute.name}</div>
									</div>
									<EditLink
										viewOnly={!canWriteUserAttribute}
										href={`${routeTool.Internal.UserAttributes}/${userAttribute.id}`}
									/>
								</div>
							</TableCell>
							<TableCell>
								<div className="flex flex-wrap gap-2">
									{userAttribute.includeInSignUpForm && (
										<Badge>{t("userAttributes.includeInSignUpForm")}</Badge>
									)}
									{userAttribute.requiredInSignUpForm && (
										<Badge>{t("userAttributes.requiredInSignUpForm")}</Badge>
									)}
									{userAttribute.includeInIdTokenBody && (
										<Badge>{t("userAttributes.includeInIdTokenBody")}</Badge>
									)}
									{userAttribute.includeInUserInfo && (
										<Badge>{t("userAttributes.includeInUserInfo")}</Badge>
									)}
									{userAttribute.unique && <Badge>{t("userAttributes.uniqueAttribute")}</Badge>}
									{userAttribute.validationRegex && <Badge>{t("userAttributes.validation")}</Badge>}
								</div>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
				<TableBody className="divide-y max-md:hidden">
					{userAttributes.map((userAttribute) => (
						<TableRow data-testid="userAttributeRow" key={userAttribute.id}>
							<TableCell>
								<div className="flex items-center gap-2">{userAttribute.name}</div>
							</TableCell>
							<TableCell>
								<ConfigBooleanValue config={userAttribute.includeInSignUpForm} />
							</TableCell>
							<TableCell>
								<ConfigBooleanValue config={userAttribute.requiredInSignUpForm} />
							</TableCell>
							<TableCell>
								<ConfigBooleanValue config={userAttribute.includeInIdTokenBody} />
							</TableCell>
							<TableCell>
								<ConfigBooleanValue config={userAttribute.includeInUserInfo} />
							</TableCell>
							<TableCell>
								<ConfigBooleanValue config={userAttribute.unique} />
							</TableCell>
							<TableCell>
								<ConfigBooleanValue config={!!userAttribute.validationRegex} />
							</TableCell>
							<TableCell>
								<EditLink
									viewOnly={!canWriteUserAttribute}
									href={`${routeTool.Internal.UserAttributes}/${userAttribute.id}`}
								/>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</section>
	);
};

export default Page;
