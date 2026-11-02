import {
	Badge,
	Button,
	Checkbox,
	Input,
	InputArea,
	Label,
	LinkButton,
	Select,
	Sidebar,
	Switch,
	useSidebar,
} from "@cloudflare/kumo";
import { useLingui } from "@lingui/react/macro";
import {
	ArrowSquareOut,
	Faders,
	Paperclip,
	X,
	ArrowsInSimple,
	ArrowsOutSimple,
} from "@phosphor-icons/react";
import type { Editor } from "@tiptap/react";
import * as React from "react";

import type {
	BylineCreditInput,
	BylineSummary,
	ContentItem,
	MediaItem,
	UserListItem,
	TranslationSummary,
} from "../lib/api";
import { getPreviewUrl, getDraftStatus } from "../lib/api";
import { fromDatetimeLocalInputValue, toDatetimeLocalInputValue } from "../lib/datetime-local.js";
import { getEntryTitle } from "../lib/entryTitle.js";
import { formatFileSize, getFileIcon } from "../lib/media-utils";
import { usePluginAdmins } from "../lib/plugin-context.js";
import { contentUrl, isSafeUrl } from "../lib/url.js";
import { cn, slugify } from "../lib/utils";
import { getLocaleDir } from "../locales/config.js";
import { useLocale } from "../locales/useLocale.js";
import { ArrowPrev } from "./ArrowIcons.js";
import { BlockKitFieldWidget } from "./BlockKitFieldWidget.js";
import {
	ContentSettingsPanel,
	DiscardDraftDialog,
	PreviewButton,
	PublishActions,
	SettingsActionBar,
} from "./ContentSettingsPanel.js";
import { ImageFieldRenderer, type ImageFieldValue } from "./ImageFieldRenderer.js";
import { PluginFieldErrorBoundary } from "./PluginFieldErrorBoundary.js";
import { RepeaterField } from "./RepeaterField.js";
import { RouterLinkButton } from "./RouterLinkButton.js";
import { SaveButton } from "./SaveButton.js";

const AUTOSAVE_DELAY = 2000;
const ADMIN_HEADER_HEIGHT_PX = 58;
const EDITOR_SETTINGS_MIN_WIDTH_PX = 320;
const EDITOR_SETTINGS_DEFAULT_WIDTH_PX = 368;
const EDITOR_SETTINGS_MAX_WIDTH_PX = 480;
const EDITOR_SETTINGS_KEYBOARD_STEP_PX = 10;

function serializeEditorState(input: {
	data: Record<string, unknown>;
	slug: string;
	bylines: BylineCreditInput[];
}) {
	return JSON.stringify({
		data: input.data,
		slug: input.slug,
		bylines: input.bylines,
	});
}

function resolveEditorBylines(item?: ContentItem | null): {
	explicitCredits: BylineCreditInput[];
	inferredByline: BylineSummary | null;
} {
	const entries = item?.bylines ?? [];
	const explicitEntries = entries.filter((entry) => entry.source !== "inferred");
	return {
		explicitCredits: explicitEntries.map((entry) => ({
			bylineId: entry.byline.id,
			roleLabel: entry.roleLabel,
		})),
		inferredByline:
			explicitEntries.length === 0
				? (entries.find((entry) => entry.source === "inferred")?.byline ?? null)
				: null,
	};
}

import type { ContentSeoInput } from "../lib/api";
import { findUnsupportedPortableTextMarks } from "../lib/portable-text-marks.js";
import { MediaPickerModal } from "./MediaPickerModal";
import {
	PortableTextEditor,
	type PluginBlockDef,
	type BlockSidebarPanel,
} from "./PortableTextEditor";

export interface FieldDescriptor {
	id?: string;
	kind: string;
	label?: string;
	required?: boolean;
	readOnly?: boolean;
	options?: Array<{ value: string; label: string }> | Record<string, unknown>;
	widget?: string;
	validation?: Record<string, unknown>;
}

export interface CurrentUserInfo {
	id: string;
	role: number;
}

export interface ContentEditorProps {
	collection: string;
	collectionLabel: string;
	item?: ContentItem | null;
	fields: Record<string, FieldDescriptor>;
	isNew?: boolean;
	entryLocale?: string | null;
	isSaving?: boolean;
	isSaveFeedbackActive?: boolean;
	onSave?: (payload: {
		data: Record<string, unknown>;
		slug?: string;
		bylines?: BylineCreditInput[];
	}) => void;
	onAutosave?: (payload: {
		data: Record<string, unknown>;
		slug?: string;
		bylines?: BylineCreditInput[];
	}) => void;
	isAutosaving?: boolean;
	isAutosaveFeedbackActive?: boolean;
	autosaveCompletionToken?: number;
	onPublish?: () => void;
	onUnpublish?: () => void;
	onDiscardDraft?: () => void;
	onSchedule?: (scheduledAt: string) => void;
	onUnschedule?: () => void;
	isScheduling?: boolean;
	onPublishedAtChange?: (publishedAt: string) => void;
	isUpdatingPublishedAt?: boolean;
	supportsDrafts?: boolean;
	supportsRevisions?: boolean;
	supportsPreview?: boolean;
	currentUser?: CurrentUserInfo;
	users?: UserListItem[];
	onAuthorChange?: (authorId: string | null) => void;
	availableBylines?: BylineSummary[];
	availableBylinesLoaded?: boolean;
	selectedBylines?: BylineCreditInput[];
	onBylinesChange?: (bylines: BylineCreditInput[]) => void;
	onQuickCreateByline?: (input: { slug: string; displayName: string }) => Promise<BylineSummary>;
	onQuickEditByline?: (
		bylineId: string,
		input: { slug: string; displayName: string },
	) => Promise<BylineSummary>;
	onDelete?: () => void;
	isDeleting?: boolean;
	i18n?: { defaultLocale: string; locales: string[] };
	translations?: TranslationSummary[];
	onTranslate?: (locale: string) => void;
	pluginBlocks?: PluginBlockDef[];
	hasSeo?: boolean;
	onSeoChange?: (seo: ContentSeoInput) => void;
	manifest?: import("../lib/api/client.js").AdminManifest | null;
}

