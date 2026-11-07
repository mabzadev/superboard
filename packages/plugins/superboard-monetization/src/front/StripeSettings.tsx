import { Button } from "@superboard/front-ui/kumo";
import {
	SettingsActions,
	SettingsRow,
	SettingsSection,
	SettingsTextField,
	useSettingsAutosave,
} from "@superboard/front-ui/settings-form";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { useEffect, useState } from "react";

import {
	getStripeConnection,
	saveStripeConnection,
	testStripeConnection,
	type StripeConnection,
} from "./billing/api/billing/billingService.js";
import { useMonetizationI18n } from "./i18n.js";

const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isApplicationOrigin(value: string) {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	return (
		!url.username &&
		!url.password &&
		(url.protocol === "https:" || (url.protocol === "http:" && localHosts.has(url.hostname)))
	);
}

export function useStripeConnection(projectId: string) {
	const [connection, setConnection] = useState<StripeConnection | null>(null);
	const [origin, setOrigin] = useState("");
	const [loadFailed, setLoadFailed] = useState(false);
	const [attempt, setAttempt] = useState(0);
	useEffect(() => {
		let active = true;
		getStripeConnection(projectId)
			.then((result) => {
				if (!active) return;
				setConnection(result);
				setOrigin(result.application_origin);
			})
			.catch(() => {
				if (active) setLoadFailed(true);
			});
		return () => {
			active = false;
		};
	}, [projectId, attempt]);
	const configured = connection?.configured === true;
	const autosave = useSettingsAutosave({
		resourceKey: configured ? "configured" : "unconfigured",
		value: origin,
		enabled: configured && isApplicationOrigin(origin),
		save: async (applicationOrigin) => {
			await saveStripeConnection(projectId, { application_origin: applicationOrigin });
		},
	});
	return {
		...autosave,
		connection,
		origin,
		loadFailed,
		setOrigin,
		reload: () => {
			setLoadFailed(false);
			setAttempt((value) => value + 1);
		},
		refresh: async () => {
			setConnection(await getStripeConnection(projectId));
		},
	};
}

export type StripeConnectionState = ReturnType<typeof useStripeConnection>;

