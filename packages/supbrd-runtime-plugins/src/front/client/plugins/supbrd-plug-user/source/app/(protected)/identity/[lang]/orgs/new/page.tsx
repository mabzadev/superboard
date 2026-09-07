"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import Breadcrumb from "../../../../../../identity/components/Breadcrumb.js";
import FieldError from "../../../../../../identity/components/FieldError.js";
import RequiredProperty from "../../../../../../identity/components/RequiredProperty.js";
import SaveButton from "../../../../../../identity/components/SaveButton.js";
import SubmitError from "../../../../../../identity/components/SubmitError.js";
import { Input } from "../../../../../../identity/components/ui/input.js";
import { Switch } from "../../../../../../identity/components/ui/switch.js";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "../../../../../../identity/components/ui/table.js";
import { useRouter } from "../../../../../../identity/i18n/navigation.js";
import { usePostApiV1OrgsMutation } from "../../../../../../identity/services/auth/api.js";
import { routeTool } from "../../../../../../identity/tools/index.js";
import useEditOrg from "../useEditOrg.js";

const Page = () => {
	const t = useTranslations();
	const router = useRouter();

	const { values, errors, onChange } = useEditOrg(undefined);
	const [showErrors, setShowErrors] = useState(false);
	const [createOrg, { isLoading: isCreating }] = usePostApiV1OrgsMutation();

	const handleSubmit = async () => {
		if (Object.values(errors).some((val) => !!val)) {
			setShowErrors(true);
			return;
		}

		const res = await createOrg({ postOrgReq: values });

		if (res.data?.org?.id) {
			router.push(`${routeTool.Internal.Orgs}/${res.data.org.id}`);
		}
	};

	return (
		<section>
			<Breadcrumb
				page={{ label: t("orgs.new") }}
				parent={{
					href: routeTool.Internal.Orgs,
					label: t("orgs.title"),
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
								<RequiredProperty title={t("orgs.name")} />
							</TableCell>
							<TableCell>
								<Input
									data-testid="nameInput"
									onChange={(e) => onChange("name", e.target.value)}
									value={values.name}
								/>
								{showErrors && <FieldError error={errors.name} />}
							</TableCell>
						</TableRow>
						<TableRow>
							<TableCell>
								<RequiredProperty title={t("orgs.slug")} />
							</TableCell>
							<TableCell>
								<Input
									data-testid="slugInput"
									onChange={(e) => onChange("slug", e.target.value)}
									value={values.slug}
								/>
								{showErrors && <FieldError error={errors.slug} />}
							</TableCell>
						</TableRow>
						<TableRow>
							<TableCell>{t("orgs.allowPublicRegistration")}</TableCell>
							<TableCell>
								<Switch
									data-testid="allowPublicRegistrationSwitch"
									checked={values.allowPublicRegistration}
									onClick={() =>
										onChange("allowPublicRegistration", !values.allowPublicRegistration)
									}
								/>
							</TableCell>
						</TableRow>
						<TableRow>
							<TableCell>{t("orgs.onlyUseForBrandingOverride")}</TableCell>
							<TableCell>
								<Switch
									data-testid="onlyUseForBrandingOverrideSwitch"
									checked={values.onlyUseForBrandingOverride}
									onClick={() =>
										onChange("onlyUseForBrandingOverride", !values.onlyUseForBrandingOverride)
									}
								/>
							</TableCell>
						</TableRow>
					</TableBody>
				</Table>
			</section>
			<SubmitError />
			<SaveButton className="mt-8" isLoading={isCreating} onClick={handleSubmit} />
		</section>
	);
};

export default Page;
