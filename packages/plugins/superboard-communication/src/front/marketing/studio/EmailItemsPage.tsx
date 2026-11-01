import {
	createEmailDesign,
	renderEmailTranslation,
	type EmailDesign,
} from "@superboard/contracts/email-studio";
import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { Button, Dialog, Input, Loader, Select } from "@superboard/front-ui/kumo";
import { moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import { useRouter, useSearchParams } from "@superboard/front-ui/navigation";
import { SectionNavigation } from "@superboard/front-ui/section-navigation.js";
import { EmptyState } from "@superboard/front-ui/ui/widgets.js";
import { useCallback, useEffect, useRef, useState } from "react";

import {
	createEmailTemplate,
	deleteEmailTemplate,
	getEmailTemplates,
	sendTransactionalEmail,
	updateEmailTemplate,
	type EmailTemplate,
} from "../api/marketing/marketingService.js";
import { applyBrandKit } from "./brand.js";
import { EmailAnalytics } from "./EmailAnalytics.js";
import { EmailCampaigns } from "./EmailCampaigns.js";
import { EmailEditor } from "./EmailEditor.js";
import { EmailItemDeliveries } from "./EmailItemDeliveries.js";
import { EmailItemTriggers } from "./EmailItemTriggers.js";
import { getBrandKit } from "./growth-service.js";
import { useStudioI18n } from "./i18n.js";
import { setLeaveGuard, useCommunicationItem } from "./ItemNavigation.js";
import { getStudioSenders, getStudioSettings, type StudioSettings } from "./service.js";
import { useWorkspaceTab } from "./workspace-navigation.js";

export type EmailGroup = "campaign" | "transactional" | "automated";
export type EmailFilter = "all" | EmailGroup;

const groups: Record<
	EmailGroup,
	{ label: string; templateType: string; purpose: EmailDesign["purpose"] }
> = {
	campaign: { label: "Campaign", templateType: "campaign", purpose: "campaign" },
	automated: { label: "Automated", templateType: "campaign", purpose: "lifecycle" },
	transactional: { label: "Transactional", templateType: "transactional", purpose: "notification" },
};

function isEmailFilter(value: string | null): value is EmailFilter {
	return value === "all" || (value !== null && Object.hasOwn(groups, value));
}

/** Campaign emails are broadcasts, automated ones are lifecycle journeys, the rest is essential mail. */
export function emailGroup(item: EmailTemplate): EmailGroup {
	if (item.template_type !== "campaign") return "transactional";
	return item.studio_document?.purpose === "lifecycle" ? "automated" : "campaign";
}

export default function EmailItemsPage({ defaultFilter = "all" }: { defaultFilter?: EmailFilter }) {
	const { selectedProject } = useProjectSelection();
	return selectedProject ? (
		<EmailItems
			key={selectedProject.id}
			project={selectedProject.id}
			defaultFilter={defaultFilter}
		/>
	) : null;
}

function EmailItems({ project, defaultFilter }: { project: string; defaultFilter: EmailFilter }) {
	const { t, locale } = useStudioI18n();
	const params = useSearchParams();
	const router = useRouter();
	const workspace = useWorkspaceTab();
	const requestedFilter = params.get("kind");
	const filter: EmailFilter = isEmailFilter(requestedFilter) ? requestedFilter : defaultFilter;
	const { itemId, section, select: selectItem } = useCommunicationItem();
	const pendingSave = useRef<(() => Promise<boolean>) | null>(null);
	const registerSave = useCallback((save: (() => Promise<boolean>) | null) => {
		pendingSave.current = save;
		setLeaveGuard(save);
	}, []);
	useEffect(
		() => () => {
			setLeaveGuard(null);
		},
		[],
	);
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
	const [hasSender, setHasSender] = useState(true);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [adding, setAdding] = useState(false);
	const [name, setName] = useState("");
	const [purpose, setPurpose] = useState<EmailGroup>(filter === "all" ? "campaign" : filter);
	const [query, setQuery] = useState("");
	const [deleting, setDeleting] = useState(false);
	const [busy, setBusy] = useState(false);
	const load = useCallback(async () => {
		setError("");
		try {
			const [templates, configuration] = await Promise.all([
				getEmailTemplates(project),
				getStudioSettings(project),
			]);
			setItems(templates);
			setSettings(configuration);
		} catch {
			setError(t("Loading failed"));
		} finally {
			setLoading(false);
		}
	}, [project, t]);
	useEffect(() => {
		let active = true;
		void Promise.all([getEmailTemplates(project), getStudioSettings(project)]).then(
			([templates, configuration]) => {
				if (!active) return;
				setItems(templates);
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
		// A missing sender only changes guidance; an unreachable Email service keeps the list usable.
		void getStudioSenders(project).then(
			(senders) => {
				if (active) setHasSender(senders.length > 0);
			},
			() => undefined,
		);
		return () => {
			active = false;
		};
	}, [project, t]);
	const selected = items.find((item) => item.id === itemId);
	const selectedGroup = selected ? emailGroup(selected) : undefined;
	const selectedType = selected?.template_type;
	const save = useCallback(
		async (nextName: string, document: EmailDesign, revision: number) => {
			const rendered = renderEmailTranslation(document, document.source_locale);
			const saved = await updateEmailTemplate(project, itemId, {
				name: nextName,
				template_type: selectedType,
				subject: document.locales[document.source_locale]?.subject,
				content_html: rendered.html,
				content_text: rendered.text,
				studio_document: document,
				expected_revision: revision,
			});
			setItems((values) => values.map((item) => (item.id === saved.id ? saved : item)));
			return saved;
		},
		[project, itemId, selectedType, setItems],
	);
	const setFilter = (value: EmailFilter) => {
		const url = new URL(window.location.href);
		url.searchParams.set("kind", value);
		router.replace(url.pathname + url.search);
		if (value !== "all") setPurpose(value);
	};
	const sections = [
		"content",
		"triggers",
		...(selectedGroup === "automated" ? [] : ["sending"]),
		"statistics",
	];
	const visible = items.filter(
		(item) =>
			(filter === "all" || emailGroup(item) === filter) &&
			`${item.name} ${item.subject ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()),
	);
	const configureSender = () => void workspace.open("senders");
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
					<h1 className="ds-page-title">{selected?.name ?? t("Emails")}</h1>
					<p className="ds-page-description">
						{t(
							itemId
								? "Configure this message, its triggers and its results."
								: "Campaigns, automated and transactional emails in one place.",
						)}
					</p>
				</div>
				{itemId ? (
					selected && (
						<Button
							variant="secondary-destructive"
							onClick={() => {
								setDeleting(true);
							}}
						>
							{t("Delete email")}
						</Button>
					)
				) : (
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
			<SectionNavigation />
			{error && (
				<div role="alert">
					{error} <Button onClick={() => void load()}>{t("Retry")}</Button>
				</div>
			)}
			{!loading && !hasSender && (
				<div
					role="status"
					className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-kumo-line bg-kumo-tint p-4"
				>
					<p className="text-sm">
						{t("Configure a sender first: emails cannot be delivered without a sender identity.")}
					</p>
					<Button size="sm" onClick={configureSender}>
						{t("Configure a sender")}
					</Button>
				</div>
			)}
			<Dialog.Root
				open={deleting}
				onOpenChange={(open) => {
					if (!open && !busy) setDeleting(false);
				}}
			>
				<Dialog className="p-6">
					<Dialog.Title>
						{t("Delete email")} · {selected?.name}
					</Dialog.Title>
					<Dialog.Description>
						{t("Scheduled campaigns retain their saved content.")}
					</Dialog.Description>
					<div className="mt-5 flex justify-end gap-2">
						<Button
							disabled={busy}
							onClick={() => {
								setDeleting(false);
							}}
						>
							{t("Cancel")}
						</Button>
						<Button
							variant="destructive"
							loading={busy}
							onClick={() => {
								if (!selected) return;
								setBusy(true);
								deleteEmailTemplate(project, selected.id)
									.then(() => {
										setItems((values) => values.filter((item) => item.id !== selected.id));
										setDeleting(false);
										pendingSave.current = null;
										setLeaveGuard(null);
										selectItem("");
									})
									.catch(() => {
										setError(t("Save failed"));
									})
									.finally(() => {
										setBusy(false);
									});
							}}
						>
							{t("Delete")}
						</Button>
					</div>
				</Dialog>
			</Dialog.Root>
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
											? "Sends"
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
									purposeGroup={
										selected.template_type === "campaign" ? "campaign" : "transactional"
									}
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
							<EmailItemTriggers
								key={selected.id}
								project={project}
								template={selected}
								templates={items}
							/>
						)}
						{section === "sending" && selectedGroup === "campaign" && (
							<EmailCampaigns
								project={project}
								templates={[selected]}
								templateId={selected.id}
								onConfigureSender={configureSender}
							/>
						)}
						{section === "sending" && selectedGroup === "transactional" && (
							<TransactionalSend key={selected.id} project={project} template={selected} />
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
							className="flex max-w-3xl flex-wrap items-end gap-3 rounded-lg border border-kumo-line p-5"
							onSubmit={(event) => {
								(async () => {
									event.preventDefault();
									if (busy || !name.trim()) return;
									setBusy(true);
									setError("");
									try {
										const draft = createEmailDesign(locale, groups[purpose].purpose);
										for (const language of settings?.locales ?? [])
											if (!draft.locales[language]) {
												const translation = createEmailDesign(language, draft.purpose).locales[
													language
												];
												if (translation) draft.locales[language] = translation;
											}
										// The project brand kit gives new emails their default look; a missing kit keeps Studio defaults.
										const brand = await getBrandKit(project).catch(() => null);
										const document = brand ? applyBrandKit(draft, brand) : draft;
										const created = await createEmailTemplate(project, {
											name: name.trim(),
											template_type: groups[purpose].templateType,
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
							<Select
								label={t("Purpose")}
								value={purpose}
								onValueChange={(value) => {
									if (value && Object.hasOwn(groups, value)) setPurpose(value);
								}}
								items={{
									campaign: t("Campaign: one-off send to a list or segment"),
									automated: t("Automated: sent by a journey or trigger"),
									transactional: t("Transactional: receipts, alerts and account emails"),
								}}
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
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div className="flex flex-wrap gap-1" role="group" aria-label={t("Email type")}>
							{(["all", "campaign", "transactional", "automated"] as const).map((value) => (
								<Button
									key={value}
									size="sm"
									variant={filter === value ? "secondary" : "ghost"}
									aria-pressed={filter === value}
									onClick={() => {
										setFilter(value);
									}}
								>
									{t(value === "all" ? "All" : groups[value].label)} (
									{value === "all"
										? items.length
										: items.filter((item) => emailGroup(item) === value).length}
									)
								</Button>
							))}
						</div>
						<Input
							aria-label={t("Search emails")}
							placeholder={t("Search emails")}
							value={query}
							onChange={(event) => {
								setQuery(event.target.value);
							}}
						/>
					</div>
					{visible.length ? (
						<div className="divide-y divide-kumo-line rounded-lg border border-kumo-line">
							{visible.map((item) => (
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
										{t(groups[emailGroup(item)].label)} ·{" "}
										{t(item.published_revision ? "Published" : "draft")}
									</span>
								</div>
							))}
						</div>
					) : items.length ? (
						<p className="p-6 text-kumo-subtle">{t("No emails match this filter")}</p>
					) : (
						<EmptyState
							title={t("No emails yet")}
							description={t(
								hasSender
									? "Create a campaign, an automated or a transactional email to get started."
									: "Configure a sender first, then create your first email.",
							)}
							action={
								hasSender ? (
									<Button
										variant="primary"
										onClick={() => {
											setAdding(true);
										}}
									>
										{t("Add email")}
									</Button>
								) : (
									<Button variant="primary" onClick={configureSender}>
										{t("Configure a sender")}
									</Button>
								)
							}
						/>
					)}
				</>
			)}
		</section>
	);
}

/** Sends one published transactional email to a single recipient, for checks and manual resends. */
function TransactionalSend({ project, template }: { project: string; template: EmailTemplate }) {
	const { t, locale } = useStudioI18n();
	const [recipient, setRecipient] = useState("");
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("");
	return (
		<form
			className="max-w-xl space-y-4 rounded-lg border border-kumo-line p-5"
			onSubmit={(event) => {
				event.preventDefault();
				if (busy || !recipient.trim()) return;
				setBusy(true);
				setMessage("");
				sendTransactionalEmail(project, { template_id: template.id, recipient: recipient.trim() })
					.then(() => {
						setMessage(t("Email queued for delivery"));
						setRecipient("");
					})
					.catch((cause: unknown) => {
						setMessage(moduleErrorMessage(cause, locale));
					})
					.finally(() => {
						setBusy(false);
					});
			}}
		>
			<div>
				<h2 className="text-lg font-semibold">{t("Send to one recipient")}</h2>
				<p className="text-sm text-kumo-subtle">
					{t(
						"Sends the published version now. Your application normally sends this email through its trigger or the API.",
					)}
				</p>
			</div>
			<Input
				type="email"
				label={t("Recipient")}
				value={recipient}
				required
				onChange={(event) => {
					setRecipient(event.target.value);
				}}
			/>
			<p role="status">{message}</p>
			<Button type="submit" variant="primary" loading={busy}>
				{t("Send now")}
			</Button>
		</form>
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
