import { Button } from "@superboard/front-ui/ui/button.js";
import { Input } from "@superboard/front-ui/ui/input.js";
import { Textarea } from "@superboard/front-ui/ui/textarea.js";
import { useEffect, useState } from "react";

const endpoint = "/_emdash/api/admin/plugins/supbrd-plug-data/settings";
const fields = {
	content: ["default_locale", "required_locales", "publishing_mode"],
	files: ["max_upload_bytes", "allowed_content_types", "signed_url_ttl_seconds"],
} as const;
const messages = {
	en: {
		default_locale: "Default language",
		required_locales: "Required languages",
		publishing_mode: "Publishing mode",
		max_upload_bytes: "Maximum upload size (bytes)",
		allowed_content_types: "Allowed content types",
		signed_url_ttl_seconds: "Signed URL lifetime (seconds)",
		draft_review: "Draft and review",
		direct: "Direct publication",
		unset: "Not configured",
		save: "Save changes",
		saved: "Settings saved",
		loading: "Loading settings…",
		failed: "Unable to load or save settings. Your changes have been kept.",
		retry: "Retry",
	},
	fr: {
		default_locale: "Langue par défaut",
		required_locales: "Langues requises",
		publishing_mode: "Mode de publication",
		max_upload_bytes: "Taille maximale des fichiers (octets)",
		allowed_content_types: "Types de contenu autorisés",
		signed_url_ttl_seconds: "Durée des URL signées (secondes)",
		draft_review: "Brouillon et validation",
		direct: "Publication directe",
		unset: "Non configuré",
		save: "Enregistrer",
		saved: "Paramètres enregistrés",
		loading: "Chargement des paramètres…",
		failed:
			"Impossible de charger ou d’enregistrer les paramètres. Vos modifications sont conservées.",
		retry: "Réessayer",
	},
};
type Values = Record<string, string | number | null>;

async function readSettings(response: Response): Promise<Values> {
	if (!response.ok) throw new Error("SETTINGS_REQUEST_FAILED");
	const body: unknown = await response.json();
	if (
		!body ||
		typeof body !== "object" ||
		!("data" in body) ||
		!body.data ||
		typeof body.data !== "object" ||
		!("values" in body.data) ||
		!body.data.values ||
		typeof body.data.values !== "object"
	)
		throw new Error("INVALID_SETTINGS_RESPONSE");
	const values: Values = {};
	const entries: [string, unknown][] = Object.entries(body.data.values);
	for (const [key, value] of entries) {
		if (value !== null && typeof value !== "string" && typeof value !== "number")
			throw new Error("INVALID_SETTING_VALUE");
		values[key] = value;
	}
	return values;
}

export function DataSettingsForm({
	section,
	locale,
}: {
	section: keyof typeof fields;
	locale: "en" | "fr";
}) {
	const t = messages[locale];
	const prefix = section === "content" ? "supbrd-plug-content__" : "supbrd-plugmod-files__";
	const [values, setValues] = useState<Values | null>(null);
	const [changes, setChanges] = useState<Values>({});
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);
	const [saved, setSaved] = useState(false);
	const [attempt, setAttempt] = useState(0);
	useEffect(() => {
		const controller = new AbortController();
		void fetch(endpoint, { signal: controller.signal })
			.then(readSettings)
			.then((result) => {
				if (!controller.signal.aborted) {
					setValues(result);
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
			const result = await readSettings(
				await fetch(endpoint, {
					method: "PUT",
					headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" },
					body: JSON.stringify({ values: changes }),
				}),
			);
			setValues(result);
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
			{failed && <p role="alert">{t.failed}</p>}
			{!values ? (
				failed ? (
					<Button
						type="button"
						onClick={() => {
							setAttempt(attempt + 1);
						}}
					>
						{t.retry}
					</Button>
				) : (
					<p>{t.loading}</p>
				)
			) : (
				<>
					{fields[section].map((field) => {
						const key = `${prefix}${field}`;
						const value = key in changes ? changes[key] : values[key];
						const numeric = field === "max_upload_bytes" || field === "signed_url_ttl_seconds";
						const change = (text: string) => {
							setSaved(false);
							setChanges((current) => ({
								...current,
								[key]: text === "" ? null : numeric ? Number(text) : text,
							}));
						};
						return (
							<label key={key} className="grid gap-2" htmlFor={`setting-${field}`}>
								{t[field]}
								{field === "publishing_mode" ? (
									<select
										id={`setting-${field}`}
										disabled={busy}
										value={value ?? ""}
										onChange={(event) => {
											change(event.target.value);
										}}
									>
										<option value="">{t.unset}</option>
										<option value="draft_review">{t.draft_review}</option>
										<option value="direct">{t.direct}</option>
									</select>
								) : field === "required_locales" || field === "allowed_content_types" ? (
									<Textarea
										id={`setting-${field}`}
										disabled={busy}
										value={value ?? ""}
										placeholder={t.unset}
										onChange={(event) => {
											change(event.target.value);
										}}
									/>
								) : (
									<Input
										id={`setting-${field}`}
										disabled={busy}
										value={value ?? ""}
										placeholder={t.unset}
										type={numeric ? "number" : "text"}
										step={numeric ? 1 : undefined}
										min={
											field === "max_upload_bytes"
												? 1024
												: field === "signed_url_ttl_seconds"
													? 60
													: undefined
										}
										max={
											field === "max_upload_bytes"
												? 5368709120
												: field === "signed_url_ttl_seconds"
													? 86400
													: undefined
										}
										minLength={field === "default_locale" ? 2 : undefined}
										onChange={(event) => {
											change(event.target.value);
										}}
									/>
								)}
							</label>
						);
					})}
					<Button type="submit" disabled={busy || Object.keys(changes).length === 0}>
						{t.save}
					</Button>
					{saved && <p role="status">{t.saved}</p>}
				</>
			)}
		</form>
	);
}