export default function StripeSettings({
	projectId,
	stripe,
}: {
	projectId: string;
	stripe: StripeConnectionState;
}) {
	const { t, date } = useMonetizationI18n();
	const { connection, origin } = stripe;
	const [secret, setSecret] = useState("");
	const [signing, setSigning] = useState("");
	const [busy, setBusy] = useState(false);
	const [saveMessage, setSaveMessage] = useState("");
	const [testMessage, setTestMessage] = useState("");
	const saveFailed = t("Unable to save Stripe settings. Check the keys and application origin.");
	const testFailed = t("Store connection failed. Check the application credentials and try again.");
	const configured = connection?.configured === true;
	async function save() {
		setBusy(true);
		setSaveMessage("");
		try {
			await saveStripeConnection(projectId, {
				...(secret.trim() ? { secret_key: secret } : {}),
				...(signing.trim() ? { webhook_secret: signing } : {}),
				application_origin:
					configured && !isApplicationOrigin(origin)
						? (connection?.application_origin ?? origin)
						: origin,
			});
			await stripe.refresh();
			setSecret("");
			setSigning("");
			setSaveMessage(t(configured ? "Secrets replaced." : "Settings saved."));
		} catch {
			setSaveMessage(saveFailed);
		} finally {
			setBusy(false);
		}
	}
	async function test() {
		setBusy(true);
		setTestMessage("");
		try {
			await testStripeConnection(projectId);
			await stripe.refresh();
			setTestMessage(t("Store connection verified."));
		} catch {
			setTestMessage(testFailed);
		} finally {
			setBusy(false);
		}
	}
	const originField = (
		<SettingsTextField
			label={t("Application origin")}
			description={
				origin.trim() && !isApplicationOrigin(origin)
					? t("Enter an HTTPS address, for example https://example.com.")
					: t(
							"HTTPS address of your website. After payment, Stripe only sends customers back to pages on this address.",
						)
			}
			required
			type="url"
			value={origin}
			onChange={(event) => {
				stripe.setOrigin(event.target.value);
			}}
		/>
	);
	const keepSecretHelp = configured ? t("Leave empty to keep the current secret.") : undefined;
	return (
		<SettingsSection
			title={t("Stripe web payments")}
			description={t("Sell your products on the web with Stripe Checkout.")}
		>
			{!connection ? (
				<SettingsRow>
					{stripe.loadFailed ? (
						<div role="alert" className="space-y-3">
							<p className="text-sm text-kumo-danger">{t("Unable to load Stripe settings.")}</p>
							<SettingsActions>
								<Button type="button" onClick={stripe.reload}>
									{t("Retry")}
								</Button>
							</SettingsActions>
						</div>
					) : (
						<p role="status" className="text-sm text-kumo-subtle">
							{t("Loading settings…")}
						</p>
					)}
				</SettingsRow>
			) : (
				<>
					<SettingsRow>
						<div className="flex flex-wrap items-center justify-between gap-3">
							<div className="min-w-0 space-y-0.5">
								<p className="text-sm font-medium">{t("Connection")}</p>
								{configured && connection.last_tested_at && (
									<p className="text-xs text-kumo-subtle">
										{t("Last verified {date}", { date: date(connection.last_tested_at) })}
									</p>
								)}
							</div>
							<div className="flex shrink-0 flex-wrap items-center gap-2">
								<Badge variant={configured ? "success" : "default"}>
									{t(configured ? "Configured" : "Not configured")}
								</Badge>
								<Badge variant="outline">
									{t(connection.environment === "sandbox" ? "Sandbox" : "Production")}
								</Badge>
							</div>
						</div>
						{testMessage && (
							<p role="status" className="text-sm">
								{testMessage}
							</p>
						)}
						<SettingsActions>
							<Button
								type="button"
								disabled={busy || !configured}
								onClick={() => {
									test().catch(() => {
										setTestMessage(testFailed);
									});
								}}
							>
								{t("Test connection")}
							</Button>
						</SettingsActions>
					</SettingsRow>
					{configured && <SettingsRow>{originField}</SettingsRow>}
					<SettingsRow>
						<form
							className="space-y-4"
							onSubmit={(event) => {
								event.preventDefault();
								save().catch(() => {
									setSaveMessage(saveFailed);
								});
							}}
						>
							<fieldset disabled={busy} className="space-y-4">
								{!configured && originField}
								<SettingsTextField
									label={t("Stripe secret key")}
									description={keepSecretHelp}
									required={!configured}
									type="password"
									autoComplete="off"
									value={secret}
									onChange={(event) => {
										setSecret(event.target.value);
									}}
								/>
								<SettingsTextField
									label={t("Webhook signing secret")}
									description={keepSecretHelp}
									required={!configured}
									type="password"
									autoComplete="off"
									value={signing}
									onChange={(event) => {
										setSigning(event.target.value);
									}}
								/>
							</fieldset>
							{saveMessage && (
								<p role="status" className="text-sm">
									{saveMessage}
								</p>
							)}
							<SettingsActions>
								<Button
									type="submit"
									variant="primary"
									disabled={busy || (configured && !secret.trim() && !signing.trim())}
								>
									{t(busy ? "Saving…" : configured ? "Replace secrets" : "Connect Stripe")}
								</Button>
							</SettingsActions>
						</form>
					</SettingsRow>
				</>
			)}
		</SettingsSection>
	);
}

export function StripeAdvancedSettings({ stripe }: { stripe: StripeConnectionState }) {
	const { t } = useMonetizationI18n();
	const [copied, setCopied] = useState(false);
	if (!stripe.connection) return null;
	const { webhook_url: url, webhook_path: path } = stripe.connection;
	return (
		<SettingsSection
			title={t("Advanced")}
			description={t("Technical details for connecting Stripe to this project.")}
		>
			<SettingsRow>
				<div className="space-y-2">
					<p className="text-sm font-medium">{t("Stripe webhook endpoint")}</p>
					<code className="block break-all rounded-md border border-kumo-line px-3 py-2 font-mono text-xs">
						{url ?? path}
					</code>
					<p className="text-xs text-kumo-subtle">
						{t(
							"Enable Checkout session, subscription, invoice payment and charge refund events on this endpoint.",
						)}
					</p>
					{url && (
						<SettingsActions>
							<Button
								type="button"
								onClick={() => {
									Promise.resolve()
										.then(() => navigator.clipboard.writeText(url))
										.then(
											() => {
												setCopied(true);
											},
											() => {
												setCopied(false);
											},
										);
								}}
							>
								{t(copied ? "Address copied" : "Copy address")}
							</Button>
						</SettingsActions>
					)}
				</div>
			</SettingsRow>
		</SettingsSection>
	);
}
