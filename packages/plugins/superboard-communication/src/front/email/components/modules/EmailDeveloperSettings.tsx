import DeleteConfirm from "@superboard/front-ui/common/delete-confirm.js";
import { Button, SwitchField } from "@superboard/front-ui/kumo";
import {
	showErrorNotification,
	showSuccessNotification,
} from "@superboard/front-ui/lib/Notifications.js";
import { moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import {
	SettingsActions,
	SettingsDependents,
	SettingsRow,
	SettingsSection,
	SettingsTextField,
} from "@superboard/front-ui/settings-form";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { History, Plus, Send, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { SettingsSubsection } from "../../../marketing/studio/settings-ui.js";
import {
	createEmailApiKey,
	createEventWebhook,
	deleteEventWebhook,
	getEmailApiKeys,
	getEventWebhookDeliveries,
	getEventWebhooks,
	revokeEmailApiKey,
	testEventWebhook,
	updateEventWebhook,
	type EmailApiKey,
	type EmailEventType,
	type EmailEventWebhook,
	type EmailEventWebhookDelivery,
} from "../../api/email/emailService.js";
import { EMAIL_VALUE_LABELS, useEmailI18n } from "./email-i18n.js";
import { CopyValue } from "./SenderDomainAuthentication.js";

const EVENT_TYPES: EmailEventType[] = [
	"sent",
	"delivered",
	"bounced",
	"complained",
	"opened",
	"clicked",
	"failed",
];
const failedStatuses = new Set(["failed", "bounced", "complained"]);

function useProjectRows<T>(project: string, load: (project: string) => Promise<T[]>) {
	const { t } = useEmailI18n();
	const [rows, setRows] = useState<T[]>([]);
	const [revision, setRevision] = useState(0);
	useEffect(() => {
		let active = true;
		void Promise.resolve()
			.then(() => load(project))
			.then(
				(value) => {
					if (active) setRows(value);
				},
				(cause: unknown) => {
					showErrorNotification(moduleErrorMessage(cause));
				},
			);
		return () => {
			active = false;
		};
	}, [project, load, revision]);
	const run = async <R,>(action: () => Promise<R>, success?: string): Promise<R | null> => {
		try {
			const result = await action();
			if (success) showSuccessNotification(t(success));
			setRevision((value) => value + 1);
			return result;
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
			return null;
		}
	};
	return { rows, run };
}

export function EmailApiKeys({ project }: { project: string }) {
	const { t, locale } = useEmailI18n();
	const { rows: keys, run } = useProjectRows<EmailApiKey>(project, getEmailApiKeys);
	const [keyName, setKeyName] = useState("");
	const [secret, setSecret] = useState<string | null>(null);
	const date = (value: string) => new Date(value).toLocaleString(locale);
	return (
		<div className="space-y-4">
			<SettingsSection
				title={t("API keys")}
				description={t(
					"Server keys for the transactional send API (POST /v1/email/send). Keep them on your server: never put them in a browser or mobile app.",
				)}
			>
				{keys.length === 0 ? (
					<SettingsRow>
						<p className="text-sm text-kumo-subtle">{t("No API key yet.")}</p>
					</SettingsRow>
				) : (
					keys.map((key) => (
						<SettingsRow key={key.id} className="flex items-center justify-between gap-4 space-y-0">
							<div className="min-w-0 space-y-1">
								<p className="text-sm font-medium">{key.name}</p>
								<p className="truncate font-mono text-xs text-kumo-subtle">
									{key.prefix}… · {key.scopes.join(", ")} ·{" "}
									{key.last_used_at
										? t("Last used {date}", { date: date(key.last_used_at) })
										: t("Never used")}
								</p>
							</div>
							<DeleteConfirm
								title={t("Revoke this API key?")}
								description={t("Servers that still use it can no longer send emails.")}
								confirmText={t("Revoke")}
								onConfirm={async () => {
									await run(() => revokeEmailApiKey(project, key.id), "API key revoked");
								}}
							>
								<Button
									variant="ghost"
									shape="square"
									icon={Trash2}
									aria-label={t("Revoke {name}", { name: key.name })}
								/>
							</DeleteConfirm>
						</SettingsRow>
					))
				)}
				<SettingsRow>
					<SettingsTextField
						label={t("Key name")}
						value={keyName}
						onChange={(event) => {
							setKeyName(event.target.value);
						}}
					/>
					<SettingsActions>
						<Button
							disabled={!keyName.trim()}
							onClick={() =>
								void run(() => createEmailApiKey(project, keyName.trim()), "API key created").then(
									(created) => {
										if (created?.secret) setSecret(created.secret);
										setKeyName("");
									},
								)
							}
						>
							{t("Create key")}
						</Button>
					</SettingsActions>
				</SettingsRow>
			</SettingsSection>
			{secret && (
				<OneTimeSecret
					value={secret}
					onClose={() => {
						setSecret(null);
					}}
					kind="key"
				/>
			)}
		</div>
	);
}

export function EmailEventWebhooks({ project }: { project: string }) {
	const { t, locale } = useEmailI18n();
	const { rows: webhooks, run } = useProjectRows<EmailEventWebhook>(project, getEventWebhooks);
	const [adding, setAdding] = useState(false);
	const [url, setUrl] = useState("");
	const [events, setEvents] = useState<EmailEventType[]>(EVENT_TYPES);
	const [secret, setSecret] = useState<string | null>(null);
	const [history, setHistory] = useState<{
		id: string;
		items: EmailEventWebhookDelivery[];
	} | null>(null);
	const date = (value: string) => new Date(value).toLocaleString(locale);
	const label = (value: string) => t(EMAIL_VALUE_LABELS[value] ?? value);
	const closeEndpoint = () => {
		setAdding(false);
		setUrl("");
		setEvents(EVENT_TYPES);
	};
	return (
		<div className="space-y-4">
			<SettingsSubsection
				title={t("Send events to your endpoints")}
				description={t(
					"Signed delivery events (HMAC-SHA256 in X-SuperBoard-Signature) are posted to your HTTPS endpoints.",
				)}
			>
				{webhooks.length === 0 ? (
					<SettingsRow>
						<p className="text-sm text-kumo-subtle">{t("No webhook endpoint yet.")}</p>
					</SettingsRow>
				) : (
					webhooks.map((webhook) => (
						<SettingsRow key={webhook.id}>
							<SwitchField
								label={<span className="break-all font-mono text-xs">{webhook.url}</span>}
								description={webhook.events.map((type) => label(type)).join(", ")}
								trailing={
									webhook.last_status ? (
										<Badge
											variant={failedStatuses.has(webhook.last_status) ? "warning" : "success"}
										>
											{label(webhook.last_status)}
										</Badge>
									) : undefined
								}
								checked={webhook.enabled}
								onCheckedChange={(enabled) =>
									void run(
										() => updateEventWebhook(project, webhook.id, { enabled }),
										"Webhook endpoint updated",
									)
								}
							/>
							<SettingsActions className="gap-1">
								<Button
									variant="ghost"
									size="sm"
									icon={Send}
									onClick={() =>
										void run(() => testEventWebhook(project, webhook.id)).then((result) => {
											if (!result) return;
											if (result.status === "delivered")
												showSuccessNotification(
													t("Test event delivered (HTTP {status})", {
														status: result.responseStatus ?? 200,
													}),
												);
											else
												showErrorNotification(
													t("Test event failed: {error}", {
														error: result.error ?? result.status,
													}),
												);
										})
									}
								>
									{t("Send test event")}
								</Button>
								<Button
									variant="ghost"
									size="sm"
									icon={History}
									aria-expanded={history?.id === webhook.id}
									onClick={() => {
										if (history?.id === webhook.id) setHistory(null);
										else
											run(() => getEventWebhookDeliveries(project, webhook.id))
												.then((items) => {
													if (items) setHistory({ id: webhook.id, items });
												})
												.catch(() => undefined);
									}}
								>
									{t("Recent deliveries")}
								</Button>
								<DeleteConfirm
									title={t("Delete this webhook endpoint?")}
									description={t("This endpoint stops receiving delivery events.")}
									onConfirm={async () => {
										await run(
											() => deleteEventWebhook(project, webhook.id),
											"Webhook endpoint deleted",
										);
									}}
								>
									<Button
										variant="ghost"
										size="sm"
										icon={Trash2}
										aria-label={t("Delete {name}", { name: webhook.url })}
									>
										{t("Delete")}
									</Button>
								</DeleteConfirm>
							</SettingsActions>
							{history?.id === webhook.id && (
								<ul className="space-y-1 border-t border-kumo-line pt-2 text-xs">
									{history.items.length === 0 ? (
										<li className="text-kumo-subtle">{t("No delivery yet.")}</li>
									) : (
										history.items.map((item) => (
											<li key={item.id} className="flex justify-between gap-2">
												<span>
													{label(item.event_type)} · {label(item.status)} ·{" "}
													{t("{count} attempts", {
														count: item.attempt_count,
													})}
													{item.response_status ? ` · HTTP ${item.response_status}` : ""}
													{item.last_error && item.status !== "delivered"
														? ` · ${item.last_error}`
														: ""}
												</span>
												<span className="text-kumo-subtle">{date(item.created_at)}</span>
											</li>
										))
									)}
								</ul>
							)}
						</SettingsRow>
					))
				)}
			</SettingsSubsection>
			{secret && (
				<OneTimeSecret
					value={secret}
					onClose={() => {
						setSecret(null);
					}}
					kind="webhook"
				/>
			)}
			{adding ? (
				<>
					<SettingsSubsection
						title={t("New webhook endpoint")}
						description={t("Choose the HTTPS address and the events it receives.")}
					>
						<SettingsRow>
							<SettingsTextField
								type="url"
								label={t("Endpoint URL (https://…)")}
								value={url}
								onChange={(event) => {
									setUrl(event.target.value);
								}}
							/>
						</SettingsRow>
						<SettingsRow>
							<p className="text-sm font-medium">{t("Events to send")}</p>
							<SettingsDependents>
								{EVENT_TYPES.map((type) => (
									<SwitchField
										key={type}
										label={label(type)}
										checked={events.includes(type)}
										onCheckedChange={(checked) => {
											setEvents((current) =>
												checked
													? EVENT_TYPES.filter((item) => item === type || current.includes(item))
													: current.filter((item) => item !== type),
											);
										}}
									/>
								))}
							</SettingsDependents>
						</SettingsRow>
					</SettingsSubsection>
					<SettingsActions>
						<Button variant="ghost" onClick={closeEndpoint}>
							{t("Cancel")}
						</Button>
						<Button
							variant="primary"
							disabled={!url.trim() || events.length === 0}
							onClick={() =>
								void run(
									() => createEventWebhook(project, { url: url.trim(), events }),
									"Webhook endpoint added",
								).then((created) => {
									if (created?.secret) setSecret(created.secret);
									if (created) closeEndpoint();
								})
							}
						>
							{t("Add endpoint")}
						</Button>
					</SettingsActions>
				</>
			) : (
				<SettingsActions>
					<Button
						icon={Plus}
						onClick={() => {
							setAdding(true);
						}}
					>
						{t("Add an endpoint")}
					</Button>
				</SettingsActions>
			)}
		</div>
	);
}

function OneTimeSecret({
	value,
	kind,
	onClose,
}: {
	value: string;
	kind: "key" | "webhook";
	onClose: () => void;
}) {
	const { t } = useEmailI18n();
	return (
		<div
			role="status"
			className="space-y-3 rounded-lg border border-kumo-warning bg-kumo-warning-tint p-4 text-sm"
		>
			<p className="font-medium">
				{kind === "key"
					? t("Copy this key now. It will not be shown again.")
					: t("Copy this signing secret now. It will not be shown again.")}
			</p>
			<CopyValue value={value} label={kind === "key" ? t("API key") : t("Signing secret")} />
			<SettingsActions>
				<Button variant="ghost" size="sm" onClick={onClose}>
					{t("Close")}
				</Button>
			</SettingsActions>
		</div>
	);
}
