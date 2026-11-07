"use client";

import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { config, usePublicConfig } from "@superboard/front-ui/lib/config.js";
import {
	showErrorNotification,
	showSuccessNotification,
} from "@superboard/front-ui/lib/Notifications.js";
import { EmptyProject, moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import {
	SettingsActions,
	SettingsRow,
	SettingsTextField,
} from "@superboard/front-ui/settings-form";
import { Button } from "@superboard/front-ui/ui/button.js";
import { Cable, KeyRound, Link2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import {
	createSupportProvider,
	deleteSupportProvider,
	listSupportChannels,
	listSupportProviders,
	saveSupportProviderCredentials,
	startSupportProviderOAuth,
	type SupportChannel,
	type SupportProviderEndpoint,
} from "../../api/support/channelsService.js";
import { listSupportInboxes, type SupportInbox } from "../../api/support/workforceService.js";
import { useSupportI18n } from "../../i18n.js";
import { SupportModulePage as ModulePage } from "../support/SupportModulePage.js";
import { SettingsSelectField } from "../support/SupportSettingsFields.js";
import {
	AccessNotice,
	SupportEmpty,
	SupportError,
	SupportLoadMore,
	SupportLoading,
	SupportSearchToolbar,
	SupportSection,
	SupportStatus,
	supportChannelLabels as providerLabels,
	useSupportCollection,
} from "../support/SupportUi.js";

const credentialFields: Record<string, string[]> = {
	widget: ["widget_key", "signing_secret", "allowed_domains"],
	email_google: ["client_id", "client_secret"],
	email_microsoft: ["client_id", "client_secret"],
	smtp: ["host", "port", "username", "password", "from_email"],
	whatsapp_cloud: ["access_token", "verify_token", "app_secret", "phone_number_id"],
	facebook_messenger: ["page_access_token", "verify_token", "app_secret", "page_id"],
	instagram: ["access_token", "verify_token", "app_secret", "instagram_id"],
	twilio_sms: ["account_sid", "auth_token", "from_number"],
	twilio_voice: ["account_sid", "auth_token", "from_number", "status_callback_url"],
	whatsapp_calls: ["access_token", "app_secret", "phone_number_id"],
	telegram: ["bot_token", "webhook_secret"],
	line: ["channel_access_token", "channel_secret"],
	tiktok: ["client_key", "client_secret"],
	twitter: ["client_id", "client_secret"],
};

const credentialLabels: Record<string, string> = {
	widget_key: "Widget key",
	signing_secret: "Signing secret",
	allowed_domains: "Allowed domains",
	client_id: "Client ID",
	client_secret: "Client secret",
	host: "Host",
	port: "Port",
	username: "Username",
	password: "Password",
	from_email: "Sender email",
	access_token: "Access token",
	verify_token: "Verification token",
	app_secret: "App secret",
	phone_number_id: "Phone number ID",
	page_access_token: "Page access token",
	page_id: "Page ID",
	instagram_id: "Instagram ID",
	account_sid: "Account SID",
	auth_token: "Auth token",
	from_number: "Sender number",
	status_callback_url: "Status callback URL",
	bot_token: "Bot token",
	webhook_secret: "Webhook secret",
	channel_access_token: "Channel access token",
	channel_secret: "Channel secret",
	client_key: "Client key",
};

const oauthProviders = new Set([
	"email_google",
	"email_microsoft",
	"facebook_messenger",
	"instagram",
	"tiktok",
	"twitter",
]);

export default function SupportChannelsPage({ inboxId: scopedInboxId }: { inboxId?: string } = {}) {
	const { t, locale } = useSupportI18n();

	const publicConfig = usePublicConfig();
	const { selectedProject, selectedInstance } = useProjectSelection();
	const projectRef = selectedProject?.id;
	const canManageCredentials = new Set(["owner", "admin"]).has(selectedInstance?.role || "member");
	const providers = useSupportCollection(projectRef, listSupportProviders, {
		inboxId: scopedInboxId,
	});
	const inboxes = useSupportCollection<SupportInbox>(projectRef, listSupportInboxes, {
		inboxId: scopedInboxId,
	});
	const [channels, setChannels] = useState<SupportChannel[]>([]);
	const [channelError, setChannelError] = useState<string | null>(null);
	const [provider, setProvider] = useState("widget");
	const [displayName, setDisplayName] = useState("");
	const [inboxId, setInboxId] = useState(scopedInboxId ?? "");
	const [selectedEndpoint, setSelectedEndpoint] = useState<SupportProviderEndpoint | null>(null);
	const [credentials, setCredentials] = useState<Record<string, string>>({});
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		const current = new URL(window.location.href);
		const result = current.searchParams.get("support_result");
		if (!result) return;
		if (result === "success") showSuccessNotification(t("Support channel authorized"));
		else showErrorNotification(t("Support channel authorization was not completed"));
		current.searchParams.delete("support_result");
		current.searchParams.delete("support_code");
		current.searchParams.delete("connection");
		window.history.replaceState(window.history.state, "", current);
	}, [t]);

	const loadChannels = useCallback(async () => {
		if (!projectRef) return;
		try {
			const result = (await listSupportChannels(projectRef)).data;
			setChannels(
				scopedInboxId ? result.filter((channel) => channel.id === scopedInboxId) : result,
			);
			setChannelError(null);
		} catch (cause) {
			setChannelError(moduleErrorMessage(cause, locale));
		}
	}, [projectRef, scopedInboxId, locale]);
	useEffect(() => void loadChannels(), [loadChannels]);

	const fields = useMemo(
		() => (selectedEndpoint ? (credentialFields[selectedEndpoint.provider] ?? []) : []),
		[selectedEndpoint],
	);

	const addProvider = async () => {
		if (!projectRef || !displayName.trim() || !inboxId) return;
		setSaving(true);
		try {
			await createSupportProvider(projectRef, {
				provider,
				display_name: displayName.trim(),
				inbox_id: inboxId,
				status: "configuration_required",
				settings: {},
			});
			setDisplayName("");
			setInboxId(scopedInboxId ?? "");
			await Promise.all([providers.reload(), loadChannels()]);
			showSuccessNotification(t("Support channel created"));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		} finally {
			setSaving(false);
		}
	};

	const removeProvider = async (endpoint: SupportProviderEndpoint) => {
		if (!projectRef || !window.confirm(t("Delete {name}?", { name: endpoint.display_name })))
			return;
		try {
			await deleteSupportProvider(projectRef, endpoint.id);
			if (selectedEndpoint?.id === endpoint.id) setSelectedEndpoint(null);
			await Promise.all([providers.reload(), loadChannels()]);
			showSuccessNotification(t("Support channel deleted"));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		}
	};

	const saveCredentials = async () => {
		if (!projectRef || !selectedEndpoint || fields.some((field) => !credentials[field]?.trim()))
			return;
		setSaving(true);
		try {
			await saveSupportProviderCredentials(projectRef, selectedEndpoint.id, credentials);
			setCredentials({});
			setSelectedEndpoint(null);
			await providers.reload();
			showSuccessNotification(t("Credentials saved securely"));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
		} finally {
			setSaving(false);
		}
	};

	const authorizeProvider = async () => {
		if (!projectRef || !selectedEndpoint || !oauthProviders.has(selectedEndpoint.provider)) return;
		setSaving(true);
		try {
			if (!publicConfig.apiUrl) throw new Error(publicConfig.endpointError(t("Support API")));
			const apiOrigin = publicConfig.apiUrl;
			const callback = `${apiOrigin}${config.apiPath}/support/providers/${encodeURIComponent(selectedEndpoint.provider)}/oauth/callback`;
			const returnUrl = new URL("/support/channels", window.location.origin);
			returnUrl.searchParams.set("connection", selectedEndpoint.id);
			const result = await startSupportProviderOAuth(projectRef, selectedEndpoint.id, {
				callback_uri: callback,
				return_uri: returnUrl.toString(),
			});
			window.location.assign(result.data.authorization_url);
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause, locale));
			setSaving(false);
		}
	};

	const compatibleInboxes = inboxes.items.filter(
		(inbox) => inbox.status === "active" && inbox.channel_type === provider,
	);

	return (
		<ModulePage
			title={t("Channels")}
			description={t("Connect every customer channel to a native Support inbox.")}
			error={channelError}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<div className="space-y-6">
					<SupportSection title={t("Channels")}>
						<p className="text-sm text-kumo-subtle">
							{t(
								"Inboxes that receive customer conversations, with the state of their connection.",
							)}
						</p>
						{channels.length === 0 ? (
							<SupportEmpty
								title={t("No connected inboxes")}
								description={t("Create an inbox from Workforce, then attach a connection here.")}
							/>
						) : (
							<RowGroup>
								{channels.map((channel) => (
									<SettingsRow
										key={channel.id}
										className="flex items-center justify-between gap-4 space-y-0"
									>
										<div className="flex min-w-0 items-center gap-3">
											<Cable className="h-5 w-5 shrink-0 text-kumo-subtle" />
											<div className="min-w-0">
												<p className="font-medium">{channel.name}</p>
												<p className="text-sm text-kumo-subtle">
													{t(
														providerLabels[channel.provider || channel.channel_type] ||
															channel.channel_type,
													)}
												</p>
											</div>
										</div>
										<SupportStatus value={channel.provider_status || channel.status} />
									</SettingsRow>
								))}
							</RowGroup>
						)}
					</SupportSection>
					<SupportSection title={t("Connections")}>
						<p className="text-sm text-kumo-subtle">
							{t("Credentials and authorizations that link a customer channel to an inbox.")}
						</p>
						<SupportSearchToolbar
							query={providers.query}
							setQuery={providers.setQuery}
							onSearch={providers.search}
							onRefresh={providers.reload}
							loading={providers.loading}
						/>
						<SupportError message={providers.error} />
						<RowGroup
							title={t("Add a connection")}
							description={t("Attach a customer channel to an active inbox of the same type.")}
						>
							<SettingsRow>
								<SettingsSelectField
									label={t("Channel")}
									value={provider}
									onChange={(event) => {
										setProvider(event.target.value);
										setInboxId(scopedInboxId ?? "");
									}}
								>
									{Object.entries(providerLabels).map(([value, label]) => (
										<option key={value} value={value}>
											{t(label)}
										</option>
									))}
								</SettingsSelectField>
								<SettingsTextField
									label={t("Display name")}
									placeholder={t("Customer care")}
									value={displayName}
									onChange={(event) => setDisplayName(event.target.value)}
								/>
								<SettingsSelectField
									label={t("Inbox")}
									description={
										!inboxes.loading && compatibleInboxes.length === 0
											? t("Create an active {provider} inbox in Workforce first.", {
													provider: t(providerLabels[provider] || provider),
												})
											: undefined
									}
									value={inboxId}
									disabled={Boolean(scopedInboxId)}
									onChange={(event) => setInboxId(event.target.value)}
								>
									<option value="">{t("Select an inbox")}</option>
									{compatibleInboxes.map((inbox) => (
										<option key={inbox.id} value={inbox.id}>
											{inbox.name}
										</option>
									))}
								</SettingsSelectField>
								<SettingsActions>
									<Button
										disabled={saving || !displayName.trim() || !inboxId}
										onClick={() => void addProvider()}
									>
										<Plus /> {t("Add")}
									</Button>
								</SettingsActions>
							</SettingsRow>
						</RowGroup>
						{providers.loading ? (
							<SupportLoading />
						) : providers.items.length === 0 ? (
							<SupportEmpty
								title={t("No channel connections")}
								description={t("Add the channel your customers use to contact your team.")}
							/>
						) : (
							<RowGroup>
								{providers.items.map((endpoint) => (
									<SettingsRow key={endpoint.id}>
										<div className="flex flex-wrap items-start justify-between gap-3">
											<div className="min-w-0">
												<p className="font-medium">{endpoint.display_name}</p>
												<p className="text-sm text-kumo-subtle">
													{t(providerLabels[endpoint.provider] || endpoint.provider)}
												</p>
											</div>
											<SupportStatus value={endpoint.status} />
										</div>
										<SettingsActions className="gap-2">
											{(credentialFields[endpoint.provider]?.length ?? 0) > 0 &&
											canManageCredentials ? (
												<Button
													variant="outline"
													onClick={() => {
														setSelectedEndpoint(endpoint);
														setCredentials({});
													}}
												>
													<KeyRound /> {t("Configure")}
												</Button>
											) : null}
											<Button
												aria-label={t("Delete {name}", { name: endpoint.display_name })}
												size="icon"
												variant="ghost"
												onClick={() => void removeProvider(endpoint)}
											>
												<Trash2 />
											</Button>
										</SettingsActions>
									</SettingsRow>
								))}
							</RowGroup>
						)}
						<SupportLoadMore
							visible={providers.hasMore}
							loading={providers.loadingMore}
							onClick={providers.loadMore}
						/>
						{!canManageCredentials ? (
							<AccessNotice>
								{t(
									"Only project owners and administrators can replace channel credentials. Existing secrets remain masked.",
								)}
							</AccessNotice>
						) : null}
						{selectedEndpoint ? (
							<RowGroup
								title={t("Secure configuration for {name}", {
									name: selectedEndpoint.display_name,
								})}
								description={t(
									"Values are encrypted per project and cannot be read back after saving.",
								)}
							>
								<SettingsRow>
									{fields.map((field) => (
										<SettingsTextField
											key={field}
											label={t(credentialLabels[field] ?? field.replaceAll("_", " "))}
											autoComplete="new-password"
											type="password"
											value={credentials[field] || ""}
											onChange={(event) =>
												setCredentials((current) => ({
													...current,
													[field]: event.target.value,
												}))
											}
										/>
									))}
									<SettingsActions>
										<Button
											variant="outline"
											onClick={() => {
												setSelectedEndpoint(null);
												setCredentials({});
											}}
										>
											{t("Cancel")}
										</Button>
										{oauthProviders.has(selectedEndpoint.provider) &&
										selectedEndpoint.status !== "configuration_required" ? (
											<Button
												variant="outline"
												disabled={saving}
												onClick={() => void authorizeProvider()}
											>
												<Link2 /> {t("Authorize")}
											</Button>
										) : null}
										<Button
											disabled={saving || fields.some((field) => !credentials[field]?.trim())}
											onClick={() => void saveCredentials()}
										>
											{t("Save securely")}
										</Button>
									</SettingsActions>
								</SettingsRow>
							</RowGroup>
						) : null}
					</SupportSection>
				</div>
			)}
		</ModulePage>
	);
}

function RowGroup({
	title,
	description,
	children,
}: {
	title?: string;
	description?: string;
	children: ReactNode;
}) {
	return (
		<div className="divide-y divide-kumo-line rounded-lg border border-kumo-line">
			{title ? (
				<div className="space-y-1 p-4">
					<h4 className="text-sm font-semibold">{title}</h4>
					{description ? <p className="text-sm text-kumo-subtle">{description}</p> : null}
				</div>
			) : null}
			{children}
		</div>
	);
}
