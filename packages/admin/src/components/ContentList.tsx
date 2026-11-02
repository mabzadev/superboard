import {
	Badge,
	Button,
	Checkbox,
	DatePicker,
	Dialog,
	LinkButton,
	Loader,
	Popover,
	Select,
	Tabs,
} from "@cloudflare/kumo";
import type { DateRange } from "@cloudflare/kumo";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import {
	Plus,
	Pencil,
	Trash,
	ArrowCounterClockwise,
	ArrowSquareOut,
	Calendar,
	Copy,
	CaretUp,
	CaretDown,
	CaretUpDown,
	Upload,
	X,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import * as React from "react";

import type {
	AdminManifest,
	ContentAuthor,
	ContentDateField,
	ContentItem,
	TrashedContentItem,
} from "../lib/api.js";
import {
	ContentListColumnBoundary,
	resolveContentListColumns,
	type ResolvedContentListColumn,
} from "../lib/content-list-columns.js";
import { getEntryTitle } from "../lib/entryTitle.js";
import { useDebouncedValue } from "../lib/hooks.js";
import { usePluginAdmins } from "../lib/plugin-context.js";
import { contentUrl } from "../lib/url.js";
import { cn, parseTimestamp } from "../lib/utils";
import { getLocaleDir } from "../locales/config.js";
import { getDayPickerLocale } from "../locales/day-picker.js";
import { CaretNext, CaretPrev } from "./ArrowIcons.js";
import {
	BylineFilter,
	EMPTY_BYLINE_FILTER,
	isBylineFilterActive,
	type BylineFilterState,
} from "./BylineFilter.js";
import {
	ContentStatusBadge,
	ContentStatusLabel,
	isContentStatusState,
} from "./ContentStatusBadge.js";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { RouterLinkButton } from "./RouterLinkButton.js";
import { TableToolbar, TableToolbarSearch } from "./TableToolbar.js";

export type ContentListSortField = "title" | "status" | "locale" | "updatedAt" | (string & {});
export interface ContentListSort {
	field: ContentListSortField;
	direction: "asc" | "desc";
}

export interface ContentListColumn {
	slug: string;
	label: string;
	kind: string;
	options?: Array<{ value: string; label: string }>;
}

export type ContentStatusFilter = "all" | "published" | "draft" | "scheduled" | "archived";

export interface ContentDateFilter {
	field: ContentDateField;
	from: string;
	to: string;
}

export const EMPTY_DATE_FILTER: ContentDateFilter = { field: "createdAt", from: "", to: "" };

export interface ContentListProps {
	collection: string;
	collectionLabel: string;
	items: ContentItem[];
	listColumns?: ContentListColumn[];
	trashedItems?: TrashedContentItem[];
	isLoading?: boolean;
	isTrashedLoading?: boolean;
	onDelete?: (id: string) => void;
	onDuplicate?: (id: string) => void;
	onRestore?: (id: string) => void;
	onPermanentDelete?: (id: string) => void;
	onLoadMore?: () => void;
	onLoadMoreTrashed?: () => void;
	hasMore?: boolean;
	hasMoreTrashed?: boolean;
	trashedCount?: number;
	i18n?: { defaultLocale: string; locales: string[] };
	activeLocale?: string;
	onLocaleChange?: (locale: string) => void;
	urlPattern?: string;
	routable?: boolean;
	titleField?: string;
	dateField?: string;
	sort?: ContentListSort;
	onSortChange?: (sort: ContentListSort) => void;
	total?: number;
	onSearchChange?: (q: string) => void;
	statusFilter?: ContentStatusFilter;
	onStatusFilterChange?: (status: ContentStatusFilter) => void;
	authors?: ContentAuthor[];
	authorFilter?: string;
	onAuthorFilterChange?: (authorId: string) => void;
	dateFilter?: ContentDateFilter;
	onDateFilterChange?: (filter: ContentDateFilter) => void;
	bylineFilter?: BylineFilterState;
	onBylineFilterChange?: (filter: BylineFilterState) => void;
	onBulkPublish?: BulkActionHandler;
	onBulkUnpublish?: BulkActionHandler;
	onBulkDelete?: BulkActionHandler;
	userRole?: number;
	pluginStates?: AdminManifest["plugins"];
}

type BulkActionHandler = (ids: string[]) => Promise<string[]>;

type ViewTab = "all" | "trash";

const PAGE_SIZE = 20;

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseListDate(value: unknown): Date | null {
	if (typeof value !== "string" || !value) return null;
	const normalized = DATE_ONLY_RE.test(value) ? `${value}T00:00:00` : value;
	const parsed = new Date(normalized);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseDateOnly(value: string): Date | undefined {
	if (!DATE_ONLY_RE.test(value)) return undefined;
	const [year, month, day] = value.split("-").map(Number);
	if (year === undefined || month === undefined || day === undefined) return undefined;
	const date = new Date(year, month - 1, day);
	return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
		? date
		: undefined;
}

function formatDateOnly(date: Date | undefined): string {
	if (!date) return "";
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

export function ContentList({
	collection,
	collectionLabel,
	items,
	listColumns = [],
	trashedItems = [],
	isLoading,
	isTrashedLoading,
	onDelete,
	onDuplicate,
	onRestore,
	onPermanentDelete,
	onLoadMore,
	onLoadMoreTrashed,
	hasMore,
	hasMoreTrashed,
	trashedCount = 0,
	i18n,
	activeLocale,
	onLocaleChange,
	urlPattern,
	routable,
	titleField,
	dateField,
	sort,
	onSortChange,
	total,
	onSearchChange,
	statusFilter = "all",
	onStatusFilterChange,
	authors,
	authorFilter = "",
	onAuthorFilterChange,
	dateFilter = EMPTY_DATE_FILTER,
	onDateFilterChange,
	bylineFilter = EMPTY_BYLINE_FILTER,
	onBylineFilterChange,
	onBulkPublish,
	onBulkUnpublish,
	onBulkDelete,
	userRole = 0,
	pluginStates,
}: ContentListProps) {
	const { t } = useLingui();
	const pluginAdmins = usePluginAdmins();
	const [activeTab, setActiveTab] = React.useState<ViewTab>("all");
	const [searchQuery, setSearchQuery] = React.useState("");
	const [page, setPage] = React.useState(0);
	const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set());

	const bulkEnabled = !!(onBulkPublish || onBulkUnpublish || onBulkDelete);

	const serverSearch = !!onSearchChange;
	const debouncedSearch = useDebouncedValue(searchQuery, 300);
	React.useEffect(() => {
		if (onSearchChange) onSearchChange(debouncedSearch.trim());
	}, [debouncedSearch, onSearchChange]);

	const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setSearchQuery(e.target.value);
		setPage(0);
	};

	const filteredItems = React.useMemo(() => {
		if (serverSearch || !searchQuery) return items;
		const query = searchQuery.toLowerCase();
		return items.filter((item) => getEntryTitle(item, titleField).toLowerCase().includes(query));
	}, [items, searchQuery, serverSearch, titleField]);

	const activeSearch = serverSearch ? debouncedSearch.trim() : searchQuery;

	const effectiveTotal =
		typeof total === "number" && (serverSearch || !searchQuery) ? total : filteredItems.length;
	const totalPages = Math.max(1, Math.ceil(effectiveTotal / PAGE_SIZE));

	const clampedPage = Math.min(page, totalPages - 1);
	const paginatedItems = filteredItems.slice(
		clampedPage * PAGE_SIZE,
		(clampedPage + 1) * PAGE_SIZE,
	);

	React.useEffect(() => {
		if (!hasMore || !onLoadMore || (!serverSearch && searchQuery)) return;
		const loadedPages = Math.ceil(filteredItems.length / PAGE_SIZE);
		if (clampedPage >= loadedPages - 1) {
			onLoadMore();
		}
	}, [clampedPage, filteredItems.length, hasMore, onLoadMore, searchQuery, serverSearch]);

	React.useEffect(() => {
		setSelectedIds((prev) => {
			if (prev.size === 0) return prev;
			const present = new Set(items.map((i) => i.id));
			let changed = false;
			const next = new Set<string>();
			for (const id of prev) {
				if (present.has(id)) next.add(id);
				else changed = true;
			}
			return changed ? next : prev;
		});
	}, [items]);

	const clearSelection = React.useCallback(() => setSelectedIds(new Set()), []);
	const toggleOne = (id: string) =>
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	const pageIds = paginatedItems.map((i) => i.id);
	const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
	const togglePage = () =>
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (allPageSelected) for (const id of pageIds) next.delete(id);
			else for (const id of pageIds) next.add(id);
			return next;
		});
	const selectedCount = selectedIds.size;
	const extensionColumns = React.useMemo(
		() => resolveContentListColumns(pluginAdmins, collection, userRole, pluginStates),
		[collection, pluginAdmins, pluginStates, userRole],
	);
	const [bulkBusy, setBulkBusy] = React.useState(false);
	const runBulk = (fn?: BulkActionHandler) => {
		if (!fn || selectedCount === 0 || bulkBusy) return;
		const ids = [...selectedIds];
		setBulkBusy(true);
		void (async () => {
			try {
				const failedIds = await fn(ids);
				setSelectedIds(new Set(failedIds));
			} catch {
			} finally {
				setBulkBusy(false);
			}
		})();
	};
	const colSpan =
		(i18n ? 5 : 4) + listColumns.length + extensionColumns.length + (bulkEnabled ? 1 : 0);

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-4">
					<h1 className="text-2xl font-semibold leading-tight">{collectionLabel}</h1>
					{i18n && activeLocale && onLocaleChange && (
						<LocaleSwitcher
							locales={i18n.locales}
							defaultLocale={i18n.defaultLocale}
							value={activeLocale}
							onChange={onLocaleChange}
							size="sm"
						/>
					)}
				</div>
				<RouterLinkButton
					to="/content/$collection/new"
					params={{ collection }}
					search={{ locale: activeLocale }}
					icon={<Plus />}
				>
					{t`Add New`}
				</RouterLinkButton>
			</div>

			<Tabs
				variant="underline"
				value={activeTab}
				onValueChange={(v) => {
					if (v === "all" || v === "trash") setActiveTab(v);
				}}
				tabs={[
					{ value: "all", label: t`All` },
					{
						value: "trash",
						label: (
							<span className="flex items-center gap-2">
								<Trash className="h-4 w-4" aria-hidden="true" />
								{t`Trash`}
								{trashedCount > 0 && <Badge variant="secondary">{trashedCount}</Badge>}
							</span>
						),
					},
				]}
			/>

			{activeTab === "all" ? (
				<>
					{(serverSearch || items.length > 0 || onStatusFilterChange) && (
						<TableToolbar>
							{(serverSearch || items.length > 0) && (
								<TableToolbarSearch
									placeholder={t`Search ${collectionLabel.toLowerCase()}...`}
									aria-label={t`Search ${collectionLabel.toLowerCase()}`}
									value={searchQuery}
									onChange={handleSearchChange}
								/>
							)}
							{onStatusFilterChange && (
								<FilterBar
									statusFilter={statusFilter}
									onStatusFilterChange={onStatusFilterChange}
									authors={authors}
									authorFilter={authorFilter}
									onAuthorFilterChange={onAuthorFilterChange}
									dateFilter={dateFilter}
									onDateFilterChange={onDateFilterChange}
									bylineFilter={bylineFilter}
									onBylineFilterChange={onBylineFilterChange}
									locale={activeLocale ?? undefined}
								/>
							)}
						</TableToolbar>
					)}

					{bulkEnabled && selectedCount > 0 && (
						<div className="flex flex-wrap items-center gap-3 rounded-md border bg-kumo-tint/40 px-4 py-2">
							<span className="text-sm font-medium">
								{bulkBusy
									? t`Working on ${selectedCount} items…`
									: plural(selectedCount, { one: "# selected", other: "# selected" })}
							</span>
							<div className="flex flex-wrap items-center gap-2">
								{onBulkPublish && (
									<Button
										size="sm"
										variant="secondary"
										disabled={bulkBusy}
										onClick={() => runBulk(onBulkPublish)}
										icon={<Upload />}
									>
										{t`Publish`}
									</Button>
								)}
								{onBulkUnpublish && (
									<Button
										size="sm"
										variant="secondary"
										disabled={bulkBusy}
										onClick={() => runBulk(onBulkUnpublish)}
									>
										{t`Set to draft`}
									</Button>
								)}
								{onBulkDelete && (
									<Dialog.Root disablePointerDismissal>
										<Dialog.Trigger
											render={(p) => (
												<Button
													{...p}
													size="sm"
													variant="destructive"
													icon={<Trash />}
													disabled={bulkBusy}
												>
													{t`Move to trash`}
												</Button>
											)}
										/>
										<Dialog className="p-6" size="sm">
											<Dialog.Title className="text-lg font-semibold">{t`Move to Trash?`}</Dialog.Title>
											<Dialog.Description className="text-kumo-subtle">
												{plural(selectedCount, {
													one: "Move # item to trash? You can restore it later.",
													other: "Move # items to trash? You can restore them later.",
												})}
											</Dialog.Description>
											<div className="mt-6 flex justify-end gap-2">
												<Dialog.Close
													render={(p) => (
														<Button {...p} variant="secondary">
															{t`Cancel`}
														</Button>
													)}
												/>
												<Dialog.Close
													render={(p) => (
														<Button
															{...p}
															variant="destructive"
															onClick={() => runBulk(onBulkDelete)}
														>
															{t`Move to Trash`}
														</Button>
													)}
												/>
											</div>
										</Dialog>
									</Dialog.Root>
								)}
								<Button
									size="sm"
									variant="ghost"
									icon={<X />}
									disabled={bulkBusy}
									onClick={clearSelection}
								>
									{t`Clear`}
								</Button>
							</div>
						</div>
					)}

					<div className="rounded-md border bg-kumo-base overflow-x-auto">
						<table className="w-full">
							<thead>
								<tr className="border-b bg-kumo-tint/50">
									{bulkEnabled && (
										<th scope="col" className="w-10 px-4 py-3">
											<Checkbox
												checked={allPageSelected}
												onCheckedChange={togglePage}
												aria-label={t`Select all on this page`}
											/>
										</th>
									)}
									<SortableTh
										field={titleField ?? "title"}
										sort={sort}
										onSortChange={onSortChange}
										label={t`Title`}
									/>
									{listColumns.map((column) => (
										<th
											key={column.slug}
											scope="col"
											className="px-4 py-3 text-start text-sm font-medium"
										>
											{column.label}
										</th>
									))}
									<SortableTh
										field="status"
										sort={sort}
										onSortChange={onSortChange}
										label={t`Status`}
									/>
									{i18n && (
										<SortableTh
											field="locale"
											sort={sort}
											onSortChange={onSortChange}
											label={t`Locale`}
										/>
									)}
									<SortableTh
										field={dateField ?? "updatedAt"}
										sort={sort}
										onSortChange={onSortChange}
										label={t`Date`}
									/>
									{extensionColumns.map((column) => (
										<ExtensionColumnHeader
											key={`${column.pluginId}:${column.extension.id}`}
											column={column}
											collection={collection}
											locale={activeLocale}
										/>
									))}
									<th scope="col" className="px-4 py-3 text-end text-sm font-medium">
										{t`Actions`}
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-kumo-line">
								{isLoading && items.length === 0 ? (
									<tr>
										<td colSpan={colSpan} className="px-4 py-8 text-center text-kumo-subtle">
											<span className="inline-flex items-center gap-2">
												<Loader size="sm" />
												{t`Loading...`}
											</span>
										</td>
									</tr>
								) : items.length === 0 ? (
									<tr>
										<td colSpan={colSpan} className="px-4 py-8 text-center text-kumo-subtle">
											{activeSearch ? (
												t`No results for "${activeSearch}"`
											) : (
												<>
													{t`No ${collectionLabel.toLowerCase()} yet.`}{" "}
													<Link
														to="/content/$collection/new"
														params={{ collection }}
														search={{ locale: activeLocale }}
														className="text-kumo-link underline"
													>
														{t`Create your first one`}
													</Link>
												</>
											)}
										</td>
									</tr>
								) : paginatedItems.length === 0 ? (
									<tr>
										<td colSpan={colSpan} className="px-4 py-8 text-center text-kumo-subtle">
											{t`No results for "${activeSearch}"`}
										</td>
									</tr>
								) : (
									paginatedItems.map((item) => (
										<ContentListItem
											key={item.id}
											item={item}
											visibleItems={paginatedItems}
											collection={collection}
											onDelete={onDelete}
											onDuplicate={onDuplicate}
											showLocale={!!i18n}
											urlPattern={urlPattern}
											routable={routable}
											titleField={titleField}
											dateField={dateField}
											listColumns={listColumns}
											selectable={bulkEnabled}
											selected={selectedIds.has(item.id)}
											onToggleSelect={toggleOne}
											extensionColumns={extensionColumns}
										/>
									))
								)}
							</tbody>
						</table>
					</div>

					{totalPages > 1 && (
						<div className="flex items-center justify-between">
							<span className="text-sm text-kumo-subtle">
								{renderItemCount({
									searchQuery: activeSearch,
									filteredCount: filteredItems.length,
									total,
									hasMore,
									serverSearch,
								})}
							</span>
							<div className="flex items-center gap-2">
								<Button
									variant="outline"
									shape="square"
									disabled={clampedPage === 0}
									onClick={() => setPage(clampedPage - 1)}
									aria-label={t`Previous page`}
								>
									<CaretPrev className="h-4 w-4" aria-hidden="true" />
								</Button>
								<span className="text-sm">
									{clampedPage + 1} / {totalPages}
								</span>
								<Button
									variant="outline"
									shape="square"
									disabled={clampedPage >= totalPages - 1}
									onClick={() => setPage(clampedPage + 1)}
									aria-label={t`Next page`}
								>
									<CaretNext className="h-4 w-4" aria-hidden="true" />
								</Button>
							</div>
						</div>
					)}

					{hasMore && (
						<div className="flex justify-center">
							<Button variant="outline" onClick={onLoadMore} disabled={isLoading}>
								{isLoading ? t`Loading...` : t`Load More`}
							</Button>
						</div>
					)}
				</>
			) : (
				<>
					<div className="rounded-md border bg-kumo-base overflow-x-auto">
						<table className="w-full">
							<thead>
								<tr className="border-b bg-kumo-tint/50">
									<th scope="col" className="px-4 py-3 text-start text-sm font-medium">
										{t`Title`}
									</th>
									<th scope="col" className="px-4 py-3 text-start text-sm font-medium">
										{t`Deleted`}
									</th>
									<th scope="col" className="px-4 py-3 text-end text-sm font-medium">
										{t`Actions`}
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-kumo-line">
								{isTrashedLoading && trashedItems.length === 0 ? (
									<tr>
										<td colSpan={3} className="px-4 py-8 text-center text-kumo-subtle">
											<span className="inline-flex items-center gap-2">
												<Loader size="sm" />
												{t`Loading...`}
											</span>
										</td>
									</tr>
								) : trashedItems.length === 0 ? (
									<tr>
										<td colSpan={3} className="px-4 py-8 text-center text-kumo-subtle">
											{t`Trash is empty`}
										</td>
									</tr>
								) : (
									trashedItems.map((item) => (
										<TrashedListItem
											key={item.id}
											item={item}
											titleField={titleField}
											onRestore={onRestore}
											onPermanentDelete={onPermanentDelete}
										/>
									))
								)}
							</tbody>
						</table>
					</div>

					{hasMoreTrashed && (
						<div className="flex justify-center">
							<Button variant="outline" onClick={onLoadMoreTrashed} disabled={isTrashedLoading}>
								{isTrashedLoading ? t`Loading...` : t`Load More`}
							</Button>
						</div>
					)}
				</>
			)}
		</div>
	);
}

