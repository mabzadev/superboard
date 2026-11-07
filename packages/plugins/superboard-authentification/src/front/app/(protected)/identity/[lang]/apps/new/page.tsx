"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useDispatch } from "react-redux";

import Breadcrumb from "../../../../../../identity/components/Breadcrumb.js";
import ClientTypeSelector from "../../../../../../identity/components/ClientTypeSelector.js";
import FieldError from "../../../../../../identity/components/FieldError.js";
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
import { Input } from "../../../../../../identity/components/ui/input.js";
import { useRouter } from "../../../../../../identity/i18n/navigation.js";
import {
	useGetApiV1ScopesQuery,
	usePostApiV1AppsMutation,
} from "../../../../../../identity/services/auth/api.js";
import { appSlice } from "../../../../../../identity/stores/app.js";
import { routeTool, typeTool } from "../../../../../../identity/tools/index.js";
import RedirectUriEditor from "../RedirectUriEditor.js";
import useEditApp from "../useEditApp.js";

const Page = () => {
	const t = useTranslations();
	const router = useRouter();

	const dispatch = useDispatch();

	const { values, errors, onChange } = useEditApp(undefined);
	const [showErrors, setShowErrors] = useState(false);

	const { data: scopesData } = useGetApiV1ScopesQuery();
	const scopes = scopesData?.scopes ?? [];
	const availableScopes = scopes.filter((scope) => scope.type === values.type);

	const [createApp, { isLoading: isCreating }] = usePostApiV1AppsMutation();

	const handleUpdateType = (newType: string) => {
		if (newType !== values.type) {
			onChange("type", newType);
			onChange("scopes", []);
		}
	};

	const handleToggleAppScope = (scope: string) => {
		const newScopes = values.scopes.includes(scope)
			? values.scopes.filter((currentScope) => currentScope !== scope)
			: [...values.scopes, scope];
		onChange("scopes", newScopes);
	};

	const handleSubmit = async () => {
		if (Object.values(errors).some((val) => !!val)) {
			setShowErrors(true);
			return;
		}

		const res = await createApp({
			postAppReq: {
				name: values.name,
				scopes: values.scopes,
				type: values.type as "spa" | "s2s",
				redirectUris: values.redirectUris
					.map((uri) => uri.trim().toLowerCase())
					.filter((uri) => !!uri),
			},
		});

		if (res.data?.app?.id) {
			dispatch(appSlice.actions.storeCreatedApp(res.data.app));
			router.push(`${routeTool.Internal.Apps}/${res.data.app.id}`);
		}
	};

	return (
		<section>
			<Breadcrumb
				page={{ label: t("apps.new") }}
				parent={{
					href: routeTool.Internal.Apps,
					label: t("apps.title"),
				}}
			/>
			<PropertyList>
				<PropertyRow>
					<PropertyLabel>
						<RequiredProperty title={t("apps.name")} />
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
					<PropertyLabel>
						<RequiredProperty title={t("apps.type")} />
					</PropertyLabel>
					<PropertyValue>
						<ClientTypeSelector value={values.type} onChange={handleUpdateType} />
						{showErrors && <FieldError error={errors.type} />}
					</PropertyValue>
				</PropertyRow>
				{!!availableScopes.length && (
					<PropertyRow>
						<PropertyLabel>
							<RequiredProperty title={t("apps.scopes")} />
						</PropertyLabel>
						<PropertyValue>
							<ScopesEditor
								scopes={availableScopes}
								value={values.scopes}
								onToggleScope={handleToggleAppScope}
							/>
							{showErrors && <FieldError error={errors.scopes} />}
						</PropertyValue>
					</PropertyRow>
				)}
				{values.type === typeTool.ClientType.SPA && (
					<PropertyRow>
						<PropertyLabel>{t("apps.redirectUris")}</PropertyLabel>
						<PropertyValue>
							<RedirectUriEditor
								redirectUris={values.redirectUris}
								onChange={(uris) => onChange("redirectUris", uris)}
							/>
						</PropertyValue>
					</PropertyRow>
				)}
			</PropertyList>
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
