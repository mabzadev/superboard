import { setupI18n } from "@lingui/core";
import type { CustomWorkerJobReceipt } from "@superboard/contracts/custom-worker";
import { useFrontContext } from "@superboard/front-ui/context";
import { Button, Checkbox, Input, Loader } from "@superboard/front-ui/kumo";
import { useCallback, useEffect, useState } from "react";

import { useProjectSelection } from "../../../../../../supbrd-front-ui/src/shared/context/useProjectSelection.js";
import { GET, POST, PUT } from "./transport.js";

const copy = {
	en: {
		voices: "Voices",
		conversions: "Conversions",
		outputs: "Generated files",
		jobs: "Processing jobs",
		settings: "Vocostar settings",
		empty: "No processing jobs for this project",
		retry: "Retry",
		refresh: "Refresh",
		next: "Next page",
		first: "First page",
		status: "Status",
		progress: "Progress",
		entity: "Result identifier",
		output: "Generated output",
		save: "Save settings",
		saved: "Settings saved",
		operation_failed: "The operation could not be completed",
		failed: "Failed",
		display_name: "Plugin display name",
		allowed_locales: "Allowed languages, separated by commas",
		text_max_characters: "Maximum text length",
		media_credit_cost: "Credits per conversion (leave empty to preserve the existing pricing)",
		voice_cloning_enabled: "Enable voice cloning",
		media_conversion_enabled: "Enable media conversion",
		queued: "Queued",
		dispatched: "Dispatched",
		running: "Running",
		completed: "Completed",
		cancelled: "Cancelled",
	},
	fr: {
		voices: "Voix",
		conversions: "Conversions",
		outputs: "Fichiers générés",
		jobs: "Traitements en cours",
		settings: "Configuration Vocostar",
		empty: "Aucun traitement pour ce projet",
		retry: "Relancer",
		refresh: "Actualiser",
		next: "Page suivante",
		first: "Première page",
		status: "État",
		progress: "Progression",
		entity: "Identifiant du résultat",
		output: "Fichier généré",
		save: "Enregistrer les paramètres",
		saved: "Paramètres enregistrés",
		operation_failed: "L’opération n’a pas pu aboutir",
		failed: "Échec",
		display_name: "Nom affiché du plugin",
		allowed_locales: "Langues autorisées, séparées par des virgules",
		text_max_characters: "Longueur maximale du texte",
		media_credit_cost:
			"Crédits par conversion (laisser vide pour conserver la tarification existante)",
		voice_cloning_enabled: "Activer le clonage de voix",
		media_conversion_enabled: "Activer la conversion de médias",
		queued: "En attente",
		dispatched: "Transmis",
		running: "En cours",
		completed: "Terminé",
		cancelled: "Annulé",
	},
};

type Job = CustomWorkerJobReceipt & { output?: string | null };
type Values = {
	display_name: string;
	allowed_locales: string;
	text_max_characters: string;
	media_credit_cost: string;
	voice_cloning_enabled: boolean;
	media_conversion_enabled: boolean;
};
const defaults: Values = {
	display_name: "Vocostar",
	allowed_locales: "en,us,fr,es,pt,de,it,ja,ko",
	text_max_characters: "10000",
	media_credit_cost: "",
	voice_cloning_enabled: true,
	media_conversion_enabled: true,
};

