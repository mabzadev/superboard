"use client";

import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { InputArea } from "@superboard/front-ui/kumo";
import { usePublicConfig } from "@superboard/front-ui/lib/config.js";
import { cn } from "@superboard/front-ui/lib/utils.js";
import { EmptyProject, moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import Image from "@superboard/front-ui/next-image";
import {
	AutosaveIndicator,
	SettingsRow,
	SettingsTextField,
	useSettingsAutosave,
} from "@superboard/front-ui/settings-form";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superboard/front-ui/ui/select.js";
import { ImageIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AcquisitionPage } from "../../../../AcquisitionPage.js";
import { useFlowI18n } from "../../../../flows/features/flows/i18n.js";
import { SettingsField, SettingsGroup } from "../../../../SettingsLayout.js";
import {
	getSocialPreview,
	saveSocialPreview,
} from "../../../api/dynamic-links/dynamicLinksService.js";

type PreviewForm = {
	title: string;
	description: string;
	image_url: string;
	site_name: string;
};

const emptyForm: PreviewForm = {
	title: "",
	description: "",
	image_url: "",
	site_name: "",
};

const previewPlatforms = [
	["facebook", "Facebook"],
	["x", "X"],
	["linkedin", "LinkedIn"],
] as const;

function publicImageUrl(value: string) {
	if (!value.trim()) return true;
	try {
		return ["http:", "https:"].includes(new URL(value).protocol);
	} catch {
		return false;
	}
}

export default function SocialPreviewPageContent() {
	const { tr } = useFlowI18n();
	const config = usePublicConfig();
	const { selectedProject } = useProjectSelection();
	const [form, setForm] = useState<PreviewForm>(emptyForm);
	const [loadedFor, setLoadedFor] = useState<string | null>(null);
	const [platform, setPlatform] = useState("facebook");
	const [error, setError] = useState<string | null>(null);
	const [imageFailed, setImageFailed] = useState(false);

	const load = useCallback(async () => {
		if (!selectedProject) return;
		try {
			const value = await getSocialPreview(selectedProject.id);
			setForm({
				title: value?.title ?? "",
				description: value?.description ?? "",
				image_url: value?.image_url ?? "",
				site_name: value?.site_name ?? "",
			});
			setLoadedFor(selectedProject.id);
			setImageFailed(false);
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause));
		}
	}, [selectedProject]);

	useEffect(() => {
		void load();
	}, [load]);

	const titleMissing = !form.title.trim();
	const imageInvalid = !publicImageUrl(form.image_url);
	const autosave = useSettingsAutosave({
		resourceKey: loadedFor ?? "",
		value: form,
		enabled:
			loadedFor !== null && loadedFor === selectedProject?.id && !titleMissing && !imageInvalid,
		save: async (value) => {
			if (!loadedFor) return;
			await saveSocialPreview(loadedFor, value);
		},
	});
	const change = (field: keyof PreviewForm, value: string) => {
		setForm((current) => ({ ...current, [field]: value }));
	};

	const domain =
		form.site_name || (config.shortlinkUrl ? new URL(config.shortlinkUrl).hostname : "");

	return (
		<AcquisitionPage
			title={tr("Social preview")}
			description={tr("Design the default Open Graph card shown when a dynamic link is shared.")}
			error={error ?? (!config.shortlinkUrl ? config.endpointError("Short-link") : null)}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<div className="flex w-full flex-col gap-6">
					<SettingsGroup
						title={tr("Default metadata")}
						description={tr("Individual links may override these project defaults.")}
					>
						<SettingsRow>
							<SettingsTextField
								label={tr("Title")}
								value={form.title}
								onChange={(event) => {
									change("title", event.currentTarget.value);
								}}
							/>
							{titleMissing && loadedFor !== null ? (
								<p className="text-xs text-kumo-warning">
									{tr("Add a title to save the social preview.")}
								</p>
							) : null}
						</SettingsRow>
						<SettingsRow>
							<SettingsField label={tr("Description")}>
								{(id) => (
									<InputArea
										id={id}
										rows={4}
										className="w-full"
										value={form.description}
										onChange={(event) => {
											change("description", event.currentTarget.value);
										}}
									/>
								)}
							</SettingsField>
						</SettingsRow>
						<SettingsRow>
							<SettingsTextField
								label={tr("Site name or domain")}
								value={form.site_name}
								onChange={(event) => {
									change("site_name", event.currentTarget.value);
								}}
							/>
						</SettingsRow>
						<SettingsRow>
							<SettingsTextField
								label={tr("Image URL")}
								description={tr(
									"Recommended ratio 1.91:1, at least 1200 × 630 pixels. The URL must be publicly accessible over HTTPS.",
								)}
								type="url"
								value={form.image_url}
								onChange={(event) => {
									setImageFailed(false);
									change("image_url", event.currentTarget.value);
								}}
							/>
							{imageInvalid ? (
								<p className="text-xs text-kumo-danger">
									{tr("Enter a complete web address, starting with https://.")}
								</p>
							) : null}
						</SettingsRow>
					</SettingsGroup>
					<SettingsGroup
						title={tr("Live preview")}
						description={tr("Platform rendering is approximate and updates as you type.")}
					>
						<SettingsRow>
							<SettingsField label={tr("Preview platform")}>
								{(id) => (
									<Select value={platform} onValueChange={setPlatform}>
										<SelectTrigger id={id} className="w-full">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{previewPlatforms.map(([value, label]) => (
												<SelectItem key={value} value={value}>
													{label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								)}
							</SettingsField>
						</SettingsRow>
						<SettingsRow className="flex justify-center bg-kumo-tint p-6">
							<div
								className={cn(
									"w-full max-w-2xl overflow-hidden border border-kumo-line bg-kumo-base shadow-sm",
									platform === "x" ? "rounded-2xl" : "rounded-lg",
								)}
							>
								<div className="relative aspect-[1.91/1] w-full bg-kumo-tint">
									{form.image_url && !imageFailed ? (
										<Image
											unoptimized
											fill
											sizes="(max-width: 768px) 100vw, 640px"
											src={form.image_url}
											alt={tr("Social preview")}
											className="object-cover"
											onError={() => {
												setImageFailed(true);
											}}
										/>
									) : (
										<div className="flex h-full items-center justify-center">
											<ImageIcon className="size-12 text-kumo-subtle" />
										</div>
									)}
								</div>
								<div className={cn("space-y-1 p-4", platform === "facebook" && "bg-kumo-tint")}>
									{platform !== "x" ? (
										<p className="text-xs uppercase tracking-wide text-kumo-subtle">{domain}</p>
									) : null}
									<h4 className="font-semibold leading-snug">
										{form.title || tr("Your link preview title")}
									</h4>
									{platform !== "linkedin" ? (
										<p className="text-sm text-kumo-subtle">
											{form.description ||
												tr("Add a concise description that explains where the shared link leads.")}
										</p>
									) : null}
								</div>
							</div>
						</SettingsRow>
					</SettingsGroup>
					<AutosaveIndicator status={autosave.status} onRetry={autosave.retry} />
				</div>
			)}
		</AcquisitionPage>
	);
}