export function ContentEditor({
	collection,
	collectionLabel,
	item,
	fields,
	isNew,
	entryLocale,
	isSaving,
	isSaveFeedbackActive,
	onSave,
	onAutosave,
	isAutosaving,
	isAutosaveFeedbackActive,
	autosaveCompletionToken,
	onPublish,
	onUnpublish,
	onDiscardDraft,
	onSchedule,
	onUnschedule,
	isScheduling,
	onPublishedAtChange,
	isUpdatingPublishedAt,
	supportsDrafts = false,
	supportsRevisions = false,
	supportsPreview = false,
	currentUser,
	users,
	onAuthorChange,
	availableBylines,
	availableBylinesLoaded,
	selectedBylines,
	onBylinesChange,
	onQuickCreateByline,
	onQuickEditByline,
	onDelete,
	isDeleting,
	i18n,
	translations,
	onTranslate,
	pluginBlocks,
	hasSeo = false,
	onSeoChange,
	manifest,
}: ContentEditorProps) {
	const { t } = useLingui();
	const { locale: uiLocale } = useLocale();
	const itemLabel = collectionLabel;
	const settingsPanelId = React.useId();
	const panelSide = getLocaleDir(uiLocale) === "rtl" ? "left" : "right";
	const [isBelowLg, setIsBelowLg] = React.useState(
		() => typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches,
	);
	React.useEffect(() => {
		const mq = window.matchMedia("(max-width: 1023px)");
		const onChange = () => setIsBelowLg(mq.matches);
		mq.addEventListener("change", onChange);
		return () => mq.removeEventListener("change", onChange);
	}, []);
	const [formData, setFormData] = React.useState<Record<string, unknown>>(item?.data || {});
	const [slug, setSlug] = React.useState(item?.slug || "");
	const [slugTouched, setSlugTouched] = React.useState(!!item?.slug);
	const [status, setStatus] = React.useState(item?.status || "draft");
	const resolvedItemBylines = resolveEditorBylines(item);
	const [internalBylines, setInternalBylines] = React.useState<BylineCreditInput[]>(
		resolvedItemBylines.explicitCredits,
	);
	const [bylinesTouched, setBylinesTouched] = React.useState(false);

	const [portableTextEditor, setPortableTextEditor] = React.useState<Editor | null>(null);

	const [blockSidebarPanel, setBlockSidebarPanel] = React.useState<BlockSidebarPanel | null>(null);

	const handleBlockSidebarOpen = React.useCallback((panel: BlockSidebarPanel) => {
		setBlockSidebarPanel(panel);
	}, []);

	const handleBlockSidebarClose = React.useCallback(() => {
		setBlockSidebarPanel((previous) => {
			previous?.onClose();
			return null;
		});
	}, []);

	const handleBlockSidebarDelete = React.useCallback(() => {
		blockSidebarPanel?.onDelete();
		setBlockSidebarPanel(null);
	}, [blockSidebarPanel]);

	const handleSeoChange = React.useCallback(
		(seo: ContentSeoInput) => {
			onSeoChange?.(seo);
		},
		[onSeoChange],
	);

	const [lastSavedData, setLastSavedData] = React.useState<string>(
		serializeEditorState({
			data: item?.data || {},
			slug: item?.slug || "",
			bylines: resolvedItemBylines.explicitCredits,
		}),
	);
	const pendingAutosaveStateRef = React.useRef<string | null>(null);

	const [previousItemId, setPreviousItemId] = React.useState<string | null>(item?.id ?? null);
	if (item && item.id !== previousItemId) {
		setPreviousItemId(item.id);
		setFormData(item.data);
		setSlug(item.slug || "");
		setSlugTouched(!!item.slug);
		setStatus(item.status);
		const nextBylines = resolveEditorBylines(item).explicitCredits;
		setInternalBylines(nextBylines);
		setLastSavedData(
			serializeEditorState({
				data: item.data,
				slug: item.slug || "",
				bylines: nextBylines,
			}),
		);
		pendingAutosaveStateRef.current = null;
		setBylinesTouched(false);
	}

	const itemDataString = React.useMemo(() => (item ? JSON.stringify(item.data) : ""), [item?.data]);
	const itemBylinesString = React.useMemo(
		() => (item ? JSON.stringify(item.bylines ?? []) : ""),
		[item?.bylines],
	);
	React.useEffect(() => {
		if (item) {
			const nextBylines = resolveEditorBylines(item).explicitCredits;
			setFormData(item.data);
			setSlug(item.slug || "");
			setSlugTouched(!!item.slug);
			setStatus(item.status);
			setInternalBylines(nextBylines);
			setLastSavedData(
				serializeEditorState({
					data: item.data,
					slug: item.slug || "",
					bylines: nextBylines,
				}),
			);
			pendingAutosaveStateRef.current = null;
			setBylinesTouched(false);
		}
	}, [item?.updatedAt, itemDataString, itemBylinesString, item?.slug, item?.status]);

	const activeBylines = React.useMemo(
		() => (isNew ? (selectedBylines ?? []) : internalBylines),
		[isNew, selectedBylines, internalBylines],
	);
	const unsupportedPortableTextMarks = React.useMemo(() => {
		const unsupported = new Set<string>();
		for (const [name, field] of Object.entries(fields)) {
			if (field.kind !== "portableText" || field.widget) continue;
			const value = formData[name];
			if (!Array.isArray(value)) continue;
			for (const mark of findUnsupportedPortableTextMarks(value)) {
				unsupported.add(mark);
			}
		}
		return [...unsupported].toSorted();
	}, [fields, formData]);
	const hasUnsupportedPortableTextMarks = unsupportedPortableTextMarks.length > 0;

	const handleBylinesChange = React.useCallback(
		(next: BylineCreditInput[]) => {
			setBylinesTouched(true);
			if (isNew) {
				onBylinesChange?.(next);
				return;
			}
			setInternalBylines(next);
			onBylinesChange?.(next);
		},
		[isNew, onBylinesChange],
	);

	const currentData = React.useMemo(
		() =>
			serializeEditorState({
				data: formData,
				slug,
				bylines: activeBylines,
			}),
		[formData, slug, activeBylines],
	);
	const isDirty = isNew || currentData !== lastSavedData;
	const saveFeedbackActive = isSaveFeedbackActive ?? isSaving;
	const autosaveFeedbackActive = isAutosaveFeedbackActive ?? isAutosaving;
	const isContentOperationPending = Boolean(isSaving);
	const isContentSaveBlocked = isContentOperationPending || hasUnsupportedPortableTextMarks;

	const autosaveTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
	const formDataRef = React.useRef(formData);
	formDataRef.current = formData;
	const slugRef = React.useRef(slug);
	slugRef.current = slug;

	React.useEffect(() => {
		if (!autosaveCompletionToken || !pendingAutosaveStateRef.current) {
			return;
		}

		setLastSavedData(pendingAutosaveStateRef.current);
		pendingAutosaveStateRef.current = null;
	}, [autosaveCompletionToken]);

	const hasInvalidUrls = React.useCallback(
		(data: Record<string, unknown>) => {
			for (const [name, field] of Object.entries(fields)) {
				if (field.kind === "url") {
					const val = typeof data[name] === "string" ? data[name].trim() : "";
					if (val && !isValidUrl(val)) return true;
				}
			}
			return false;
		},
		[fields],
	);

	React.useEffect(() => {
		if (isNew || !onAutosave || !item?.id || hasUnsupportedPortableTextMarks) {
			return;
		}

		if (!isDirty || isSaving || isAutosaving) {
			return;
		}

		if (autosaveTimeoutRef.current) {
			clearTimeout(autosaveTimeoutRef.current);
		}

		autosaveTimeoutRef.current = setTimeout(() => {
			if (hasInvalidUrls(formDataRef.current)) return;
			const payload: {
				data: Record<string, unknown>;
				slug?: string;
				bylines?: BylineCreditInput[];
			} = {
				data: editableFieldData(formDataRef.current, fields),
				slug: slugRef.current || undefined,
			};
			if (bylinesTouched) payload.bylines = activeBylines;
			pendingAutosaveStateRef.current = serializeEditorState({
				data: formDataRef.current,
				slug: payload.slug || "",
				bylines: activeBylines,
			});
			onAutosave(payload);
		}, AUTOSAVE_DELAY);

		return () => {
			if (autosaveTimeoutRef.current) {
				clearTimeout(autosaveTimeoutRef.current);
			}
		};
	}, [
		currentData,
		isNew,
		onAutosave,
		item?.id,
		isDirty,
		isSaving,
		isAutosaving,
		activeBylines,
		bylinesTouched,
		hasInvalidUrls,
		hasUnsupportedPortableTextMarks,
		fields,
	]);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (hasInvalidUrls(formData) || hasUnsupportedPortableTextMarks) return;
		if (autosaveTimeoutRef.current) {
			clearTimeout(autosaveTimeoutRef.current);
			autosaveTimeoutRef.current = null;
		}
		const payload: {
			data: Record<string, unknown>;
			slug?: string;
			bylines?: BylineCreditInput[];
		} = {
			data: editableFieldData(formData, fields),
			slug: slug || undefined,
		};
		if (isNew || bylinesTouched) payload.bylines = activeBylines;
		onSave?.(payload);
	};

	const [isLoadingPreview, setIsLoadingPreview] = React.useState(false);

	const urlPattern = manifest?.collections[collection]?.urlPattern;
	const routable = manifest?.collections[collection]?.routable !== false;

	const titleField = manifest?.collections[collection]?.titleField;
	const entryTitle = item && titleField ? getEntryTitle(item, titleField) : "";

	const handlePreview = async () => {
		if (!item?.id) return;

		setIsLoadingPreview(true);
		try {
			const result = await getPreviewUrl(collection, item.id);
			if (result?.url) {
				window.open(result.url, "_blank", "noopener,noreferrer");
			} else {
				window.open(
					contentUrl(collection, slug || item.id, urlPattern),
					"_blank",
					"noopener,noreferrer",
				);
			}
		} catch {
			window.open(
				contentUrl(collection, slug || item?.id || "", urlPattern),
				"_blank",
				"noopener,noreferrer",
			);
		} finally {
			setIsLoadingPreview(false);
		}
	};

	const handleFieldChange = React.useCallback(
		(name: string, value: unknown) => {
			setFormData((prev) => ({ ...prev, [name]: value }));
			if (name === "title" && !slugTouched && typeof value === "string" && value) {
				setSlug(slugify(value));
			}
		},
		[slugTouched],
	);

	const handleSlugChange = React.useCallback((value: string) => {
		setSlug(value);
		setSlugTouched(true);
	}, []);

	const isPublished = status === "published";

	const draftStatus = item ? getDraftStatus(item) : "unpublished";
	const hasPendingChanges = draftStatus === "published_with_changes";
	const isLive = draftStatus === "published" || draftStatus === "published_with_changes";
	const liveViewUrl =
		routable && isLive && item?.slug ? contentUrl(collection, item.slug, urlPattern) : null;

	const hasSchedule = Boolean(item?.scheduledAt);
	const canSchedule =
		!isNew && !hasSchedule && Boolean(onSchedule) && (!isPublished || hasPendingChanges);

	const [isDistractionFree, setIsDistractionFree] = React.useState(false);

	React.useEffect(() => {
		if (!isDistractionFree) return;

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				setIsDistractionFree(false);
			}
		};

		document.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => document.removeEventListener("keydown", handleKeyDown, { capture: true });
	}, [isDistractionFree]);

	return (
		<form
			onSubmit={handleSubmit}
			className={cn(
				"transition-all duration-300",
				isDistractionFree
					? "space-y-6 fixed inset-0 z-50 bg-kumo-elevated p-8 overflow-auto"
					: "flex h-full bg-kumo-elevated",
			)}
		>
			<Sidebar.Provider
				contained={!isBelowLg}
				defaultOpen
				open={isBelowLg ? undefined : true}
				side={panelSide}
				collapsible="offcanvas"
				resizable
				defaultWidth={EDITOR_SETTINGS_DEFAULT_WIDTH_PX}
				minWidth={EDITOR_SETTINGS_MIN_WIDTH_PX}
				maxWidth={EDITOR_SETTINGS_MAX_WIDTH_PX}
				mobileBreakpoint={1024}
				className={cn(!isDistractionFree && "h-full min-h-0")}
				style={
					{
						"--sidebar-bg": "var(--color-kumo-elevated)",
						...(isBelowLg ? { "--sidebar-width": "20rem" } : {}),
					} as React.CSSProperties
				}
			>
				<div className={cn(isDistractionFree ? "w-full" : "flex-1 min-w-0 overflow-y-auto p-6")}>
					<div
						className={cn(
							"flex flex-wrap items-center justify-between gap-y-2",
							isDistractionFree
								? "opacity-0 hover:opacity-100 transition-opacity duration-200 fixed top-0 start-0 end-0 mx-auto w-[calc(100%-4rem)] max-w-3xl bg-kumo-elevated/95 py-4 backdrop-blur z-10"
								: cn(
										"mx-auto mb-6 max-w-3xl",
										isBelowLg && "bg-kumo-elevated/95 py-3 backdrop-blur",
									),
						)}
					>
						<div className="flex min-w-0 items-center gap-3">
							{!isDistractionFree && (
								<RouterLinkButton
									to="/content/$collection"
									params={{ collection }}
									search={{ locale: undefined }}
									aria-label={t`Back to ${collectionLabel} list`}
									variant="ghost"
									shape="square"
									icon={<ArrowPrev />}
								/>
							)}
							<h1 className="min-w-0 truncate text-lg font-semibold">
								{isNew ? t`New ${itemLabel}` : entryTitle || t`Edit ${itemLabel}`}
							</h1>
							{i18n && item?.locale && (
								<Badge variant="outline" className="uppercase text-xs">
									{item.locale}
								</Badge>
							)}
						</div>
						<div className="flex items-center gap-2">
							{!isDistractionFree ? (
								<>
									{isBelowLg && (
										<div className="flex flex-wrap items-center justify-end gap-2">
											{!isNew && supportsPreview && (
												<PreviewButton
													hasPendingChanges={hasPendingChanges}
													isLoadingPreview={isLoadingPreview}
													onPreview={handlePreview}
												/>
											)}
											<SaveButton
												type="submit"
												isDirty={isDirty}
												isSaving={Boolean(saveFeedbackActive || autosaveFeedbackActive)}
												disabled={isContentSaveBlocked}
											/>
											{liveViewUrl && (
												<LinkButton
													href={liveViewUrl}
													external
													variant="outline"
													icon={<ArrowSquareOut />}
												>
													{t`Live View`}
												</LinkButton>
											)}
											<PublishActions
												collectionLabel={collectionLabel}
												isNew={isNew}
												isLive={isLive}
												hasPendingChanges={hasPendingChanges}
												onPublish={onPublish}
												onUnpublish={onUnpublish}
											/>
											<MobileSettingsButton />
										</div>
									)}
									<Button
										variant="ghost"
										shape="square"
										type="button"
										onClick={() => setIsDistractionFree(true)}
										aria-label={t`Enter distraction-free mode`}
										title={t`Distraction-free mode (⌘⇧\\)`}
									>
										<ArrowsOutSimple className="h-4 w-4" aria-hidden="true" />
									</Button>
								</>
							) : (
								<>
									<SaveButton
										type="submit"
										size="sm"
										isDirty={isDirty}
										isSaving={Boolean(saveFeedbackActive || autosaveFeedbackActive)}
										disabled={isContentSaveBlocked}
									/>
									{liveViewUrl && (
										<LinkButton
											href={liveViewUrl}
											external
											variant="outline"
											size="sm"
											icon={<ArrowSquareOut />}
										>
											{t`Live View`}
										</LinkButton>
									)}
									{!isNew && supportsPreview && (
										<PreviewButton
											size="sm"
											hasPendingChanges={hasPendingChanges}
											isLoadingPreview={isLoadingPreview}
											onPreview={handlePreview}
										/>
									)}
									{!isNew && (
										<>
											{supportsDrafts && hasPendingChanges && onDiscardDraft && (
												<DiscardDraftDialog
													onDiscard={onDiscardDraft}
													triggerVariant="outline"
													triggerSize="sm"
												/>
											)}
											<PublishActions
												collectionLabel={collectionLabel}
												isLive={isLive}
												hasPendingChanges={hasPendingChanges}
												onPublish={onPublish}
												onUnpublish={onUnpublish}
												size="sm"
											/>
										</>
									)}
									<Button
										variant="ghost"
										shape="square"
										type="button"
										onClick={() => setIsDistractionFree(false)}
										aria-label={t`Exit distraction-free mode`}
									>
										<ArrowsInSimple className="h-5 w-5" aria-hidden="true" />
									</Button>
								</>
							)}
						</div>
					</div>

					<div
						className={cn(
							isDistractionFree ? "mx-auto max-w-3xl pt-16" : "mx-auto max-w-3xl space-y-6",
						)}
					>
						<div className="space-y-6">
							{Object.entries(fields).map(([name, field]) => {
								const fieldKey = `${name}:${item?.id ?? "new"}`;
								const fieldEl = (
									<FieldRenderer
										key={fieldKey}
										name={name}
										field={field}
										value={formData[name]}
										onChange={handleFieldChange}
										onEditorReady={
											field.kind === "portableText" && name === "content"
												? setPortableTextEditor
												: undefined
										}
										pluginBlocks={pluginBlocks}
										onBlockSidebarOpen={
											field.kind === "portableText" ? handleBlockSidebarOpen : undefined
										}
										onBlockSidebarClose={
											field.kind === "portableText" ? handleBlockSidebarClose : undefined
										}
										manifest={manifest}
									/>
								);
								return fieldEl;
							})}
						</div>
					</div>
				</div>

				<Sidebar
					id={settingsPanelId}
					aria-label={t`Settings`}
					className={cn(isDistractionFree && "hidden")}
				>
					{!isBelowLg && (
						<SettingsActionBar
							collectionLabel={collectionLabel}
							isNew={isNew}
							isDirty={isDirty}
							isSaving={Boolean(saveFeedbackActive)}
							isAutosaving={autosaveFeedbackActive}
							saveDisabled={isContentSaveBlocked}
							isLive={isLive}
							hasPendingChanges={hasPendingChanges}
							liveViewUrl={liveViewUrl}
							supportsPreview={supportsPreview}
							isLoadingPreview={isLoadingPreview}
							onPreview={handlePreview}
							onPublish={onPublish}
							onUnpublish={onUnpublish}
							announceSaveStatus={!isDistractionFree}
						/>
					)}
					<div
						className="flex-1 overflow-y-auto overflow-x-hidden bg-kumo-base"
						style={isBelowLg ? { paddingTop: ADMIN_HEADER_HEIGHT_PX } : undefined}
					>
						{isBelowLg && (
							<div className="flex justify-end px-4 pt-3">
								<MobileSettingsCloseButton />
							</div>
						)}
						<ContentSettingsPanel
							collection={collection}
							item={item}
							isNew={isNew}
							manifest={manifest}
							entryLocale={entryLocale}
							slug={slug}
							onSlugChange={handleSlugChange}
							status={status}
							supportsDrafts={supportsDrafts}
							isLive={isLive}
							hasPendingChanges={hasPendingChanges}
							hasSchedule={hasSchedule}
							supportsRevisions={supportsRevisions}
							canSchedule={canSchedule}
							onSchedule={onSchedule}
							onUnschedule={onUnschedule}
							isScheduling={isScheduling}
							onPublishedAtChange={onPublishedAtChange}
							isUpdatingPublishedAt={isUpdatingPublishedAt}
							onDiscardDraft={onDiscardDraft}
							onDelete={onDelete}
							isDeleting={isDeleting}
							currentUser={currentUser}
							users={users}
							onAuthorChange={onAuthorChange}
							activeBylines={activeBylines}
							inferredByline={resolvedItemBylines.inferredByline}
							availableBylines={availableBylines}
							availableBylinesLoaded={availableBylinesLoaded}
							onBylinesChange={handleBylinesChange}
							onQuickCreateByline={onQuickCreateByline}
							onQuickEditByline={onQuickEditByline}
							i18n={i18n}
							translations={translations}
							onTranslate={onTranslate}
							hasSeo={hasSeo}
							onSeoChange={onSeoChange ? handleSeoChange : undefined}
							portableTextEditor={portableTextEditor}
							blockSidebarPanel={blockSidebarPanel}
							onBlockSidebarClose={handleBlockSidebarClose}
							onBlockSidebarDelete={handleBlockSidebarDelete}
						/>
					</div>
					{!isBelowLg && <ContentEditorSettingsResizeHandle panelId={settingsPanelId} />}
				</Sidebar>

				<MobileBlockSidebarSync active={!!blockSidebarPanel} suspended={isDistractionFree} />
				<MobileSidebarPortalGuard />
			</Sidebar.Provider>
		</form>
	);
}

