"use client";

import { useParams } from "@superboard/front-ui/navigation";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { useSelector } from "react-redux";

import Breadcrumb from "../../../../../../identity/components/Breadcrumb.js";
import ClientTypeLabel from "../../../../../../identity/components/ClientTypeLabel.js";
import DeleteButton from "../../../../../../identity/components/DeleteButton.js";
import FieldError from "../../../../../../identity/components/FieldError.js";
import LoadingPage from "../../../../../../identity/components/LoadingPage.js";
import {
	PropertyLabel,
	PropertyList,
	PropertyRow,
	PropertyValue,
} from "../../../../../../identity/components/PropertyList.js";
import RequiredProperty from "../../../../../../identity/components/RequiredProperty.js";
import SaveButton from "../../../../../../identity/components/SaveButton.js";
import ScopesEditor from "../../../../../../identity/components/ScopesEditor.js";
import SubmitError from "../../../../../../identity/components/SubmitError.js";
import SwitchRow from "../../../../../../identity/components/SwitchRow.js";
import { Alert } from "../../../../../../identity/components/ui/alert.js";
import { Input } from "../../../../../../identity/components/ui/input.js";
import { Switch } from "../../../../../../identity/components/ui/switch.js";
import { useRouter } from "../../../../../../identity/i18n/navigation.js";
import { useAuth } from "../../../../../../identity/melody-react.js";
import {
	useDeleteApiV1AppsByIdMutation,
	useGetApiV1AppsByIdQuery,
	useGetApiV1ScopesQuery,
	usePutApiV1AppsByIdMutation,
} from "../../../../../../identity/services/auth/api.js";
import type { RootState } from "../../../../../../identity/stores/index.js";
import { routeTool, typeTool, accessTool } from "../../../../../../identity/tools/index.js";
import RedirectUriEditor from "../RedirectUriEditor.js";
import useEditApp from "../useEditApp.js";

