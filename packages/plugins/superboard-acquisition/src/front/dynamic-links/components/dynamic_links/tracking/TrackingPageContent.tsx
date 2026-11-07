"use client";

import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { EmptyProject, moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import {
	AutosaveIndicator,
	SettingsDependents,
	SettingsRow,
	SettingsTextField,
	SwitchField,
	useSettingsAutosave,
} from "@superboard/front-ui/settings-form";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superboard/front-ui/ui/select.js";
import { ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import brand from "../../../../../../../../../scripts/config/superboard-brand.json";
import { AcquisitionPage } from "../../../../AcquisitionPage.js";
import { useFlowI18n } from "../../../../flows/features/flows/i18n.js";
import { SettingsCard, SettingsField } from "../../../../SettingsLayout.js";
import {
	getTracking,
	saveTracking,
	type TrackingSettings,
} from "../../../api/dynamic-links/dynamicLinksService.js";

const internalTrackingProvider = brand.brand.namespace;

export default function TrackingPageContent() {
	const { tr } = useFlowI18n();
	const { selectedProject } = useProjectSelection();
	const [settings, setSettings] = useState<TrackingSettings>({
		enabled: true,
		provider: internalTrackingProvider,
		configuration: {},
	});
	const [loadedFor, setLoadedFor] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		if (!selectedProject) return;
		try {
			setSettings(await getTracking(selectedProject.id));
			setLoadedFor(selectedProject.id);
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause));
		}
	}, [selectedProject]);

	useEffect(() => {
		void load();
	}, [load]);

	const autosave = useSettingsAutosave({
		resourceKey: loadedFor ?? "",
		value: settings,
		enabled: loadedFor !== null && loadedFor === selectedProject?.id,
		save: async (value) => {
			if (!loadedFor) return;
			await saveTracking(loadedFor, value);
		},
	});
	const external = settings.provider !== internalTrackingProvider && settings.provider !== "none";

	return (
		<AcquisitionPage
			title={tr("Tracking")}
			description={tr(
				"Disable tracking globally or forward events to an approved analytics provider.",
			)}
			error={error}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<div className="flex w-full flex-col gap-4">
					<SettingsCard>
						<SettingsRow>
							<SwitchField
								label={tr("Collect link analytics")}
								description={tr("Consent rules are still enforced by the SDK.")}
								checked={settings.enabled}
								onCheckedChange={(enabled) => {
									setSettings((value) => ({ ...value, enabled }));
								}}
							/>
							{settings.enabled ? (
								<SettingsDependents>
									<SettingsField label={tr("Provider")}>
										{(id) => (
											<Select
												value={settings.provider}
												onValueChange={(provider) => {
													setSettings((value) => ({ ...value, provider }));
												}}
											>
												<SelectTrigger id={id} className="w-full">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value={internalTrackingProvider}>
														{brand.brand.name}
													</SelectItem>
													<SelectItem value="google">{tr("Google Analytics")}</SelectItem>
													<SelectItem value="segment">{tr("Segment")}</SelectItem>
													<SelectItem value="none">{tr("No external provider")}</SelectItem>
												</SelectContent>
											</Select>
										)}
									</SettingsField>
									{external ? (
										<SettingsTextField
											label={tr(
												settings.provider === "google" ? "Measurement ID" : "Write key reference",
											)}
											type="password"
											value={
												typeof settings.configuration.credential === "string"
													? settings.configuration.credential
													: ""
											}
											onChange={(event) => {
												const credential = event.currentTarget.value;
												setSettings((value) => ({
													...value,
													configuration: { ...value.configuration, credential },
												}));
											}}
										/>
									) : null}
								</SettingsDependents>
							) : null}
						</SettingsRow>
						<SettingsRow className="flex items-start gap-3 space-y-0">
							<ShieldCheck className="mt-0.5 size-4 shrink-0 text-kumo-subtle" />
							<div className="space-y-1">
								<p className="text-sm font-medium">{tr("Consent-aware")}</p>
								<p className="text-sm text-kumo-subtle">
									{tr(
										"Tracking may be disabled per project. Collection changes are audited by the Dynamic Links Worker.",
									)}
								</p>
							</div>
						</SettingsRow>
					</SettingsCard>
					<AutosaveIndicator status={autosave.status} onRetry={autosave.retry} />
				</div>
			)}
		</AcquisitionPage>
	);
}
