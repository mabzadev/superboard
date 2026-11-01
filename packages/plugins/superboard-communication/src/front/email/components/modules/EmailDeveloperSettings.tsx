import {
	showErrorNotification,
	showSuccessNotification,
} from "@superboard/front-ui/lib/Notifications.js";
import { moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@superboard/front-ui/ui/card.js";
import { Input } from "@superboard/front-ui/ui/input.js";
import { Switch } from "@superboard/front-ui/ui/switch.js";
import { History, KeyRound, Plus, Send, Trash2, Webhook } from "lucide-react";
import { useEffect, useState } from "react";

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

/** Server API keys and outbound event webhooks of the transactional email API. */
export function EmailDeveloperSettings({ project }: { project: string }) {
	const { t, locale } = useEmailI18n();
	const [keys, setKeys] = useState<EmailApiKey[]>([]);
	const [webhooks, setWebhooks] = useState<EmailEventWebhook[]>([]);
	const [keyName, setKeyName] = useState("");
	const [url, setUrl] = useState("");
	const [events, setEvents] = useState<EmailEventType[]>(EVENT_TYPES);
	const [secret, setSecret] = useState<{
		kind: "key" | "webhook";
		value: string;
	} | null>(null);
	const [history, setHistory] = useState<{
		id: string;
		items: EmailEventWebhookDelivery[];
	} | null>(null);
	const [revision, setRevision] = useState(0);
	useEffect(() => {
		let active = true;
		void Promise.resolve()
			.then(() => Promise.all([getEmailApiKeys(project), getEventWebhooks(project)]))
			.then(
				([keyRows, webhookRows]) => {
					if (!active) return;
					setKeys(keyRows);
					setWebhooks(webhookRows);
				},
				(cause: unknown) => {
					showErrorNotification(moduleErrorMessage(cause));
				},
			);
		return () => {
			active = false;
		};
	}, [project, revision]);
	const run = async <T,>(action: () => Promise<T>, success?: string): Promise<T | null> => {
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
	const date = (value: string) => new Date(value).toLocaleString(locale);
	const label = (value: string) => t(EMAIL_VALUE_LABELS[value] ?? value);
	return (
		<div className="grid gap-6 xl:grid-cols-2">
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<KeyRound />
						{t("API keys")}
					</CardTitle>
					<CardDescription>
						{t(
							"Server keys for the transactional send API (POST /v1/email/send). Keep them on your server: never put them in a browser or mobile app.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3">
					<div className="flex gap-2">
						<Input
							aria-label={t("Key name")}
							placeholder={t("Key name")}
							value={keyName}
							onChange={(event) => {
								setKeyName(event.target.value);
							}}
						/>
						<Button
							disabled={!keyName.trim()}
							onClick={() =>
								void run(() => createEmailApiKey(project, keyName.trim()), "API key created").then(
									(created) => {
										if (created?.secret) setSecret({ kind: "key", value: created.secret });
										setKeyName("");
									},
								)
							}
						>
							<Plus />
							{t("Create key")}
						</Button>
					</div>
					{secret?.kind === "key" && (
						<OneTimeSecret
							value={secret.value}
							onClose={() => {
								setSecret(null);
							}}
							kind="key"
						/>
					)}
					{keys.length === 0 ? (
						<p className="py-4 text-center text-sm text-muted-foreground">{t("No API key yet.")}</p>
					) : (
						keys.map((key) => (
							<div key={key.id} className="flex items-center justify-between rounded-md border p-3">
								<div className="min-w-0">
									<p className="font-medium">{key.name}</p>
									<p className="truncate font-mono text-xs text-muted-foreground">
										{key.prefix}… · {key.scopes.join(", ")} ·{" "}
										{key.last_used_at
											? t("Last used {date}", { date: date(key.last_used_at) })
											: t("Never used")}
									</p>
								</div>
								<Button
									variant="ghost"
									size="icon"
									aria-label={t("Revoke {name}", { name: key.name })}
									onClick={() =>
										void run(() => revokeEmailApiKey(project, key.id), "API key revoked")
									}
								>
									<Trash2 />
								</Button>
							</div>
						))
					)}
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Webhook />
						{t("Event webhooks")}
					</CardTitle>
					<CardDescription>
						{t(
							"Receive signed delivery events (HMAC-SHA256 in X-SuperBoard-Signature) on your HTTPS endpoint.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3">
					<Input
						type="url"
						aria-label={t("Endpoint URL (https://…)")}
						placeholder={t("Endpoint URL (https://…)")}
						value={url}
						onChange={(event) => {
							setUrl(event.target.value);
						}}
					/>
					<EventPicker value={events} onChange={setEvents} />
					<Button
						disabled={!url.trim() || events.length === 0}
						onClick={() =>
							void run(
								() => createEventWebhook(project, { url: url.trim(), events }),
								"Webhook endpoint added",
							).then((created) => {
								if (created?.secret) setSecret({ kind: "webhook", value: created.secret });
								if (created) setUrl("");
							})
						}
					>
						<Plus />
						{t("Add endpoint")}
					</Button>
					{secret?.kind === "webhook" && (
						<OneTimeSecret
							value={secret.value}
							onClose={() => {
								setSecret(null);
							}}
							kind="webhook"
						/>
					)}
					{webhooks.length === 0 ? (
						<p className="py-4 text-center text-sm text-muted-foreground">
							{t("No webhook endpoint yet.")}
						</p>
					) : (
						webhooks.map((webhook) => (
							<div key={webhook.id} className="space-y-2 rounded-md border p-3">
								<div className="flex items-start justify-between gap-2">
									<div className="min-w-0">
										<p className="truncate font-mono text-xs">{webhook.url}</p>
										<p className="text-xs text-muted-foreground">
											{webhook.events.map((type) => label(type)).join(", ")}
											{webhook.last_status ? ` · ${label(webhook.last_status)}` : ""}
										</p>
									</div>
									<div className="flex shrink-0 items-center">
										<Switch
											aria-label={t("Enabled")}
											checked={webhook.enabled}
											onCheckedChange={(enabled) =>
												void run(
													() =>
														updateEventWebhook(project, webhook.id, {
															enabled,
														}),
													"Webhook endpoint updated",
												)
											}
										/>
										<Button
											variant="ghost"
											size="icon"
											aria-label={t("Send test event")}
											title={t("Send test event")}
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
											<Send />
										</Button>
										<Button
											variant="ghost"
											size="icon"
											aria-label={t("Recent deliveries")}
											title={t("Recent deliveries")}
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
											<History />
										</Button>
										<Button
											variant="ghost"
											size="icon"
											aria-label={t("Delete {name}", { name: webhook.url })}
											onClick={() =>
												void run(
													() => deleteEventWebhook(project, webhook.id),
													"Webhook endpoint deleted",
												)
											}
										>
											<Trash2 />
										</Button>
									</div>
								</div>
								{history?.id === webhook.id && (
									<ul className="space-y-1 border-t pt-2 text-xs">
										{history.items.length === 0 ? (
											<li className="text-muted-foreground">{t("No delivery yet.")}</li>
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
													<span className="text-muted-foreground">{date(item.created_at)}</span>
												</li>
											))
										)}
									</ul>
								)}
							</div>
						))
					)}
				</CardContent>
			</Card>
		</div>
	);
}

function EventPicker({
	value,
	onChange,
}: {
	value: EmailEventType[];
	onChange: (value: EmailEventType[]) => void;
}) {
	const { t } = useEmailI18n();
	return (
		<div className="flex flex-wrap gap-3">
			{EVENT_TYPES.map((type) => (
				<label key={type} className="flex items-center gap-1 text-xs">
					<input
						type="checkbox"
						checked={value.includes(type)}
						onChange={(event) => {
							onChange(
								event.target.checked
									? EVENT_TYPES.filter((item) => item === type || value.includes(item))
									: value.filter((item) => item !== type),
							);
						}}
					/>
					{t(EMAIL_VALUE_LABELS[type] ?? type)}
				</label>
			))}
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
			className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs"
		>
			<p className="font-medium">
				{kind === "key"
					? t("Copy this key now. It will not be shown again.")
					: t("Copy this signing secret now. It will not be shown again.")}
			</p>
			<CopyValue value={value} label={kind === "key" ? t("API keys") : t("Event webhooks")} />
			<Button variant="ghost" size="sm" onClick={onClose}>
				{t("Close")}
			</Button>
		</div>
	);
}
