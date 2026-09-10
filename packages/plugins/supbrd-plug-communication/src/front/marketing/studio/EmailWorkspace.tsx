import {
	createEmailDesign,
	EMAIL_PURPOSES,
	renderEmailTranslation,
	type EmailDesign,
} from "@superboard/contracts/email-studio";
import { Button, Dialog, Input, InputArea, Loader, Select } from "@superboard/front-ui/kumo";
import { useCallback, useEffect, useRef, useState } from "react";

import { useProjectSelection } from "../../../../../../supbrd-front-ui/src/shared/context/useProjectSelection.js";
import { EmailAdministration } from "../../email/components/modules/EmailAdministration.js";
import { EmailMessages } from "../../email/EmailMessages.js";
import {
	createEmailTemplate,
	deleteEmailTemplate,
	getEmailTemplates,
	updateEmailTemplate,
	getEmailCampaigns,
	type EmailCampaign,
	type EmailTemplate,
} from "../api/marketing/marketingService.js";
import { MarketingJourneysPage } from "../components/modules/MarketingJourneyPages.js";
import { EmailAnalytics } from "./EmailAnalytics.js";
import { EmailCampaigns } from "./EmailCampaigns.js";
import { EmailContacts } from "./EmailContacts.js";
import { EmailEditor } from "./EmailEditor.js";
import { useStudioI18n } from "./i18n.js";
import {
	getStudioDeliveries,
	getStudioDelivery,
	getStudioSettings,
	saveStudioSettings,
	type StudioDelivery,
	type StudioSettings,
} from "./service.js";

