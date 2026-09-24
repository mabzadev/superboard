import {
	createEmailDesign,
	renderEmailTranslation,
	type EmailDesign,
} from "@superboard/contracts/email-studio";
import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { Button, Input, Loader } from "@superboard/front-ui/kumo";
import { useCallback, useEffect, useRef, useState } from "react";

import {
	createEmailTemplate,
	getEmailTemplates,
	updateEmailTemplate,
	type EmailTemplate,
} from "../api/marketing/marketingService.js";
import { EmailAnalytics } from "./EmailAnalytics.js";
import { EmailCampaigns } from "./EmailCampaigns.js";
import { EmailEditor } from "./EmailEditor.js";
import { EmailItemDeliveries } from "./EmailItemDeliveries.js";
import { EmailItemTriggers } from "./EmailItemTriggers.js";
import { useStudioI18n } from "./i18n.js";
import { useCommunicationItem } from "./ItemNavigation.js";
import { getStudioSettings, type StudioSettings } from "./service.js";

export default function EmailItemsPage({ kind }: { kind: "campaign" | "transactional" }) {
	const { selectedProject } = useProjectSelection();
	return selectedProject ? (
		<EmailItems key={`${selectedProject.id}:${kind}`} project={selectedProject.id} kind={kind} />
	) : null;
}

function EmailItems({ project, kind }: { project: string; kind: "campaign" | "transactional" }) {
	const { t, locale } = useStudioI18n();
	const { itemId, section, select: selectItem } = useCommunicationItem();
	const pendingSave = useRef<(() => Promise<boolean>) | null>(null);
	const registerSave = useCallback((save: (() => Promise<boolean>) | null) => {
		pendingSave.current = save;
	}, []);
	const select = (id: string, nextSection = "content") => {
		if (!pendingSave.current) {
			selectItem(id, nextSection);
			return;
		}
		pendingSave
			.current()
			.then((allowed) => {
				if (allowed) selectItem(id, nextSection);
			})
			.catch(() => {
				setError(t("Save failed"));
			});
	};
	const [items, setItems] = useState<EmailTemplate[]>([]);
	const [settings, setSettings] = useState<StudioSettings>();
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [adding, setAdding] = useState(false);
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const title = kind === "campaign" ? "Campaign email" : "Transactional email";
	const load = useCallback(async () => {
		setError("");
		try {
			const [templates, configuration] = await Promise.all([
				getEmailTemplates(project),
				getStudioSettings(project),
			]);
			setItems(
				templates.filter((item) =>
					kind === "campaign"
						? item.template_type === "campaign"
						: item.template_type !== "campaign",
				),
			);
			setSettings(configuration);
		} catch {
			setError(t("Loading failed"));
		} finally {
			setLoading(false);
		}
	}, [project, kind, t]);
	useEffect(() => {
		let active = true;
		void Promise.all([getEmailTemplates(project), getStudioSettings(project)]).then(
			([templates, configuration]) => {
				if (!active) return;
				setItems(
					templates.filter((item) =>
						kind === "campaign"
							? item.template_type === "campaign"
							: item.template_type !== "campaign",
					),
				);
				setSettings(configuration);
				setLoading(false);
			},
			() => {
				if (active) {
					setError(t("Loading failed"));
					setLoading(false);
				}
			},
		);
		return () => {
			active = false;
		};
	}, [project, kind, t]);
	const selected = items.find((item) => item.id === itemId);
	const save = useCallback(
		async (nextName: string, document: EmailDesign, revision: number) => {
			const rendered = renderEmailTranslation(document, document.source_locale);
			const saved = await updateEmailTemplate(project, itemId, {
				name: nextName,
				template_type: kind,
				subject: document.locales[document.source_locale]?.subject,
				content_html: rendered.html,
				content_text: rendered.text,
				studio_document: document,
				expected_revision: revision,
			});
			setItems((values) => values.map((item) => (item.id === saved.id ? saved : item)));
			return saved;
		},
		[project, itemId, kind, setItems],
	);
	const sections = [
		"content",
		"triggers",
		...(kind === "campaign" ? ["sending"] : []),
		"statistics",
	];
	return (
		<section className="ds-page space-y-5">
			<header className="flex flex-wrap items-center justify-between gap-3">
				<div>
					{itemId && (
						<Button
							variant="ghost"
							onClick={() => {
								select("");
							}}
						>
							{t("Back to list")}
						</Button>
					)}
					<h1 className="ds-page-title">{selected?.name ?? t(title)}</h1>
					<p className="ds-page-description">
						{t(
							itemId
								? "Configure this message, its triggers and its results."
								: "Add an email, then configure its content and triggers.",
						)}
					</p>
				</div>
				{!itemId && (
					<Button
						variant="primary"
						onClick={() => {
							setAdding(true);
						}}
					>
						{t("Add email")}
					</Button>
				)}
			</header>
			{error && (
				<div role="alert">
					{error} <Button onClick={() => void load()}>{t("Retry")}</Button>
				</div>
			)}
			{loading ? (
				<Loader />
			) : itemId ? (
				selected ? (
					<>
						<nav
							className="flex flex-wrap gap-2 border-b border-kumo-line pb-3"
							aria-label={t("Message settings")}
						>
							{sections.map((value) => (
								<Button
									key={value}
									variant={section === value ? "secondary" : "ghost"}
									aria-pressed={section === value}
									onClick={() => {
										select(itemId, value);
									}}
								>
									{t(
										value === "sending"
											? "One-off sends"
											: value === "content"
												? "Content"
												: value === "triggers"
													? "Triggers"
													: "Statistics",
									)}
								</Button>
							))}
						</nav>
						{section === "content" &&
							(selected.studio_document ? (
								<EmailEditor
									key={selected.id}
									project={project}
									template={selected}
									settings={settings}
									purposeGroup={kind}
									registerSave={registerSave}
									onSave={save}
									onBack={() => {
										select("");
									}}
								/>
							) : (
								<LegacyContent key={selected.id} project={project} item={selected} onSaved={load} />
							))}
						{section === "triggers" && (
							<EmailItemTriggers key={selected.id} project={project} template={selected} />
						)}
						{section === "sending" && kind === "campaign" && (
							<EmailCampaigns project={project} templates={[selected]} templateId={selected.id} />
						)}
						{section === "statistics" && (
							<>
								<EmailAnalytics
									project={project}
									locales={settings?.locales ?? [locale]}
									templateId={selected.id}
								/>
								<EmailItemDeliveries key={selected.id} project={project} templateId={selected.id} />
							</>
						)}
					</>
				) : (
					<p role="alert">{t("Message not found")}</p>
				)
			) : (
				<>
					{adding && (
						<form
							className="flex max-w-xl flex-wrap items-end gap-3 rounded-lg border border-kumo-line p-5"
							onSubmit={(event) => {
								(async () => {
									event.preventDefault();
									if (busy || !name.trim()) return;
									setBusy(true);
									setError("");
									try {
										const document = createEmailDesign(
											locale,
											kind === "campaign" ? "campaign" : "notification",
										);
										for (const language of settings?.locales ?? [])
											if (!document.locales[language]) {
												const translation = createEmailDesign(language, document.purpose).locales[
													language
												];
												if (translation) document.locales[language] = translation;
											}
										const created = await createEmailTemplate(project, {
											name: name.trim(),
											template_type: kind,
											studio_document: document,
											expected_revision: 0,
										});
										setItems((values) => [created, ...values]);
										setAdding(false);
										setName("");
										select(created.id);
									} catch {
										setError(t("Save failed"));
									} finally {
										setBusy(false);
									}
								})().catch(() => {
									setError(t("Save failed"));
								});
							}}
						>
							<Input
								label={t("Name")}
								value={name}
								onChange={(event) => {
									setName(event.target.value);
								}}
								required
								maxLength={255}
							/>
							<Button type="submit" variant="primary" loading={busy}>
								{t("Create")}
							</Button>
							<Button
								onClick={() => {
									setAdding(false);
								}}
							>
								{t("Cancel")}
							</Button>
						</form>
					)}
					<div className="divide-y divide-kumo-line rounded-lg border border-kumo-line">
						{items.map((item) => (
							<div key={item.id} className="flex items-center justify-between gap-4 p-5">
								<div>
									<Button
										variant="ghost"
										onClick={() => {
											select(item.id);
										}}
									>
										{item.name}
									</Button>
									<p className="text-sm text-kumo-subtle">{item.subject}</p>
								</div>
								<span className="text-sm text-kumo-subtle">
									{t(item.published_revision ? "Published" : "draft")}
								</span>
							</div>
						))}
						{!items.length && <p className="p-6 text-kumo-subtle">{t("No emails yet")}</p>}
					</div>
				</>
			)}
		</section>
	);
}

