import DeleteConfirm from "@superboard/front-ui/common/delete-confirm.js";
import { Button, Loader, Select } from "@superboard/front-ui/kumo";
import { usePublicConfig } from "@superboard/front-ui/lib/config.js";
import { moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import {
	SettingsActions,
	SettingsRow,
	SettingsTextField,
} from "@superboard/front-ui/settings-form";
import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
	createProviderWebhook as createEmailWebhook,
	deleteProviderWebhook as deleteEmailWebhook,
	getProviderWebhooks as getEmailWebhooks,
} from "../../email/api/email/emailService.js";
import {
	createProviderWebhook as createMarketingWebhook,
	deleteProviderWebhook as deleteMarketingWebhook,
	getProviderWebhooks as getMarketingWebhooks,
} from "../api/marketing/marketingService.js";
import { useStudioI18n } from "./i18n.js";
import { SettingsSubsection } from "./settings-ui.js";

type Service = "email" | "marketing";
type Webhook = { id: string; provider: string; service: Service };
const serviceKeys: Service[] = ["email", "marketing"];

const services = {
	email: {
		label: "Transactional email",
		path: "/api/v1/email/provider-webhooks/",
		list: getEmailWebhooks,
		create: createEmailWebhook,
		remove: deleteEmailWebhook,
	},
	marketing: {
		label: "Campaigns and journeys",
		path: "/api/v1/marketing/provider-webhooks/",
		list: getMarketingWebhooks,
		create: createMarketingWebhook,
		remove: deleteMarketingWebhook,
	},
} as const;

export function ProviderWebhooks({ project }: { project: string }) {
	const { t, locale } = useStudioI18n();
	const { apiUrl = "" } = usePublicConfig();
	const [items, setItems] = useState<Webhook[]>([]);
	const [loading, setLoading] = useState(true);
	const [adding, setAdding] = useState(false);
	const [service, setService] = useState<Service>("email");
	const [provider, setProvider] = useState("");
	const [secret, setSecret] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const fetchAll = useCallback(
		() =>
			Promise.allSettled(
				serviceKeys.map(async (key) =>
					(await services[key].list(project)).map((item) => ({
						id: item.id,
						provider: item.provider,
						service: key,
					})),
				),
			),
		[project],
	);
	const apply = useCallback(
		(results: Awaited<ReturnType<typeof fetchAll>>) => {
			setItems(results.flatMap((result) => (result.status === "fulfilled" ? result.value : [])));
			setError(results.some((result) => result.status === "rejected") ? t("Loading failed") : "");
			setLoading(false);
		},
		[t],
	);
	const load = useCallback(() => fetchAll().then(apply), [fetchAll, apply]);
	useEffect(() => {
		let active = true;
		void fetchAll()
			.then((results) => {
				if (active) apply(results);
			})
			.catch(() => undefined);
		return () => {
			active = false;
		};
	}, [fetchAll, apply]);
	const run = async (action: () => Promise<unknown>) => {
		setBusy(true);
		setError("");
		try {
			await action();
			await load();
			return true;
		} catch (cause) {
			setError(moduleErrorMessage(cause, locale));
			return false;
		} finally {
			setBusy(false);
		}
	};
	const close = () => {
		setAdding(false);
		setProvider("");
		setSecret("");
	};
	return (
		<div className="space-y-4">
			<SettingsSubsection
				title={t("Receive provider events")}
				description={t(
					"Give these URLs to your email provider so bounces, complaints and deliveries update your contacts automatically.",
				)}
			>
				{loading ? (
					<SettingsRow>
						<Loader />
					</SettingsRow>
				) : items.length ? (
					items.map((item) => (
						<SettingsRow
							key={`${item.service}:${item.id}`}
							className="flex items-start justify-between gap-4 space-y-0"
						>
							<div className="min-w-0 space-y-1">
								<p className="text-sm font-medium">
									{item.provider} · {t(services[item.service].label)}
								</p>
								<code className="block break-all text-xs text-kumo-subtle">
									{apiUrl}
									{services[item.service].path}
									{item.id}
								</code>
							</div>
							<DeleteConfirm
								title={t("Delete this provider webhook?")}
								description={t(
									"Your provider will no longer be able to report bounces and complaints to this URL.",
								)}
								onConfirm={async () => {
									await run(() => services[item.service].remove(project, item.id));
								}}
							>
								<Button
									variant="ghost"
									shape="square"
									icon={Trash2}
									disabled={busy}
									aria-label={t("Delete {name}", { name: item.provider })}
								/>
							</DeleteConfirm>
						</SettingsRow>
					))
				) : (
					<SettingsRow>
						<p className="text-sm text-kumo-subtle">
							{t(
								"No provider webhook yet. Create one if your provider reports bounces by webhook.",
							)}
						</p>
					</SettingsRow>
				)}
			</SettingsSubsection>
			{error && (
				<p role="alert" className="text-sm text-kumo-danger">
					{error}
				</p>
			)}
			{adding ? (
				<form
					className="space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						void run(() => services[service].create(project, { provider, secret, enabled: true }))
							.then((saved) => {
								if (saved) close();
							})
							.catch(() => undefined);
					}}
				>
					<SettingsSubsection
						title={t("New provider webhook")}
						description={t("Each webhook receives the events of one service.")}
					>
						<SettingsRow>
							<Select
								className="w-full"
								label={t("Events for")}
								value={service}
								onValueChange={(value) => {
									if (value === "email" || value === "marketing") setService(value);
								}}
								items={{
									email: t(services.email.label),
									marketing: t(services.marketing.label),
								}}
							/>
						</SettingsRow>
						<SettingsRow>
							<SettingsTextField
								label={t("Provider identifier")}
								value={provider}
								required
								onChange={(event) => {
									setProvider(event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "_"));
								}}
							/>
						</SettingsRow>
						<SettingsRow>
							<SettingsTextField
								type="password"
								autoComplete="new-password"
								label={t("Shared secret (minimum 16 characters)")}
								value={secret}
								required
								onChange={(event) => {
									setSecret(event.target.value);
								}}
							/>
						</SettingsRow>
					</SettingsSubsection>
					<SettingsActions>
						<Button type="button" variant="ghost" onClick={close}>
							{t("Cancel")}
						</Button>
						<Button
							type="submit"
							variant="primary"
							disabled={busy || !provider || secret.length < 16}
						>
							{t("Create endpoint")}
						</Button>
					</SettingsActions>
				</form>
			) : (
				<SettingsActions>
					<Button
						type="button"
						icon={Plus}
						onClick={() => {
							setAdding(true);
						}}
					>
						{t("Add a provider webhook")}
					</Button>
				</SettingsActions>
			)}
		</div>
	);
}
