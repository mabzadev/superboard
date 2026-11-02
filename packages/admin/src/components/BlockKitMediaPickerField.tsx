import { Button } from "@cloudflare/kumo";
import { useLingui } from "@lingui/react/macro";
import { Image as ImageIcon, ImageBroken, X } from "@phosphor-icons/react";
import * as React from "react";

import type { MediaItem } from "../lib/api";
import { isSafeUrl } from "../lib/url";
import { MediaPickerModal } from "./MediaPickerModal";

export interface BlockKitMediaPickerFieldProps {
	actionId: string;
	label: string;
	placeholder?: string;
	mimeTypeFilter?: string;
	value: unknown;
	onChange: (actionId: string, value: unknown) => void;
}

export function BlockKitMediaPickerField({
	actionId,
	label,
	placeholder,
	mimeTypeFilter,
	value,
	onChange,
}: BlockKitMediaPickerFieldProps) {
	const { t } = useLingui();
	const [pickerOpen, setPickerOpen] = React.useState(false);
	const [imageBroken, setImageBroken] = React.useState(false);
	const url = typeof value === "string" && value.length > 0 ? value : "";

	React.useEffect(() => {
		setImageBroken(false);
	}, [url]);
	const filter = mimeTypeFilter ?? "image/";
	const canPreview = isSafePreviewUrl(url);

	const handleSelect = (item: MediaItem) => {
		const isLocalMedia = item.provider === "local" || !!item.storageKey;
		const localKey = item.storageKey || item.id;
		const nextUrl = isLocalMedia && localKey ? `/_emdash/api/media/file/${localKey}` : item.url;
		if (!nextUrl) return;
		onChange(actionId, nextUrl);
	};

	return (
		<div>
			<label className="text-sm font-medium mb-1.5 block">{label}</label>
			{canPreview ? (
				imageBroken ? (
					<div className="relative group min-h-20">
						<div className="min-h-20 w-full rounded-md border border-kumo-line bg-kumo-muted flex items-center justify-center gap-2 text-kumo-subtle">
							<ImageBroken className="h-5 w-5" />
							<span className="text-sm">{t`Image not found`}</span>
						</div>
						<div className="absolute top-2 end-2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto transition-opacity flex gap-1">
							<Button
								type="button"
								size="sm"
								variant="secondary"
								onClick={() => setPickerOpen(true)}
							>
								{t`Change`}
							</Button>
							<Button
								type="button"
								shape="square"
								variant="destructive"
								className="h-8 w-8"
								onClick={() => onChange(actionId, "")}
								aria-label={t`Remove`}
							>
								<X className="h-4 w-4" />
							</Button>
						</div>
					</div>
				) : (
					<div className="relative group">
						<img
							src={url}
							alt=""
							className="max-h-40 min-h-20 w-full rounded-md border border-kumo-line object-contain bg-kumo-muted"
							referrerPolicy="no-referrer"
							loading="lazy"
							onError={() => setImageBroken(true)}
						/>
						<div className="absolute top-2 end-2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto transition-opacity flex gap-1">
							<Button
								type="button"
								size="sm"
								variant="secondary"
								onClick={() => setPickerOpen(true)}
							>
								{t`Change`}
							</Button>
							<Button
								type="button"
								shape="square"
								variant="destructive"
								className="h-8 w-8"
								onClick={() => onChange(actionId, "")}
								aria-label={t`Remove`}
							>
								<X className="h-4 w-4" />
							</Button>
						</div>
					</div>
				)
			) : (
				<Button
					type="button"
					variant="outline"
					className="w-full h-24 justify-center border-dashed"
					onClick={() => setPickerOpen(true)}
				>
					<div className="flex flex-col items-center gap-1.5 text-kumo-subtle">
						<ImageIcon className="h-6 w-6" />
						<span className="text-sm">{placeholder ?? t`Select media`}</span>
					</div>
				</Button>
			)}
			<MediaPickerModal
				open={pickerOpen}
				onOpenChange={setPickerOpen}
				onSelect={handleSelect}
				mimeTypeFilter={filter}
				title={t`Select ${label}`}
			/>
		</div>
	);
}

const HAS_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

function isSafePreviewUrl(url: string): boolean {
	if (!url) return false;
	if (HAS_SCHEME_RE.test(url)) {
		return isSafeUrl(url);
	}
	return url.startsWith("/") && !url.startsWith("//");
}