interface FilterBarProps {
	statusFilter: ContentStatusFilter;
	onStatusFilterChange: (status: ContentStatusFilter) => void;
	authors?: ContentAuthor[];
	authorFilter: string;
	onAuthorFilterChange?: (authorId: string) => void;
	dateFilter: ContentDateFilter;
	onDateFilterChange?: (filter: ContentDateFilter) => void;
	bylineFilter: BylineFilterState;
	onBylineFilterChange?: (filter: BylineFilterState) => void;
	locale?: string;
}

function FilterBar({
	statusFilter,
	onStatusFilterChange,
	authors,
	authorFilter,
	onAuthorFilterChange,
	dateFilter,
	onDateFilterChange,
	bylineFilter,
	onBylineFilterChange,
	locale,
}: FilterBarProps) {
	const { t } = useLingui();

	const showAuthorFilter = !!onAuthorFilterChange && !!authors && authors.length > 0;
	const showDateFilter = !!onDateFilterChange;

	const statusItems: Record<ContentStatusFilter, string> = {
		all: t`All statuses`,
		published: t`Published`,
		draft: t`Draft`,
		scheduled: t`Scheduled`,
		archived: t`Archived`,
	};
	const renderStatusLabel = (value: ContentStatusFilter) =>
		value === "all" ? statusItems.all : <ContentStatusLabel state={value} />;

	const dateFieldItems: Record<string, string> = {
		createdAt: t`Created`,
		updatedAt: t`Updated`,
		publishedAt: t`Published`,
	};

	const hasActiveFilter =
		statusFilter !== "all" ||
		authorFilter !== "" ||
		!!dateFilter.from ||
		!!dateFilter.to ||
		isBylineFilterActive(bylineFilter);

	const handleClear = () => {
		onStatusFilterChange("all");
		onAuthorFilterChange?.("");
		onDateFilterChange?.(EMPTY_DATE_FILTER);
		onBylineFilterChange?.({
			...EMPTY_BYLINE_FILTER,
			includeInferred: bylineFilter.includeInferred,
		});
	};

	return (
		<>
			<Select
				size="sm"
				className="emdash-status-filter-trigger min-w-32 ps-3.5"
				aria-label={t`Filter by status`}
				value={statusFilter}
				onValueChange={(v) => onStatusFilterChange((v as ContentStatusFilter) ?? "all")}
				renderValue={(v) =>
					renderStatusLabel(typeof v === "string" && Object.hasOwn(statusItems, v) ? v : "all")
				}
				items={statusItems}
			>
				{Object.entries(statusItems).map(([value]) => (
					<Select.Option key={value} value={value} className="emdash-compact-select-option text-xs">
						{renderStatusLabel(value as ContentStatusFilter)}
					</Select.Option>
				))}
			</Select>

			{showAuthorFilter && (
				<Select
					size="sm"
					aria-label={t`Filter by author`}
					value={authorFilter}
					onValueChange={(v) => onAuthorFilterChange?.(v ?? "")}
					items={{
						"": t`All authors`,
						...Object.fromEntries(authors.map((a) => [a.id, a.name || a.email])),
					}}
				>
					<Select.Option value="">{t`All authors`}</Select.Option>
					{authors.map((a) => (
						<Select.Option key={a.id} value={a.id}>
							{a.name || a.email}
						</Select.Option>
					))}
				</Select>
			)}

			{onBylineFilterChange && (
				<BylineFilter value={bylineFilter} onChange={onBylineFilterChange} locale={locale} />
			)}

			{showDateFilter && (
				<>
					<Select
						size="sm"
						className="emdash-date-field-filter-trigger min-w-28 ps-3.5"
						aria-label={t`Date field to filter on`}
						value={dateFilter.field}
						onValueChange={(v) =>
							onDateFilterChange?.({ ...dateFilter, field: (v as ContentDateField) ?? "createdAt" })
						}
						items={dateFieldItems}
					>
						{Object.entries(dateFieldItems).map(([value, label]) => (
							<Select.Option
								key={value}
								value={value}
								className="emdash-compact-select-option text-xs"
							>
								{label}
							</Select.Option>
						))}
					</Select>
					<DateRangeFilter value={dateFilter} onChange={onDateFilterChange} />
				</>
			)}

			{hasActiveFilter && (
				<Button variant="ghost" size="sm" onClick={handleClear} icon={<X />}>
					{t`Clear filters`}
				</Button>
			)}
		</>
	);
}