function ContentEditorSettingsResizeHandle({ panelId }: { panelId: string }) {
	const { t } = useLingui();
	const { side, width, minWidth, maxWidth, setWidth } = useSidebar();

	const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
		let nextWidth: number;
		switch (event.key) {
			case "ArrowLeft":
				nextWidth = width + (side === "right" ? 1 : -1) * EDITOR_SETTINGS_KEYBOARD_STEP_PX;
				break;
			case "ArrowRight":
				nextWidth = width + (side === "left" ? 1 : -1) * EDITOR_SETTINGS_KEYBOARD_STEP_PX;
				break;
			case "Home":
				nextWidth = minWidth;
				break;
			case "End":
				nextWidth = maxWidth;
				break;
			default:
				return;
		}

		event.preventDefault();
		setWidth(nextWidth);
	};

	return (
		<Sidebar.ResizeHandle
			role="separator"
			aria-label={t`Resize settings panel`}
			aria-orientation="vertical"
			aria-controls={panelId}
			aria-valuemin={minWidth}
			aria-valuemax={maxWidth}
			aria-valuenow={width}
			className="touch-none"
			onKeyDown={handleKeyDown}
		/>
	);
}

function MobileBlockSidebarSync({ active, suspended }: { active: boolean; suspended?: boolean }) {
	const { isMobile, openMobile, setOpenMobile } = useSidebar();
	const prevActiveRef = React.useRef(active);
	const prevIsMobileRef = React.useRef(isMobile);
	const prevSuspendedRef = React.useRef(suspended);
	const priorOpenRef = React.useRef<boolean | null>(null);

	React.useEffect(() => {
		const becameActive = active && !prevActiveRef.current;
		const becameInactive = !active && prevActiveRef.current;
		const becameMobileWithActivePanel = active && isMobile && !prevIsMobileRef.current;
		const becameUnsuspendedWithActivePanel = active && !suspended && prevSuspendedRef.current;
		prevActiveRef.current = active;
		prevIsMobileRef.current = isMobile;
		prevSuspendedRef.current = suspended;

		if (!isMobile) {
			priorOpenRef.current = null;
			if (openMobile) setOpenMobile(false);
			return;
		}

		if (suspended) {
			priorOpenRef.current = null;
			if (openMobile) setOpenMobile(false);
			return;
		}

		if (becameInactive) {
			setOpenMobile(priorOpenRef.current ?? false);
			priorOpenRef.current = null;
			return;
		}

		if (becameActive || becameMobileWithActivePanel || becameUnsuspendedWithActivePanel) {
			priorOpenRef.current = openMobile;
			setOpenMobile(true);
		}
	}, [active, isMobile, openMobile, setOpenMobile, suspended]);

	return null;
}