export default function VocostarPage() {
	const { path, locale } = useFrontContext();
	const { selectedProject } = useProjectSelection();
	const section = path.split("/").at(-1) ?? "jobs";
	const i18n = setupI18n({ locale, messages: { [locale]: copy[locale] } });
	const t = (id: string) => i18n._(id);
	const [items, setItems] = useState<Job[]>([]);
	const [values, setValues] = useState<Values>(defaults);
	const [cursor, setCursor] = useState<string | null>(null);
	const [next, setNext] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(false);
	const [saved, setSaved] = useState(false);
	const base = `/api/v1/plugins/vocostar/projects/${selectedProject?.id ?? ""}`;
	const load = useCallback(async () => {
		if (!selectedProject) return;
		setLoading(true);
		setError(false);
		try {
			if (section === "settings") {
				const response = await GET("/_emdash/api/admin/plugins/supbrd-plugmod-vocostar/settings");
				const stored = response.data.data.values;
				setValues(
					Object.fromEntries(
						Object.entries(defaults).map(([key, fallback]) => [
							key,
							stored[key] == null
								? fallback
								: typeof fallback === "boolean"
									? stored[key] === true
									: String(stored[key]),
						]),
					) as Values,
				);
			} else {
				const query = new URLSearchParams({ limit: "50", ...(cursor ? { cursor } : {}) });
				const response = await GET(`${base}/${section}?${query}`);
				setItems(response.data.data.items);
				setNext(response.data.data.next_cursor);
			}
		} catch {
			setError(true);
		} finally {
			setLoading(false);
		}
	}, [selectedProject, section, cursor, base]);
	useEffect(() => {
		void load();
	}, [load]);
	useEffect(() => {
		setCursor(null);
		setSaved(false);
	}, [selectedProject?.id, section]);
	async function run(action: () => Promise<unknown>) {
		if (busy) return;
		setBusy(true);
		setError(false);
		setSaved(false);
		try {
			await action();
			await load();
			setSaved(true);
		} catch {
			setError(true);
		} finally {
			setBusy(false);
		}
	}
	return (
		<section className="space-y-5">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h1 className="text-xl font-semibold">{t(section)}</h1>
				<Button onClick={() => void load()} disabled={loading}>
					{t("refresh")}
				</Button>
			</div>
			{error && <p role="alert">{t("operation_failed")}</p>}
			{saved && <p role="status">{t("saved")}</p>}
			{loading ? (
				<Loader />
			) : section === "settings" ? (
				<form
					className="grid max-w-2xl gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						const settings: Record<string, unknown> = {
							...values,
							text_max_characters: Number(values.text_max_characters),
						};
						if (values.media_credit_cost === "") delete settings.media_credit_cost;
						else settings.media_credit_cost = Number(values.media_credit_cost);
						void run(() =>
							PUT("/_emdash/api/admin/plugins/supbrd-plugmod-vocostar/settings", {
								values: settings,
							}),
						);
					}}
				>
					{(
						["display_name", "allowed_locales", "text_max_characters", "media_credit_cost"] as const
					).map((key) => (
						<Input
							key={key}
							label={t(key)}
							value={values[key]}
							type={
								key === "media_credit_cost" || key === "text_max_characters" ? "number" : "text"
							}
							onChange={(event) =>
								setValues((previous) => ({ ...previous, [key]: event.target.value }))
							}
						/>
					))}
					<Checkbox
						label={t("voice_cloning_enabled")}
						checked={values.voice_cloning_enabled}
						onCheckedChange={(checked) =>
							setValues((previous) => ({ ...previous, voice_cloning_enabled: checked }))
						}
					/>
					<Checkbox
						label={t("media_conversion_enabled")}
						checked={values.media_conversion_enabled}
						onCheckedChange={(checked) =>
							setValues((previous) => ({ ...previous, media_conversion_enabled: checked }))
						}
					/>
					<Button type="submit" variant="primary" loading={busy}>
						{t("save")}
					</Button>
				</form>
			) : (
				<>
					{items.length ? (
						<div className="overflow-x-auto">
							<table className="w-full text-start">
								<thead>
									<tr>
										<th className="p-3 text-start">{t("entity")}</th>
										<th className="p-3 text-start">{t("status")}</th>
										<th className="p-3 text-start">{t("progress")}</th>
										<th className="p-3 text-start">
											{section === "outputs" ? t("output") : t("retry")}
										</th>
									</tr>
								</thead>
								<tbody>
									{items.map((job) => (
										<tr key={job.id} className="border-b border-kumo-line">
											<td className="p-3">{job.entityId}</td>
											<td className="p-3">{t(job.status)}</td>
											<td className="p-3">
												{job.progress == null ? "—" : `${Math.round(job.progress * 100)}%`}
											</td>
											<td className="p-3">
												{section === "outputs" ? (
													<pre className="max-w-lg whitespace-pre-wrap break-words">
														{job.output}
													</pre>
												) : (
													job.status === "failed" && (
														<Button
															disabled={busy}
															onClick={() =>
																void run(() =>
																	POST(`${base}/jobs/${encodeURIComponent(job.id)}/retry`),
																)
															}
														>
															{t("retry")}
														</Button>
													)
												)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					) : (
						<p>{t("empty")}</p>
					)}
					<div className="flex gap-2">
						<Button disabled={!cursor || loading} onClick={() => setCursor(null)}>
							{t("first")}
						</Button>
						<Button disabled={!next || loading} onClick={() => setCursor(next)}>
							{t("next")}
						</Button>
					</div>
				</>
			)}
		</section>
	);
}
