"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import Breadcrumb from "../../../../../../identity/components/Breadcrumb.js";
import FieldError from "../../../../../../identity/components/FieldError.js";
import LocaleEditor from "../../../../../../identity/components/LocaleEditor.js";
import {
	PropertyLabel,
	PropertyList,
	PropertyRow,
	PropertyValue,
} from "../../../../../../identity/components/PropertyList.js";
import RequiredProperty from "../../../../../../identity/components/RequiredProperty.js";
import SaveButton from "../../../../../../identity/components/SaveButton.js";
import SubmitError from "../../../../../../identity/components/SubmitError.js";
import SwitchRow from "../../../../../../identity/components/SwitchRow.js";
import { Input } from "../../../../../../identity/components/ui/input.js";
import { Switch } from "../../../../../../identity/components/ui/switch.js";
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
				<PropertyList>
					<PropertyRow>
						<PropertyLabel>
							<RequiredProperty title={t("userAttributes.name")} />
						</PropertyLabel>
						<PropertyValue>
							<Input
								data-testid="nameInput"
								onChange={(e) => onChange("name", e.target.value)}
								value={values.name}
							/>
							{showErrors && <FieldError error={errors.name} />}
						</PropertyValue>
					</PropertyRow>
					<PropertyRow>
						<PropertyLabel>{t("userAttributes.locales")}</PropertyLabel>
						<PropertyValue>
							<LocaleEditor
								description={`* ${t("userAttributes.localeNote")}`}
								supportedLocales={configs.SUPPORTED_LOCALES}
								values={values.locales}
								onChange={(values) => onChange("locales", values)}
							/>
						</PropertyValue>
					</PropertyRow>
					<PropertyRow inline>
						<PropertyLabel>{t("userAttributes.includeInSignUpForm")}</PropertyLabel>
						<PropertyValue>
							<Switch
								checked={values.includeInSignUpForm}
								onClick={() => handleUpdateIncludeInSignUpForm()}
							/>
						</PropertyValue>
					</PropertyRow>
					{values.includeInSignUpForm && (
						<PropertyRow>
							<SwitchRow
								label={t("userAttributes.requiredInSignUpForm")}
								description={t("userAttributes.requiredAttributeNote")}
								checked={values.requiredInSignUpForm}
								onClick={() => onChange("requiredInSignUpForm", !values.requiredInSignUpForm)}
							/>
						</PropertyRow>
					)}
					<PropertyRow inline>
						<PropertyLabel>{t("userAttributes.includeInIdTokenBody")}</PropertyLabel>
						<PropertyValue>
							<Switch
								checked={values.includeInIdTokenBody}
								onClick={() => onChange("includeInIdTokenBody", !values.includeInIdTokenBody)}
							/>
						</PropertyValue>
					</PropertyRow>
					<PropertyRow inline>
						<PropertyLabel>{t("userAttributes.includeInUserInfo")}</PropertyLabel>
						<PropertyValue>
							<Switch
								checked={values.includeInUserInfo}
								onClick={() => onChange("includeInUserInfo", !values.includeInUserInfo)}
							/>
						</PropertyValue>
					</PropertyRow>
					<PropertyRow>
						<SwitchRow
							label={t("userAttributes.uniqueAttribute")}
							description={t("userAttributes.uniqueAttributeNote")}
							checked={values.unique}
							onClick={() => onChange("unique", !values.unique)}
						/>
					</PropertyRow>
					<PropertyRow>
						<PropertyLabel>{t("userAttributes.validation")}</PropertyLabel>
						<PropertyValue>
							<Input
								data-testid="validationRegexInput"
								placeholder={t("userAttributes.validationPlaceholder")}
								onChange={(e) => onChange("validationRegex", e.target.value)}
								value={values.validationRegex}
							/>
							{showErrors && <FieldError error={errors.validationRegex} />}
						</PropertyValue>
					</PropertyRow>
					<PropertyRow>
						<PropertyLabel>{t("userAttributes.validationLocales")}</PropertyLabel>
						<PropertyValue>
							<LocaleEditor
								description={`* ${t("userAttributes.validationLocaleNote")}`}
								supportedLocales={configs.SUPPORTED_LOCALES}
								values={values.validationLocales}
								onChange={(values) => onChange("validationLocales", values)}
							/>
						</PropertyValue>
					</PropertyRow>
				</PropertyList>
			</section>
			<SubmitError />
			<div className="mt-8 flex justify-end">
				<SaveButton
					isLoading={isCreating}
					onClick={() => {
						handleSubmit().catch(() => undefined);
					}}
				/>
			</div>
		</section>
	);
};

export default Page;