function MobileSidebarPortalGuard() {
	const { isMobile, openMobile, setOpenMobile } = useSidebar();

	React.useEffect(() => {
		if (!isMobile || !openMobile) return;
		const nestedOverlaySelector =
			'[role="dialog"], [role="listbox"], [role="menu"], .kumo-tooltip-popup';
		const keepSheetOpen = () => queueMicrotask(() => setOpenMobile(true));
		const reopenSheetAfterDismiss = () => setTimeout(setOpenMobile, 0, true);
		const promotePortal = (element: Element) => {
			const overlay =
				element.closest(nestedOverlaySelector) ?? element.querySelector(nestedOverlaySelector);
			const portal = overlay?.closest<HTMLElement>("[data-base-ui-portal]");
			if (!portal) return;
			portal.style.position = "relative";
			portal.style.zIndex = "60";
		};

		const handleFocusOut = (event: FocusEvent) => {
			const source = event.target;
			const destination = event.relatedTarget;
			if (!(source instanceof Element)) return;

			if (source.closest("[data-sortable-handle]") && destination === null) {
				event.stopPropagation();
				keepSheetOpen();
				return;
			}
			if (source.closest("[data-keep-mobile-sidebar-open]") && destination === null) {
				event.stopPropagation();
				keepSheetOpen();
				return;
			}

			if (!(destination instanceof Element)) return;

			const sheet = source.closest('nav[data-sidebar="sidebar"][data-mobile="true"]');
			if (!sheet || sheet.contains(destination)) return;
			if (!destination.closest(nestedOverlaySelector)) return;

			promotePortal(destination);
			keepSheetOpen();
		};

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			const target = event.target;
			if (!(target instanceof Element)) return;

			if (target.closest('[data-sortable-handle][data-sorting="true"]')) {
				reopenSheetAfterDismiss();
				return;
			}

			if (!target.closest(nestedOverlaySelector)) return;
			keepSheetOpen();
		};

		document.addEventListener("focusout", handleFocusOut, true);
		document.addEventListener("keydown", handleKeyDown, true);
		const portalObserver = new MutationObserver((records) => {
			for (const record of records) {
				for (const node of record.addedNodes) {
					if (node instanceof Element) promotePortal(node);
				}
			}
		});
		portalObserver.observe(document.body, { childList: true, subtree: true });
		document
			.querySelectorAll<HTMLElement>("[data-base-ui-portal]")
			.forEach((portal) => promotePortal(portal));
		return () => {
			document.removeEventListener("focusout", handleFocusOut, true);
			document.removeEventListener("keydown", handleKeyDown, true);
			portalObserver.disconnect();
		};
	}, [isMobile, openMobile, setOpenMobile]);

	return null;
}

