import { Button, Dialog, Input, Label, Loader } from "@cloudflare/kumo";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { Upload, Image, Check, Globe, MagnifyingGlass, Paperclip } from "@phosphor-icons/react";
import { X } from "@phosphor-icons/react";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import {
	MEDIA_SEARCH_MAX_LENGTH,
	fetchMediaList,
	fetchMediaProviders,
	fetchProviderMedia,
	uploadMedia,
	uploadToProvider,
	updateMedia,
	type MediaItem,
	type MediaProviderItem,
} from "../lib/api";
import { useDebouncedValue } from "../lib/hooks.js";
import {
	providerItemToMediaItem,
	getFileIcon,
	getMediaThumbnailUrl,
	getMediaObjectPosition,
	fallbackToOriginalThumbnail,
} from "../lib/media-utils";
import { matchesMimeAllowlist, mimeFromUrl } from "../lib/mime-utils.js";
import { cn } from "../lib/utils";
import { DialogError } from "./DialogError.js";

interface SelectedMedia {
	providerId: string;
	item: MediaItem | MediaProviderItem;
}

function matchesAnyFilter(mime: string, filters: string[] | undefined): boolean {
	if (!filters || filters.length === 0) return true;
	const normalizedMime = mime.toLowerCase();
	for (const entry of filters) {
		if (!entry || !entry.includes("/")) continue;
		const normalizedEntry = entry.toLowerCase();
		if (normalizedEntry.endsWith("/")) {
			if (normalizedMime.startsWith(normalizedEntry)) return true;
		} else if (normalizedMime === normalizedEntry) {
			return true;
		}
	}
	return false;
}

export interface MediaPickerModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSelect: (item: MediaItem) => void;
	multiple?: boolean;
	onSelectMany?: (items: MediaItem[]) => void;
	mimeTypeFilter?: string;
	title?: string;
	hideUrlInput?: boolean;
	mediaKind?: "image" | "file";
	mimeTypeFilters?: string[];
	fieldId?: string;
	localOnly?: boolean;
}

function probeImageDimensions(
	url: string,
	errorMessage: string,
): Promise<{ width: number; height: number }> {
	return new Promise((resolve, reject) => {
		const img = new window.Image();
		img.onload = () => {
			resolve({ width: img.naturalWidth, height: img.naturalHeight });
		};
		img.onerror = () => {
			reject(new Error(errorMessage));
		};
		img.src = url;
	});
}

