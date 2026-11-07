"use client";

import { useParams } from "@superboard/front-ui/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import Breadcrumb from "../../../../../../identity/components/Breadcrumb.js";
import ClientTypeLabel from "../../../../../../identity/components/ClientTypeLabel.js";
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
import { Input } from "../../../../../../identity/components/ui/input.js";
import { useRouter } from "../../../../../../identity/i18n/navigation.js";
import { useAuth } from "../../../../../../identity/melody-react.js";
import {
	useDeleteApiV1ScopesByIdMutation,
	useGetApiV1ScopesByIdQuery,
	usePutApiV1ScopesByIdMutation,
} from "../../../../../../identity/services/auth/api.js";
import { configSignal } from "../../../../../../identity/signals/index.js";
import { dataTool, routeTool, accessTool } from "../../../../../../identity/tools/index.js";
import useSignalValue from "../../../../../../identity/useSignalValue.js";
import useEditScope from "../useEditScope.js";

const Page = () => {
	const { id } = useParams();

	const t = useTranslations();
	const router = useRouter();

	const { data, isLoading } = useGetApiV1ScopesByIdQuery({ id: Number(id) });
	const scope = data?.scope;
	const [updateScope, { isLoading: isUpdating }] = usePutApiV1ScopesByIdMutation();
	const [deleteScope, { isLoading: isDeleting }] = useDeleteApiV1ScopesByIdMutation();

	const configs = useSignalValue(configSignal);

	const isSystem = useMemo(() => scope && dataTool.isSystemScope(scope.name), [scope]);

	const { userInfo } = useAuth();
	const canWriteScope = accessTool.isAllowedAccess(accessTool.Access.WriteScope, userInfo?.roles);

	const { values, errors, onChange } = useEditScope(scope);
	const [showErrors, setShowErrors] = useState(false);

	const hasDifferentLocales = useMemo(() => {
		if (values.locales !== undefined && scope?.locales === undefined) return true;
		if (Array.isArray(values.locales) && Array.isArray(scope?.locales)) {
			if (values.locales.length !== scope.locales.length) return true;
			if (
				values.locales.find((valueLocale) => {
					return scope.locales.every((scopeLocale) => {
						return (
							scopeLocale.locale !== valueLocale.locale || scopeLocale.value !== valueLocale.value
						);
					});
				})
			)
				return true;
		}
		return false;
	}, [values, scope]);

	const hasDifferentName = useMemo(
		() => values.name && values.name !== scope?.name,
		[values, scope],
	);
	const hasDifferentNote = useMemo(() => values.note !== scope?.note, [values, scope]);

	const canUpdate = useMemo(
		() => hasDifferentName || hasDifferentNote || hasDifferentLocales,
		[hasDifferentName, hasDifferentNote, hasDifferentLocales],
	);

	const handleSave = async () => {
		if (Object.values(errors).some((val) => !!val)) {
			setShowErrors(true);
			return;
		}

		await updateScope({
			id: Number(id),
			putScopeReq: {
				name: hasDifferentName ? values.name : undefined,
				note: hasDifferentNote ? values.note : undefined,
				locales: hasDifferentLocales ? values.locales : undefined,
			},
		});
	};

	const handleDelete = async () => {
		await deleteScope({ id: Number(id) });

		router.push(routeTool.Internal.Scopes);
	};

	if (isLoading) return <LoadingPage />;

	if (!scope) return null;

	return (
		<section>
			<Breadcrumb
				page={{ label: scope.name }}
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
							{isSystem ? (
								values.name
							) : (
								<Input
									disabled={!canWriteScope}
									data-testid="nameInput"
									onChange={(e) => onChange("name", e.target.value)}
									value={values.name}
								/>
							)}
							{showErrors && <FieldError error={errors.name} />}
						</PropertyValue>
					</PropertyRow>
					<PropertyRow>
						<PropertyLabel>{t("common.note")}</PropertyLabel>
						<PropertyValue>
							<Input
								data-testid="noteInput"
								disabled={!canWriteScope}
								onChange={(e) => onChange("note", e.target.value)}
								value={values.note}
							/>
						</PropertyValue>
					</PropertyRow>
					<PropertyRow>
						<PropertyLabel>{t("scopes.type")}</PropertyLabel>
						<PropertyValue>
							<ClientTypeLabel type={scope.type} />
						</PropertyValue>
					</PropertyRow>
					{configs.ENABLE_USER_APP_CONSENT && scope.type === "spa" && (
						<PropertyRow>
							<PropertyLabel>{t("scopes.locales")}</PropertyLabel>
							<PropertyValue>
								<LocaleEditor
									description={`* ${t("scopes.localeNote")}`}
									supportedLocales={configs.SUPPORTED_LOCALES}
									values={values.locales ?? []}
									disabled={!canWriteScope}
									onChange={(locales) => onChange("locales", locales)}
								/>
							</PropertyValue>
						</PropertyRow>
					)}
					<PropertyRow>
						<PropertyLabel>{t("common.createdAt")}</PropertyLabel>
						<PropertyValue>{t("common.utcTime", { time: scope.createdAt })}</PropertyValue>
					</PropertyRow>
					<PropertyRow>
						<PropertyLabel>{t("common.updatedAt")}</PropertyLabel>
						<PropertyValue>{t("common.utcTime", { time: scope.updatedAt })}</PropertyValue>
					</PropertyRow>
				</PropertyList>
			</section>
			<SubmitError />
			{canWriteScope && (
				<section className="mt-8 flex items-center justify-end gap-4">
					<SaveButton
						isLoading={isUpdating}
						disabled={!canUpdate || isDeleting}
						onClick={handleSave}
					/>
					{!isSystem && (
						<DeleteButton
							isLoading={isDeleting}
							disabled={isUpdating}
							confirmDeleteTitle={t("common.deleteConfirm", { item: values.name })}
							onConfirmDelete={handleDelete}
						/>
					)}
				</section>
			)}
		</section>
	);
};

export default Page;
