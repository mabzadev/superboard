import { Button } from "@superboard/front-ui/ui/button.js";
import { Input } from "@superboard/front-ui/ui/input.js";
import { Textarea } from "@superboard/front-ui/ui/textarea.js";
import { useEffect, useState } from "react";

import { useMonetizationI18n } from "./i18n.js";

const endpoint = "/_emdash/api/admin/plugins/supbrd-plug-commerce/settings";
const fields = {
	products: [
		["default_currency", "Default Currency"],
		["store_environment", "Store environment"],
		["catalog_sync_enabled", "Catalog synchronization"],
	],
	billing: [
		["apple_issuer_id", "Apple issuer ID"],
		["apple_key_id", "Apple key ID"],
		["apple_private_key", "Apple private key"],
		["google_service_account_json", "Google service account JSON"],
		["stripe_secret_key", "Stripe secret key"],
		["webhook_signing_secret", "Webhook signing secret"],
	],
} as const;
type Values = Record<string, string | boolean | null>;
type Settings = { values: Values; secretsSet: Record<string, boolean> };
async function readSettings(response: Response): Promise<Settings> {
	if (!response.ok) throw new Error("SETTINGS_REQUEST_FAILED");
	const body: unknown = await response.json();
	if (
		!body ||
		typeof body !== "object" ||
		!("data" in body) ||
		!body.data ||
		typeof body.data !== "object"
	)
		throw new Error("INVALID_SETTINGS_RESPONSE");
	const data = body.data;
	if (
		!("values" in data) ||
		!data.values ||
		typeof data.values !== "object" ||
		!("secretsSet" in data) ||
		!data.secretsSet ||
		typeof data.secretsSet !== "object"
	)
		throw new Error("INVALID_SETTINGS_RESPONSE");
	const values: Values = {};
	const entries: [string, unknown][] = Object.entries(data.values);
	for (const [key, value] of entries) {
		if (value !== null && typeof value !== "string" && typeof value !== "boolean")
			throw new Error("INVALID_SETTING_VALUE");
		values[key] = value;
	}
	const secretsSet: Record<string, boolean> = {};
	const secretEntries: [string, unknown][] = Object.entries(data.secretsSet);
	for (const [key, value] of secretEntries) {
		if (typeof value !== "boolean") throw new Error("INVALID_SECRET_STATUS");
		secretsSet[key] = value;
	}
	return { values, secretsSet };
}

export function MonetizationSettingsForm({ section }: { section: keyof typeof fields }) {
	const { t } = useMonetizationI18n();
	const prefix = section === "products" ? "supbrd-plug-products__" : "supbrd-plugmod-billing__";
	const [settings, setSettings] = useState<Settings | null>(null);
	const [changes, setChanges] = useState<Values>({});
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	const [saved, setSaved] = useState(false);
	const [attempt, setAttempt] = useState(0);
	useEffect(() => {
		const controller = new AbortController();
		void fetch(endpoint, { signal: controller.signal })
			.then(readSettings)
			.then((data) => {
				if (!controller.signal.aborted) {
					setSettings(data);
					setFailed(false);
				}
			})
			.catch(() => {
				if (!controller.signal.aborted) setFailed(true);
			});
		return () => {
			controller.abort();
		};
	}, [attempt]);
	async function save() {
		setBusy(true);
		setFailed(false);
		setSaved(false);
		try {
			await readSettings(
				await fetch(endpoint, {
					method: "PUT",
					headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" },
					body: JSON.stringify({ values: changes }),
				}),
			);
			const persisted = await readSettings(await fetch(endpoint));
			for (const [key, value] of Object.entries(changes)) {
				if (
					key in persisted.secretsSet
						? persisted.secretsSet[key] !== (value !== null && value !== "")
						: value !== null && persisted.values[key] !== value
				)
					throw new Error("SETTINGS_NOT_PERSISTED");
			}
			setSettings(persisted);
			setChanges({});
			setSaved(true);
		} catch {
			setFailed(true);
		} finally {
			setBusy(false);
		}
	}
	return (
		<form
			className="grid max-w-2xl gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				void save().catch(() => {
					setFailed(true);
				});
			}}
		>
			{failed && (
				<p role="alert">{t("Unable to load or save settings. Your changes have been kept.")}</p>
			)}
			{!settings ? (
				failed ? (
					<Button
						type="button"
						onClick={() => {
							setAttempt(attempt + 1);
						}}
					>
						{t("Retry")}
					</Button>
				) : (
					<p>{t("Loading settings…")}</p>
				)
			) : (
				<>
					{fields[section].map(([field, label]) => {
						const key = prefix + field;
						const secret = key in settings.secretsSet;
						const value = key in changes ? changes[key] : secret ? "" : settings.values[key];
						const change = (next: string | boolean | null) => {
							setSaved(false);
							setChanges((current) => ({ ...current, [key]: next }));
						};
						return (
							<div key={key} className="grid gap-2">
								<label htmlFor={`setting-${field}`}>{t(label)}</label>
								{field === "store_environment" || field === "catalog_sync_enabled" ? (
									<select
										id={`setting-${field}`}
										disabled={busy}
										value={value === true ? "true" : value === false ? "false" : (value ?? "")}
										onChange={(event) => {
											const text = event.target.value;
											change(
												text === ""
													? null
													: field === "catalog_sync_enabled"
														? text === "true"
														: text,
											);
										}}
									>
										<option value="">{t("Not configured")}</option>
										{field === "store_environment" ? (
											<>
												<option value="sandbox">{t("Sandbox")}</option>
												<option value="production">{t("Production")}</option>
											</>
										) : (
											<>
												<option value="true">{t("Enabled")}</option>
												<option value="false">{t("Disabled")}</option>
											</>
										)}
									</select>
								) : field === "apple_private_key" || field === "google_service_account_json" ? (
									<Textarea
										id={`setting-${field}`}
										disabled={busy}
										autoComplete="off"
										className="[-webkit-text-security:disc]"
										value={typeof value === "string" ? value : ""}
										onChange={(event) => {
											if (event.target.value === "") {
												setSaved(false);
												setChanges((current) => {
													const next = { ...current };
													delete next[key];
													return next;
												});
											} else change(event.target.value);
										}}
									/>
								) : (
									<Input
										id={`setting-${field}`}
										disabled={busy}
										type={secret ? "password" : "text"}
										autoComplete="off"
										value={typeof value === "string" ? value : ""}
										pattern={field === "default_currency" ? "[A-Z]{3}" : undefined}
										onChange={(event) => {
											if (secret && event.target.value === "") {
												setSaved(false);
												setChanges((current) => {
													const next = { ...current };
													delete next[key];
													return next;
												});
											} else change(event.target.value || null);
										}}
									/>
								)}
								{secret && (
									<>
										<p>{t(settings.secretsSet[key] ? "Configured" : "Not configured")}</p>
										<p>{t("Leave blank to keep the stored secret.")}</p>
										<Button
											type="button"
											disabled={busy}
											onClick={() => {
												change(null);
											}}
										>
											{t("Clear secret")}
										</Button>
									</>
								)}
							</div>
						);
					})}
					<Button type="submit" disabled={busy || Object.keys(changes).length === 0}>
						{t("Save changes")}
					</Button>
					{saved && <p role="status">{t("Settings saved.")}</p>}
				</>
			)}
		</form>
	);
}