function DateRangeFilter({
	value,
	onChange,
}: {
	value: ContentDateFilter;
	onChange: (filter: ContentDateFilter) => void;
}) {
	const { i18n, t } = useLingui();
	const from = parseDateOnly(value.from);
	const to = parseDateOnly(value.to);
	const formatter = React.useMemo(
		() => new Intl.DateTimeFormat(i18n.locale, { dateStyle: "medium" }),
		[i18n.locale],
	);
	const rangeLabel = from
		? to
			? formatter.formatRange(from, to)
			: t`From ${formatter.format(from)}`
		: to
			? t`Until ${formatter.format(to)}`
			: t`Date range`;
	const selected: DateRange | undefined = from ? { from, to } : to ? { from: to, to } : undefined;
	const dayPickerLocale = getDayPickerLocale(i18n.locale);
	const direction = getLocaleDir(i18n.locale);
	const isUpperBoundOnly = !from && !!to;
	const canUseAsEndDate = !!from && (!to || value.from === value.to);

	const handleChange = (range: DateRange | undefined, triggerDate?: Date) => {
		if (isUpperBoundOnly && triggerDate) {
			onChange({
				...value,
				from: "",
				to: formatDateOnly(triggerDate),
			});
			return;
		}
		onChange({
			...value,
			from: formatDateOnly(range?.from),
			to: formatDateOnly(range?.to),
		});
	};
	const handleUseAsEndDate = () => {
		if (!from || !canUseAsEndDate) return;
		onChange({
			...value,
			from: "",
			to: formatDateOnly(from),
		});
	};

	return (
		<Popover>
			<Popover.Trigger
				render={
					<Button
						variant="secondary"
						size="sm"
						icon={
							<span
								className="emdash-date-range-icon flex size-3 shrink-0 items-center justify-center"
								aria-hidden="true"
							>
								<Calendar className="size-3" />
							</span>
						}
						aria-label={t`Filter by date range: ${rangeLabel}`}
						className="emdash-date-range-trigger px-3.5 font-normal"
					/>
				}
			>
				<span className="emdash-date-range-label">{rangeLabel}</span>
			</Popover.Trigger>
			<Popover.Content align="start" className="w-auto px-3 py-2.5">
				<Popover.Title className="text-sm font-medium">{t`Choose a date range`}</Popover.Title>
				<DatePicker
					mode="range"
					selected={selected}
					defaultMonth={from ?? to}
					onChange={handleChange}
					aria-label={t`Choose a date range`}
					className="mt-1"
					locale={dayPickerLocale}
					dir={direction}
				/>
				<div className="mt-1 flex flex-wrap items-center justify-end gap-2 border-t border-kumo-line pt-2">
					{(from || to) && (
						<Button size="sm" variant="ghost" onClick={() => handleChange(undefined)}>
							{t`Clear`}
						</Button>
					)}
					{canUseAsEndDate && (
						<Button size="sm" variant="ghost" onClick={handleUseAsEndDate}>
							{t`Use as end date`}
						</Button>
					)}
					<Popover.Close render={<Button size="sm" variant="secondary" />}>{t`Done`}</Popover.Close>
				</div>
			</Popover.Content>
		</Popover>
	);
}

