import ActionConfirm from "@superboard/front-ui/common/action-confirm.js";
import { Button, InputArea, Loader, Select, SwitchField } from "@superboard/front-ui/kumo";
import {
	SettingsDependents,
	SettingsRow,
	SettingsSection,
	SettingsTextField,
} from "@superboard/front-ui/settings-form";
import { useEffect, useState, type ReactNode } from "react";

import { useStudioI18n } from "./i18n.js";
import { getStudioSettings, saveStudioSettings, type StudioSettings } from "./service.js";
import { useAutosave } from "./settings-autosave.js";
import { HoursField, StateBadge } from "./settings-ui.js";

const defaultFrequencyHours = 24;
const maximumFrequencyHours = 720;

function useStudioSettings(project: string) {
	const { t } = useStudioI18n();
	const [value, setValue] = useState<StudioSettings | null>(null);
	const [failed, setFailed] = useState(false);
	const [attempt, setAttempt] = useState(0);
	useEffect(() => {
		let active = true;
		void getStudioSettings(project).then(
			(result) => {
				if (active) setValue(result);
			},
			() => {
				if (active) setFailed(true);
			},
		);
		return () => {
			active = false;
		};
	}, [project, attempt]);
	const fallback: ReactNode = failed ? (
		<div role="alert" className="space-y-3">
			<p className="text-sm text-kumo-danger">{t("Loading failed")}</p>
			<Button
				type="button"
				onClick={() => {
					setFailed(false);
					setAttempt((count) => count + 1);
				}}
			>
				{t("Reload")}
			</Button>
		</div>
	) : (
		<Loader />
	);
	return { value, fallback };
}

export function LanguageSettings({
	project,
	onSaved,
}: {
	project: string;
	onSaved?: (settings: StudioSettings) => void;
}) {
	const { value, fallback } = useStudioSettings(project);
	return value ? <LanguageForm project={project} initial={value} onSaved={onSaved} /> : fallback;
}

function LanguageForm({
	project,
	initial,
	onSaved,
}: {
	project: string;
	initial: StudioSettings;
	onSaved?: (settings: StudioSettings) => void;
}) {
	const { t } = useStudioI18n();
	const [value, setValue] = useState(initial);
	const [lastFrequency, setLastFrequency] = useState(
		initial.marketing_frequency_hours || defaultFrequencyHours,
	);
	const locales = value.locales.map((item) => item.trim()).filter(Boolean);
	const fallbackEnabled = locales.includes(value.fallback_locale);
	const { indicator } = useAutosave({
		resourceKey: project,
		value,
		enabled: fallbackEnabled,
		save: async ({ ai_provider: _provider, ...next }) => {
			const saved = await saveStudioSettings(project, {
				...next,
				locales: next.locales.map((item) => item.trim()).filter(Boolean),
				glossary: next.glossary.map((item) => item.trim()).filter(Boolean),
			});
			onSaved?.(saved);
		},
	});
	const limited = value.marketing_frequency_hours > 0;
	return (
		<>
			<SettingsSection
				title={t("Languages")}
				description={t(
					"Languages your emails can be written in, and the one used when a translation is missing.",
				)}
			>
				<SettingsRow>
					<SettingsTextField
						label={t("Enabled languages")}
						description={t("Language codes separated by commas, for example: en, fr")}
						value={value.locales.join(", ")}
						onChange={(event) => {
							setValue({
								...value,
								locales: event.target.value.split(",").map((item) => item.trim()),
							});
						}}
					/>
				</SettingsRow>
				<SettingsRow>
					<Select
						className="w-full"
						label={t("Fallback language")}
						value={value.fallback_locale}
						onValueChange={(next) => {
							if (typeof next === "string" && next) setValue({ ...value, fallback_locale: next });
						}}
						items={Object.fromEntries(
							[...new Set([...locales, value.fallback_locale])]
								.filter(Boolean)
								.map((locale) => [locale, locale]),
						)}
					/>
					{!fallbackEnabled && (
						<p className="text-sm text-kumo-warning">
							{t("Choose a fallback language among the enabled languages.")}
						</p>
					)}
				</SettingsRow>
				<SettingsRow>
					<InputArea
						label={t("Brand glossary")}
						description={t("Terms kept unchanged when emails are translated, one per line.")}
						value={value.glossary.join("\n")}
						onChange={(event) => {
							setValue({ ...value, glossary: event.target.value.split("\n") });
						}}
					/>
				</SettingsRow>
			</SettingsSection>
			<SettingsSection
				title={t("Marketing email frequency")}
				description={t("Avoid sending too many campaign and lifecycle emails to the same contact.")}
			>
				<SettingsRow>
					<SwitchField
						label={t("Limit marketing emails per contact")}
						checked={limited}
						onCheckedChange={(next) => {
							if (!next) setLastFrequency(value.marketing_frequency_hours || lastFrequency);
							setValue({ ...value, marketing_frequency_hours: next ? lastFrequency : 0 });
						}}
					/>
					{limited && (
						<SettingsDependents>
							<HoursField
								label={t("Minimum time between two marketing emails")}
								value={value.marketing_frequency_hours}
								min={1}
								max={maximumFrequencyHours}
								onChange={(hours) => {
									setValue({ ...value, marketing_frequency_hours: hours });
								}}
							/>
						</SettingsDependents>
					)}
				</SettingsRow>
			</SettingsSection>
			{indicator}
		</>
	);
}