function MobileSettingsButton() {
	const { t } = useLingui();
	const { toggleSidebar } = useSidebar();
	return (
		<Button type="button" variant="outline" icon={<Faders />} onClick={toggleSidebar}>
			{t`Settings`}
		</Button>
	);
}

function MobileSettingsCloseButton() {
	const { t } = useLingui();
	const { setOpenMobile } = useSidebar();
	return (
		<Button
			type="button"
			variant="ghost"
			shape="square"
			icon={<X />}
			aria-label={t`Close settings`}
			onClick={() => setOpenMobile(false)}
		/>
	);
}

interface FieldRendererProps {
	name: string;
	field: FieldDescriptor;
	value: unknown;
	onChange: (name: string, value: unknown) => void;
	onEditorReady?: (editor: Editor | null) => void;
	minimal?: boolean;
	pluginBlocks?: PluginBlockDef[];
	onBlockSidebarOpen?: (panel: BlockSidebarPanel) => void;
	onBlockSidebarClose?: () => void;
	manifest?: import("../lib/api/client.js").AdminManifest | null;
}

function editableFieldData(data: Record<string, unknown>, fields: Record<string, FieldDescriptor>) {
	return Object.fromEntries(Object.entries(data).filter(([name]) => !fields[name]?.readOnly));
}