interface SortableThProps {
	field: ContentListSortField;
	sort: ContentListSort | undefined;
	onSortChange: ((sort: ContentListSort) => void) | undefined;
	label: string;
}

function SortableTh({ field, sort, onSortChange, label }: SortableThProps) {
	const isActive = sort?.field === field;
	const direction = isActive ? sort?.direction : undefined;

	if (!onSortChange) {
		return (
			<th scope="col" className="px-4 py-3 text-start text-sm font-medium">
				{label}
			</th>
		);
	}

	const ariaSort: "ascending" | "descending" | "none" = isActive
		? direction === "asc"
			? "ascending"
			: "descending"
		: "none";

	const handleClick = () => {
		if (isActive) {
			onSortChange({ field, direction: direction === "asc" ? "desc" : "asc" });
		} else {
			onSortChange({ field, direction: "desc" });
		}
	};

	const Icon = isActive ? (direction === "asc" ? CaretUp : CaretDown) : CaretUpDown;

	return (
		<th scope="col" aria-sort={ariaSort} className="px-4 py-3 text-start text-sm font-medium">
			<button
				type="button"
				onClick={handleClick}
				className={cn(
					"inline-flex items-center gap-1 rounded text-kumo-default hover:text-kumo-link",
					"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kumo-brand",
				)}
			>
				<span>{label}</span>
				<Icon className="h-3 w-3" aria-hidden="true" />
			</button>
		</th>
	);
}

