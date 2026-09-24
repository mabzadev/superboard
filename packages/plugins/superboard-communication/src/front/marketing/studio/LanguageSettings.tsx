import { Button, Input, InputArea } from "@superboard/front-ui/kumo";
import { useEffect, useState } from "react";

import { useStudioI18n } from "./i18n.js";
import { getStudioSettings, saveStudioSettings, type StudioSettings } from "./service.js";

export function LanguageSettings({
	project,
	onSaved,
}: {
	project: string;
	onSaved?: (settings: StudioSettings) => void;
}) {
	const { t } = useStudioI18n();
	const [value, setValue] = useState<StudioSettings | null>(null);
	const [message, setMessage] = useState("");
	useEffect(() => {
		let active = true;
		void getStudioSettings(project).then(
			(result) => {
				if (active) setValue(result);
			},
			() => {
				if (active) setMessage(t("Loading failed"));
			},
		);
		return () => {
			active = false;
		};
	}, [project, t]);
	return (
		<section className="space-y-4 rounded-lg border border-kumo-line bg-kumo-base p-6">
			<h2 className="text-lg font-semibold">{t("Email settings")}</h2>
			{message && <p role="status">{message}</p>}
			{value && (
				<>
					<div className="grid gap-4 md:grid-cols-3">
						<Input
							label={t("Enabled languages")}
							value={value.locales.join(", ")}
							onChange={(event) => {
								setValue({
									...value,
									locales: event.target.value.split(",").map((item) => item.trim()),
								});
							}}
						/>
						<Input
							label={t("Fallback language")}
							value={value.fallback_locale}
							onChange={(event) => {
								setValue({ ...value, fallback_locale: event.target.value });
							}}
						/>
						<Input
							label={t("Marketing frequency (hours)")}
							type="number"
							min={0}
							max={720}
							value={value.marketing_frequency_hours}
							onChange={(event) => {
								setValue({ ...value, marketing_frequency_hours: Number(event.target.value) });
							}}
						/>
					</div>
					<InputArea
						label={t("Brand glossary")}
						description={t("One term per line")}
						value={value.glossary.join("\n")}
						onChange={(event) => {
							setValue({ ...value, glossary: event.target.value.split("\n") });
						}}
					/>
					<div className="space-y-3 border-t border-kumo-line pt-4">
						<h3 className="font-semibold">{t("Translation provider")}</h3>
						<Input
							label={t("Responses API endpoint")}
							placeholder={t("https://api.openai.com/v1/responses")}
							value={value.ai_provider?.url ?? ""}
							onChange={(event) => {
								setValue({
									...value,
									ai_provider: {
										...value.ai_provider,
										url: event.target.value,
										model: value.ai_provider?.model ?? "",
									},
								});
							}}
						/>
						<Input
							label={t("Model")}
							value={value.ai_provider?.model ?? ""}
							onChange={(event) => {
								setValue({
									...value,
									ai_provider: {
										...value.ai_provider,
										url: value.ai_provider?.url ?? "",
										model: event.target.value,
									},
								});
							}}
						/>
						<Input
							type="password"
							label={t("API key")}
							description={
								value.ai_provider?.configured ? t("A key is already configured.") : undefined
							}
							value={value.ai_provider?.api_key ?? ""}
							onChange={(event) => {
								setValue({
									...value,
									ai_provider: {
										...value.ai_provider,
										url: value.ai_provider?.url ?? "",
										model: value.ai_provider?.model ?? "",
										api_key: event.target.value,
									},
								});
							}}
						/>
						{value.ai_provider && (
							<Button
								variant="ghost"
								onClick={() => {
									setValue({ ...value, ai_provider: null });
								}}
							>
								{t("Remove provider")}
							</Button>
						)}
					</div>
					<Button
						variant="primary"
						onClick={() => {
							void (async () => {
								try {
									const saved = await saveStudioSettings(project, value);
									setValue(saved);
									onSaved?.(saved);
									setMessage(t("Saved"));
								} catch {
									setMessage(t("Save failed"));
								}
							})().catch(() => {
								setMessage(t("Save failed"));
							});
						}}
					>
						{t("Save")}
					</Button>
				</>
			)}
		</section>
	);
}