export function MediaPickerModal({
	open,
	onOpenChange,
	onSelect,
	multiple = false,
	onSelectMany,
	mimeTypeFilter = "image/",
	mimeTypeFilters,
	fieldId,
	title: providedTitle,
	hideUrlInput = false,
	mediaKind = "image",
	localOnly = false,
}: MediaPickerModalProps) {
	const { t } = useLingui();
	const isFileKind = mediaKind === "file";

	const filters = React.useMemo(() => {
		if (mimeTypeFilters !== undefined)
			return mimeTypeFilters.length > 0 ? mimeTypeFilters : undefined;
		if (mimeTypeFilter && mimeTypeFilter.length > 0) return [mimeTypeFilter];
		return undefined;
	}, [mimeTypeFilters, mimeTypeFilter]);
	const title = providedTitle ?? (isFileKind ? t`Select File` : t`Select Image`);
	const emptyStateUploadHint = isFileKind
		? t`Upload a file to get started`
		: t`Upload an image to get started`;
	const emptyStateUploadCta = isFileKind ? t`Upload File` : t`Upload Image`;
	const EmptyStateIcon = isFileKind ? Paperclip : Image;
	const queryClient = useQueryClient();
	const [selectedItem, setSelectedItem] = React.useState<SelectedMedia | null>(null);
	const [selectedItems, setSelectedItems] = React.useState<SelectedMedia[]>([]);
	const [activeProvider, setActiveProvider] = React.useState<string>("local");
	const [searchQuery, setSearchQuery] = React.useState("");
	const debouncedSearch = useDebouncedValue(searchQuery, 300);
	const fileInputRef = React.useRef<HTMLInputElement>(null);

	const [imageUrl, setImageUrl] = React.useState("");
	const [isProbing, setIsProbing] = React.useState(false);
	const [urlError, setUrlError] = React.useState<string | null>(null);

	const [providerDimensions, setProviderDimensions] = React.useState<
		Record<string, { width: number; height: number }>
	>({});

	React.useEffect(() => {
		if (open) {
			setSelectedItem(null);
			setSelectedItems([]);
			setActiveProvider("local");
			setSearchQuery("");
			setImageUrl("");
			setUrlError(null);
			setUploadError(null);
			setProviderDimensions({});
		}
	}, [open, localOnly]);

	const { data: providers } = useQuery({
		queryKey: ["media-providers"],
		queryFn: fetchMediaProviders,
		enabled: open && !localOnly,
		placeholderData: [],
	});

	const activeProviderInfo = React.useMemo(() => {
		if (activeProvider === "local") {
			return {
				id: "local",
				name: t`Library`,
				icon: undefined,
				capabilities: { browse: true, search: false, upload: true, delete: true },
			};
		}
		return providers?.find((p) => p.id === activeProvider);
	}, [activeProvider, providers, t]);

	const mediaQueryKey = ["media", filters?.join(",") ?? "", debouncedSearch.trim()];
	const {
		data: localData,
		isLoading: localLoading,
		fetchNextPage: fetchNextLocalPage,
		hasNextPage: hasNextLocalPage,
		isFetchingNextPage: isFetchingNextLocalPage,
	} = useInfiniteQuery({
		queryKey: mediaQueryKey,
		queryFn: ({ pageParam }) =>
			fetchMediaList({
				mimeType: filters,
				cursor: pageParam,
				limit: 100,
				search: debouncedSearch.trim() || undefined,
			}),
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (lastPage) => lastPage.nextCursor,
		enabled: open && activeProvider === "local",
	});

	const { data: providerData, isLoading: providerLoading } = useQuery({
		queryKey: ["provider-media", activeProvider, filters?.join(",") ?? "", searchQuery],
		queryFn: () =>
			fetchProviderMedia(activeProvider, {
				mimeType: filters,
				limit: 50,
				query: searchQuery || undefined,
			}),
		enabled: open && !localOnly && activeProvider !== "local",
	});

	const isLoading =
		activeProvider === "local" ? localLoading || isFetchingNextLocalPage : providerLoading;

	const [uploadError, setUploadError] = React.useState<string | null>(null);

	const uploadLocalMutation = useMutation({
		mutationFn: (file: File) => uploadMedia(file, { fieldId }),
		onSuccess: (item) => {
			void queryClient.invalidateQueries({ queryKey: ["media"] });
			if (multiple) {
				setSelectedItems((prev) => [...prev, { providerId: "local", item }]);
			} else {
				setSelectedItem({ providerId: "local", item });
			}
			setUploadError(null);
		},
		onError: (err: Error) => {
			setUploadError(err.message);
		},
	});

	const uploadProviderMutation = useMutation({
		mutationFn: ({ providerId, file }: { providerId: string; file: File }) =>
			uploadToProvider(providerId, file),
		onSuccess: (item, { providerId }) => {
			void queryClient.invalidateQueries({ queryKey: ["provider-media", providerId] });
			if (multiple) {
				setSelectedItems((prev) => [...prev, { providerId, item }]);
			} else {
				setSelectedItem({ providerId, item });
			}
			setUploadError(null);
		},
		onError: (err: Error) => {
			setUploadError(err.message);
		},
	});

	const isUploading = uploadLocalMutation.isPending || uploadProviderMutation.isPending;

	const updatedDimensionsRef = React.useRef<Set<string>>(new Set());

	const dimensionsMutation = useMutation({
		mutationFn: ({ id, width, height }: { id: string; width: number; height: number }) =>
			updateMedia(id, { width, height }),
		onSuccess: (_updated, { id, width, height }) => {
			queryClient.setQueryData(
				mediaQueryKey,
				(
					old:
						| {
								pages: { items: MediaItem[]; nextCursor?: string }[];
								pageParams: unknown[];
						  }
						| undefined,
				) => {
					if (!old) return old;
					return {
						...old,
						pages: old.pages.map((page) => ({
							...page,
							items: page.items.map((item) => (item.id === id ? { ...item, width, height } : item)),
						})),
					};
				},
			);

			if (selectedItem?.providerId === "local" && selectedItem.item.id === id) {
				setSelectedItem({
					providerId: "local",
					item: { ...selectedItem.item, width, height },
				});
			}
		},
		onError: (error) => {
			console.warn("Failed to update media dimensions:", error);
		},
	});

	const handleDimensionsDetected = React.useCallback(
		(id: string, width: number, height: number) => {
			if (updatedDimensionsRef.current.has(id)) return;
			updatedDimensionsRef.current.add(id);
			dimensionsMutation.mutate({ id, width, height });
		},
		[dimensionsMutation],
	);

	const items = React.useMemo(() => {
		if (activeProvider === "local") {
			const localItems = localData?.pages.flatMap((page) => page.items) || [];
			return localItems.filter((item) => matchesAnyFilter(item.mimeType, filters));
		}
		return providerData?.items || [];
	}, [activeProvider, localData, providerData?.items, filters]);

	const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
		const files = e.target.files;
		const file = files?.[0];
		if (file) {
			if (activeProvider === "local") {
				uploadLocalMutation.mutate(file);
			} else if (activeProviderInfo?.capabilities.upload) {
				uploadProviderMutation.mutate({ providerId: activeProvider, file });
			}
		}
		if (fileInputRef.current) {
			fileInputRef.current.value = "";
		}
	};

	const toMediaItem = (selected: SelectedMedia): MediaItem => {
		if (selected.providerId === "local") {
			return selected.item as MediaItem;
		}
		const providerItem = selected.item as MediaProviderItem;
		const dims = providerDimensions[providerItem.id];
		const itemWithDims = dims
			? {
					...providerItem,
					width: providerItem.width ?? dims.width,
					height: providerItem.height ?? dims.height,
				}
			: providerItem;
		return providerItemToMediaItem(selected.providerId, itemWithDims);
	};

	const isItemSelected = (providerId: string, id: string) =>
		multiple
			? selectedItems.some((s) => s.providerId === providerId && s.item.id === id)
			: selectedItem?.providerId === providerId && selectedItem.item.id === id;

	const handleItemClick = (providerId: string, item: MediaItem | MediaProviderItem) => {
		if (multiple) {
			setSelectedItems((prev) =>
				prev.some((s) => s.providerId === providerId && s.item.id === item.id)
					? prev.filter((s) => !(s.providerId === providerId && s.item.id === item.id))
					: [...prev, { providerId, item }],
			);
		} else {
			setSelectedItem({ providerId, item });
		}
	};

	const handleConfirm = () => {
		if (multiple) {
			if (selectedItems.length === 0) return;
			onSelectMany?.(selectedItems.map(toMediaItem));
			onOpenChange(false);
			setSelectedItems([]);
			setImageUrl("");
			return;
		}
		if (selectedItem) {
			onSelect(toMediaItem(selectedItem));
			onOpenChange(false);
			setSelectedItem(null);
			setImageUrl("");
		}
	};

	const handleClose = () => {
		onOpenChange(false);
		setSelectedItem(null);
		setSelectedItems([]);
		setImageUrl("");
		setUrlError(null);
	};

	const handleUrlSubmit = async () => {
		if (!imageUrl.trim()) return;

		let url: URL;
		try {
			url = new URL(imageUrl.trim());
		} catch {
			setUrlError(t`Please enter a valid URL`);
			return;
		}

		setIsProbing(true);
		setUrlError(null);

		try {
			const sniffedMime = mimeFromUrl(url) ?? "image/unknown";

			if (sniffedMime === "image/unknown" && filters && filters.length > 0) {
				setUrlError(
					t`Cannot determine MIME type from URL. Use a URL ending in a recognized image extension (e.g. .jpg, .png, .webp).`,
				);
				return;
			}
			if (filters && filters.length > 0 && !matchesMimeAllowlist(sniffedMime, filters)) {
				setUrlError(t`This field does not accept ${sniffedMime} files.`);
				return;
			}

			const dimensions = await probeImageDimensions(url.href, t`Failed to load image`);
			const externalItem: MediaItem = {
				id: "",
				filename: url.pathname.split("/").pop() || "external-image",
				mimeType: sniffedMime,
				url: url.href,
				provider: "external-url",
				size: 0,
				width: dimensions.width,
				height: dimensions.height,
				createdAt: new Date().toISOString(),
			};

			if (multiple) {
				onSelectMany?.([externalItem]);
			} else {
				onSelect(externalItem);
			}
			onOpenChange(false);
			setImageUrl("");
		} catch {
			setUrlError(t`Could not load image from URL`);
		} finally {
			setIsProbing(false);
		}
	};

	const handleUrlKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			e.preventDefault();
			void handleUrlSubmit();
		}
	};

	const canUpload =
		activeProvider === "local" || (activeProviderInfo?.capabilities.upload ?? false);
	const canSearch = activeProviderInfo?.capabilities.search ?? false;

	const providerTabs = React.useMemo(() => {
		const tabs: Array<{ id: string; name: string; icon?: string }> = [
			{ id: "local", name: t`Library`, icon: undefined },
		];
		if (providers && !localOnly) {
			for (const p of providers) {
				if (p.id !== "local") {
					tabs.push({ id: p.id, name: p.name, icon: p.icon });
				}
			}
		}
		return tabs;
	}, [providers, localOnly, t]);

	return (
		<Dialog.Root open={open} onOpenChange={handleClose}>
			<Dialog className="p-6 max-w-4xl max-h-[80vh] flex flex-col overflow-hidden" size="xl">
				<div className="flex items-start justify-between gap-4 mb-4">
					<Dialog.Title className="text-lg font-semibold leading-none tracking-tight">
						{title}
					</Dialog.Title>
					<Dialog.Close
						aria-label={t`Close`}
						render={(props) => (
							<Button
								{...props}
								variant="ghost"
								shape="square"
								aria-label={t`Close`}
								className="absolute end-4 top-4"
							>
								<X className="h-4 w-4" />
								<span className="sr-only">{t`Close`}</span>
							</Button>
						)}
					/>
				</div>

				{!hideUrlInput && !localOnly && (
					<>
						<div className="border-b pb-4">
							<Label>{t`Insert from URL`}</Label>
							<div className="flex gap-2 mt-1.5">
								<div className="flex-1 relative">
									<Globe className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-kumo-subtle" />
									<Input
										type="url"
										placeholder={t`https://example.com/image.jpg`}
										aria-label={t`Image URL`}
										value={imageUrl}
										onChange={(e) => {
											setImageUrl(e.target.value);
											setUrlError(null);
										}}
										onKeyDown={handleUrlKeyDown}
										className="ps-9"
									/>
								</div>
								<Button onClick={handleUrlSubmit} disabled={!imageUrl.trim() || isProbing}>
									{isProbing ? <Loader size="sm" /> : t`Insert`}
								</Button>
							</div>
							{urlError && <p className="text-sm text-kumo-danger mt-1">{urlError}</p>}
						</div>

						<div className="relative py-2">
							<div className="absolute inset-0 flex items-center">
								<span className="w-full border-t" />
							</div>
							<div className="relative flex justify-center text-xs uppercase">
								<span className="bg-kumo-base px-2 text-kumo-subtle">{t`or choose from library`}</span>
							</div>
						</div>
					</>
				)}

				{providerTabs.length > 1 && (
					<div className="flex gap-2 border-b pb-3 flex-wrap">
						{providerTabs.map((tab) => (
							<button
								key={tab.id}
								type="button"
								onClick={() => {
									setActiveProvider(tab.id);
									setSelectedItem(null);
									setSelectedItems([]);
									setSearchQuery("");
								}}
								className={cn(
									"flex items-center gap-2 px-4 h-9 text-sm font-medium rounded-md transition-colors whitespace-nowrap",
									activeProvider === tab.id
										? "bg-kumo-brand text-white"
										: "bg-kumo-tint hover:bg-kumo-tint/80 text-kumo-subtle",
								)}
							>
								{tab.icon &&
									(tab.icon.startsWith("data:") ? (
										<img src={tab.icon} alt="" className="h-4 w-4" aria-hidden="true" />
									) : (
										<span aria-hidden="true">{tab.icon}</span>
									))}
								{tab.name}
							</button>
						))}
					</div>
				)}

				<div className="flex items-center justify-between pb-3 gap-4">
					{canSearch || activeProvider === "local" ? (
						<div className="relative flex-1 max-w-xs">
							<MagnifyingGlass className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-kumo-subtle" />
							<Input
								type="search"
								placeholder={activeProvider === "local" ? t`Search by filename...` : t`Search...`}
								aria-label={t`Search media`}
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								maxLength={MEDIA_SEARCH_MAX_LENGTH}
								className="ps-9"
							/>
						</div>
					) : (
						<p className="text-sm text-kumo-subtle">
							{plural(items.length, { one: "# item", other: "# items" })}
						</p>
					)}

					{canUpload && (
						<>
							<Button
								size="sm"
								icon={<Upload />}
								onClick={() => fileInputRef.current?.click()}
								disabled={isUploading}
							>
								{isUploading ? t`Uploading...` : t`Upload`}
							</Button>
							<input
								ref={fileInputRef}
								type="file"
								accept={
									filters
										? filters.map((f) => (f.endsWith("/") ? f + "*" : f)).join(",")
										: undefined
								}
								className="sr-only"
								onChange={handleFileSelect}
								aria-label={t`Upload file`}
							/>
						</>
					)}
				</div>

				<DialogError
					message={uploadError ? t`Upload failed: ${uploadError}` : null}
					className="mb-3"
				/>

				<div className="flex-1 overflow-y-auto min-h-0">
					{isLoading && items.length === 0 ? (
						<div className="flex items-center justify-center h-full">
							<Loader />
						</div>
					) : items.length === 0 ? (
						<div className="flex flex-col items-center justify-center h-full text-center p-8">
							<EmptyStateIcon className="h-12 w-12 text-kumo-subtle mb-4" aria-hidden="true" />
							<h3 className="text-lg font-medium">{t`No media found`}</h3>
							<p className="text-sm text-kumo-subtle mt-1">
								{canSearch && searchQuery
									? t`Try a different search term`
									: canUpload
										? emptyStateUploadHint
										: t`No media available from this provider`}
							</p>
							{canUpload && !searchQuery && (
								<Button
									className="mt-4"
									icon={<Upload />}
									onClick={() => fileInputRef.current?.click()}
								>
									{emptyStateUploadCta}
								</Button>
							)}
						</div>
					) : (
						<ul
							className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3 p-1"
							role="listbox"
							aria-label={t`Available media`}
						>
							{activeProvider === "local"
								? (items as MediaItem[]).map((item) => (
										<MediaPickerItem
											key={item.id}
											item={item}
											selected={isItemSelected("local", item.id)}
											onClick={() => handleItemClick("local", item)}
											onDoubleClick={() => {
												if (multiple) {
													handleItemClick("local", item);
													return;
												}
												onSelect(item);
												onOpenChange(false);
											}}
											onDimensionsDetected={handleDimensionsDetected}
										/>
									))
								: (items as MediaProviderItem[]).map((item) => (
										<ProviderMediaItem
											key={item.id}
											item={item}
											selected={isItemSelected(activeProvider, item.id)}
											onClick={() => handleItemClick(activeProvider, item)}
											onDoubleClick={() => {
												if (multiple) {
													handleItemClick(activeProvider, item);
													return;
												}
												const dims = providerDimensions[item.id];
												const itemWithDims = dims
													? {
															...item,
															width: item.width ?? dims.width,
															height: item.height ?? dims.height,
														}
													: item;
												const mediaItem = providerItemToMediaItem(activeProvider, itemWithDims);
												onSelect(mediaItem);
												onOpenChange(false);
											}}
											onDimensionsLoaded={(width, height) => {
												setProviderDimensions((prev) => ({
													...prev,
													[item.id]: { width, height },
												}));
											}}
										/>
									))}
						</ul>
					)}

					{activeProvider === "local" && hasNextLocalPage && (
						<div className="flex justify-center py-3">
							<Button
								variant="outline"
								size="sm"
								onClick={() => void fetchNextLocalPage()}
								disabled={isFetchingNextLocalPage}
							>
								{isFetchingNextLocalPage ? t`Loading...` : t`Load More`}
							</Button>
						</div>
					)}
				</div>

				<div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 border-t pt-4">
					<div className="flex-1 text-sm text-kumo-subtle">
						{multiple
							? selectedItems.length > 0 && (
									<span>
										{plural(selectedItems.length, {
											one: "# item selected",
											other: "# items selected",
										})}
									</span>
								)
							: selectedItem && (
									<span>
										{t`Selected:`} <strong>{selectedItem.item.filename}</strong>
										{selectedItem.providerId !== "local" && (
											<span className="ms-2 text-xs">
												{t`(from ${providers?.find((p) => p.id === selectedItem.providerId)?.name})`}
											</span>
										)}
									</span>
								)}
					</div>
					<Button variant="outline" onClick={handleClose}>
						{t`Cancel`}
					</Button>
					<Button
						onClick={handleConfirm}
						disabled={multiple ? selectedItems.length === 0 : !selectedItem}
					>
						{t`Insert`}
					</Button>
				</div>
			</Dialog>
		</Dialog.Root>
	);
}