export default function EmailWorkspace({
	initialTab = "Templates",
	initialDeliverySource = "marketing",
}: {
	initialTab?: string;
	initialDeliverySource?: string;
}) {
	const { selectedProject } = useProjectSelection();
	const { t, locale } = useStudioI18n();
	const project = selectedProject?.id;
	const [tab, setTab] = useState(initialTab);
	const [templates, setTemplates] = useState<EmailTemplate[]>([]);
	const [settings, setSettings] = useState<StudioSettings>();
	const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [query, setQuery] = useState("");
	const [purpose, setPurpose] = useState("all");
	const [deleting, setDeleting] = useState<EmailTemplate | null>(null);
	const [deletingBusy, setDeletingBusy] = useState(false);
	const [editor, setEditor] = useState<{
		key: string;
		template?: EmailTemplate;
		document?: EmailDesign;
		name?: string;
	} | null>(null);
	const resourceId = useRef<string | null>(null);
	const selectedId = useRef(project);
	selectedId.current = project;
	const reload = useCallback(async () => {
		if (!project) return;
		setLoading(true);
		setError("");
		try {
			const [values, sends, configuration] = await Promise.all([
				getEmailTemplates(project),
				getEmailCampaigns(project),
				getStudioSettings(project),
			]);
			if (selectedId.current !== project) return;
			setTemplates(values);
			setCampaigns(sends);
			setSettings(configuration);
		} catch {
			if (selectedId.current === project) setError(t("Loading failed"));
		} finally {
			if (selectedId.current === project) setLoading(false);
		}
	}, [project, t]);
	useEffect(() => {
		setEditor(null);
		resourceId.current = null;
		void reload();
	}, [reload]);
	const save = useCallback(
		async (name: string, document: EmailDesign, expected: number) => {
			if (!project) throw new Error("PROJECT_REQUIRED");
			const rendered = renderEmailTranslation(document, document.source_locale);
			const payload = {
				name,
				subject: document.locales[document.source_locale]!.subject,
				content_html: rendered.html,
				content_text: rendered.text,
				template_type: ["campaign", "lifecycle"].includes(document.purpose)
					? "campaign"
					: document.purpose === "operator"
						? "system"
						: "transactional",
				studio_document: document,
				expected_revision: expected,
			};
			const result = resourceId.current
				? await updateEmailTemplate(project, resourceId.current, payload)
				: await createEmailTemplate(project, payload);
			if (selectedId.current !== project) return result;
			resourceId.current = result.id;
			setTemplates((values) => [result, ...values.filter((value) => value.id !== result.id)]);
			setEditor((value) => (value ? { ...value, template: result } : value));
			return result;
		},
		[project],
	);
	if (!project) return <p className="p-8">{t("Select a project")}</p>;
	if (editor?.template && !editor.template.studio_document)
		return (
			<LegacyEmailEditor
				key={`${project}:${editor.key}`}
				project={project}
				template={editor.template}
				onBack={() => {
					setEditor(null);
					void reload();
				}}
			/>
		);
	if (editor)
		return (
			<EmailEditor
				key={`${project}:${editor.key}`}
				project={project}
				template={editor.template}
				initialDesign={editor.document}
				initialName={editor.name}
				settings={settings}
				onSave={save}
				onBack={() => setEditor(null)}
			/>
		);
	const filtered = templates.filter(
		(value) =>
			value.name.toLowerCase().includes(query.toLowerCase()) &&
			(purpose === "all" || value.studio_document?.purpose === purpose),
	);
	const start = (document: EmailDesign) => {
		if (settings) {
			for (const language of settings.locales)
				if (!document.locales[language])
					document.locales[language] = createEmailDesign(language, document.purpose).locales[
						language
					]!;
			if (document.locales[settings.fallback_locale])
				document.fallback_locale = settings.fallback_locale;
		}
		resourceId.current = null;
		let number = 1;
		while (templates.some((item) => item.name === t("New message") + " " + number)) number++;
		setEditor({ key: crypto.randomUUID(), document, name: t("New message") + " " + number });
	};
	return (
		<div className="mx-auto w-full max-w-[1680px] space-y-6 p-6 text-kumo-default">
			<header className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-kumo-subtle">
						{selectedProject?.name ?? project}
					</p>
					<h1 className="text-3xl font-semibold tracking-tight">{t("Emails")}</h1>
					<p className="mt-2 text-sm text-kumo-subtle">
						{t("Create, localize and deliver messages that fit each customer.")}
					</p>
				</div>
				<Button variant="primary" onClick={() => start(createEmailDesign(locale))}>
					{t("Create a template")}
				</Button>
			</header>
			<nav aria-label={t("Emails")} className="flex flex-wrap gap-1 border-b border-kumo-line pb-3">
				{[
					"Overview",
					"Campaigns",
					"Automations",
					"Contacts",
					"Templates",
					"Deliveries",
					"Settings",
				].map((value) => (
					<Button
						key={value}
						variant={tab === value ? "secondary" : "ghost"}
						aria-pressed={tab === value}
						onClick={() => setTab(value)}
					>
						{t(value)}
					</Button>
				))}
			</nav>
			<Dialog.Root
				open={deleting !== null}
				onOpenChange={(open) => {
					if (!open && !deletingBusy) setDeleting(null);
				}}
			>
				<Dialog className="p-6">
					<Dialog.Title>
						{t("Delete template")} · {deleting?.name}
					</Dialog.Title>
					<Dialog.Description>
						{t("Scheduled campaigns retain their saved content.")}
					</Dialog.Description>
					<div className="mt-5 flex justify-end gap-2">
						<Button disabled={deletingBusy} onClick={() => setDeleting(null)}>
							{t("Cancel")}
						</Button>
						<Button
							variant="destructive"
							loading={deletingBusy}
							onClick={async () => {
								if (!deleting) return;
								setDeletingBusy(true);
								try {
									await deleteEmailTemplate(project, deleting.id);
									setDeleting(null);
									await reload();
								} catch {
									setError(t("Save failed"));
								} finally {
									setDeletingBusy(false);
								}
							}}
						>
							{t("Delete")}
						</Button>
					</div>
				</Dialog>
			</Dialog.Root>
			{error && (
				<div role="alert" className="flex items-center gap-3 text-kumo-danger">
					{error}
					<Button onClick={() => void reload()}>{t("Retry")}</Button>
				</div>
			)}
			{loading ? (
				<Loader />
			) : error ? null : (
				<>
					{tab === "Overview" && (
						<>
							<div className="grid gap-4 md:grid-cols-3">
								{[
									["Templates", templates.length],
									[
										"Ready translations",
										templates.reduce(
											(sum, item) =>
												sum +
												Object.values(item.studio_document?.locales ?? {}).filter(
													(translation) => translation.status === "approved",
												).length,
											0,
										),
									],
									[
										"Active campaigns",
										campaigns.filter((item) => ["running", "scheduled"].includes(item.status))
											.length,
									],
								].map(([label, value]) => (
									<div key={label} className="rounded-xl border border-kumo-line bg-kumo-base p-6">
										<p className="text-sm text-kumo-subtle">{t(String(label))}</p>
										<p className="mt-3 text-3xl font-semibold tabular-nums">{value}</p>
									</div>
								))}
							</div>
							<EmailAnalytics project={project} locales={settings?.locales ?? ["fr", "en"]} />
						</>
					)}
					{tab === "Templates" && (
						<>
							<div className="flex flex-wrap items-center justify-between gap-3">
								<div>
									<h2 className="text-lg font-semibold">{t("Choose a template")}</h2>
									<p className="mt-1 text-sm text-kumo-subtle">
										{t("Start from a purpose-built layout, then make it yours.")}
									</p>
								</div>
								<div className="flex gap-2">
									<Input
										aria-label={t("Search templates")}
										placeholder={t("Search templates")}
										value={query}
										onChange={(event) => setQuery(event.target.value)}
									/>
									<Select
										aria-label={t("Purpose")}
										value={purpose}
										onValueChange={(value) => value && setPurpose(value)}
										items={{
											all: t("All purposes"),
											...Object.fromEntries(EMAIL_PURPOSES.map((key) => [key, t(key)])),
										}}
									/>
								</div>
							</div>
							<div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
								{filtered.map((template) => (
									<article
										key={template.id}
										className="overflow-hidden rounded-xl border border-kumo-line bg-kumo-base"
									>
										<div
											className="pointer-events-none h-56 overflow-hidden bg-kumo-tint p-3"
											aria-hidden="true"
										>
											<iframe
												title={template.name}
												sandbox=""
												srcDoc={
													template.studio_document
														? renderEmailTranslation(
																template.studio_document,
																template.studio_document.source_locale,
																{ profile: { name: "Alex", action_url: "https://example.test" } },
															).html
														: (template.content_html ?? "")
												}
												tabIndex={-1}
												className="h-[450px] w-[200%] origin-top-left scale-50 border-0"
											/>
										</div>
										<div className="space-y-3 p-4">
											<div className="flex items-center justify-between">
												<h3 className="font-semibold">{template.name}</h3>
												<span className="text-xs text-kumo-subtle">
													{template.studio_document
														? t(template.studio_document.purpose)
														: template.template_type}
												</span>
											</div>
											<div className="flex flex-wrap gap-2">
												{Object.entries(template.studio_document?.locales ?? {}).map(
													([language, value]) => (
														<span
															key={language}
															className="rounded-md bg-kumo-tint px-2 py-1 text-xs"
														>
															{language.toUpperCase()} · {t(value.status)}
														</span>
													),
												)}
											</div>
											<Button
												className="w-full"
												onClick={() => {
													resourceId.current = template.id;
													setEditor({ key: template.id, template });
												}}
											>
												{t("Open editor")}
											</Button>
											<div className="flex gap-2">
												<Button
													size="sm"
													variant="ghost"
													onClick={async () => {
														if (template.studio_document) {
															start(structuredClone(template.studio_document));
															return;
														}
														try {
															let number = 1;
															while (
																templates.some(
																	(item) =>
																		item.name === template.name + " " + t("Copy") + " " + number,
																)
															)
																number++;
															await createEmailTemplate(project, {
																name: template.name + " " + t("Copy") + " " + number,
																template_type: template.template_type,
																subject: template.subject,
																content_html: template.content_html,
																content_text: template.content_text,
																content_markdown: template.content_markdown,
															});
															await reload();
														} catch {
															setError(t("Save failed"));
														}
													}}
												>
													{t("Duplicate")}
												</Button>
												<Button size="sm" variant="ghost" onClick={() => setDeleting(template)}>
													{t("Delete")}
												</Button>
											</div>
										</div>
									</article>
								))}
							</div>
							{filtered.length === 0 && (
								<p className="py-6 text-kumo-subtle">
									{t(templates.length ? "No matching templates" : "No templates yet")}
								</p>
							)}
							<div className="border-t border-kumo-line pt-6">
								<p className="mb-4 text-sm font-semibold">{t("Use this layout")}</p>
								<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
									{(
										[
											"campaign",
											"lifecycle",
											"billing",
											"notification",
											"authentication",
											"support",
										] as const
									)
										.filter((kind) => purpose === "all" || kind === purpose)
										.map((kind) => {
											const design = createEmailDesign(locale, kind);
											const preview = renderEmailTranslation(design, locale, {
												profile: { name: "Alex", action_url: "https://example.test" },
												event: {
													plan_name: t("Example plan"),
													amount: 29,
													paid_at: new Date().toISOString(),
													result_name: t("Example result"),
													reply: t("Example reply"),
												},
												currency: "CHF",
												unsubscribe_url: "https://example.test/unsubscribe",
											});
											return (
												<article
													key={kind}
													className="overflow-hidden rounded-xl border border-kumo-line bg-kumo-base"
												>
													<div
														className="pointer-events-none h-52 overflow-hidden bg-kumo-tint p-3"
														aria-hidden="true"
													>
														<iframe
															title={t(kind)}
															tabIndex={-1}
															sandbox=""
															srcDoc={preview.html}
															className="h-[430px] w-[200%] origin-top-left scale-50 border-0"
														/>
													</div>
													<div className="space-y-3 p-4">
														<h3 className="font-semibold">{t(kind)}</h3>
														<Button className="w-full" onClick={() => start(design)}>
															{t("Use this layout")}
														</Button>
													</div>
												</article>
											);
										})}
								</div>
							</div>
						</>
					)}
					{tab === "Contacts" && (
						<EmailContacts key={project} project={project} locales={settings?.locales} />
					)}
					{tab === "Campaigns" && (
						<EmailCampaigns key={project} project={project} templates={templates} />
					)}
					{tab === "Automations" && <MarketingJourneysPage />}
					{tab === "Deliveries" && (
						<Deliveries key={project} project={project} initialSource={initialDeliverySource} />
					)}
					{tab === "Settings" && (
						<>
							<LanguageSettings key={project} project={project} onSaved={setSettings} />
							<EmailAdministration />
						</>
					)}
				</>
			)}
		</div>
	);
}