function FieldRenderer({
	name,
	field,
	value,
	onChange,
	onEditorReady,
	minimal,
	pluginBlocks,
	onBlockSidebarOpen,
	onBlockSidebarClose,
	manifest,
}: FieldRendererProps) {
	const { t } = useLingui();
	const pluginAdmins = usePluginAdmins();
	const label = field.label || name.charAt(0).toUpperCase() + name.slice(1);
	const id = `field-${name}`;
	const labelClass = minimal ? "text-kumo-subtle/50 text-xs font-normal" : undefined;

	const handleChange = React.useCallback((v: unknown) => onChange(name, v), [onChange, name]);
	if (field.readOnly) {
		const option = Array.isArray(field.options)
			? field.options.find((entry) => entry.value === value)
			: undefined;
		const text =
			option?.label ??
			(typeof value === "string" ? value : value == null ? "" : JSON.stringify(value, null, 2));
		return field.kind === "json" || field.kind === "text" ? (
			<InputArea id={id} label={label} value={text} readOnly rows={8} dir="auto" />
		) : (
			<Input id={id} label={label} value={text} readOnly dir="auto" />
		);
	}

	if (field.widget) {
		const sepIdx = field.widget.indexOf(":");
		if (sepIdx <= 0) {
			console.warn(
				`[emdash] Field "${name}" has widget "${field.widget}" but it should use the format "pluginId:widgetName". Falling back to default editor.`,
			);
		}
		if (sepIdx > 0) {
			const pluginId = field.widget.slice(0, sepIdx);
			const widgetName = field.widget.slice(sepIdx + 1);
			const PluginField = pluginAdmins[pluginId]?.fields?.[widgetName] as
				| React.ComponentType<{
						value: unknown;
						onChange: (value: unknown) => void;
						label: string;
						id: string;
						required?: boolean;
						options?: Array<{ value: string; label: string }> | Record<string, unknown>;
						minimal?: boolean;
				  }>
				| undefined;
			if (typeof PluginField === "function") {
				return (
					<PluginFieldErrorBoundary fieldKind={field.kind}>
						<PluginField
							value={value}
							onChange={handleChange}
							label={label}
							id={id}
							required={field.required}
							options={field.options}
							minimal={minimal}
						/>
					</PluginFieldErrorBoundary>
				);
			}
			if (manifest) {
				const pluginManifest = manifest.plugins[pluginId];
				const widgetDef = pluginManifest?.fieldWidgets?.find((w) => w.name === widgetName);
				if (widgetDef?.elements && widgetDef.elements.length > 0) {
					return (
						<PluginFieldErrorBoundary fieldKind={field.kind}>
							<BlockKitFieldWidget
								label={label}
								elements={widgetDef.elements}
								value={value}
								onChange={handleChange}
							/>
						</PluginFieldErrorBoundary>
					);
				}
			}
		}
	}

	switch (field.kind) {
		case "string":
			return (
				<Input
					label={<span className={labelClass}>{label}</span>}
					id={id}
					value={typeof value === "string" ? value : ""}
					onChange={(e) => handleChange(e.target.value)}
					required={field.required}
					dir="auto"
					className={
						minimal
							? "border-0 bg-transparent px-0 text-lg font-medium focus-visible:ring-0 focus-visible:ring-offset-0"
							: undefined
					}
				/>
			);

		case "number":
			return (
				<Input
					label={<span className={labelClass}>{label}</span>}
					id={id}
					type="number"
					value={typeof value === "number" ? value : ""}
					onChange={(e) => handleChange(Number(e.target.value))}
					required={field.required}
				/>
			);

		case "boolean":
			return (
				<Switch id={id} label={label} checked={Boolean(value)} onCheckedChange={handleChange} />
			);

		case "portableText": {
			const labelId = `${id}-label`;
			return (
				<div id={id} className={cn(!minimal && "grid gap-2")}>
					{!minimal && (
						<Label>
							<span id={labelId}>{label}</span>
						</Label>
					)}
					<PortableTextEditor
						value={Array.isArray(value) ? value : []}
						onChange={handleChange}
						placeholder={t`Start writing, or type '/' for commands`}
						aria-labelledby={labelId}
						className={cn(
							!minimal &&
								"bg-kumo-control focus-within:ring-kumo-focus/50 focus-within:ring-[1.5px]",
						)}
						pluginBlocks={pluginBlocks}
						onEditorReady={onEditorReady}
						minimal={minimal}
						onBlockSidebarOpen={onBlockSidebarOpen}
						onBlockSidebarClose={onBlockSidebarClose}
					/>
				</div>
			);
		}

		case "richText":
			return (
				<InputArea
					label={label}
					id={id}
					value={typeof value === "string" ? value : ""}
					onChange={(e) => handleChange(e.target.value)}
					rows={10}
					dir="auto"
					placeholder={t`Enter markdown content...`}
				/>
			);

		case "select": {
			const selectOptions = Array.isArray(field.options) ? field.options : [];
			const selectItems: Record<string, string> = {};
			for (const opt of selectOptions) {
				selectItems[opt.value] = opt.label;
			}
			return (
				<Select
					id={id}
					label={label}
					value={typeof value === "string" ? value : ""}
					onValueChange={(v) => handleChange(v ?? "")}
					items={selectItems}
				>
					{selectOptions.map((opt) => (
						<Select.Option key={opt.value} value={opt.value}>
							{opt.label}
						</Select.Option>
					))}
				</Select>
			);
		}

		case "multiSelect": {
			const multiSelectOptions = Array.isArray(field.options) ? field.options : [];
			const selected: string[] = Array.isArray(value) ? (value as string[]) : [];
			return (
				<fieldset>
					<Label className={labelClass}>{label}</Label>
					<div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
						{multiSelectOptions.map((opt) => {
							const isChecked = selected.includes(opt.value);
							return (
								<Checkbox
									key={opt.value}
									label={opt.label}
									checked={isChecked}
									onCheckedChange={(checked) => {
										const next = checked
											? [...selected, opt.value]
											: selected.filter((v) => v !== opt.value);
										handleChange(next);
									}}
								/>
							);
						})}
					</div>
				</fieldset>
			);
		}

		case "datetime":
			return (
				<Input
					label={label}
					id={id}
					type="datetime-local"
					value={toDatetimeLocalInputValue(value)}
					onChange={(e) => handleChange(fromDatetimeLocalInputValue(e.target.value))}
					required={field.required}
				/>
			);

		case "image": {
			const imageValue =
				value != null && typeof value === "object" ? (value as ImageFieldValue) : undefined;
			return (
				<ImageFieldRenderer
					id={id}
					label={label}
					description={
						name === "featured_image"
							? t`Used as the main visual for this post on listing pages and at the top of the post`
							: undefined
					}
					value={imageValue}
					onChange={handleChange}
					required={field.required}
					allowedMimeTypes={
						Array.isArray(field.validation?.allowedMimeTypes)
							? (field.validation.allowedMimeTypes as string[])
							: undefined
					}
					fieldId={field.id}
					variant={name === "featured_image" ? "featured" : "default"}
				/>
			);
		}

		case "file": {
			const fileValue =
				value != null && typeof value === "object" ? (value as FileFieldValue) : undefined;
			return (
				<FileFieldRenderer
					id={id}
					label={label}
					value={fileValue}
					onChange={handleChange}
					required={field.required}
					allowedMimeTypes={
						Array.isArray(field.validation?.allowedMimeTypes)
							? (field.validation.allowedMimeTypes as string[])
							: undefined
					}
					fieldId={field.id}
				/>
			);
		}

		case "repeater": {
			const validation = field.validation;
			const subFields = (validation?.subFields ?? []) as Array<{
				slug: string;
				type: string;
				label: string;
				required?: boolean;
				options?: string[];
			}>;
			return (
				<RepeaterField
					label={label}
					id={id}
					value={value}
					onChange={handleChange}
					required={field.required}
					subFields={subFields}
					minItems={typeof validation?.minItems === "number" ? validation.minItems : undefined}
					maxItems={typeof validation?.maxItems === "number" ? validation.maxItems : undefined}
				/>
			);
		}

		case "json": {
			const jsonString =
				typeof value === "string" ? value : value != null ? JSON.stringify(value, null, 2) : "";
			return (
				<JsonFieldEditor
					label={label}
					id={id}
					value={jsonString}
					onChange={handleChange}
					required={field.required}
				/>
			);
		}

		case "url":
			return (
				<UrlFieldEditor
					label={label}
					labelClass={labelClass}
					id={id}
					value={typeof value === "string" ? value : ""}
					onChange={handleChange}
					required={field.required}
					placeholder="https://"
				/>
			);

		default:
			return (
				<Input
					label={label}
					id={id}
					value={typeof value === "string" ? value : ""}
					onChange={(e) => handleChange(e.target.value)}
					required={field.required}
					dir="auto"
				/>
			);
	}
}