interface ExtensionColumnHeaderProps {
	column: ResolvedContentListColumn;
	collection: string;
	locale?: string;
}

function ExtensionColumnHeader({ column, collection, locale }: ExtensionColumnHeaderProps) {
	const { i18n } = useLingui();
	const { pluginId, extension } = column;
	const Header = extension.header;
	const label = i18n._(extension.label);

	return (
		<th
			scope="col"
			aria-label={label}
			className={cn(
				"px-4 py-3 text-sm font-medium",
				extension.align === "end" ? "text-end" : "text-start",
			)}
		>
			<ContentListColumnBoundary
				key={`${collection}:${locale ?? ""}:${pluginId}:${extension.id}`}
				pluginId={pluginId}
				columnId={extension.id}
				fallback={label}
			>
				{Header ? <Header collection={collection} locale={locale} /> : label}
			</ContentListColumnBoundary>
		</th>
	);
}

function renderItemCount({
	searchQuery,
	filteredCount,
	total,
	hasMore,
	serverSearch,
}: {
	searchQuery: string;
	filteredCount: number;
	total: number | undefined;
	hasMore: boolean | undefined;
	serverSearch: boolean;
}): string {
	if (searchQuery) {
		const matchCount = serverSearch && typeof total === "number" ? total : filteredCount;
		return plural(matchCount, {
			one: `# item matching "${searchQuery}"`,
			other: `# items matching "${searchQuery}"`,
		});
	}
	if (typeof total === "number") {
		return plural(total, {
			one: `# item`,
			other: `# items`,
		});
	}
	return plural(filteredCount, {
		one: `#${hasMore ? "+" : ""} item`,
		other: `#${hasMore ? "+" : ""} items`,
	});
}