function LegacyEmailEditor({
	project,
	template,
	onBack,
}: {
	project: string;
	template: EmailTemplate;
	onBack: () => void;
}) {
	const { t } = useStudioI18n();
	const [value, setValue] = useState(template);
	const [message, setMessage] = useState("");
	const [busy, setBusy] = useState(false);
	return (
		<section className="space-y-5 p-6">
			<div className="flex justify-between">
				<Button onClick={onBack}>{t("Back")}</Button>
				<Button
					variant="primary"
					disabled={busy}
					onClick={async () => {
						setBusy(true);
						try {
							await updateEmailTemplate(project, template.id, {
								name: value.name,
								subject: value.subject,
								content_html: value.content_html,
								content_text: value.content_text,
							});
							setMessage(t("Saved"));
						} catch {
							setMessage(t("Save failed"));
						} finally {
							setBusy(false);
						}
					}}
				>
					{t("Save")}
				</Button>
			</div>
			<h2 className="text-xl font-semibold">{t("HTML template")}</h2>
			<p role="status">{message}</p>
			<div className="grid gap-6 lg:grid-cols-2">
				<div className="space-y-4">
					<Input
						label={t("Template name")}
						value={value.name}
						onChange={(event) => setValue({ ...value, name: event.target.value })}
					/>
					<Input
						label={t("Subject")}
						value={value.subject ?? ""}
						onChange={(event) => setValue({ ...value, subject: event.target.value })}
					/>
					<InputArea
						label="HTML"
						value={value.content_html ?? ""}
						onChange={(event) => setValue({ ...value, content_html: event.target.value })}
					/>
					<InputArea
						label={t("Text")}
						value={value.content_text ?? ""}
						onChange={(event) => setValue({ ...value, content_text: event.target.value })}
					/>
				</div>
				<iframe
					title={t("Email preview")}
					sandbox=""
					className="h-[680px] w-full border-0"
					srcDoc={value.content_html ?? ""}
				/>
			</div>
		</section>
	);
}

