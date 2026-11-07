"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import Breadcrumb from "../../../../../../identity/components/Breadcrumb.js";
import ClientTypeSelector from "../../../../../../identity/components/ClientTypeSelector.js";
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
import { Input } from "../../../../../../identity/components/ui/input.js";
import { useRouter } from "../../../../../../identity/i18n/navigation.js";
import { usePostApiV1ScopesMutation } from "../../../../../../identity/services/auth/api.js";
import { configSignal } from "../../../../../../identity/signals/index.js";
import { routeTool } from "../../../../../../identity/tools/index.js";
import useSignalValue from "../../../../../../identity/useSignalValue.js";
import useEditScope from "../useEditScope.js";

const Page = () => {
	const t = useTranslations();
	const router = useRouter();

	const { values, errors, onChange } = useEditScope(undefined);
	const [showErrors, setShowErrors] = useState(false);
	const configs = useSignalValue(configSignal);

	const [createScope, { isLoading: isCreating }] = usePostApiV1ScopesMutation();

	const handleUpdateType = (val: string) => {
		onChange("type", val);
		onChange("locales", undefined);
	};

	const handleSubmit = async () => {
		if (Object.values(errors).some((val) => !!val)) {
			setShowErrors(true);
			return;
		}

		const res = await createScope({
			postScopeReq: {
				...values,
				type: values.type as "spa" | "s2s",
			},
		});

		if (res.data?.scope?.id) {
			router.push(`${routeTool.Internal.Scopes}/${res.data.scope.id}`);
		}
	};

	return (
		<section>
			<Breadcrumb
				page={{ label: t("scopes.new") }}
				parent={{
					href: routeTool.Internal.Scopes,
					label: t("scopes.title"),
				}}
			/>
			<section>
				<PropertyList>
					<PropertyRow>
						<PropertyLabel>
							<RequiredProperty title={t("scopes.name")} />
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
						<PropertyLabel>{t("common.note")}</PropertyLabel>
						<PropertyValue>
							<Input
								data-testid="noteInput"
								onChange={(e) => onChange("note", e.target.value)}
								value={values.note}
							/>
						</PropertyValue>
					</PropertyRow>
					<PropertyRow>
						<PropertyLabel>
							<RequiredProperty title={t("scopes.type")} />
						</PropertyLabel>
						<PropertyValue>
							<ClientTypeSelector value={values.type} onChange={handleUpdateType} />
							{showErrors && <FieldError error={errors.type} />}
						</PropertyValue>
					</PropertyRow>
					{configs.ENABLE_USER_APP_CONSENT && values.type === "spa" && (
						<PropertyRow>
							<PropertyLabel>{t("scopes.locales")}</PropertyLabel>
							<PropertyValue>
								<LocaleEditor
									description={`* ${t("scopes.localeNote")}`}
									supportedLocales={configs.SUPPORTED_LOCALES}
									values={values.locales ?? []}
									onChange={(locales) => onChange("locales", locales)}
								/>
							</PropertyValue>
						</PropertyRow>
					)}
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