interface ContentListItemProps {
	item: ContentItem;
	visibleItems: readonly ContentItem[];
	collection: string;
	onDelete?: (id: string) => void;
	onDuplicate?: (id: string) => void;
	showLocale?: boolean;
	urlPattern?: string;
	routable?: boolean;
	titleField?: string;
	dateField?: string;
	listColumns: ContentListColumn[];
	selectable?: boolean;
	selected?: boolean;
	onToggleSelect?: (id: string) => void;
	extensionColumns?: ResolvedContentListColumn[];
}

function ContentListItem({
	item,
	visibleItems,
	collection,
	onDelete,
	onDuplicate,
	showLocale,
	urlPattern,
	routable,
	titleField,
	dateField,
	listColumns,
	selectable,
	selected,
	onToggleSelect,
	extensionColumns,
}: ContentListItemProps) {
	const { t } = useLingui();
	const title = getEntryTitle(item, titleField);
	const customDate = dateField ? parseListDate(item.data[dateField]) : null;
	const date = customDate ?? parseTimestamp(item.updatedAt || item.createdAt);

	return (
		<tr className={cn("hover:bg-kumo-tint/25", selected && "bg-kumo-tint/40")}>
			{selectable && (
				<td className="px-4 py-3">
					<Checkbox
						checked={!!selected}
						onCheckedChange={() => onToggleSelect?.(item.id)}
						aria-label={t`Select ${title}`}
					/>
				</td>
			)}
			<td className="px-4 py-3">
				<Link
					to="/content/$collection/$id"
					params={{ collection, id: item.id }}
					search={{ locale: item.locale }}
					className="font-medium hover:text-kumo-link"
				>
					{title}
				</Link>
			</td>
			{listColumns.map((column) => (
				<ContentListCustomCell key={column.slug} column={column} value={item.data[column.slug]} />
			))}
			<td className="px-4 py-3">
				<StatusBadge
					status={item.status}
					hasPendingChanges={!!item.draftRevisionId && item.draftRevisionId !== item.liveRevisionId}
				/>
			</td>
			{showLocale && (
				<td className="px-4 py-3">
					<span className="bg-kumo-tint rounded px-1.5 py-0.5 text-xs font-semibold uppercase">
						{item.locale}
					</span>
				</td>
			)}
			<td data-testid="content-updated" className="px-4 py-3 text-sm text-kumo-subtle">
				{date.toLocaleDateString()}
			</td>
			{extensionColumns?.map(({ pluginId, extension }) => {
				const Cell = extension.cell;
				return (
					<td
						key={`${pluginId}:${extension.id}`}
						className={cn(
							"px-4 py-3 text-sm",
							extension.align === "end" ? "text-end" : "text-start",
						)}
					>
						<ContentListColumnBoundary
							key={`${collection}:${item.locale}:${item.id}:${pluginId}:${extension.id}`}
							pluginId={pluginId}
							columnId={extension.id}
							resetKey={item.updatedAt}
						>
							<Cell
								collection={collection}
								item={item}
								locale={item.locale}
								visibleItems={visibleItems}
							/>
						</ContentListColumnBoundary>
					</td>
				);
			})}
			<td className="px-4 py-3 text-end">
				<div className="flex items-center justify-end space-x-1">
					{routable !== false && item.status === "published" && item.slug && (
						<LinkButton
							href={contentUrl(collection, item.slug, urlPattern)}
							external
							variant="ghost"
							shape="square"
							aria-label={t`View published ${title}`}
							icon={<ArrowSquareOut />}
						/>
					)}
					<RouterLinkButton
						to="/content/$collection/$id"
						params={{ collection, id: item.id }}
						search={{ locale: item.locale }}
						aria-label={t`Edit ${title}`}
						variant="ghost"
						shape="square"
						icon={<Pencil />}
					/>
					<Button
						variant="ghost"
						shape="square"
						aria-label={t`Duplicate ${title}`}
						onClick={() => onDuplicate?.(item.id)}
					>
						<Copy className="h-4 w-4" aria-hidden="true" />
					</Button>
					<Dialog.Root disablePointerDismissal>
						<Dialog.Trigger
							render={(p) => (
								<Button
									{...p}
									variant="ghost"
									shape="square"
									aria-label={t`Move ${title} to trash`}
								>
									<Trash className="h-4 w-4 text-kumo-danger" aria-hidden="true" />
								</Button>
							)}
						/>
						<Dialog className="p-6" size="sm">
							<Dialog.Title className="text-lg font-semibold">{t`Move to Trash?`}</Dialog.Title>
							<Dialog.Description className="text-kumo-subtle">
								{t`Move "${title}" to trash? You can restore it later.`}
							</Dialog.Description>
							<div className="mt-6 flex justify-end gap-2">
								<Dialog.Close
									render={(p) => (
										<Button {...p} variant="secondary">
											{t`Cancel`}
										</Button>
									)}
								/>
								<Dialog.Close
									render={(p) => (
										<Button {...p} variant="destructive" onClick={() => onDelete?.(item.id)}>
											{t`Move to Trash`}
										</Button>
									)}
								/>
							</div>
						</Dialog>
					</Dialog.Root>
				</div>
			</td>
		</tr>
	);
}

