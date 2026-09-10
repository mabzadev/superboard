"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import Breadcrumb from "../../../../../../identity/components/Breadcrumb.js";
import FieldError from "../../../../../../identity/components/FieldError.js";
import LocaleEditor from "../../../../../../identity/components/LocaleEditor.js";
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
import { usePostApiV1UserAttributesMutation } from "../../../../../../identity/services/auth/api.js";
import { configSignal } from "../../../../../../identity/signals/index.js";
import { routeTool } from "../../../../../../identity/tools/index.js";
import useSignalValue from "../../../../../../identity/useSignalValue.js";
import useEditUserAttribute from "../useEditUserAttribute.js";

const Page = () => {
	const t = useTranslations();
	const router = useRouter();

	const configs = useSignalValue(configSignal);

	const { values, errors, onChange } = useEditUserAttribute(undefined);
	const [showErrors, setShowErrors] = useState(false);
	const [createUserAttribute, { isLoading: isCreating }] = usePostApiV1UserAttributesMutation();

	const handleSubmit = async () => {
		if (Object.values(errors).some((val) => !!val)) {
			setShowErrors(true);
			return;
		}

		const res = await createUserAttribute({ postUserAttributeReq: values });

		if (res.data?.userAttribute?.id) {
			router.push(`${routeTool.Internal.UserAttributes}/${res.data.userAttribute.id}`);
		}
	};

	const handleUpdateIncludeInSignUpForm = () => {
		const value = !values.includeInSignUpForm;
		onChange("includeInSignUpForm", value);
		if (!value && values.requiredInSignUpForm) {
			onChange("requiredInSignUpForm", false);
		}
	};

	return (
		<section>
			<Breadcrumb
				page={{ label: t("userAttributes.new") }}
				parent={{
					href: routeTool.Internal.UserAttributes,
					label: t("userAttributes.title"),
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
								<RequiredProperty title={t("userAttributes.name")} />
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
							<TableCell>{t("userAttributes.locales")}</TableCell>
							<TableCell>
								<LocaleEditor
									description={`* ${t("userAttributes.localeNote")}`}
									supportedLocales={configs.SUPPORTED_LOCALES}
									values={values.locales}
									onChange={(values) => onChange("locales", values)}
								/>
							</TableCell>
						</TableRow>
						<TableRow>
							<TableCell>{t("userAttributes.includeInSignUpForm")}</TableCell>
							<TableCell>
								<Switch
									checked={values.includeInSignUpForm}
									onClick={() => handleUpdateIncludeInSignUpForm()}
								/>
							</TableCell>
						</TableRow>
						<TableRow>
							<TableCell>{t("userAttributes.requiredInSignUpForm")}</TableCell>
							<TableCell>
								<div className="flex items-center gap-4">
									<Switch
										checked={values.requiredInSignUpForm}
										disabled={!values.includeInSignUpForm}
										onClick={() => onChange("requiredInSignUpForm", !values.requiredInSignUpForm)}
									/>
									<p>{t("userAttributes.requiredAttributeNote")}</p>
								</div>
							</TableCell>
						</TableRow>
						<TableRow>
							<TableCell>{t("userAttributes.includeInIdTokenBody")}</TableCell>
							<TableCell>
								<Switch
									checked={values.includeInIdTokenBody}
									onClick={() => onChange("includeInIdTokenBody", !values.includeInIdTokenBody)}
								/>
							</TableCell>
						</TableRow>
						<TableRow>
							<TableCell>{t("userAttributes.includeInUserInfo")}</TableCell>
							<TableCell>
								<Switch
									checked={values.includeInUserInfo}
									onClick={() => onChange("includeInUserInfo", !values.includeInUserInfo)}
								/>
							</TableCell>
						</TableRow>
						<TableRow>
							<TableCell>{t("userAttributes.uniqueAttribute")}</TableCell>
							<TableCell>
								<div className="flex items-center gap-4">
									<Switch
										checked={values.unique}
										onClick={() => onChange("unique", !values.unique)}
									/>
									<p>{t("userAttributes.uniqueAttributeNote")}</p>
								</div>
							</TableCell>
						</TableRow>
						<TableRow>
							<TableCell>{t("userAttributes.validation")}</TableCell>
							<TableCell>
								<Input
									data-testid="validationRegexInput"
									placeholder={t("userAttributes.validationPlaceholder")}
									onChange={(e) => onChange("validationRegex", e.target.value)}
									value={values.validationRegex}
								/>
								{showErrors && <FieldError error={errors.validationRegex} />}
							</TableCell>
						</TableRow>
						<TableRow>
							<TableCell>{t("userAttributes.validationLocales")}</TableCell>
							<TableCell>
								<LocaleEditor
									description={`* ${t("userAttributes.validationLocaleNote")}`}
									supportedLocales={configs.SUPPORTED_LOCALES}
									values={values.validationLocales}
									onChange={(values) => onChange("validationLocales", values)}
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