function LanguageSettings({
	project,
	onSaved,
}: {
	project: string;
	onSaved: (settings: StudioSettings) => void;
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
		<section className="space-y-4 rounded-xl border border-kumo-line bg-kumo-base p-6">
			<h2 className="text-lg font-semibold">{t("Languages")}</h2>
			{message && <p role="status">{message}</p>}
			{value && (
				<>
					<div className="grid gap-4 md:grid-cols-3">
						<Input
							label={t("Enabled languages")}
							value={value.locales.join(", ")}
							onChange={(event) =>
								setValue({
									...value,
									locales: event.target.value.split(",").map((item) => item.trim()),
								})
							}
						/>
						<Input
							label={t("Fallback language")}
							value={value.fallback_locale}
							onChange={(event) => setValue({ ...value, fallback_locale: event.target.value })}
						/>
						<Input
							label={t("Marketing frequency (hours)")}
							type="number"
							min={0}
							max={720}
							value={value.marketing_frequency_hours}
							onChange={(event) =>
								setValue({ ...value, marketing_frequency_hours: Number(event.target.value) })
							}
						/>
					</div>
					<InputArea
						label={t("Brand glossary")}
						description={t("One term per line")}
						value={value.glossary.join("\n")}
						onChange={(event) => setValue({ ...value, glossary: event.target.value.split("\n") })}
					/>
					<div className="space-y-3 border-t border-kumo-line pt-4">
						<h3 className="font-semibold">{t("Translation provider")}</h3>
						<Input
							label={t("Responses API endpoint")}
							placeholder="https://api.openai.com/v1/responses"
							value={value.ai_provider?.url ?? ""}
							onChange={(event) =>
								setValue({
									...value,
									ai_provider: {
										...value.ai_provider,
										url: event.target.value,
										model: value.ai_provider?.model ?? "",
									},
								})
							}
						/>
						<Input
							label={t("Model")}
							value={value.ai_provider?.model ?? ""}
							onChange={(event) =>
								setValue({
									...value,
									ai_provider: {
										...value.ai_provider,
										url: value.ai_provider?.url ?? "",
										model: event.target.value,
									},
								})
							}
						/>
						<Input
							type="password"
							label={t("API key")}
							description={
								value.ai_provider?.configured ? t("A key is already configured.") : undefined
							}
							value={value.ai_provider?.api_key ?? ""}
							onChange={(event) =>
								setValue({
									...value,
									ai_provider: {
										...value.ai_provider,
										url: value.ai_provider?.url ?? "",
										model: value.ai_provider?.model ?? "",
										api_key: event.target.value,
									},
								})
							}
						/>
						{value.ai_provider && (
							<Button variant="ghost" onClick={() => setValue({ ...value, ai_provider: null })}>
								{t("Remove provider")}
							</Button>
						)}
					</div>
					<Button
						variant="primary"
						onClick={async () => {
							try {
								const saved = await saveStudioSettings(project, value);
								setValue(saved);
								onSaved(saved);
								setMessage(t("Saved"));
							} catch {
								setMessage(t("Save failed"));
							}
						}}
					>
						{t("Save")}
					</Button>
				</>
			)}
		</section>
	);
}