function ContentListCustomCell({
	column,
	value,
}: {
	column: ContentListColumn;
	value: unknown;
}): React.ReactNode {
	const { i18n, t } = useLingui();
	const text = formatListColumnValue(column, value, {
		emptyLabel: t`Not set`,
		falseLabel: t`No`,
		locale: i18n.locale,
		trueLabel: t`Yes`,
	});
	return (
		<td className="max-w-48 px-4 py-3 text-sm">
			<span className="block truncate" title={text}>
				{text}
			</span>
		</td>
	);
}

interface ListColumnFormatOptions {
	emptyLabel: string;
	falseLabel: string;
	locale: string;
	trueLabel: string;
}

function formatListColumnValue(
	column: ContentListColumn,
	value: unknown,
	{ emptyLabel, falseLabel, locale, trueLabel }: ListColumnFormatOptions,
): string {
	if (value === null || value === undefined || value === "") return emptyLabel;

	const optionLabel = (optionValue: unknown): string => {
		const text = scalarListColumnValue(optionValue);
		if (text === undefined) return emptyLabel;
		return column.options?.find((option) => option.value === text)?.label ?? text;
	};

	switch (column.kind) {
		case "select":
			return optionLabel(value);
		case "multiSelect": {
			let values: unknown[];
			if (Array.isArray(value)) {
				values = value;
			} else if (typeof value === "string") {
				try {
					const parsed: unknown = JSON.parse(value);
					values = Array.isArray(parsed) ? parsed : [value];
				} catch {
					values = [value];
				}
			} else {
				values = [value];
			}
			return values.length > 0
				? new Intl.ListFormat(locale, { style: "short", type: "unit" }).format(
						values.map(optionLabel),
					)
				: emptyLabel;
		}
		case "boolean":
			return value === true || value === 1 || value === "1" || value === "true"
				? trueLabel
				: falseLabel;
		case "datetime": {
			const text = scalarListColumnValue(value);
			if (text === undefined) return emptyLabel;
			const date = new Date(text);
			return Number.isNaN(date.getTime()) ? text : new Intl.DateTimeFormat(locale).format(date);
		}
		case "number": {
			if (typeof value === "number" || typeof value === "bigint") {
				return new Intl.NumberFormat(locale).format(value);
			}
			return scalarListColumnValue(value) ?? emptyLabel;
		}
		case "string":
		default:
			return scalarListColumnValue(value) ?? emptyLabel;
	}
}