export function TranslationProviderSettings({ project }: { project: string }) {
	const { value, fallback } = useStudioSettings(project);
	return value ? <TranslationProviderForm project={project} initial={value} /> : fallback;
}

type ProviderDraft = { enabled: boolean; url: string; model: string; api_key: string };

function TranslationProviderForm({
	project,
	initial,
}: {
	project: string;
	initial: StudioSettings;
}) {
	const { t } = useStudioI18n();
	const [configured, setConfigured] = useState(Boolean(initial.ai_provider?.configured));
	const [draft, setDraft] = useState<ProviderDraft>({
		enabled: Boolean(initial.ai_provider),
		url: initial.ai_provider?.url ?? "",
		model: initial.ai_provider?.model ?? "",
		api_key: "",
	});
	const [confirming, setConfirming] = useState(false);
	const complete = Boolean(
		draft.url.trim() && draft.model.trim() && (draft.api_key.trim() || configured),
	);
	const { indicator } = useAutosave({
		resourceKey: project,
		value: draft,
		enabled: !draft.enabled || complete,
		save: async (next) => {
			const { ai_provider: _provider, ...settings } = initial;
			const saved = await saveStudioSettings(project, {
				...settings,
				ai_provider: next.enabled
					? {
							url: next.url.trim(),
							model: next.model.trim(),
							...(next.api_key.trim() ? { api_key: next.api_key.trim() } : {}),
						}
					: null,
			});
			setConfigured(Boolean(saved.ai_provider?.configured));
		},
	});
	const change = (patch: Partial<ProviderDraft>) => {
		setDraft((current) => ({ ...current, ...patch }));
	};
	const state = !draft.enabled ? "off" : configured && complete ? "enabled" : "incomplete";
	return (
		<>
			<SettingsSection
				title={t("Translation provider")}
				description={t("Translate email content with your own AI provider.")}
			>
				<SettingsRow>
					<SwitchField
						label={t("Translate with AI")}
						trailing={<StateBadge state={state} />}
						checked={draft.enabled}
						onCheckedChange={(next) => {
							if (!next && configured) setConfirming(true);
							else change({ enabled: next });
						}}
					/>
					{draft.enabled && (
						<SettingsDependents>
							<SettingsTextField
								label={t("Responses API endpoint")}
								type="url"
								placeholder={t("https://api.openai.com/v1/responses")}
								value={draft.url}
								onChange={(event) => {
									change({ url: event.target.value });
								}}
							/>
							<SettingsTextField
								label={t("Model")}
								value={draft.model}
								onChange={(event) => {
									change({ model: event.target.value });
								}}
							/>
							<SettingsTextField
								label={t("API key")}
								type="password"
								autoComplete="new-password"
								description={configured ? t("A key is already configured.") : undefined}
								value={draft.api_key}
								onChange={(event) => {
									change({ api_key: event.target.value });
								}}
							/>
						</SettingsDependents>
					)}
				</SettingsRow>
			</SettingsSection>
			<ActionConfirm
				open={confirming}
				setOpen={setConfirming}
				title={t("Remove the translation provider?")}
				description={t("Its encrypted API key is deleted. You will need to enter it again.")}
				confirmText={t("Remove provider")}
				onConfirm={() => {
					change({ enabled: false, url: "", model: "", api_key: "" });
				}}
			/>
			{indicator}
		</>
	);
}
