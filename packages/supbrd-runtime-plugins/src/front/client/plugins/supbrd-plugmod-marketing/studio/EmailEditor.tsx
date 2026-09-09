import {
	canonicalEmailLocale,
	createEmailDesign,
	EMAIL_PURPOSES,
	renderEmailTranslation,
	resolveEmailMessage,
	type EmailBlock,
	type EmailDesign,
	type EmailRenderContext,
	type EmailTranslation,
} from "@superboard/contracts/email-studio";
import { Button, Input, InputArea, Select } from "@superboard/front-ui/kumo";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { EmailTemplate } from "../source/api/marketing/marketingService.js";
import { useStudioI18n } from "./i18n.js";
import {
	getEmailVersions,
	publishStudioTemplate,
	testStudioEmail,
	translateStudioEmail,
	getSharedEmailBlocks,
	createSharedEmailBlock,
	updateSharedEmailBlock,
	getSharedEmailBlockUsage,
	applySharedEmailBlock,
	type SharedEmailBlock,
	type StudioSettings,
	type EmailVersion,
} from "./service.js";

type Save = (
	name: string,
	document: EmailDesign,
	expectedRevision: number,
) => Promise<EmailTemplate>;
const toolsScript = `<script>document.addEventListener('click',e=>{e.preventDefault();const b=e.target.closest('[data-email-block]');if(b)parent.postMessage({studio:'select',id:b.dataset.emailBlock},'*')});document.addEventListener('dblclick',e=>{const b=e.target.closest('[data-email-block]');const n=e.target.closest('h1,p,a');if(!b||!n)return;n.contentEditable='true';n.focus();n.addEventListener('blur',()=>{n.contentEditable='false';parent.postMessage({studio:'edit',id:b.dataset.emailBlock,text:n.innerText},'*')},{once:true})})<\/script>`;
const blockTypes: EmailBlock["type"][] = [
	"heading",
	"text",
	"image",
	"button",
	"divider",
	"spacer",
	"columns",
];

function modifyBlocks(
	blocks: EmailBlock[],
	id: string,
	update: (block: EmailBlock) => EmailBlock,
): EmailBlock[] {
	return blocks.map((block) =>
		block.id === id
			? update(block)
			: block.columns
				? { ...block, columns: block.columns.map((column) => modifyBlocks(column, id, update)) }
				: block,
	);
}
function findBlock(blocks: EmailBlock[], id: string): EmailBlock | undefined {
	for (const block of blocks) {
		if (block.id === id) return block;
		const nested = block.columns?.flatMap((column) => column);
		if (nested) {
			const found = findBlock(nested, id);
			if (found) return found;
		}
	}
	return undefined;
}