const URL_PROTOCOL_PATTERN = /^https?:\/\//;

function isValidUrl(val: string): boolean {
	if (!URL_PROTOCOL_PATTERN.test(val)) return false;
	try {
		const url = new URL(val);
		if (url.protocol !== "http:" && url.protocol !== "https:") return false;
		if (url.hostname.includes("..")) return false;
		return url.hostname.includes(".") || url.hostname === "localhost";
	} catch {
		return false;
	}
}

function UrlFieldEditor({
	label,
	labelClass,
	id,
	value,
	onChange,
	required,
	placeholder,
}: {
	label: string;
	labelClass?: string;
	id: string;
	value: string;
	onChange: (value: unknown) => void;
	required?: boolean;
	placeholder?: string;
}) {
	const { t } = useLingui();
	const [error, setError] = React.useState<string | null>(null);

	const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
		const val = e.target.value.trim();
		if (!val) {
			setError(null);
			return;
		}
		if (!isValidUrl(val)) {
			setError(t`Enter a valid URL (e.g. https://example.com)`);
		} else {
			setError(null);
		}
	};

	return (
		<div>
			<Input
				label={<span className={labelClass}>{label}</span>}
				id={id}
				type="url"
				value={value}
				onChange={(e) => {
					if (error) setError(null);
					onChange(e.target.value);
				}}
				onBlur={handleBlur}
				required={required}
				placeholder={placeholder}
			/>
			{error && <p className="text-sm text-kumo-danger mt-1">{error}</p>}
		</div>
	);
}

