"use client";

import { useParams } from "@superboard/front-ui/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import Breadcrumb from "../../../../../../identity/components/Breadcrumb.js";
import DeleteButton from "../../../../../../identity/components/DeleteButton.js";
import FieldError from "../../../../../../identity/components/FieldError.js";
import LoadingPage from "../../../../../../identity/components/LoadingPage.js";
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
import { useAuth } from "../../../../../../identity/melody-react.js";
import {
	useGetApiV1UserAttributesByIdQuery,
	usePutApiV1UserAttributesByIdMutation,
	useDeleteApiV1UserAttributesByIdMutation,
} from "../../../../../../identity/services/auth/api.js";
import { configSignal } from "../../../../../../identity/signals/index.js";
import { routeTool, accessTool } from "../../../../../../identity/tools/index.js";
import useSignalValue from "../../../../../../identity/useSignalValue.js";
import useEditUserAttribute from "../useEditUserAttribute.js";

const Page = () => {
	const { id } = useParams();

	const t = useTranslations();
	const router = useRouter();

	const configs = useSignalValue(configSignal);

	const { data, isLoading } = useGetApiV1UserAttributesByIdQuery({ id: Number(id) });
	const [updateUserAttribute, { isLoading: isUpdating }] = usePutApiV1UserAttributesByIdMutation();
	const [deleteUserAttribute, { isLoading: isDeleting }] =
		useDeleteApiV1UserAttributesByIdMutation();

	const { userInfo } = useAuth();
	const canWriteUserAttribute = accessTool.isAllowedAccess(
		accessTool.Access.WriteUserAttribute,
		userInfo?.roles,
	);

	const userAttribute = data?.userAttribute;

	const { values, errors, onChange } = useEditUserAttribute(userAttribute);
	const [showErrors, setShowErrors] = useState(false);

	const hasDifferentLocales = useMemo(() => {
		if (values.locales !== undefined && userAttribute?.locales === undefined) return true;
		if (Array.isArray(values.locales) && Array.isArray(userAttribute?.locales)) {
			if (values.locales.length !== userAttribute.locales.length) return true;
			if (
				values.locales.find((valueLocale) => {
					return userAttribute?.locales?.every((attributeLocale) => {
						return (
							attributeLocale.locale !== valueLocale.locale ||
							attributeLocale.value !== valueLocale.value
						);
					});
				})
			)
				return true;
		}
		return false;
	}, [values, userAttribute]);

	const hasDifferentValidationLocales = useMemo(() => {
		if (values.validationLocales !== undefined && userAttribute?.validationLocales === undefined)
			return true;
		if (
			Array.isArray(values.validationLocales) &&
			Array.isArray(userAttribute?.validationLocales)
		) {
			if (values.validationLocales.length !== userAttribute.validationLocales.length) return true;
			if (
				values.validationLocales.find((validationLocale) => {
					return userAttribute?.validationLocales?.every((attributeLocale) => {
						return (
							attributeLocale.locale !== validationLocale.locale ||
							attributeLocale.value !== validationLocale.value
						);
					});
				})
			)
				return true;
		}
		return false;
	}, [values, userAttribute]);

	const handleSave = async () => {
		if (Object.values(errors).some((val) => !!val)) {
			setShowErrors(true);
			return;
		}

		await updateUserAttribute({
			id: Number(id),
			putUserAttributeReq: values,
		});
	};

	const handleDelete = async () => {
		await deleteUserAttribute({ id: Number(id) });

		router.push(routeTool.Internal.UserAttributes);
	};

	const handleChangeIncludeInSignUpForm = () => {
		const value = !values.includeInSignUpForm;
		onChange("includeInSignUpForm", value);
		if (!value && values.requiredInSignUpForm) {
			onChange("requiredInSignUpForm", false);
		}
	};

	if (isLoading) return <LoadingPage />;

	if (!userAttribute) return null;

	return (
		<section>
			<Breadcrumb
				page={{ label: userAttribute.name }}
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
								disabled={!canWriteUserAttribute}
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
								disabled={!canWriteUserAttribute}
								onChange={(values) => onChange("locales", values)}
							/>
						</PropertyValue>
					</PropertyRow>
					<PropertyRow inline>
						<PropertyLabel>{t("userAttributes.includeInSignUpForm")}</PropertyLabel>
						<PropertyValue>
							<Switch
								checked={values.includeInSignUpForm}
								disabled={!canWriteUserAttribute}
								onClick={handleChangeIncludeInSignUpForm}
							/>
						</PropertyValue>
					</PropertyRow>
					{values.includeInSignUpForm && (
						<PropertyRow>
							<SwitchRow
								label={t("userAttributes.requiredInSignUpForm")}
								description={t("userAttributes.requiredAttributeNote")}
								checked={values.requiredInSignUpForm}
								disabled={!canWriteUserAttribute}
								onClick={() => onChange("requiredInSignUpForm", !values.requiredInSignUpForm)}
							/>
						</PropertyRow>
					)}
					<PropertyRow inline>
						<PropertyLabel>{t("userAttributes.includeInIdTokenBody")}</PropertyLabel>
						<PropertyValue>
							<Switch
								checked={values.includeInIdTokenBody}
								disabled={!canWriteUserAttribute}
								onClick={() => onChange("includeInIdTokenBody", !values.includeInIdTokenBody)}
							/>
						</PropertyValue>
					</PropertyRow>
					<PropertyRow inline>
						<PropertyLabel>{t("userAttributes.includeInUserInfo")}</PropertyLabel>
						<PropertyValue>
							<Switch
								checked={values.includeInUserInfo}
								disabled={!canWriteUserAttribute}
								onClick={() => onChange("includeInUserInfo", !values.includeInUserInfo)}
							/>
						</PropertyValue>
					</PropertyRow>
					<PropertyRow>
						<SwitchRow
							label={t("userAttributes.uniqueAttribute")}
							description={t("userAttributes.uniqueAttributeNote")}
							checked={values.unique}
							disabled={!canWriteUserAttribute}
							onClick={() => onChange("unique", !values.unique)}
						/>
					</PropertyRow>
					<PropertyRow>
						<PropertyLabel>{t("userAttributes.validation")}</PropertyLabel>
						<PropertyValue>
							<Input
								data-testid="validationRegexInput"
								disabled={!canWriteUserAttribute}
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
								disabled={!canWriteUserAttribute}
								onChange={(values) => onChange("validationLocales", values)}
							/>
						</PropertyValue>
					</PropertyRow>
					<PropertyRow>
						<PropertyLabel>{t("common.createdAt")}</PropertyLabel>
						<PropertyValue>{t("common.utcTime", { time: userAttribute.createdAt })}</PropertyValue>
					</PropertyRow>
					<PropertyRow>
						<PropertyLabel>{t("common.updatedAt")}</PropertyLabel>
						<PropertyValue>{t("common.utcTime", { time: userAttribute.updatedAt })}</PropertyValue>
					</PropertyRow>
				</PropertyList>
			</section>
			<SubmitError />
			{canWriteUserAttribute && (
				<section className="mt-8 flex items-center justify-end gap-4">
					<SaveButton
						isLoading={isUpdating}
						disabled={
							!values.name ||
							(values.name === userAttribute.name &&
								values.validationRegex === userAttribute.validationRegex &&
								values.includeInSignUpForm === userAttribute.includeInSignUpForm &&
								values.requiredInSignUpForm === userAttribute.requiredInSignUpForm &&
								values.includeInIdTokenBody === userAttribute.includeInIdTokenBody &&
								values.includeInUserInfo === userAttribute.includeInUserInfo &&
								values.unique === userAttribute.unique &&
								!hasDifferentLocales &&
								!hasDifferentValidationLocales)
						}
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
		</section>
	);
};

export default Page;