export function EmailEditor({
	project,
	template,
	initialDesign,
	initialName,
	settings,
	onSave,
	onBack,
}: {
	project: string;
	template?: EmailTemplate;
	initialDesign?: EmailDesign;
	initialName?: string;
	settings?: StudioSettings;
	onSave: Save;
	onBack: () => void;
}) {
	const { t, locale } = useStudioI18n();
	const initial = template?.studio_document ?? initialDesign ?? createEmailDesign(locale);
	const [document, setDocument] = useState<EmailDesign>(() => structuredClone(initial));
	const [name, setName] = useState(template?.name ?? initialName ?? t("New message"));
	const [language, setLanguage] = useState(initial.source_locale);
	const [panel, setPanel] = useState("Content");
	const [selectedId, setSelectedId] = useState(
		initial.locales[initial.source_locale]?.blocks[0]?.id ?? "",
	);
	const [device, setDevice] = useState("Desktop");
	const [status, setStatus] = useState(template ? "Saved" : "Unsaved changes");
	const [publishedRevision, setPublishedRevision] = useState(template?.published_revision ?? 0);
	const [error, setError] = useState("");
	const [history, setHistory] = useState<EmailVersion[]>([]);
	const [languageInput, setLanguageInput] = useState("");
	const [profile, setProfile] = useState({
		name: "Alex",
		email: "alex@example.test",
		locale,
		billing_locale: "",
		action_url: "https://example.test",
	});
	const [requestLocale, setRequestLocale] = useState("");
	const [testRecipient, setTestRecipient] = useState("");
	const [testStatus, setTestStatus] = useState("");
	const [previewValues, setPreviewValues] = useState<Record<string, string>>({});
	const [translating, setTranslating] = useState(false);
	const [shared, setShared] = useState<SharedEmailBlock[]>([]);
	const [usage, setUsage] = useState<Array<{ id: string; name: string }>>([]);
	useEffect(() => {
		let active = true;
		void getSharedEmailBlocks(project).then(
			(values) => {
				if (active) setShared(values);
			},
			() => {
				if (active) setError(t("Loading failed"));
			},
		);
		return () => {
			active = false;
		};
	}, [project, t]);
	const iframe = useRef<HTMLIFrameElement>(null);
	const revision = useRef(template?.studio_revision ?? 0);
	const savedSignature = useRef(template ? JSON.stringify([template.name, initial]) : "");
	const saving = useRef(false);
	const pauseSave = useRef(false);
	const current = useRef({ name, document });
	current.current = { name, document };
	const undo = useRef<EmailDesign[]>([]);
	const redo = useRef<EmailDesign[]>([]);
	const content = document.locales[language] ?? document.locales[document.source_locale]!;
	const selected = findBlock(content.blocks, selectedId);
	const context: EmailRenderContext = useMemo(
		() => ({
			profile: { ...profile, ...previewValues },
			event: previewValues,
			currency: previewValues.currency,
			time_zone: previewValues.time_zone,
			unsubscribe_url: "https://example.test/unsubscribe",
			request_locale: requestLocale || undefined,
		}),
		[profile, requestLocale, previewValues],
	);
	const rendered = useMemo(
		() => renderEmailTranslation(document, language, context),
		[document, language, context],
	);
	const resolved = useMemo(() => resolveEmailMessage(document, context), [document, context]);
	const update = useCallback((transform: (value: EmailDesign) => EmailDesign) => {
		setDocument((value) => {
			undo.current = [...undo.current.slice(-49), value];
			redo.current = [];
			return transform(structuredClone(value));
		});
		setStatus("Unsaved changes");
	}, []);
	const updateTranslation = (value: Partial<EmailTranslation>) =>
		update((draft) => {
			draft.locales[language] = { ...draft.locales[language]!, ...value };
			return draft;
		});
	const updateBlock = useCallback(
		(id: string, value: Partial<EmailBlock>) =>
			update((draft) => {
				const translation = draft.locales[language]!;
				translation.blocks = modifyBlocks(translation.blocks, id, (block) => ({
					...block,
					...value,
				}));
				translation.status = "draft";
				return draft;
			}),
		[language, update],
	);
	const save = useCallback(async () => {
		if (saving.current || pauseSave.current) return;
		const value = current.current;
		const signature = JSON.stringify([value.name, value.document]);
		if (signature === savedSignature.current || !value.name.trim()) return;
		saving.current = true;
		setStatus("Saving");
		setError("");
		try {
			const result = await onSave(value.name, value.document, revision.current);
			revision.current = result.studio_revision ?? revision.current + 1;
			const canonical = result.studio_document ?? value.document;
			if (JSON.stringify([current.current.name, current.current.document]) === signature) {
				savedSignature.current = JSON.stringify([value.name, canonical]);
				setDocument(canonical);
				setStatus("Saved");
			} else {
				savedSignature.current = signature;
				setStatus("Unsaved changes");
			}
		} catch (cause) {
			const conflict =
				cause instanceof Error &&
				(cause.message.includes("changed") || cause.message.includes("CONFLICT"));
			pauseSave.current = true;
			setError(t(conflict ? "Reload before saving" : "Save failed"));
			setStatus("Save failed");
		} finally {
			saving.current = false;
		}
	}, [onSave, t]);
	useEffect(() => {
		const timer = setTimeout(() => {
			void save();
		}, 1400);
		return () => clearTimeout(timer);
	}, [document, name, save, status]);
	useEffect(() => {
		const listener = (event: MessageEvent) => {
			if (
				event.source !== iframe.current?.contentWindow ||
				!event.data ||
				typeof event.data !== "object"
			)
				return;
			const value = event.data as Record<string, unknown>;
			if (typeof value.id !== "string" || !findBlock(content.blocks, value.id)) return;
			if (value.studio === "select") setSelectedId(value.id);
			if (value.studio === "edit" && typeof value.text === "string" && value.text.length <= 20_000)
				updateBlock(value.id, { text: value.text });
		};
		window.addEventListener("message", listener);
		return () => window.removeEventListener("message", listener);
	}, [content.blocks, updateBlock]);
	useEffect(() => {
		const before = (event: BeforeUnloadEvent) => {
			if (
				JSON.stringify([current.current.name, current.current.document]) !== savedSignature.current
			)
				event.preventDefault();
		};
		window.addEventListener("beforeunload", before);
		return () => window.removeEventListener("beforeunload", before);
	}, []);
	const openHistory = async () => {
		setPanel("History");
		if (template?.id) {
			try {
				setHistory(await getEmailVersions(project, template.id));
			} catch {
				setError(t("Loading failed"));
			}
		}
	};
	const addBlock = (type: EmailBlock["type"]) => {
		const block: EmailBlock = {
			id: crypto.randomUUID(),
			type,
			...(type === "heading" || type === "text" || type === "button"
				? { text: t(type === "button" ? "Welcome" : type) }
				: {}),
			...(type === "button" ? { url: "{{action_url}}" } : {}),
			...(type === "columns"
				? {
						columns: [
							[{ id: crypto.randomUUID(), type: "text", text: t("Text") }],
							[{ id: crypto.randomUUID(), type: "text", text: t("Text") }],
						],
					}
				: {}),
		};
		updateTranslation({ blocks: [...content.blocks, block], status: "draft" });
		setSelectedId(block.id);
	};
	const reorder = (id: string, delta: number) => {
		const blocks = [...content.blocks];
		const index = blocks.findIndex((block) => block.id === id);
		const target = index + delta;
		if (index < 0 || target < 0 || target >= blocks.length) return;
		[blocks[index], blocks[target]] = [blocks[target]!, blocks[index]!];
		updateTranslation({ blocks, status: "draft" });
	};
	return (
		<section className="overflow-hidden rounded-xl border border-kumo-line bg-kumo-base text-kumo-default">
			<header className="flex flex-wrap items-center justify-between gap-3 border-b border-kumo-line p-4">
				<div className="flex items-center gap-3">
					<Button
						variant="ghost"
						onClick={async () => {
							await save();
							if (!pauseSave.current && !saving.current) onBack();
						}}
					>
						{t("Back")}
					</Button>
					<Input
						aria-label={t("Template name")}
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
				</div>
				<div className="flex items-center gap-2">
					<span role="status" className="text-xs text-kumo-subtle">
						{t(status)}
					</span>
					<Button
						disabled={!undo.current.length}
						onClick={() => {
							const previous = undo.current.pop();
							if (previous) {
								redo.current.push(document);
								setDocument(previous);
							}
						}}
					>
						{t("Undo")}
					</Button>
					<Button
						disabled={!redo.current.length}
						onClick={() => {
							const next = redo.current.pop();
							if (next) {
								undo.current.push(document);
								setDocument(next);
							}
						}}
					>
						{t("Redo")}
					</Button>
					<Button
						variant="primary"
						onClick={() => {
							pauseSave.current = false;
							void save();
						}}
					>
						{t("Save")}
					</Button>
					<Button
						disabled={!template?.id || status === "Saving"}
						onClick={async () => {
							if (!template?.id) return;
							await save();
							if (pauseSave.current) return;
							try {
								const result = await publishStudioTemplate(project, template.id, revision.current);
								setPublishedRevision(result.published_revision);
								setError("");
							} catch (cause) {
								const code =
									cause && typeof cause === "object" && "code" in cause ? cause.code : null;
								setError(
									t(
										code === "EMAIL_TRANSLATIONS_NOT_READY"
											? "Approve the fallback translation before publishing."
											: code === "EMAIL_REVISION_CONFLICT"
												? "Reload before saving"
												: "Publication failed",
									),
								);
							}
						}}
					>
						{t("Publish")}
					</Button>
					{publishedRevision > 0 && (
						<span className="text-xs text-kumo-subtle">
							{t("Published version")} · {publishedRevision}
						</span>
					)}
				</div>
			</header>
			{error && (
				<p role="alert" className="p-3 text-kumo-danger">
					{error}
				</p>
			)}
			<nav
				aria-label={t("Templates")}
				className="flex flex-wrap items-center gap-2 border-b border-kumo-line px-4 py-3"
			>
				{["Content", "Design", "Languages", "Preview", "History"].map((item) => (
					<Button
						key={item}
						variant={panel === item ? "secondary" : "ghost"}
						aria-pressed={panel === item}
						onClick={() => (item === "History" ? void openHistory() : setPanel(item))}
					>
						{t(item)}
					</Button>
				))}
				<div className="ms-auto flex gap-2">
					<Select
						aria-label={t("Language")}
						value={language}
						onValueChange={(value) => value && setLanguage(value)}
						items={Object.fromEntries(
							Object.keys(document.locales).map((key) => [key, key.toUpperCase()]),
						)}
					/>
					<Select
						aria-label={t("Preview")}
						value={device}
						onValueChange={(value) => value && setDevice(value)}
						items={{ Desktop: t("Desktop"), Mobile: t("Mobile") }}
					/>
				</div>
			</nav>
			<div className="grid min-h-[680px] lg:grid-cols-[220px_minmax(320px,1fr)_300px]">
				<aside className="space-y-5 border-e border-kumo-line p-4">
					<p className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
						{t("Blocks")}
					</p>
					<div className="flex flex-wrap gap-2">
						{blockTypes.map((type) => (
							<Button key={type} size="sm" variant="outline" onClick={() => addBlock(type)}>
								{t(type)}
							</Button>
						))}
					</div>
					<p className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
						{t("Shared content")}
					</p>
					{shared.map((item) => (
						<Button
							key={item.id}
							size="sm"
							variant="outline"
							className="w-full justify-start truncate"
							onClick={() => {
								const source =
									item.document.locales[language] ??
									item.document.locales[language.split("-")[0]!] ??
									item.document.locales[item.document.fallback_locale];
								const block = source?.blocks[0];
								if (!block) return;
								const inserted = {
									...structuredClone(block),
									id: crypto.randomUUID(),
									shared_id: item.id,
								};
								updateTranslation({ blocks: [...content.blocks, inserted], status: "draft" });
								setSelectedId(inserted.id);
							}}
						>
							{item.document.locales[item.document.source_locale]?.subject}
						</Button>
					))}
					<p className="text-xs font-semibold uppercase tracking-wider text-kumo-subtle">
						{t("Layers")}
					</p>
					<div className="space-y-2">
						{content.blocks.map((block) => (
							<div
								key={block.id}
								draggable
								onDragStart={(event) => event.dataTransfer.setData("text/plain", block.id)}
								onDragOver={(event) => event.preventDefault()}
								onDrop={(event) => {
									event.preventDefault();
									const from = content.blocks.findIndex(
										(item) => item.id === event.dataTransfer.getData("text/plain"),
									);
									const to = content.blocks.findIndex((item) => item.id === block.id);
									if (from >= 0) reorder(content.blocks[from]!.id, to - from);
								}}
								className={`rounded-lg border p-2 ${block.id === selectedId ? "border-kumo-brand bg-kumo-tint" : "border-kumo-line"}`}
							>
								<Button
									variant="ghost"
									size="sm"
									className="w-full justify-start truncate"
									onClick={() => setSelectedId(block.id)}
								>
									{block.text?.slice(0, 26) || t(block.type)}
								</Button>
								<div className="flex justify-end gap-1">
									<Button size="xs" aria-label={t("Move up")} onClick={() => reorder(block.id, -1)}>
										↑
									</Button>
									<Button
										size="xs"
										aria-label={t("Move down")}
										onClick={() => reorder(block.id, 1)}
									>
										↓
									</Button>
								</div>
							</div>
						))}
					</div>
				</aside>
				<main className="min-w-0 overflow-auto bg-kumo-tint p-5">
					<div className="mx-auto mb-4 max-w-[680px]">
						<p className="text-sm font-medium">{rendered.subject}</p>
						<p className="mt-1 text-xs text-kumo-subtle">
							{t("Double-click text to edit it directly.")}
						</p>
					</div>
					<iframe
						ref={iframe}
						title={t("Email preview")}
						sandbox={panel === "Content" ? "allow-scripts" : ""}
						srcDoc={rendered.html + (panel === "Content" ? toolsScript : "")}
						className="mx-auto block min-h-[620px] rounded-lg border-0 bg-kumo-base shadow-md"
						style={{ width: device === "Mobile" ? 360 : "100%", maxWidth: 720 }}
					/>
				</main>
				<aside className="space-y-4 border-s border-kumo-line p-4">
					{panel === "Content" && (
						<>
							<Input
								label={t("Subject")}
								value={content.subject}
								onChange={(event) =>
									updateTranslation({ subject: event.target.value, status: "draft" })
								}
							/>
							<Input
								label={t("Preheader")}
								value={content.preheader}
								onChange={(event) =>
									updateTranslation({ preheader: event.target.value, status: "draft" })
								}
							/>
							<Select
								label={t("Purpose")}
								value={document.purpose}
								onValueChange={(value) =>
									value && update((draft) => ({ ...draft, purpose: value }))
								}
								items={Object.fromEntries(EMAIL_PURPOSES.map((purpose) => [purpose, t(purpose)]))}
							/>
							{selected ? (
								<div className="space-y-4 border-t border-kumo-line pt-4">
									<p className="font-semibold">{t(selected.type)}</p>
									{["heading", "text", "button"].includes(selected.type) && (
										<InputArea
											label={t("Text")}
											value={selected.text ?? ""}
											onChange={(event) => updateBlock(selected.id, { text: event.target.value })}
										/>
									)}
									{["button", "image"].includes(selected.type) && (
										<Input
											label={t(selected.type === "image" ? "Image URL" : "Action URL")}
											value={selected.url ?? ""}
											onChange={(event) => updateBlock(selected.id, { url: event.target.value })}
										/>
									)}
									{selected.type === "image" && (
										<Input
											label={t("Alternative text")}
											value={selected.alt ?? ""}
											onChange={(event) => updateBlock(selected.id, { alt: event.target.value })}
										/>
									)}
									<Select
										label={t("Alignment")}
										value={selected.align ?? "left"}
										onValueChange={(value) => value && updateBlock(selected.id, { align: value })}
										items={{ left: t("left"), center: t("center"), right: t("right") }}
									/>
									<Input
										label={t("Padding")}
										type="number"
										min={0}
										max={80}
										value={selected.padding ?? 16}
										onChange={(event) =>
											updateBlock(selected.id, { padding: Number(event.target.value) })
										}
									/>
									<Select
										label={t("Insert variable")}
										value=""
										onValueChange={(value) =>
											value &&
											updateBlock(selected.id, { text: (selected.text ?? "") + ` {{${value}}}` })
										}
										items={{
											name: t("Name"),
											email: t("Email"),
											"event.action_url": t("Action URL"),
										}}
									/>
									<Select
										label={t("Conditional display")}
										value={selected.condition?.operator ?? "none"}
										onValueChange={(value) =>
											updateBlock(selected.id, {
												condition:
													value === "none" || !value
														? undefined
														: {
																field: selected.condition?.field ?? "locale",
																operator: value as "equals" | "not_equals" | "exists",
																value: selected.condition?.value ?? "",
															},
											})
										}
										items={{
											none: t("Always visible"),
											equals: t("equals"),
											not_equals: t("not_equals"),
											exists: t("exists"),
										}}
									/>
									{selected.condition && (
										<>
											<Input
												label={t("Profile field")}
												value={selected.condition.field}
												onChange={(event) =>
													updateBlock(selected.id, {
														condition: { ...selected.condition!, field: event.target.value },
													})
												}
											/>
											<Input
												label={t("Value")}
												value={selected.condition.value ?? ""}
												onChange={(event) =>
													updateBlock(selected.id, {
														condition: { ...selected.condition!, value: event.target.value },
													})
												}
											/>
										</>
									)}
									<Button
										onClick={async () => {
											try {
												const saved = await createSharedEmailBlock(
													project,
													selected.text?.slice(0, 100) || t(selected.type),
													language,
													selected,
												);
												setShared((values) => [saved, ...values]);
												updateBlock(selected.id, { shared_id: saved.id });
											} catch {
												setError(t("Save failed"));
											}
										}}
									>
										{t("Save as shared content")}
									</Button>
									{selected.shared_id && (
										<>
											<Button
												onClick={async () => {
													const source = shared.find((item) => item.id === selected.shared_id);
													if (!source) return;
													try {
														const next = structuredClone(source);
														const content =
															next.document.locales[language] ??
															structuredClone(next.document.locales[next.document.source_locale]!);
														content.blocks = [{ ...selected, shared_id: undefined }];
														next.document.locales[language] = content;
														const saved = await updateSharedEmailBlock(project, next);
														setShared((values) =>
															values.map((item) => (item.id === saved.id ? saved : item)),
														);
														setUsage(await getSharedEmailBlockUsage(project, saved.id));
													} catch {
														setError(t("Save failed"));
													}
												}}
											>
												{t("Update shared content")}
											</Button>
											{usage.length > 0 && (
												<div className="space-y-2 rounded-lg border border-kumo-line p-3">
													<p>{t("Affected templates")}</p>
													{usage.map((item) => (
														<p key={item.id} className="text-xs">
															{item.name}
														</p>
													))}
													<Button
														onClick={async () => {
															try {
																const result = await applySharedEmailBlock(
																	project,
																	selected.shared_id!,
																	usage.slice(0, 25).map((item) => item.id),
																);
																setUsage([]);
																setError(
																	result.conflicts.length
																		? t("Some templates changed. Reload before applying again.")
																		: t("Drafts updated. Reload this template before editing."),
																);
																pauseSave.current = true;
															} catch {
																setError(t("Save failed"));
															}
														}}
													>
														{t("Apply to these drafts")}
													</Button>
												</div>
											)}
										</>
									)}
									<div className="flex gap-2">
										<Button
											onClick={() => {
												const copy = structuredClone(selected);
												copy.id = crypto.randomUUID();
												updateTranslation({ blocks: [...content.blocks, copy], status: "draft" });
											}}
										>
											{t("Duplicate")}
										</Button>
										<Button
											variant="secondary-destructive"
											onClick={() =>
												updateTranslation({
													blocks: content.blocks.filter((block) => block.id !== selected.id),
													status: "draft",
												})
											}
										>
											{t("Delete")}
										</Button>
									</div>
								</div>
							) : (
								<p>{t("Choose a block to edit its content and appearance.")}</p>
							)}
						</>
					)}
					{panel === "Design" && (
						<>
							{(
								[
									["background", "Background"],
									["surface", "Surface"],
									["accent", "Accent"],
									["text", "Color"],
								] as const
							).map(([key, label]) => (
								<Input
									key={key}
									type="color"
									label={t(label)}
									value={document.theme[key]}
									onChange={(event) =>
										update((draft) => ({
											...draft,
											theme: { ...draft.theme, [key]: event.target.value },
										}))
									}
								/>
							))}
							<Input
								type="number"
								label={t("Width")}
								min={320}
								max={800}
								value={document.theme.width}
								onChange={(event) =>
									update((draft) => ({
										...draft,
										theme: { ...draft.theme, width: Number(event.target.value) },
									}))
								}
							/>
							<Select
								label={t("Font")}
								value={document.theme.font}
								onValueChange={(value) =>
									value && update((draft) => ({ ...draft, theme: { ...draft.theme, font: value } }))
								}
								items={{
									"Arial, sans-serif": "Arial",
									"Georgia, serif": "Georgia",
									"Verdana, sans-serif": "Verdana",
								}}
							/>
						</>
					)}
					{panel === "Languages" && (
						<>
							<p className="text-sm text-kumo-subtle">
								{t("Source changes mark translations for review.")}
							</p>
							<p>
								{t("Source language")} · {document.source_locale.toUpperCase()}
							</p>
							{Object.entries(document.locales).map(([key, value]) => (
								<div
									key={key}
									className="flex items-center justify-between rounded-lg border border-kumo-line p-3"
								>
									<Button variant="ghost" onClick={() => setLanguage(key)}>
										{key.toUpperCase()}
									</Button>
									<span className="text-xs">{t(value.status)}</span>
								</div>
							))}
							<Input
								label={t("Language code")}
								placeholder="fr-CH"
								value={languageInput}
								onChange={(event) => setLanguageInput(event.target.value)}
							/>
							<Button
								onClick={() => {
									const key = canonicalEmailLocale(languageInput);
									if (
										!key ||
										document.locales[key] ||
										(settings && !settings.locales.includes(key))
									) {
										setError(t("Enable this language in project settings first."));
										return;
									}
									update((draft) => ({
										...draft,
										locales: {
											...draft.locales,
											[key]: {
												...structuredClone(draft.locales[draft.source_locale]!),
												status: "draft",
											},
										},
									}));
									setLanguage(key);
									setLanguageInput("");
								}}
							>
								{t("Add language")}
							</Button>
							<Select
								label={t("Fallback language")}
								value={document.fallback_locale}
								onValueChange={(value) =>
									value && update((draft) => ({ ...draft, fallback_locale: value }))
								}
								items={Object.fromEntries(
									Object.keys(document.locales).map((key) => [key, key.toUpperCase()]),
								)}
							/>
							<Select
								label={t("Missing translation")}
								value={document.missing_translation}
								onValueChange={(value) =>
									value && update((draft) => ({ ...draft, missing_translation: value }))
								}
								items={{ fallback: t("fallback"), skip: t("skip") }}
							/>
							<Button
								disabled={translating || language === document.source_locale || !template?.id}
								loading={translating}
								onClick={async () => {
									if (!template?.id) return;
									await save();
									if (pauseSave.current) return;
									const expected = revision.current;
									const sourceSignature = JSON.stringify(current.current.document);
									setTranslating(true);
									try {
										const result = await translateStudioEmail(
											project,
											template.id,
											language,
											expected,
										);
										if (
											revision.current !== expected ||
											JSON.stringify(current.current.document) !== sourceSignature
										) {
											setError(t("The source changed during translation. Try again."));
											return;
										}
										updateTranslation(result.translation);
									} catch (cause) {
										setError(
											t(
												cause instanceof Error && cause.message.includes("Configure")
													? "Configure a translation provider in project settings."
													: "Translation failed",
											),
										);
									} finally {
										setTranslating(false);
									}
								}}
							>
								{t("Translate with AI")}
							</Button>
							<Button
								variant="primary"
								onClick={() =>
									updateTranslation({
										status: "approved",
										source_revision: document.source_revision,
									})
								}
							>
								{t("Approve translation")}
							</Button>
							{language !== document.source_locale && (
								<details>
									<summary>{t("Compare with source")}</summary>
									<p className="mt-3 font-medium">
										{document.locales[document.source_locale]!.subject}
									</p>
									{document.locales[document.source_locale]!.blocks.map((block) => (
										<p key={block.id} className="my-2 text-sm">
											{block.text}
										</p>
									))}
								</details>
							)}
						</>
					)}
					{panel === "Preview" && (
						<>
							<p className="font-semibold">{t("Test profile")}</p>
							{(
								[
									["name", "Name"],
									["email", "Email"],
									["locale", "Preferred language"],
									["billing_locale", "Billing language"],
									["action_url", "Action URL"],
								] as const
							).map(([key, label]) => (
								<Input
									key={key}
									label={t(label)}
									value={profile[key]}
									onChange={(event) =>
										setProfile((value) => ({ ...value, [key]: event.target.value }))
									}
								/>
							))}
							<Input
								label={t("Request language")}
								value={requestLocale}
								onChange={(event) => setRequestLocale(event.target.value)}
							/>
							<div className="rounded-lg bg-kumo-tint p-3">
								<p className="text-sm font-medium">
									{t("Selected language")} ·{" "}
									{resolved.status === "ready" ? resolved.locale.toUpperCase() : "—"}
								</p>
								<p className="mt-1 text-xs">{t(resolved.reason)}</p>
							</div>
							{[...new Set([...Object.keys(previewValues), ...rendered.missing_variables])]
								.filter((key) => !key.includes("."))
								.map((key) => (
									<Input
										key={key}
										label={t("Test value") + " · " + key}
										value={previewValues[key] ?? ""}
										onChange={(event) =>
											setPreviewValues((values) => ({ ...values, [key]: event.target.value }))
										}
									/>
								))}
							{rendered.missing_variables.length > 0 && (
								<p role="alert">
									{t("Missing variables")}: {rendered.missing_variables.join(", ")}
								</p>
							)}
							<Input
								type="email"
								label={t("Test recipient")}
								value={testRecipient}
								onChange={(event) => setTestRecipient(event.target.value)}
							/>
							<Button
								disabled={!template?.id || !testRecipient || rendered.missing_variables.length > 0}
								onClick={async () => {
									if (!template?.id) return;
									await save();
									try {
										await testStudioEmail(project, template.id, testRecipient, language, context);
										setTestStatus(t("Test sent"));
									} catch {
										setError(t("Save failed"));
									}
								}}
							>
								{t("Send a test")}
							</Button>
							<p role="status">{testStatus}</p>
						</>
					)}
					{panel === "History" &&
						(history.length ? (
							history.map((version) => (
								<div
									key={version.revision}
									className="space-y-3 rounded-lg border border-kumo-line p-3"
								>
									<p className="text-sm">
										v{version.revision} · {new Date(version.created_at).toLocaleString(locale)}
									</p>
									<Button
										onClick={() => {
											update(() => structuredClone(version.document));
											setLanguage(version.document.source_locale);
											setPanel("Content");
										}}
									>
										{t("Restore this version")}
									</Button>
								</div>
							))
						) : (
							<p>{t("No saved versions yet")}</p>
						))}
				</aside>
			</div>
		</section>
	);
}