interface MediaPickerItemProps {
	item: MediaItem;
	selected: boolean;
	onClick: () => void;
	onDoubleClick: () => void;
	onDimensionsDetected?: (id: string, width: number, height: number) => void;
}

function MediaPickerItem({
	item,
	selected,
	onClick,
	onDoubleClick,
	onDimensionsDetected,
}: MediaPickerItemProps) {
	const { t } = useLingui();
	const isImage = item.mimeType.startsWith("image/");
	const needsDimensions = isImage && (!item.width || !item.height);

	const displayUrl = needsDimensions ? item.url : getMediaThumbnailUrl(item.url, item.mimeType);

	const handleImageLoad = React.useCallback(
		(e: React.SyntheticEvent<HTMLImageElement>) => {
			if (needsDimensions && onDimensionsDetected) {
				const img = e.currentTarget;
				if (img.naturalWidth && img.naturalHeight) {
					onDimensionsDetected(item.id, img.naturalWidth, img.naturalHeight);
				}
			}
		},
		[needsDimensions, onDimensionsDetected, item.id],
	);

	return (
		<li role="option" aria-selected={selected}>
			<button
				type="button"
				className={cn(
					"relative aspect-square w-full rounded-lg border-2 overflow-hidden transition-all",
					"hover:border-kumo-brand/50 focus:outline-none focus:ring-2 focus:ring-kumo-ring",
					selected ? "border-kumo-brand ring-2 ring-kumo-brand/20" : "border-transparent",
				)}
				onClick={onClick}
				onDoubleClick={onDoubleClick}
				aria-label={t`${item.filename}${selected ? t` (selected)` : ""}`}
			>
				{isImage ? (
					<img
						src={displayUrl}
						alt=""
						className="h-full w-full object-cover"
						style={{ objectPosition: getMediaObjectPosition(item) }}
						onLoad={handleImageLoad}
						onError={(e) => fallbackToOriginalThumbnail(e.currentTarget, item.url)}
					/>
				) : (
					<div className="flex h-full w-full items-center justify-center bg-kumo-tint">
						<span className="text-3xl" aria-hidden="true">
							{getFileIcon(item.mimeType)}
						</span>
					</div>
				)}

				{selected && (
					<div
						className="absolute inset-0 bg-kumo-brand/20 flex items-center justify-center"
						aria-hidden="true"
					>
						<div className="bg-kumo-brand text-white rounded-full p-1">
							<Check className="h-4 w-4" />
						</div>
					</div>
				)}

				<div
					className="absolute bottom-0 start-0 end-0 bg-gradient-to-t from-black/60 to-transparent p-2"
					aria-hidden="true"
				>
					<p className="text-xs text-white truncate">{item.filename}</p>
				</div>
			</button>
		</li>
	);
}