const Page = () => {
	const { id } = useParams();
	const router = useRouter();
	const t = useTranslations();

	const createdApp = useSelector((state: RootState) => state.app.createdApp);

	const { data: appData, isLoading: isAppLoading } = useGetApiV1AppsByIdQuery({ id: Number(id) });
	const app = appData?.app;

	const { data: scopesData } = useGetApiV1ScopesQuery();
	const scopes = scopesData?.scopes ?? [];
	const availableScopes = scopes.filter((scope) => scope.type === app?.type);

	const [updateApp, { isLoading: isUpdating }] = usePutApiV1AppsByIdMutation();
	const [deleteApp, { isLoading: isDeleting }] = useDeleteApiV1AppsByIdMutation();

	const { userInfo } = useAuth();
	const canWriteApp = accessTool.isAllowedAccess(accessTool.Access.WriteApp, userInfo?.roles);

	const { values, errors, onChange } = useEditApp(app);

	const updateObj = useMemo(() => {
		if (!app) return {};
		type Key =
			| "name"
			| "scopes"
			| "redirectUris"
			| "isActive"
			| "useSystemMfaConfig"
			| "requireEmailMfa"
			| "requireOtpMfa"
			| "allowEmailMfaAsBackup";
		const updateKeys = [
			"name",
			"scopes",
			"redirectUris",
			"isActive",
			"useSystemMfaConfig",
			"requireEmailMfa",
			"requireOtpMfa",
			"allowEmailMfaAsBackup",
		].filter((key) => values[key as Key] !== app[key as Key]);
		return updateKeys.reduce(
			(obj, key) => ({
				...obj,
				[key]: values[key as Key],
			}),
			{},
		);
	}, [app, values]);

	const handleDelete = async () => {
		await deleteApp({ id: Number(id) });

		router.push(routeTool.Internal.Apps);
	};

	const handleSave = async () => {
		if (Object.values(errors).some((val) => !!val)) {
			return;
		}

		await updateApp({
			id: Number(id),
			putAppReq: updateObj,
		});
	};

	const handleToggleAppScope = (scope: string) => {
		const newScopes = values.scopes.includes(scope)
			? values.scopes.filter((currentScope) => currentScope !== scope)
			: [...values.scopes, scope];
		onChange("scopes", newScopes);
	};

	if (isAppLoading) return <LoadingPage />;

	if (!app) return null;

	return (
		<section>
			<Breadcrumb
				page={{ label: app.name }}
				parent={{
					href: routeTool.Internal.Apps,
					label: t("apps.title"),
				}}
			/>
			<section>
				<PropertyList>
					<PropertyRow>
						<PropertyLabel>
							<RequiredProperty title={t("apps.name")} />
						</PropertyLabel>
						<PropertyValue>
							<Input
								disabled={!canWriteApp}
								data-testid="nameInput"
								onChange={(e) => onChange("name", e.target.value)}
								value={values.name}
							/>
							<FieldError error={errors.name} />
						</PropertyValue>
					</PropertyRow>
					<PropertyRow>
						<PropertyLabel>{t("apps.clientId")}</PropertyLabel>
						<PropertyValue>{app.clientId}</PropertyValue>
					</PropertyRow>
					{app.type === typeTool.ClientType.S2S && (
						<PropertyRow>
							<PropertyLabel>{t("apps.clientSecret")}</PropertyLabel>
							<PropertyValue className="break-all">
								<div className="flex items-center gap-4">
									{createdApp?.id === Number(id) ? createdApp.secret : "*****"}
								</div>
								{createdApp?.id === Number(id) && (
									<Alert variant="warning" className="mt-2">
										{t("apps.secretNote")}
									</Alert>
								)}
							</PropertyValue>
						</PropertyRow>
					)}
					<PropertyRow inline>
						<PropertyLabel>{t("apps.status")}</PropertyLabel>
						<PropertyValue>
							<Switch
								data-testid="statusInput"
								checked={values.isActive}
								disabled={!canWriteApp}
								onClick={() => onChange("isActive", !values.isActive)}
							/>
						</PropertyValue>
					</PropertyRow>
					<PropertyRow>
						<PropertyLabel>{t("apps.type")}</PropertyLabel>
						<PropertyValue>
							<ClientTypeLabel type={app.type} />
						</PropertyValue>
					</PropertyRow>
					<PropertyRow>
						<PropertyLabel>
							<RequiredProperty title={t("apps.scopes")} />
						</PropertyLabel>
						<PropertyValue>
							<ScopesEditor
								disabled={!canWriteApp}
								scopes={availableScopes}
								value={values.scopes}
								onToggleScope={handleToggleAppScope}
							/>
							<FieldError error={errors.scopes} />
						</PropertyValue>
					</PropertyRow>
					{app.type === typeTool.ClientType.SPA && (
						<PropertyRow>
							<PropertyLabel>{t("apps.redirectUris")}</PropertyLabel>
							<PropertyValue>
								<RedirectUriEditor
									disabled={!canWriteApp}
									redirectUris={values.redirectUris}
									onChange={(uris) => onChange("redirectUris", uris)}
								/>
							</PropertyValue>
						</PropertyRow>
					)}
					<PropertyRow>
						<PropertyLabel>{t("apps.appLevelMfa")}</PropertyLabel>
						<PropertyValue className="flex flex-col gap-4">
							<SwitchRow
								id="mfa-useSystem"
								data-testid="mfa-useSystem"
								label={t("apps.useSystemMfaConfig")}
								checked={values.useSystemMfaConfig}
								disabled={!canWriteApp}
								onClick={() => onChange("useSystemMfaConfig", !values.useSystemMfaConfig)}
							/>
							{!values.useSystemMfaConfig && (
								<>
									<p className="text-sm">{t("apps.appLevelMfaDescription")}</p>
									<SwitchRow
										id="mfa-requireEmail"
										data-testid="mfa-requireEmail"
										label={t("apps.requireEmailMfa")}
										checked={values.requireEmailMfa}
										disabled={!canWriteApp}
										onClick={() => onChange("requireEmailMfa", !values.requireEmailMfa)}
									/>
									<SwitchRow
										id="mfa-requireOtp"
										data-testid="mfa-requireOtp"
										label={t("apps.requireOtpMfa")}
										checked={values.requireOtpMfa}
										disabled={!canWriteApp}
										onClick={() => onChange("requireOtpMfa", !values.requireOtpMfa)}
									/>
									<SwitchRow
										id="mfa-allowEmailMfaAsBackup"
										data-testid="mfa-allowEmailMfaAsBackup"
										label={t("apps.allowEmailMfaAsBackup")}
										checked={values.allowEmailMfaAsBackup}
										disabled={!canWriteApp}
										onClick={() => {
											onChange("allowEmailMfaAsBackup", !values.allowEmailMfaAsBackup);
										}}
									/>
								</>
							)}
						</PropertyValue>
					</PropertyRow>
					<PropertyRow>
						<PropertyLabel>{t("common.createdAt")}</PropertyLabel>
						<PropertyValue>{t("common.utcTime", { time: app.createdAt })}</PropertyValue>
					</PropertyRow>
					<PropertyRow>
						<PropertyLabel>{t("common.updatedAt")}</PropertyLabel>
						<PropertyValue>{t("common.utcTime", { time: app.updatedAt })}</PropertyValue>
					</PropertyRow>
				</PropertyList>
			</section>
			<SubmitError />
			{canWriteApp && (
				<section className="mt-8 flex items-center justify-end gap-4">
					<SaveButton
						isLoading={isUpdating}
						disabled={!Object.keys(updateObj).length || isDeleting}
						onClick={handleSave}
					/>
					<DeleteButton
						isLoading={isDeleting}
						disabled={isUpdating}
						confirmDeleteTitle={t("common.deleteConfirm", { item: app.name })}
						onConfirmDelete={handleDelete}
					/>
				</section>
			)}
		</section>
	);
};

export default Page;
