import { Button, Input, Loader, Select } from "@superboard/front-ui/kumo";
import { usePublicConfig } from "@superboard/front-ui/lib/config.js";
import { moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
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

type Service = "email" | "marketing";
type Webhook = { id: string; provider: string; service: Service };
const serviceKeys: Service[] = ["email", "marketing"];

// Each service receives provider events on its own public endpoint.
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

/** One list of the provider webhook endpoints of both email services, each with its real URL. */
export function ProviderWebhooks({ project }: { project: string }) {
	const { t, locale } = useStudioI18n();
	const { apiUrl = "" } = usePublicConfig();
	const [items, setItems] = useState<Webhook[]>([]);
	const [loading, setLoading] = useState(true);
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
	return (
		<section className="space-y-4 rounded-lg border border-kumo-line bg-kumo-base p-6">
			<div>
				<h2 className="text-lg font-semibold">{t("Provider webhooks")}</h2>
				<p className="text-sm text-kumo-subtle">
					{t(
						"Give these URLs to your email provider so bounces, complaints and deliveries update your contacts automatically.",
					)}
				</p>
			</div>
			<form
				className="flex flex-wrap items-end gap-3"
				onSubmit={(event) => {
					event.preventDefault();
					void run(() => services[service].create(project, { provider, secret, enabled: true }))
						.then((saved) => {
							if (saved) {
								setProvider("");
								setSecret("");
							}
						})
						.catch(() => undefined);
				}}
			>
				<Select
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
				<Input
					label={t("Provider identifier")}
					value={provider}
					required
					onChange={(event) => {
						setProvider(event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "_"));
					}}
				/>
				<Input
					type="password"
					autoComplete="new-password"
					label={t("Shared secret (minimum 16 characters)")}
					value={secret}
					required
					onChange={(event) => {
						setSecret(event.target.value);
					}}
				/>
				<Button type="submit" disabled={busy || !provider || secret.length < 16}>
					{t("Create endpoint")}
				</Button>
			</form>
			{error && (
				<p role="alert" className="text-kumo-danger">
					{error}
				</p>
			)}
			{loading ? (
				<Loader />
			) : items.length ? (
				<div className="divide-y divide-kumo-line rounded-lg border border-kumo-line">
					{items.map((item) => (
						<div
							key={`${item.service}:${item.id}`}
							className="flex flex-wrap items-center justify-between gap-3 p-4"
						>
							<div className="min-w-0">
								<p className="font-medium">
									{item.provider} · {t(services[item.service].label)}
								</p>
								<code className="break-all text-xs">
									{apiUrl}
									{services[item.service].path}
									{item.id}
								</code>
							</div>
							<Button
								size="sm"
								variant="ghost"
								disabled={busy}
								aria-label={t("Delete {name}", { name: item.provider })}
								onClick={() => void run(() => services[item.service].remove(project, item.id))}
							>
								{t("Delete")}
							</Button>
						</div>
					))}
				</div>
			) : (
				<p className="text-sm text-kumo-subtle">
					{t("No provider webhook yet. Create one if your provider reports bounces by webhook.")}
				</p>
			)}
		</section>
	);
}