function Deliveries({ project, initialSource }: { project: string; initialSource: string }) {
	const { t } = useStudioI18n();
	const [source, setSource] = useState(initialSource);
	const [values, setValues] = useState<StudioDelivery[]>([]);
	const [query, setQuery] = useState("");
	const [cursor, setCursor] = useState<string>();
	const [selected, setSelected] = useState<StudioDelivery>();
	const [error, setError] = useState("");
	useEffect(() => {
		if (source !== "marketing") return;
		let active = true;
		const timer = setTimeout(() => {
			void getStudioDeliveries(project, query ? { q: query } : {}).then(
				(result) => {
					if (active) {
						setValues(result.items);
						setCursor(result.nextCursor);
					}
				},
				() => {
					if (active) setError(t("Loading failed"));
				},
			);
		}, 250);
		return () => {
			active = false;
			clearTimeout(timer);
		};
	}, [project, query, t, source]);
	const sources = (
		<div className="flex gap-2">
			<Button
				variant={source === "marketing" ? "secondary" : "ghost"}
				onClick={() => setSource("marketing")}
			>
				{t("Campaigns and journeys")}
			</Button>
			<Button
				variant={source === "transactional" ? "secondary" : "ghost"}
				onClick={() => setSource("transactional")}
			>
				{t("System and transactional emails")}
			</Button>
		</div>
	);
	if (source === "transactional")
		return (
			<section className="space-y-4">
				{sources}
				<EmailMessages project={project} />
			</section>
		);
	return (
		<section className="space-y-4">
			{sources}
			<Input
				aria-label={t("Recipient")}
				placeholder={t("Recipient")}
				value={query}
				onChange={(event) => setQuery(event.target.value)}
			/>
			{error && <p role="alert">{error}</p>}
			<div className="overflow-auto rounded-xl border border-kumo-line">
				<table className="w-full text-start text-sm">
					<thead className="bg-kumo-tint">
						<tr>
							{["Recipient", "Subject", "Language", "Status"].map((key) => (
								<th key={key} className="p-4 text-start font-medium">
									{t(key)}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{values.map((value) => (
							<tr key={value.delivery_id} className="border-t border-kumo-line">
								<td className="p-4">{value.recipient_email}</td>
								<td>
									<Button
										variant="ghost"
										onClick={async () => {
											try {
												setSelected(await getStudioDelivery(project, value.delivery_id));
											} catch {
												setError(t("Loading failed"));
											}
										}}
									>
										{value.subject ?? t(value.reason)}
									</Button>
								</td>
								<td>{value.locale ?? "—"}</td>
								<td>{value.status ?? t(value.reason)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{!values.length && <p>{t("No deliveries yet")}</p>}
			{cursor && (
				<Button
					onClick={async () => {
						const result = await getStudioDeliveries(project, {
							cursor,
							...(query ? { q: query } : {}),
						});
						setValues((items) => [...items, ...result.items]);
						setCursor(result.nextCursor);
					}}
				>
					{t("Load more")}
				</Button>
			)}
			{selected && (
				<div className="space-y-3 rounded-xl border border-kumo-line p-5">
					<p>
						{selected.subject} · {selected.locale} · {t(selected.reason)}
					</p>
					{selected.content_html ? (
						<iframe
							title={t("View message")}
							sandbox=""
							srcDoc={selected.content_html ?? ""}
							className="h-[600px] w-full border-0"
						/>
					) : (
						<p className="p-6 text-sm text-kumo-subtle">{t("Message body unavailable")}</p>
					)}
				</div>
			)}
		</section>
	);
}
