"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import Breadcrumb from "../../../../../../identity/components/Breadcrumb.js";
import ClientTypeSelector from "../../../../../../identity/components/ClientTypeSelector.js";
import FieldError from "../../../../../../identity/components/FieldError.js";
import LocaleEditor from "../../../../../../identity/components/LocaleEditor.js";
import RequiredProperty from "../../../../../../identity/components/RequiredProperty.js";
import SaveButton from "../../../../../../identity/components/SaveButton.js";
import SubmitError from "../../../../../../identity/components/SubmitError.js";
import { Input } from "../../../../../../identity/components/ui/input.js";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "../../../../../../identity/components/ui/table.js";
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
								<RequiredProperty title={t("scopes.name")} />
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
							<TableCell>{t("common.note")}</TableCell>
							<TableCell>
								<Input
									data-testid="noteInput"
									onChange={(e) => onChange("note", e.target.value)}
									value={values.note}
								/>
							</TableCell>
						</TableRow>
						<TableRow>
							<TableCell>
								<RequiredProperty title={t("scopes.type")} />
							</TableCell>
							<TableCell>
								<ClientTypeSelector value={values.type} onChange={handleUpdateType} />
								{showErrors && <FieldError error={errors.type} />}
							</TableCell>
						</TableRow>
						{configs.ENABLE_USER_APP_CONSENT && values.type === "spa" && (
							<TableRow>
								<TableCell>{t("scopes.locales")}</TableCell>
								<TableCell>
									<LocaleEditor
										description={`* ${t("scopes.localeNote")}`}
										supportedLocales={configs.SUPPORTED_LOCALES}
										values={values.locales ?? []}
										onChange={(locales) => onChange("locales", locales)}
									/>
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</section>
			<SubmitError />
			<SaveButton className="mt-8" isLoading={isCreating} onClick={handleSubmit} />
		</section>
	);
};

export default Page;
