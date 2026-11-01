import { Button, Input, InputArea, Select } from "@superboard/front-ui/kumo";
import { moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import { useEffect, useState } from "react";

import {
	getDoubleOptInSettings,
	saveDoubleOptInSettings,
	type DoubleOptInCopy,
	type DoubleOptInSettings,
} from "./audience-service.js";
import { useStudioI18n } from "./i18n.js";

const copyFields: Array<[keyof DoubleOptInCopy, string]> = [
	["subject", "Subject"],
	["heading", "Heading"],
	["body", "Message"],
	["button_label", "Button label"],
];

/** Collapsed by default: most projects keep the built-in confirmation email. */
export function DoubleOptInEmail({ project }: { project: string }) {
	const { t, locale } = useStudioI18n();
	const [settings, setSettings] = useState<DoubleOptInSettings | null>(null);
	const [language, setLanguage] = useState<"en" | "fr">(locale.startsWith("fr") ? "fr" : "en");
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("");
	const [error, setError] = useState("");
	useEffect(() => {
		let active = true;
		void getDoubleOptInSettings(project).then(
			(value) => {
				if (active) setSettings(value);
			},
			() => undefined,
		);
		return () => {
			active = false;
		};
	}, [project]);
	if (!settings) return null;
	const current = settings[language];
	const save = async (next: DoubleOptInSettings) => {
		setBusy(true);
		setError("");
		setMessage("");
		try {
			setSettings(await saveDoubleOptInSettings(project, { en: next.en, fr: next.fr }));
			setMessage(t("Saved"));
		} catch (cause) {
			setError(moduleErrorMessage(cause, locale));
		} finally {
			setBusy(false);
		}
	};
	return (
		<details className="rounded-lg border border-kumo-line bg-kumo-base p-5 xl:col-span-2">
			<summary className="cursor-pointer font-semibold">
				{t("Confirmation email (double opt-in)")}
				{settings.customized && (
					<span className="ms-2 text-xs font-normal text-kumo-subtle">{t("Customized")}</span>
				)}
			</summary>
			<div className="mt-4 grid gap-6 lg:grid-cols-2">
				<form
					className="space-y-3"
					onSubmit={(event) => {
						event.preventDefault();
						save(settings).catch(() => undefined);
					}}
				>
					<p className="text-sm text-kumo-subtle">
						{t(
							"Sent when a contact must confirm a subscription. The confirmation button is added automatically. Write {name} to greet the contact by name.",
							{ name: "{{name}}" },
						)}
					</p>
					<Select
						label={t("Language")}
						value={language}
						onValueChange={(next) => {
							if (next) setLanguage(next);
						}}
						items={{ en: t("English"), fr: t("French") }}
					/>
					{copyFields.map(([key, label]) =>
						key === "body" ? (
							<InputArea
								key={key}
								label={t(label)}
								value={current[key]}
								maxLength={2000}
								onChange={(event) => {
									setSettings({
										...settings,
										[language]: { ...current, [key]: event.target.value },
									});
								}}
							/>
						) : (
							<Input
								key={key}
								label={t(label)}
								value={current[key]}
								maxLength={key === "button_label" ? 60 : 200}
								onChange={(event) => {
									setSettings({
										...settings,
										[language]: { ...current, [key]: event.target.value },
									});
								}}
							/>
						),
					)}
					{error && (
						<p role="alert" className="text-kumo-danger">
							{error}
						</p>
					)}
					{message && <p role="status">{message}</p>}
					<div className="flex gap-2">
						<Button type="submit" variant="primary" disabled={busy}>
							{t("Save")}
						</Button>
						<Button
							disabled={busy || !settings.customized}
							onClick={() =>
								void save({ ...settings, en: settings.defaults.en, fr: settings.defaults.fr })
							}
						>
							{t("Restore default")}
						</Button>
					</div>
				</form>
				<div className="space-y-2" aria-label={t("Preview")}>
					<p className="text-sm font-medium">{t("Preview")}</p>
					<div className="rounded-lg border border-kumo-line bg-white p-5 text-zinc-900">
						<p className="text-xs text-zinc-500">
							{current.subject || settings.defaults[language].subject}
						</p>
						<p className="mt-3 font-semibold">
							{current.heading || settings.defaults[language].heading}
						</p>
						{current.body && <p className="mt-2 whitespace-pre-line text-sm">{current.body}</p>}
						<p className="mt-4">
							<span className="text-sm text-blue-700 underline">
								{current.button_label || settings.defaults[language].button_label}
							</span>
						</p>
					</div>
				</div>
			</div>
		</details>
	);
}
