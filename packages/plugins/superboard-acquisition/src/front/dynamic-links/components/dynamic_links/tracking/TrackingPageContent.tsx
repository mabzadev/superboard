"use client";

import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import {
	showErrorNotification,
	showSuccessNotification,
} from "@superboard/front-ui/lib/Notifications.js";
import { EmptyProject, moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import { Alert, AlertDescription, AlertTitle } from "@superboard/front-ui/ui/alert.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import { Card, CardContent } from "@superboard/front-ui/ui/card.js";
import { Input } from "@superboard/front-ui/ui/input.js";
import { Label } from "@superboard/front-ui/ui/label.js";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superboard/front-ui/ui/select.js";
import { Switch } from "@superboard/front-ui/ui/switch.js";
import { Save, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import brand from "../../../../../../../../../scripts/config/superboard-brand.json";
import { AcquisitionPage } from "../../../../AcquisitionPage.js";
import { useFlowI18n } from "../../../../flows/features/flows/i18n.js";
import {
	getTracking,
	saveTracking,
	type TrackingSettings,
} from "../../../api/dynamic-links/dynamicLinksService.js";

const internalTrackingProvider = brand.brand.namespace;

/**
 * Collection preferences only. Attributed results live in the Dynamic links
 * Analytics tab so settings and measurement are not duplicated.
 */
export default function TrackingPageContent() {
	const { tr } = useFlowI18n();
	const { selectedProject } = useProjectSelection();
	const [settings, setSettings] = useState<TrackingSettings>({
		enabled: true,
		provider: internalTrackingProvider,
		configuration: {},
	});
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	const load = useCallback(async () => {
		if (!selectedProject) return;
		try {
			setSettings(await getTracking(selectedProject.id));
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause));
		}
	}, [selectedProject]);

	useEffect(() => {
		void load();
	}, [load]);

	const save = async () => {
		if (!selectedProject) return;
		setSaving(true);
		try {
			await saveTracking(selectedProject.id, settings);
			showSuccessNotification(tr("Tracking preferences saved"));
			await load();
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		} finally {
			setSaving(false);
		}
	};

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
				<Card className="max-w-2xl">
					<CardContent className="space-y-5 pt-6">
						<label className="flex items-center justify-between gap-4 rounded-lg border p-4">
							<span>
								<span className="block font-medium">{tr("Collect link analytics")}</span>
								<span className="block text-xs text-muted-foreground">
									{tr("Consent rules are still enforced by the SDK.")}
								</span>
							</span>
							<Switch
								checked={settings.enabled}
								onCheckedChange={(enabled) => setSettings((value) => ({ ...value, enabled }))}
							/>
						</label>
						<label className="space-y-2">
							<Label>{tr("Provider")}</Label>
							<Select
								value={settings.provider}
								onValueChange={(provider) => setSettings((value) => ({ ...value, provider }))}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={internalTrackingProvider}>{brand.brand.name}</SelectItem>
									<SelectItem value="google">{tr("Google Analytics")}</SelectItem>
									<SelectItem value="segment">{tr("Segment")}</SelectItem>
									<SelectItem value="none">{tr("No external provider")}</SelectItem>
								</SelectContent>
							</Select>
						</label>
						{settings.provider !== internalTrackingProvider && settings.provider !== "none" ? (
							<div className="space-y-2">
								<Label>
									{tr(settings.provider === "google" ? "Measurement ID" : "Write key reference")}
								</Label>
								<Input
									type="password"
									value={
										typeof settings.configuration.credential === "string"
											? settings.configuration.credential
											: ""
									}
									onChange={(event) =>
										setSettings((value) => ({
											...value,
											configuration: {
												...value.configuration,
												credential: event.currentTarget.value,
											},
										}))
									}
								/>
							</div>
						) : null}
						<Alert>
							<ShieldCheck className="size-4" />
							<AlertTitle>{tr("Consent-aware")}</AlertTitle>
							<AlertDescription>
								{tr(
									"Tracking may be disabled per project. Collection changes are audited by the Dynamic Links Worker.",
								)}
							</AlertDescription>
						</Alert>
						<Button className="w-full" disabled={saving} onClick={() => void save()}>
							<Save className="size-4" />
							{tr(saving ? "Saving…" : "Save tracking settings")}
						</Button>
					</CardContent>
				</Card>
			)}
		</AcquisitionPage>
	);
}
