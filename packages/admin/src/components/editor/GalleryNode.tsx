import { Button } from "@cloudflare/kumo";
import { useLingui } from "@lingui/react/macro";
import { Images, Trash, SlidersHorizontal } from "@phosphor-icons/react";
import type { NodeViewProps } from "@tiptap/react";
import { Node } from "@tiptap/react";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import * as React from "react";

import { getMediaObjectPosition } from "../../lib/media-utils.js";
import { cn } from "../../lib/utils";

export interface GalleryImage {
	_type: "image";
	_key: string;
	asset: {
		_type?: "reference";
		_ref: string;
		url?: string;
		provider?: string;
	};
	alt?: string;
	caption?: string;
	width?: number;
	height?: number;
	focalX?: number;
	focalY?: number;
	blurhash?: string;
	dominantColor?: string;
}

export interface GalleryAttributes {
	images: GalleryImage[];
	columns?: number;
}

export interface GallerySidebarPanel {
	type: "gallery";
	attrs: GalleryAttributes & { selectedImageKey?: string; nodeKey?: string };
	onUpdate: (attrs: Partial<GalleryAttributes>) => void;
	onReplace: (attrs: GalleryAttributes) => void;
	onDelete: () => void;
	onClose: () => void;
}

declare module "@tiptap/react" {
	interface Commands<ReturnType> {
		gallery: {
			setGallery: (options: GalleryAttributes) => ReturnType;
		};
	}
}

export function galleryImageUrl(image: GalleryImage): string {
	if (image.asset.url) return image.asset.url;
	if (image.asset._ref) return `/_emdash/api/media/file/${encodeURIComponent(image.asset._ref)}`;
	return "";
}

function GalleryNodeView({
	node,
	updateAttributes,
	selected,
	deleteNode,
	editor,
	getPos,
}: NodeViewProps) {
	const { t } = useLingui();
	const sidebarOpenRef = React.useRef(false);

	const images = (node.attrs.images ?? []) as GalleryImage[];
	const columns = typeof node.attrs.columns === "number" ? node.attrs.columns : 3;

	const getAttrs = (): GalleryAttributes => ({
		images: (node.attrs.images ?? []) as GalleryImage[],
		columns: typeof node.attrs.columns === "number" ? node.attrs.columns : undefined,
	});

	const openSidebar = (selectedImageKey?: string) => {
		const storage = (editor.storage as unknown as Record<string, Record<string, unknown>>).gallery;
		const onOpen = storage?.onOpenBlockSidebar as ((panel: GallerySidebarPanel) => void) | null;
		if (onOpen) {
			sidebarOpenRef.current = true;
			onOpen({
				type: "gallery",
				attrs: { ...getAttrs(), selectedImageKey, nodeKey: String(getPos?.() ?? "") },
				onUpdate: (attrs) => updateAttributes(attrs),
				onReplace: (attrs) => updateAttributes(attrs),
				onDelete: () => deleteNode(),
				onClose: () => {
					sidebarOpenRef.current = false;
				},
			});
		}
	};

	const closeSidebar = () => {
		if (!sidebarOpenRef.current) return;
		const storage = (editor.storage as unknown as Record<string, Record<string, unknown>>).gallery;
		const onClose = storage?.onCloseBlockSidebar as (() => void) | null;
		if (onClose) {
			onClose();
			sidebarOpenRef.current = false;
		}
	};

	const toggleSidebar = () => {
		if (sidebarOpenRef.current) {
			closeSidebar();
		} else {
			openSidebar();
		}
	};

	React.useEffect(() => {
		if (!selected) {
			closeSidebar();
		}
	}, [selected]);

	return (
		<NodeViewWrapper
			className={cn(
				"relative my-4 group",
				selected && "ring-2 ring-kumo-brand ring-offset-2 rounded-lg",
			)}
		>
			{images.length === 0 ? (
				<Button
					type="button"
					variant="outline"
					className="mt-2 w-full h-32 justify-center border-dashed"
					onMouseDown={(e) => e.preventDefault()}
					onClick={() => openSidebar()}
				>
					<div className="flex flex-col items-center gap-2 text-kumo-subtle">
						<Images className="h-8 w-8" />
						<span className="text-sm">{t`Empty gallery — open settings to add images`}</span>
					</div>
				</Button>
			) : (
				<div
					className="grid gap-2 rounded-lg"
					style={{ gridTemplateColumns: `repeat(${Math.max(1, columns)}, 1fr)` }}
				>
					{images.map((image, index) => (
						<figure key={image._key} className="m-0">
							<button
								type="button"
								className="block w-full cursor-pointer"
								onMouseDown={(e) => e.preventDefault()}
								onClick={(e) => {
									e.stopPropagation();
									openSidebar(image._key);
								}}
								aria-label={t`Edit image ${index + 1}`}
							>
								<img
									src={galleryImageUrl(image)}
									alt={image.alt || ""}
									className="w-full aspect-square object-cover rounded-md border"
									style={{ objectPosition: getMediaObjectPosition(image) }}
									draggable={false}
								/>
							</button>
							{image.caption && (
								<figcaption className="text-xs text-kumo-subtle mt-1 text-center truncate">
									{image.caption}
								</figcaption>
							)}
						</figure>
					))}
				</div>
			)}

			{selected && (
				<div className="absolute top-2 end-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
					<Button
						type="button"
						variant="secondary"
						shape="square"
						className="h-8 w-8"
						onMouseDown={(e) => e.preventDefault()}
						onClick={toggleSidebar}
						title={t`Gallery settings`}
						aria-label={t`Gallery settings`}
					>
						<SlidersHorizontal className="h-4 w-4" />
					</Button>
					<Button
						type="button"
						variant="destructive"
						shape="square"
						className="h-8 w-8"
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => deleteNode()}
						title={t`Delete gallery`}
						aria-label={t`Delete gallery`}
					>
						<Trash className="h-4 w-4" />
					</Button>
				</div>
			)}
		</NodeViewWrapper>
	);
}

export const GalleryExtension = Node.create({
	name: "gallery",

	group: "block",

	atom: true,

	draggable: true,

	addStorage() {
		return {
			onOpenBlockSidebar: null as ((panel: GallerySidebarPanel) => void) | null,
			onCloseBlockSidebar: null as (() => void) | null,
		};
	},

	addAttributes() {
		return {
			images: {
				default: [],
			},
			columns: {
				default: null,
			},
		};
	},

	parseHTML() {
		return [{ tag: 'div[data-type="gallery"]' }];
	},

	renderHTML() {
		return ["div", { "data-type": "gallery" }];
	},

	addNodeView() {
		return ReactNodeViewRenderer(GalleryNodeView);
	},

	addCommands() {
		return {
			setGallery:
				(options: GalleryAttributes) =>
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				({ commands }: any) => {
					return commands.insertContent({
						type: this.name,
						attrs: options,
					});
				},
		};
	},
});