function LegacyContent({
	project,
	item,
	onSaved,
}: {
	project: string;
	item: EmailTemplate;
	onSaved: () => Promise<void>;
}) {
	const { t } = useStudioI18n();
	const [name, setName] = useState(item.name);
	const [subject, setSubject] = useState(item.subject ?? "");
	const [html, setHtml] = useState(item.content_html ?? "");
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("");
	return (
		<form
			className="grid gap-4"
			onSubmit={(event) => {
				(async () => {
					event.preventDefault();
					setBusy(true);
					setMessage("");
					try {
						await updateEmailTemplate(project, item.id, { name, subject, content_html: html });
						await onSaved();
						setMessage(t("Saved"));
					} catch {
						setMessage(t("Save failed"));
					} finally {
						setBusy(false);
					}
				})().catch(() => {
					setMessage(t("Save failed"));
				});
			}}
		>
			<Input
				label={t("Name")}
				value={name}
				onChange={(event) => {
					setName(event.target.value);
				}}
				required
			/>
			<Input
				label={t("Subject")}
				value={subject}
				onChange={(event) => {
					setSubject(event.target.value);
				}}
			/>
			<label>
				{t("HTML template")}
				<textarea
					className="min-h-64 w-full rounded border border-kumo-line p-3"
					value={html}
					onChange={(event) => {
						setHtml(event.target.value);
					}}
				/>
			</label>
			<p role="status">{message}</p>
			<Button type="submit" loading={busy}>
				{t("Save")}
			</Button>
		</form>
	);
}