interface ProviderMediaItemProps {
	item: MediaProviderItem;
	selected: boolean;
	onClick: () => void;
	onDoubleClick: () => void;
	onDimensionsLoaded?: (width: number, height: number) => void;
}

function ProviderMediaItem({
	item,
	selected,
	onClick,
	onDoubleClick,
	onDimensionsLoaded,
}: ProviderMediaItemProps) {
	const { t } = useLingui();
	const isImage = item.mimeType.startsWith("image/");
	const needsDimensions = isImage && (!item.width || !item.height);

	const handleImageLoad = React.useCallback(
		(e: React.SyntheticEvent<HTMLImageElement>) => {
			if (needsDimensions && onDimensionsLoaded) {
				const img = e.currentTarget;
				if (img.naturalWidth && img.naturalHeight) {
					onDimensionsLoaded(img.naturalWidth, img.naturalHeight);
				}
			}
		},
		[needsDimensions, onDimensionsLoaded],
	);

	return (
		<li role="option" aria-selected={selected}>
			<button
				type="button"
				className={cn(
					"relative aspect-square w-full rounded-lg border-2 overflow-hidden transition-all",
					"hover:border-kumo-brand/50 focus:outline-none focus:ring-2 focus:ring-kumo-ring",
					selected ? "border-kumo-brand ring-2 ring-kumo-brand/20" : "border-transparent",
				)}
				onClick={onClick}
				onDoubleClick={onDoubleClick}
				aria-label={t`${item.filename}${selected ? t` (selected)` : ""}`}
			>
				{isImage && item.previewUrl ? (
					<img
						src={item.previewUrl}
						alt=""
						className="h-full w-full object-cover"
						onLoad={handleImageLoad}
					/>
				) : (
					<div className="flex h-full w-full items-center justify-center bg-kumo-tint">
						<span className="text-3xl" aria-hidden="true">
							{getFileIcon(item.mimeType)}
						</span>
					</div>
				)}

				{selected && (
					<div
						className="absolute inset-0 bg-kumo-brand/20 flex items-center justify-center"
						aria-hidden="true"
					>
						<div className="bg-kumo-brand text-white rounded-full p-1">
							<Check className="h-4 w-4" />
						</div>
					</div>
				)}

				<div
					className="absolute bottom-0 start-0 end-0 bg-gradient-to-t from-black/60 to-transparent p-2"
					aria-hidden="true"
				>
					<p className="text-xs text-white truncate">{item.filename}</p>
				</div>
			</button>
		</li>
	);
}

export default MediaPickerModal;