function JsonFieldEditor({
	label,
	id,
	value,
	onChange,
	required,
}: {
	label: string;
	id: string;
	value: string;
	onChange: (value: unknown) => void;
	required?: boolean;
}) {
	const { t } = useLingui();
	const [text, setText] = React.useState(value);
	const [error, setError] = React.useState<string | null>(null);

	React.useEffect(() => {
		setText(value);
		setError(null);
	}, [value]);

	const handleChange = (newText: string) => {
		setText(newText);
		setError(null);
	};

	const handleBlur = () => {
		const trimmed = text.trim();
		if (trimmed === "") {
			setError(null);
			onChange(null);
			return;
		}
		try {
			const parsed = JSON.parse(trimmed);
			setError(null);
			onChange(parsed);
		} catch {
			setError(t`Invalid JSON`);
		}
	};

	return (
		<div>
			<InputArea
				label={label}
				id={id}
				value={text}
				onChange={(e) => handleChange(e.target.value)}
				onBlur={handleBlur}
				rows={8}
				placeholder="{}"
				required={required}
				className="font-mono text-sm"
			/>
			{error && <p className="text-sm text-kumo-danger mt-1">{error}</p>}
		</div>
	);
}

interface FileFieldValue {
	id: string;
	provider?: string;
	src?: string;
	url?: string;
	filename?: string;
	mimeType?: string;
	size?: number;
	meta?: Record<string, unknown>;
}

interface FileFieldRendererProps {
	id?: string;
	label: string;
	value: FileFieldValue | undefined;
	onChange: (value: FileFieldValue | null) => void;
	required?: boolean;
	allowedMimeTypes?: string[];
	fieldId?: string;
}

function FileFieldRenderer({
	id,
	label,
	value,
	onChange,
	required,
	allowedMimeTypes,
	fieldId,
}: FileFieldRendererProps) {
	const { t } = useLingui();
	const [pickerOpen, setPickerOpen] = React.useState(false);

	const normalized = React.useMemo(() => {
		if (!value) return null;
		const isLocal = !value.provider || value.provider === "local";
		const storageKey =
			typeof value.meta?.storageKey === "string" ? value.meta.storageKey : undefined;
		const directUrl = value.src ?? value.url;
		const localSrc =
			typeof directUrl === "string" && directUrl.startsWith("/_emdash/") ? directUrl : undefined;
		const localUrl = isLocal
			? storageKey
				? `/_emdash/api/media/file/${encodeURIComponent(storageKey)}`
				: (localSrc ?? `/_emdash/api/media/file/${encodeURIComponent(value.id)}`)
			: undefined;
		const externalUrl = !isLocal && directUrl && isSafeUrl(directUrl) ? directUrl : undefined;
		return {
			displayUrl: localUrl ?? externalUrl,
			filename: value.filename || t`Untitled file`,
			mimeType: value.mimeType || "",
			size: value.size,
		};
	}, [value, t]);

	const handleSelect = (item: MediaItem) => {
		const isLocalProvider = !item.provider || item.provider === "local";
		onChange({
			id: item.id,
			provider: item.provider || "local",
			src: isLocalProvider ? undefined : item.url,
			filename: item.filename,
			mimeType: item.mimeType,
			size: item.size,
			meta: isLocalProvider ? { ...item.meta, storageKey: item.storageKey } : item.meta,
		});
	};

	const handleRemove = () => {
		onChange(null);
	};

	const hasMime = !!normalized?.mimeType;
	const size = typeof normalized?.size === "number" ? normalized.size : undefined;
	const hasSize = size !== undefined;

	return (
		<div id={id} className="grid gap-2">
			<Label>{label}</Label>
			{normalized ? (
				<div className="flex items-center gap-3 rounded-lg border p-3">
					<span className="text-3xl" aria-hidden="true">
						{getFileIcon(normalized.mimeType)}
					</span>
					<div className="flex-1 min-w-0">
						{normalized.displayUrl ? (
							<a
								href={normalized.displayUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="text-sm font-medium truncate block hover:underline"
							>
								{normalized.filename}
							</a>
						) : (
							<p className="text-sm font-medium truncate">{normalized.filename}</p>
						)}
						{(hasMime || hasSize) && (
							<p className="text-xs text-kumo-subtle">
								{hasMime ? normalized.mimeType : null}
								{hasMime && hasSize ? " • " : null}
								{hasSize ? formatFileSize(size) : null}
							</p>
						)}
					</div>
					<div className="flex gap-1">
						<Button type="button" size="sm" variant="secondary" onClick={() => setPickerOpen(true)}>
							{t`Change`}
						</Button>
						<Button
							type="button"
							shape="square"
							variant="destructive"
							className="h-8 w-8"
							onClick={handleRemove}
							aria-label={t`Remove ${label}`}
						>
							<X className="h-4 w-4" />
						</Button>
					</div>
				</div>
			) : (
				<Button
					type="button"
					variant="outline"
					className="w-full h-32 justify-center border-dashed"
					onClick={() => setPickerOpen(true)}
					aria-label={t`Select ${label}`}
				>
					<div className="flex flex-col items-center gap-2 text-kumo-subtle">
						<Paperclip className="h-8 w-8" />
						<span>{t`Select file`}</span>
					</div>
				</Button>
			)}
			<MediaPickerModal
				open={pickerOpen}
				onOpenChange={setPickerOpen}
				onSelect={handleSelect}
				mimeTypeFilters={allowedMimeTypes ?? []}
				fieldId={fieldId}
				hideUrlInput
				mediaKind="file"
				title={t`Select ${label}`}
			/>
			{required && !normalized && (
				<p className="-mt-1 text-sm text-kumo-danger">{t`This field is required`}</p>
			)}
		</div>
	);
}