function scalarListColumnValue(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
		return String(value);
	}
	return undefined;
}

interface TrashedListItemProps {
	item: TrashedContentItem;
	titleField?: string;
	onRestore?: (id: string) => void;
	onPermanentDelete?: (id: string) => void;
}

function TrashedListItem({ item, titleField, onRestore, onPermanentDelete }: TrashedListItemProps) {
	const { t } = useLingui();
	const title = getEntryTitle(item, titleField);
	const deletedDate = parseTimestamp(item.deletedAt);

	return (
		<tr className="hover:bg-kumo-tint/25">
			<td className="px-4 py-3">
				<span className="font-medium text-kumo-subtle">{title}</span>
			</td>
			<td className="px-4 py-3 text-sm text-kumo-subtle">{deletedDate.toLocaleDateString()}</td>
			<td className="px-4 py-3 text-end">
				<div className="flex items-center justify-end space-x-1">
					<Button
						variant="ghost"
						shape="square"
						aria-label={t`Restore ${title}`}
						onClick={() => onRestore?.(item.id)}
					>
						<ArrowCounterClockwise className="h-4 w-4 text-kumo-link" aria-hidden="true" />
					</Button>
					<Dialog.Root disablePointerDismissal>
						<Dialog.Trigger
							render={(p) => (
								<Button
									{...p}
									variant="ghost"
									shape="square"
									aria-label={t`Permanently delete ${title}`}
								>
									<Trash className="h-4 w-4 text-kumo-danger" aria-hidden="true" />
								</Button>
							)}
						/>
						<Dialog className="p-6" size="sm">
							<Dialog.Title className="text-lg font-semibold">
								{t`Delete Permanently?`}
							</Dialog.Title>
							<Dialog.Description className="text-kumo-subtle">
								{t`Permanently delete "${title}"? This cannot be undone.`}
							</Dialog.Description>
							<div className="mt-6 flex justify-end gap-2">
								<Dialog.Close
									render={(p) => (
										<Button {...p} variant="secondary">
											{t`Cancel`}
										</Button>
									)}
								/>
								<Dialog.Close
									render={(p) => (
										<Button
											{...p}
											variant="destructive"
											onClick={() => onPermanentDelete?.(item.id)}
										>
											{t`Delete Permanently`}
										</Button>
									)}
								/>
							</div>
						</Dialog>
					</Dialog.Root>
				</div>
			</td>
		</tr>
	);
}

function StatusBadge({
	status,
	hasPendingChanges,
}: {
	status: string;
	hasPendingChanges?: boolean;
}) {
	const state = isContentStatusState(status) ? status : undefined;

	return (
		<span className="inline-flex items-center gap-1.5">
			{state ? <ContentStatusBadge state={state} /> : <Badge variant="neutral">{status}</Badge>}
			{hasPendingChanges && <ContentStatusBadge state="pendingChanges" />}
		</span>
	);
}
