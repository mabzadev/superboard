import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { PluginConfigurationTab } from "@superboard/front-ui/plugin-configuration-tab";
import { SectionNavigation } from "@superboard/front-ui/section-navigation.js";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import { Checkbox } from "@superboard/front-ui/ui/checkbox.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@superboard/front-ui/ui/tabs.js";
import { useEffect, useState } from "react";

import {
	getBillingOverview,
	updateBillingSettings,
	type BillingOverview,
} from "./billing/api/billing/billingService.js";
import { useMonetizationI18n } from "./i18n.js";
import { MonetizationSettingsForm } from "./MonetizationSettingsForm.js";

export default function MonetizationSettingsPage() {
	const { t, locale } = useMonetizationI18n();
	const { selectedProject } = useProjectSelection();
	const [tab, setTab] = useState(() => {
		const requested =
			typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab");
		return requested && ["general", "products", "gateways", "configuration"].includes(requested)
			? requested
			: "general";
	});
	return (
		<section className="ds-page space-y-5">
			<header className="ds-page-header">
				<div>
					<h1 className="ds-page-title">{t("Monetization Settings")}</h1>
					<p className="ds-page-description">
						{t("Manage purchase and restore rules and inspect configured store credentials.")}
					</p>
				</div>
			</header>
			<SectionNavigation />
			<Tabs
				value={tab}
				onValueChange={(value) => {
					setTab(value);
					const url = new URL(window.location.href);
					url.searchParams.set("tab", value);
					window.history.replaceState(null, "", url);
				}}
			>
				<TabsList aria-label={t("Settings sections")}>
					<TabsTrigger value="general">{t("General")}</TabsTrigger>
					<TabsTrigger value="products">{t("Products")}</TabsTrigger>
					<TabsTrigger value="gateways">{t("Gateways")}</TabsTrigger>
					<TabsTrigger value="configuration">{t("Configuration")}</TabsTrigger>
				</TabsList>
				{selectedProject ? (
					<BillingSettings key={selectedProject.id} projectId={selectedProject.id} tab={tab} />
				) : (
					<p role="status">{t("Loading settings…")}</p>
				)}
				<TabsContent value="products" forceMount hidden={tab !== "products"}>
					<MonetizationSettingsForm section="products" />
				</TabsContent>
				<TabsContent value="configuration">
					<PluginConfigurationTab locale={locale} />
				</TabsContent>
			</Tabs>
		</section>
	);
}

function BillingSettings({ projectId, tab }: { projectId: string; tab: string }) {
	const { t } = useMonetizationI18n();
	const [overview, setOverview] = useState<BillingOverview | null>(null);
	const [enabled, setEnabled] = useState(false);
	const [blockTransfer, setBlockTransfer] = useState(false);
	const [error, setError] = useState<"load" | "save" | null>(null);
	const [busy, setBusy] = useState(false);
	const [saved, setSaved] = useState(false);
	const [attempt, setAttempt] = useState(0);
	useEffect(() => {
		let active = true;
		void getBillingOverview(projectId)
			.then((data) => {
				if (!active) return;
				if (!data.settings) throw new Error("BILLING_SETTINGS_MISSING");
				setError(null);
				setOverview(data);
				setEnabled(data.settings.purchases_enabled === 1);
				setBlockTransfer(data.settings.restore_behavior === "block");
			})
			.catch(() => {
				if (active) setError("load");
			});
		return () => {
			active = false;
		};
	}, [projectId, attempt]);
	const dirty =
		overview?.settings &&
		(enabled !== (overview.settings.purchases_enabled === 1) ||
			blockTransfer !== (overview.settings.restore_behavior === "block"));
	const save = async () => {
		setBusy(true);
		setError(null);
		setSaved(false);
		try {
			await updateBillingSettings(projectId, {
				purchases_enabled: enabled,
				restore_behavior: blockTransfer ? "block" : "transfer",
			});
			const persisted = await getBillingOverview(projectId);
			if (
				!persisted.settings ||
				(persisted.settings.purchases_enabled === 1) !== enabled ||
				(persisted.settings.restore_behavior === "block") !== blockTransfer
			)
				throw new Error("BILLING_SETTINGS_NOT_PERSISTED");
			setOverview(persisted);
			setSaved(true);
		} catch {
			setError("save");
		} finally {
			setBusy(false);
		}
	};
	const unavailable =
		error === "load" ? (
			<div role="alert">
				<p>{t("Could not load billing settings.")}</p>
				<Button
					type="button"
					onClick={() => {
						setError(null);
						setAttempt((value) => value + 1);
					}}
				>
					{t("Retry")}
				</Button>
			</div>
		) : (
			<p role="status">{t("Loading settings…")}</p>
		);
	return (
		<>
			<TabsContent value="general">
				{!overview ? (
					unavailable
				) : (
					<form
						className="space-y-5"
						onSubmit={(event) => {
							event.preventDefault();
							save().catch(() => {
								setError("save");
							});
						}}
					>
						<fieldset disabled={busy} className="space-y-4">
							<legend className="sr-only">{t("General")}</legend>
							<label className="flex items-center gap-2">
								<Checkbox
									checked={enabled}
									onCheckedChange={(value) => {
										setEnabled(value === true);
										setSaved(false);
									}}
								/>
								{t("Enable purchases")}
							</label>
							<label className="flex items-center gap-2">
								<Checkbox
									checked={blockTransfer}
									onCheckedChange={(value) => {
										setBlockTransfer(value === true);
										setSaved(false);
									}}
								/>
								{t("Block purchase transfers between users")}
							</label>
						</fieldset>
						{error === "save" && <p role="alert">{t("Could not save billing settings.")}</p>}
						{saved && <p role="status">{t("Settings saved.")}</p>}
						<Button type="submit" disabled={!dirty || busy}>
							{t(busy ? "Saving…" : "Save settings")}
						</Button>
					</form>
				)}
			</TabsContent>
			<TabsContent value="gateways" forceMount hidden={tab !== "gateways"}>
				<MonetizationSettingsForm section="billing" />
				{!overview ? (
					unavailable
				) : (
					<div className="space-y-4">
						<h2>{t("Connected Gateways")}</h2>
						<p>{t("Credential configuration does not confirm provider availability.")}</p>
						{(
							[
								["ios", "Apple App Store"],
								["android", "Google Play Billing"],
							] as const
						).map(([platform, label]) => {
							const credential = overview.credentials?.[platform];
							return (
								<div
									key={platform}
									className="flex items-center justify-between rounded border p-4"
								>
									<span>{t(label)}</span>
									<Badge variant="secondary">
										{t(
											credential
												? credential.configured
													? "Configured"
													: "Not configured"
												: "Unknown",
										)}
									</Badge>
								</div>
							);
						})}
					</div>
				)}
			</TabsContent>
		</>
	);
}
