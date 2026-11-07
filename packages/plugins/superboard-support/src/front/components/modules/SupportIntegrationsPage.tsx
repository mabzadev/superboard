"use client";

import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { config, usePublicConfig } from "@superboard/front-ui/lib/config.js";
import {
	showErrorNotification,
	showSuccessNotification,
} from "@superboard/front-ui/lib/Notifications.js";
import { isSafePublicHttpsUrl } from "@superboard/front-ui/lib/validation.js";
import { EmptyProject, moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import {
	SettingsActions,
	SettingsRow,
	SettingsSection,
	SettingsTextField,
	SwitchField,
} from "@superboard/front-ui/settings-form";
import { Button } from "@superboard/front-ui/ui/button.js";
import { Blocks, KeyRound, Link2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import {
	createSupportIntegration,
	deleteSupportIntegration,
	listSupportIntegrations,
	saveSupportIntegrationCredentials,
	startSupportIntegrationOAuth,
	updateSupportIntegration,
	type SupportIntegration,
} from "../../api/support/integrationsService.js";
import { useSupportI18n } from "../../i18n.js";
import { SupportModulePage as ModulePage } from "../support/SupportModulePage.js";
import { SettingsSelectField, SettingsValidatedField } from "../support/SupportSettingsFields.js";
import {
	AccessNotice,
	SupportEmpty,
	SupportError,
	SupportLoadMore,
	SupportLoading,
	SupportSearchToolbar,
	SupportStatus,
	useSupportCollection,
} from "../support/SupportUi.js";

type IntegrationProvider = "slack" | "linear" | "notion" | "shopify" | "dyte" | "api" | "webhook";

type CredentialField = {
	key: string;
	label: string;
	minLength?: number;
	maxLength?: number;
};

type IntegrationDefinition = {
	label: string;
	field: string;
	key: string;
	placeholder?: string;
	acceptedAliases?: string[];
	workflowAction?: string;
	additionalSettings?: Array<{
		key: string;
		label: string;
		placeholder?: string;
		placeholderValues?: Record<string, string>;
		required?: boolean;
	}>;
	credentialFields: CredentialField[];
};

const integrations: Record<IntegrationProvider, IntegrationDefinition> = {
	slack: {
		label: "Slack",
		field: "Channel ID",
		key: "channel_id",
		acceptedAliases: ["workspace_id"],
		workflowAction: "post_message",
		additionalSettings: [
			{
				key: "message_template",
				label: "Message template",
				placeholder: "New Support conversation {id}",
				placeholderValues: { id: "{{conversation.display_id}}" },
			},
			{
				key: "thread_reference",
				label: "Thread reference",
				placeholder: "1712345678.123456",
			},
		],
		credentialFields: [
			{ key: "client_id", label: "Client ID" },
			{ key: "client_secret", label: "Client secret" },
			{ key: "signing_secret", label: "Signing secret" },
		],
	},
	linear: {
		label: "Linear",
		field: "Team ID",
		key: "team_id",
		workflowAction: "create_issue",
		additionalSettings: [
			{ key: "title_template", label: "Title template" },
			{ key: "description_template", label: "Description template" },
		],
		credentialFields: [
			{ key: "client_id", label: "Client ID" },
			{ key: "client_secret", label: "Client secret" },
		],
	},
	notion: {
		label: "Notion",
		field: "Page ID",
		key: "page_id",
		acceptedAliases: ["workspace_id"],
		workflowAction: "update_page_title",
		additionalSettings: [{ key: "title_template", label: "Title template" }],
		credentialFields: [
			{ key: "client_id", label: "Client ID" },
			{ key: "client_secret", label: "Client secret" },
		],
	},
	shopify: {
		label: "Shopify",
		field: "Shop domain",
		key: "shop_domain",
		acceptedAliases: ["store_domain"],
		placeholder: "example.myshopify.com",
		workflowAction: "add_tags",
		additionalSettings: [
			{
				key: "resource_id",
				label: "Customer or order resource ID",
				placeholder: "gid://shopify/Customer/123456789",
				required: true,
			},
			{
				key: "tags",
				label: "Tags (comma separated)",
				placeholder: "support, priority",
				required: true,
			},
		],
		credentialFields: [
			{ key: "client_id", label: "Client ID" },
			{ key: "client_secret", label: "Client secret" },
		],
	},
	dyte: {
		label: "Dyte",
		field: "Meeting preset",
		key: "meeting_preset",
		credentialFields: [
			{ key: "organization_id", label: "Organization ID" },
			{ key: "api_key", label: "API key" },
		],
	},
	api: {
		label: "Dashboard app",
		field: "App URL",
		key: "app_url",
		placeholder: "https://app.example.com/support",
		credentialFields: [],
	},
	webhook: {
		label: "Custom webhook",
		field: "Endpoint URL",
		key: "endpoint_url",
		placeholder: "https://hooks.example.com/support",
		credentialFields: [
			{
				key: "signing_secret",
				label: "Signing secret",
				minLength: 32,
				maxLength: 512,
			},
		],
	},
};

const webhookEventOptions = [
	{ value: "conversation.created", label: "Conversation created" },
	{ value: "conversation.updated", label: "Conversation updated" },
	{ value: "message.created", label: "Message created" },
	{ value: "conversation.csat_submitted", label: "CSAT submitted" },
	{ value: "*", label: "All current and future events" },
] as const;

const defaultWebhookEvents = webhookEventOptions
	.filter((event) => event.value !== "*")
	.map((event) => event.value);
const webhookEventValues = new Set<string>(webhookEventOptions.map((event) => event.value));

const oauthProviders = new Set<IntegrationProvider>(["slack", "linear", "notion", "shopify"]);

function isIntegrationProvider(value: string): value is IntegrationProvider {
	return value in integrations;
}

function credentialValuesAreValid(fields: CredentialField[], values: Record<string, string>) {
	return fields.every((field) => {
		const value = values[field.key] || "";
		return (
			value.trim().length > 0 &&
			value.length >= (field.minLength ?? 1) &&
			value.length <= (field.maxLength ?? 4_096)
		);
	});
}

function integrationTarget(integration: SupportIntegration, definition: IntegrationDefinition) {
	const settings = integration.settings || {};
	for (const key of [definition.key, ...(definition.acceptedAliases || [])]) {
		if (typeof settings[key] === "string") return settings[key] as string;
	}
	return "";
}

function integrationAdditionalSettings(
	integration: SupportIntegration,
	definition: IntegrationDefinition,
) {
	const settings = integration.settings || {};
	return Object.fromEntries(
		(definition.additionalSettings || []).map((field) => {
			const value = settings[field.key];
			return [
				field.key,
				Array.isArray(value)
					? value.filter((item) => typeof item === "string").join(", ")
					: typeof value === "string"
						? value
						: "",
			];
		}),
	);
}

function integrationSettings(
	provider: IntegrationProvider,
	definition: IntegrationDefinition,
	target: string,
	additional: Record<string, string>,
	events: string[],
) {
	const settings: Record<string, unknown> = {
		[definition.key]: target.trim(),
		...(provider === "webhook" ? { events: [...events] } : {}),
	};
	if (definition.workflowAction) {
		settings.workflow_action = definition.workflowAction;
		settings.allowed_actions = [definition.workflowAction];
	}
	for (const field of definition.additionalSettings || []) {
		const value = (additional[field.key] || "").trim();
		if (!value) continue;
		settings[field.key] =
			field.key === "tags"
				? value
						.split(",")
						.map((tag) => tag.trim())
						.filter(Boolean)
						.slice(0, 20)
				: value;
	}
	return settings;
}

function settingsAreValid(
	provider: IntegrationProvider,
	definition: IntegrationDefinition,
	target: string,
	additional: Record<string, string>,
) {
	const value = target.trim();
	if (!value) return false;
	if (provider === "webhook" && !isSafePublicHttpsUrl(value)) return false;
	if (provider === "slack" && !/^[CDG][A-Z0-9]{2,31}$/u.test(value)) return false;
	if (
		["linear", "notion"].includes(provider) &&
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
	) {
		return false;
	}
	if (provider === "shopify" && !/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/u.test(value))
		return false;
	for (const field of definition.additionalSettings || []) {
		const setting = (additional[field.key] || "").trim();
		if (field.required && !setting) return false;
		if (
			field.key === "resource_id" &&
			setting &&
			!/^gid:\/\/shopify\/(?:Order|DraftOrder|Customer|Product|Article|DiscountNode)\/[A-Za-z0-9_-]{1,128}$/u.test(
				setting,
			)
		)
			return false;
		if (field.key === "tags" && setting && !setting.split(",").some((tag) => tag.trim()))
			return false;
		if (field.key === "thread_reference" && setting && !/^\d{1,20}\.\d{1,20}$/u.test(setting))
			return false;
	}
	return true;
}

function integrationEvents(integration: SupportIntegration) {
	const events = integration.settings?.events;
	if (!Array.isArray(events)) return [...defaultWebhookEvents];
	const supported = events.filter(
		(event): event is string => typeof event === "string" && webhookEventValues.has(event),
	);
	return supported.length > 0 ? supported : [...defaultWebhookEvents];
}

function toggleWebhookEvent(current: string[], value: string, checked: boolean) {
	if (value === "*") return checked ? ["*"] : [];
	const withoutWildcard = current.filter((event) => event !== "*");
	if (!checked) return withoutWildcard.filter((event) => event !== value);
	return withoutWildcard.includes(value) ? withoutWildcard : [...withoutWildcard, value];
}

async function beginAuthorization(
	projectRef: string,
	integrationId: string,
	provider: IntegrationProvider,
	apiUrl?: string,
) {
	if (!apiUrl) throw new Error("Public Support API endpoint is not configured");
	const callback = new URL(
		`${config.apiPath}/support/providers/${encodeURIComponent(provider)}/oauth/callback`,
		apiUrl,
	);
	const returnUrl = new URL("/support/integrations", window.location.origin);
	returnUrl.searchParams.set("integration", integrationId);
	const result = await startSupportIntegrationOAuth(projectRef, integrationId, {
		callback_uri: callback.toString(),
		return_uri: returnUrl.toString(),
	});
	return result.data.authorization_url;
}

function WebhookEvents({
	idPrefix,
	selected,
	onChange,
	disabled = false,
}: {
	idPrefix: string;
	selected: string[];
	onChange: (events: string[]) => void;
	disabled?: boolean;
}) {
	const { t } = useSupportI18n();

	return (
		<fieldset className="space-y-3">
			<legend className="text-sm font-medium">{t("Events")}</legend>
			{webhookEventOptions.map((event) => {
				const id = `${idPrefix}-${event.value.replaceAll(".", "-").replace("*", "all")}`;
				const everything = event.value !== "*" && selected.includes("*");
				return (
					<SwitchField
						key={event.value}
						id={id}
						label={t(event.label)}
						checked={everything || selected.includes(event.value)}
						disabled={disabled || everything}
						onCheckedChange={(checked) => {
							onChange(toggleWebhookEvent(selected, event.value, checked));
						}}
					/>
				);
			})}
			<p className="text-xs text-kumo-subtle">
				{t(
					"“All current and future events” also subscribes this endpoint to event types added later.",
				)}
			</p>
		</fieldset>
	);
}

export default function SupportIntegrationsPage() {
	const { t, locale } = useSupportI18n();

	const publicConfig = usePublicConfig();
	const { selectedProject, selectedInstance } = useProjectSelection();
	const projectRef = selectedProject?.id;
	const canManageCredentials = new Set(["owner", "admin"]).has(selectedInstance?.role || "member");
	const resources = useSupportCollection(projectRef, listSupportIntegrations);
	const [provider, setProvider] = useState<IntegrationProvider>("slack");
	const [name, setName] = useState("");
	const [target, setTarget] = useState("");
	const [webhookEvents, setWebhookEvents] = useState<string[]>([...defaultWebhookEvents]);
	const [additionalSettings, setAdditionalSettings] = useState<Record<string, string>>({});
	const [credentials, setCredentials] = useState<Record<string, string>>({});
	const [saving, setSaving] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);
	const [selectedIntegration, setSelectedIntegration] = useState<SupportIntegration | null>(null);
	const [configurationTarget, setConfigurationTarget] = useState("");
	const [configurationEvents, setConfigurationEvents] = useState<string[]>([]);
	const [configurationAdditionalSettings, setConfigurationAdditionalSettings] = useState<
		Record<string, string>
	>({});
	const [configurationCredentials, setConfigurationCredentials] = useState<Record<string, string>>(
		{},
	);
	const [configuring, setConfiguring] = useState(false);
	const [configurationError, setConfigurationError] = useState<string | null>(null);
	const definition = integrations[provider];
	const targetIsValid = settingsAreValid(provider, definition, target, additionalSettings);
	const eventsAreValid = provider !== "webhook" || webhookEvents.length > 0;
	const credentialsAreValid = credentialValuesAreValid(definition.credentialFields, credentials);
	const needsCredentialAccess = definition.credentialFields.length > 0;
	const canCreate =
		Boolean(name.trim()) &&
		targetIsValid &&
		eventsAreValid &&
		credentialsAreValid &&
		(!needsCredentialAccess || canManageCredentials);

	useEffect(() => {
		const current = new URL(window.location.href);
		const result = current.searchParams.get("support_result");
		if (!result) return;
		if (result === "success") {
			showSuccessNotification(t("Support integration authorized"));
		} else {
			showErrorNotification(t("Support integration authorization was not completed"));
		}
		current.searchParams.delete("support_result");
		current.searchParams.delete("support_code");
		current.searchParams.delete("integration");
		window.history.replaceState({}, "", `${current.pathname}${current.search}${current.hash}`);
	}, [t]);

	const clearCreateForm = () => {
		setName("");
		setTarget("");
		setWebhookEvents([...defaultWebhookEvents]);
		setAdditionalSettings({});
		setCredentials({});
	};

	const closeConfiguration = () => {
		setSelectedIntegration(null);
		setConfigurationTarget("");
		setConfigurationEvents([]);
		setConfigurationAdditionalSettings({});
		setConfigurationCredentials({});
		setConfigurationError(null);
	};

	const openConfiguration = (integration: SupportIntegration) => {
		if (!isIntegrationProvider(integration.provider)) return;
		const integrationDefinition = integrations[integration.provider];
		setSelectedIntegration(integration);
		setConfigurationTarget(integrationTarget(integration, integrationDefinition));
		setConfigurationEvents(
			integration.provider === "webhook" ? integrationEvents(integration) : [],
		);
		setConfigurationAdditionalSettings(
			integrationAdditionalSettings(integration, integrationDefinition),
		);
		setConfigurationCredentials({});
		setConfigurationError(null);
	};

	const create = async () => {
		if (!projectRef || !canCreate) return;
		const submittedTarget = target.trim();
		const submittedEvents = [...webhookEvents];
		const submittedCredentials = { ...credentials };
		const submittedAdditionalSettings = { ...additionalSettings };
		const settings = integrationSettings(
			provider,
			definition,
			submittedTarget,
			submittedAdditionalSettings,
			submittedEvents,
		);
		setSaving(true);
		setFormError(null);
		try {
			const result = await createSupportIntegration(projectRef, {
				provider,
				display_name: name.trim(),
				status: "configuration_required",
				settings,
			});
			if (definition.credentialFields.length > 0) {
				try {
					await saveSupportIntegrationCredentials(projectRef, result.data.id, submittedCredentials);
				} catch (cause) {
					const detail = moduleErrorMessage(cause, locale);
					setSelectedIntegration({
						...result.data,
						status: "configuration_required",
						settings,
					});
					setConfigurationTarget(submittedTarget);
					setConfigurationEvents(provider === "webhook" ? submittedEvents : []);
					setConfigurationAdditionalSettings(submittedAdditionalSettings);
					setConfigurationCredentials({});
					setConfigurationError(
						`The integration was created, but its credentials were not saved. ${detail}`,
					);
					await resources.reload();
					showErrorNotification(detail);
					return;
				}
			}
			if (oauthProviders.has(provider)) {
				try {
					const authorization = await beginAuthorization(
						projectRef,
						result.data.id,
						provider,
						publicConfig.apiUrl,
					);
					clearCreateForm();
					showSuccessNotification(t("Continue to authorize the Support integration"));
					window.location.assign(authorization);
					return;
				} catch (cause) {
					const detail = moduleErrorMessage(cause, locale);
					setFormError(
						t("The integration client was saved, but authorization could not start. {detail}", {
							detail,
						}),
					);
					await resources.reload();
					showErrorNotification(detail);
					return;
				}
			}
			clearCreateForm();
			await resources.reload();
			showSuccessNotification(t("Support integration configured"));
		} catch (cause) {
			const detail = moduleErrorMessage(cause, locale);
			setFormError(detail);
			showErrorNotification(detail);
		} finally {
			setCredentials({});
			setSaving(false);
		}
	};

	const saveConfiguration = async () => {
		if (!projectRef || !selectedIntegration || !isIntegrationProvider(selectedIntegration.provider))
			return;
		const selectedDefinition = integrations[selectedIntegration.provider];
		const validTarget = settingsAreValid(
			selectedIntegration.provider,
			selectedDefinition,
			configurationTarget,
			configurationAdditionalSettings,
		);
		const validEvents =
			selectedIntegration.provider !== "webhook" || configurationEvents.length > 0;
		if (
			!validTarget ||
			!validEvents ||
			!credentialValuesAreValid(selectedDefinition.credentialFields, configurationCredentials)
		)
			return;
		const settings = integrationSettings(
			selectedIntegration.provider,
			selectedDefinition,
			configurationTarget,
			configurationAdditionalSettings,
			configurationEvents,
		);
		const submittedCredentials = { ...configurationCredentials };
		setConfiguring(true);
		setConfigurationError(null);
		try {
			await updateSupportIntegration(projectRef, selectedIntegration.id, {
				settings,
			});
			if (selectedDefinition.credentialFields.length > 0)
				await saveSupportIntegrationCredentials(
					projectRef,
					selectedIntegration.id,
					submittedCredentials,
				);
			if (oauthProviders.has(selectedIntegration.provider)) {
				const authorization = await beginAuthorization(
					projectRef,
					selectedIntegration.id,
					selectedIntegration.provider,
					publicConfig.apiUrl,
				);
				closeConfiguration();
				showSuccessNotification(t("Continue to authorize the Support integration"));
				window.location.assign(authorization);
				return;
			}
			closeConfiguration();
			await resources.reload();
			showSuccessNotification(
				selectedDefinition.credentialFields.length > 0
					? t("Integration credentials saved securely")
					: t("Support integration configured"),
			);
		} catch (cause) {
			const detail = moduleErrorMessage(cause, locale);
			setConfigurationError(detail);
			showErrorNotification(detail);
		} finally {
			setConfigurationCredentials({});
			setConfiguring(false);
		}
	};

	const remove = async (integration: SupportIntegration) => {
		if (!projectRef || !window.confirm(t("Delete {name}?", { name: integration.display_name })))
			return;
		try {
			await deleteSupportIntegration(projectRef, integration.id);
			if (selectedIntegration?.id === integration.id) closeConfiguration();
			await resources.reload();
			showSuccessNotification(t("Support integration deleted"));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		}
	};

	const authorizeExisting = async (integration: SupportIntegration) => {
		if (
			!projectRef ||
			!canManageCredentials ||
			!isIntegrationProvider(integration.provider) ||
			!oauthProviders.has(integration.provider)
		)
			return;
		setSaving(true);
		try {
			const authorization = await beginAuthorization(
				projectRef,
				integration.id,
				integration.provider,
				publicConfig.apiUrl,
			);
			showSuccessNotification(t("Continue to authorize the Support integration"));
			window.location.assign(authorization);
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
			setSaving(false);
		}
	};

	const selectedProvider =
		selectedIntegration && isIntegrationProvider(selectedIntegration.provider)
			? selectedIntegration.provider
			: null;
	const selectedDefinition = selectedProvider ? integrations[selectedProvider] : null;
	const configurationTargetIsValid =
		selectedProvider && selectedDefinition
			? settingsAreValid(
					selectedProvider,
					selectedDefinition,
					configurationTarget,
					configurationAdditionalSettings,
				)
			: false;
	const configurationEventsAreValid =
		selectedProvider !== "webhook" || configurationEvents.length > 0;
	const configurationCredentialsAreValid = selectedDefinition
		? credentialValuesAreValid(selectedDefinition.credentialFields, configurationCredentials)
		: false;

	return (
		<ModulePage
			title={t("Integrations")}
			description={t("Connect Support workflows to your team tools and customer context.")}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<div className="space-y-6">
					<SupportSearchToolbar
						query={resources.query}
						setQuery={resources.setQuery}
						onSearch={resources.search}
						onRefresh={resources.reload}
						loading={resources.loading}
					/>
					<SupportError message={resources.error} />
					<SettingsSection
						title={
							<span className="flex items-center gap-2">
								<Blocks className="size-4" /> {t("Add an integration")}
							</span>
						}
						description={t("Connect a team tool, commerce context, meeting service or webhook.")}
					>
						<SettingsRow>
							<SupportError message={formError} />
							<SettingsSelectField
								id="support-integration-provider"
								label={t("Integration")}
								value={provider}
								onChange={(event) => {
									setProvider(event.target.value as IntegrationProvider);
									setTarget("");
									setWebhookEvents([...defaultWebhookEvents]);
									setAdditionalSettings({});
									setCredentials({});
									setFormError(null);
								}}
							>
								{Object.entries(integrations).map(([value, item]) => (
									<option key={value} value={value}>
										{t(item.label)}
									</option>
								))}
							</SettingsSelectField>
							<SettingsTextField
								id="support-integration-name"
								label={t("Display name")}
								placeholder={t("{name} for Support", { name: t(definition.label) })}
								value={name}
								onChange={(event) => setName(event.target.value)}
							/>
							<SettingsValidatedField
								id="support-integration-target"
								label={t(definition.field)}
								aria-invalid={provider === "webhook" && Boolean(target) && !targetIsValid}
								error={
									provider === "webhook" && target && !targetIsValid
										? t(
												"Use a public HTTPS URL without credentials, fragments, or private-network addresses.",
											)
										: undefined
								}
								placeholder={definition.placeholder && t(definition.placeholder)}
								type={provider === "webhook" || provider === "api" ? "url" : "text"}
								value={target}
								onChange={(event) => setTarget(event.target.value)}
							/>
							{(definition.additionalSettings || []).map((field) => (
								<SettingsTextField
									key={field.key}
									id={`support-integration-${field.key}`}
									label={t(field.label)}
									placeholder={field.placeholder && t(field.placeholder, field.placeholderValues)}
									value={additionalSettings[field.key] || ""}
									onChange={(event) =>
										setAdditionalSettings((current) => ({
											...current,
											[field.key]: event.target.value,
										}))
									}
								/>
							))}
						</SettingsRow>
						{provider === "webhook" ? (
							<SettingsRow>
								<WebhookEvents
									idPrefix="new-support-webhook-event"
									onChange={setWebhookEvents}
									selected={webhookEvents}
								/>
							</SettingsRow>
						) : null}
						{needsCredentialAccess && canManageCredentials ? (
							<SettingsRow>
								<div>
									<p className="flex items-center gap-2 text-sm font-medium">
										<KeyRound className="size-4" /> {t("Secure credentials")}
									</p>
									<p className="mt-1 text-xs text-kumo-subtle">
										{t(
											"Values are sent only to the write-only credential endpoint, encrypted per project, and cleared from this form after every submission attempt.",
										)}
									</p>
								</div>
								{definition.credentialFields.map((field) => (
									<SettingsTextField
										key={field.key}
										id={`new-integration-${field.key}`}
										label={t(field.label)}
										autoComplete="new-password"
										maxLength={field.maxLength}
										minLength={field.minLength}
										spellCheck={false}
										type="password"
										value={credentials[field.key] || ""}
										onChange={(event) =>
											setCredentials((current) => ({
												...current,
												[field.key]: event.target.value,
											}))
										}
									/>
								))}
							</SettingsRow>
						) : needsCredentialAccess ? (
							<SettingsRow>
								<AccessNotice>
									{t(
										"Only project owners and administrators can create or replace integration credentials. Existing secrets are never loaded into this page.",
									)}
								</AccessNotice>
							</SettingsRow>
						) : null}
						<SettingsRow>
							<SettingsActions>
								<Button
									aria-busy={saving}
									disabled={saving || !canCreate}
									onClick={() => void create()}
								>
									<Plus /> {saving ? t("Creating…") : t("Add and configure")}
								</Button>
							</SettingsActions>
						</SettingsRow>
					</SettingsSection>
					{resources.loading ? (
						<SupportLoading />
					) : resources.items.length === 0 ? (
						<SupportEmpty
							title={t("No Support integrations")}
							description={t(
								"Add a team tool, commerce context, meeting service or custom webhook.",
							)}
						/>
					) : (
						<SettingsSection
							title={t("Connected integrations")}
							description={t(
								"Each integration shows whether it is ready to process Support events.",
							)}
						>
							{resources.items.map((item) => {
								const itemProvider = isIntegrationProvider(item.provider) ? item.provider : null;
								const itemDefinition = itemProvider ? integrations[itemProvider] : null;
								const canConfigure = canManageCredentials && Boolean(itemDefinition);
								return (
									<SettingsRow key={item.id}>
										<div className="flex flex-wrap items-start justify-between gap-3">
											<div className="min-w-0">
												<p className="font-medium">{item.display_name}</p>
												<p className="text-sm text-kumo-subtle">
													{t(itemDefinition?.label || item.provider)}
												</p>
												{item.status === "configuration_required" ? (
													<p className="mt-1 text-xs text-kumo-subtle">
														{t(
															"Save all required credentials before this integration can process Support events.",
														)}
													</p>
												) : null}
											</div>
											<SupportStatus value={item.status} />
										</div>
										<SettingsActions className="gap-2">
											{canManageCredentials && itemProvider && oauthProviders.has(itemProvider) ? (
												<Button
													disabled={saving || configuring}
													variant="outline"
													onClick={() => void authorizeExisting(item)}
												>
													<Link2 /> {t("Authorize")}
												</Button>
											) : null}
											{canConfigure ? (
												<Button
													disabled={saving || configuring}
													variant="outline"
													onClick={() => openConfiguration(item)}
												>
													<KeyRound />
													{!itemDefinition?.credentialFields.length ||
													item.status === "configuration_required"
														? t("Configure")
														: t("Replace credentials")}
												</Button>
											) : null}
											<Button
												aria-label={t("Delete {name}", { name: item.display_name })}
												disabled={saving || configuring}
												size="icon"
												variant="ghost"
												onClick={() => void remove(item)}
											>
												<Trash2 />
											</Button>
										</SettingsActions>
									</SettingsRow>
								);
							})}
						</SettingsSection>
					)}
					<SupportLoadMore
						visible={resources.hasMore}
						loading={resources.loadingMore}
						onClick={resources.loadMore}
					/>
					{selectedIntegration && selectedDefinition && selectedProvider ? (
						<SettingsSection
							title={t("Secure configuration for {name}", {
								name: selectedIntegration.display_name,
							})}
							description={t("Saving replaces the target and the complete credential set.")}
						>
							<SettingsRow>
								<SupportError message={configurationError} />
								{selectedDefinition.credentialFields.length > 0 && (
									<p className="text-sm text-kumo-subtle">
										{t(
											"Stored credentials are write-only. They are never returned by the API or loaded into this page; saving replaces the complete credential set.",
										)}
									</p>
								)}
								{selectedDefinition.credentialFields.length > 0 &&
								selectedIntegration.status !== "configuration_required" ? (
									<div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
										<span>{t("Stored credentials")}</span>
										<span aria-label={t("Stored credentials are masked")} className="font-mono">
											••••••••
										</span>
									</div>
								) : null}
								<SettingsValidatedField
									id="configured-integration-target"
									label={t(selectedDefinition.field)}
									aria-invalid={
										selectedProvider === "webhook" &&
										Boolean(configurationTarget) &&
										!configurationTargetIsValid
									}
									error={
										selectedProvider === "webhook" &&
										configurationTarget &&
										!configurationTargetIsValid
											? t(
													"Use a public HTTPS URL without credentials, fragments, or private-network addresses.",
												)
											: undefined
									}
									placeholder={selectedDefinition.placeholder && t(selectedDefinition.placeholder)}
									type={
										selectedProvider === "webhook" || selectedProvider === "api" ? "url" : "text"
									}
									value={configurationTarget}
									onChange={(event) => setConfigurationTarget(event.target.value)}
								/>
								{(selectedDefinition.additionalSettings || []).map((field) => (
									<SettingsTextField
										key={field.key}
										disabled={configuring}
										id={`configured-integration-${field.key}`}
										label={t(field.label)}
										placeholder={field.placeholder && t(field.placeholder, field.placeholderValues)}
										value={configurationAdditionalSettings[field.key] || ""}
										onChange={(event) =>
											setConfigurationAdditionalSettings((current) => ({
												...current,
												[field.key]: event.target.value,
											}))
										}
									/>
								))}
							</SettingsRow>
							{selectedProvider === "webhook" ? (
								<SettingsRow>
									<WebhookEvents
										disabled={configuring}
										idPrefix="configured-support-webhook-event"
										onChange={setConfigurationEvents}
										selected={configurationEvents}
									/>
								</SettingsRow>
							) : null}
							{selectedDefinition.credentialFields.length > 0 ? (
								<SettingsRow>
									{selectedDefinition.credentialFields.map((field) => (
										<SettingsTextField
											key={field.key}
											autoComplete="new-password"
											disabled={configuring}
											id={`configured-integration-${field.key}`}
											label={t("New {field}", { field: t(field.label).toLowerCase() })}
											maxLength={field.maxLength}
											minLength={field.minLength}
											spellCheck={false}
											type="password"
											value={configurationCredentials[field.key] || ""}
											onChange={(event) =>
												setConfigurationCredentials((current) => ({
													...current,
													[field.key]: event.target.value,
												}))
											}
										/>
									))}
								</SettingsRow>
							) : null}
							<SettingsRow>
								<SettingsActions>
									<Button disabled={configuring} variant="outline" onClick={closeConfiguration}>
										{t("Cancel")}
									</Button>
									<Button
										aria-busy={configuring}
										disabled={
											configuring ||
											!configurationTargetIsValid ||
											!configurationEventsAreValid ||
											!configurationCredentialsAreValid
										}
										onClick={() => void saveConfiguration()}
									>
										{configuring ? t("Saving…") : t("Save securely")}
									</Button>
								</SettingsActions>
							</SettingsRow>
						</SettingsSection>
					) : null}
				</div>
			)}
		</ModulePage>
	);
}
