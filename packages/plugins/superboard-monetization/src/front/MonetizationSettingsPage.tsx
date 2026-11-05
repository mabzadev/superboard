import { usePluginEnabled } from "@superboard/front-ui/context";
import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { PluginDiagnosticsLink } from "@superboard/front-ui/plugin-diagnostics-link";
import { SectionNavigation } from "@superboard/front-ui/section-navigation.js";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import { Checkbox } from "@superboard/front-ui/ui/checkbox.js";
import { Label } from "@superboard/front-ui/ui/label.js";
import { RadioGroup, RadioGroupItem } from "@superboard/front-ui/ui/radio-group.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@superboard/front-ui/ui/tabs.js";
import { useEffect, useState } from "react";

import {
	getBillingOverview,
	testBillingCredentials,
	updateBillingSettings,
	type BillingOverview,
} from "./billing/api/billing/billingService.js";
import DisplayCurrencySetting from "./DisplayCurrencySetting.js";
import { useMonetizationI18n } from "./i18n.js";
import StripeSettings from "./StripeSettings.js";

const restoreBehaviors = [
	{
		value: "transfer",
		label: "Transfer to new App User ID",
		help: "Default. When another App User ID restores or buys with a receipt that is already in use, the purchases move to it, so only one customer has access at a time. Purchases that belong to an anonymous App User ID are merged with the new App User ID instead.",
	},
	{
		value: "transfer_if_no_active_subscriptions",
		label: "Transfer if there are no active subscriptions",
		help: "Purchases move to the new App User ID only if the current owner has no active subscription. Otherwise they stay with the current owner and the restore or purchase returns an error. One-time purchases don’t block the transfer.",
	},
	{
		value: "block",
		label: "Keep with original App User ID",
		help: "Use with caution. Restoring or buying with a receipt that belongs to another App User ID returns an error. Choose this only if customers must create an account before purchasing, and be ready to help them recover their account.",
	},
] as const;

type RestoreBehavior = (typeof restoreBehaviors)[number]["value"];

function storedRestoreBehavior(value: string | undefined): RestoreBehavior {
	return restoreBehaviors.find((behavior) => behavior.value === value)?.value ?? "transfer";
}

function storedSandboxBehavior(value: string | null | undefined): RestoreBehavior | null {
	return restoreBehaviors.find((behavior) => behavior.value === value)?.value ?? null;
}

export default function MonetizationSettingsPage() {
	const { t, locale } = useMonetizationI18n();
	const { selectedProject } = useProjectSelection();
	const [requested] = useState(() =>
		typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab"),
	);
	const [tab, setTab] = useState(() =>
		requested === "gateways" || requested === "configuration" ? "gateways" : "general",
	);
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
				className="min-w-0 gap-5"
				value={tab}
				onValueChange={(value) => {
					setTab(value);
					const url = new URL(window.location.href);
					url.searchParams.set("tab", value);
					window.history.replaceState(null, "", url);
				}}
			>
				<TabsList
					className="h-auto max-w-full flex-wrap justify-start"
					aria-label={t("Settings sections")}
				>
					<TabsTrigger value="general">{t("General")}</TabsTrigger>
					<TabsTrigger value="gateways">{t("Gateways")}</TabsTrigger>
				</TabsList>
				{selectedProject ? (
					<BillingSettings key={selectedProject.id} projectId={selectedProject.id} tab={tab} />
				) : (
					<p role="status">{t("Loading settings…")}</p>
				)}
			</Tabs>
			<PluginDiagnosticsLink locale={locale} />
		</section>
	);
}

function BillingSettings({ projectId, tab }: { projectId: string; tab: string }) {
	const operatorAccountPage = usePluginEnabled("superboard-user");
	const { t, locale } = useMonetizationI18n();
	const [overview, setOverview] = useState<BillingOverview | null>(null);
	const [enabled, setEnabled] = useState(false);
	const [restoreBehavior, setRestoreBehavior] = useState<RestoreBehavior>("transfer");
	const [sandboxBehavior, setSandboxBehavior] = useState<RestoreBehavior | null>(null);
	const [error, setError] = useState<"load" | "save" | null>(null);
	const [busy, setBusy] = useState(false);
	const [saved, setSaved] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const [connectionResult, setConnectionResult] = useState<string | null>(null);
	useEffect(() => {
		let active = true;
		void getBillingOverview(projectId)
			.then((data) => {
				if (!active) return;
				if (!data.settings) throw new Error("BILLING_SETTINGS_MISSING");
				setError(null);
				setOverview(data);
				setEnabled(data.settings.purchases_enabled === 1);
				setRestoreBehavior(storedRestoreBehavior(data.settings.restore_behavior));
				setSandboxBehavior(storedSandboxBehavior(data.settings.sandbox_restore_behavior));
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
			restoreBehavior !== storedRestoreBehavior(overview.settings.restore_behavior) ||
			sandboxBehavior !== storedSandboxBehavior(overview.settings.sandbox_restore_behavior));
	const save = async () => {
		setBusy(true);
		setError(null);
		setSaved(false);
		const storedSandbox = storedSandboxBehavior(overview?.settings?.sandbox_restore_behavior);
		try {
			await updateBillingSettings(projectId, {
				purchases_enabled: enabled,
				restore_behavior: restoreBehavior,
				...(sandboxBehavior !== null || storedSandbox !== null
					? { sandbox_restore_behavior: sandboxBehavior }
					: {}),
			});
			const persisted = await getBillingOverview(projectId);
			if (
				!persisted.settings ||
				(persisted.settings.purchases_enabled === 1) !== enabled ||
				storedRestoreBehavior(persisted.settings.restore_behavior) !== restoreBehavior ||
				storedSandboxBehavior(persisted.settings.sandbox_restore_behavior) !== sandboxBehavior
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
							<div className="space-y-3">
								<h2 id="restore-behavior-title" className="text-sm font-medium">
									{t("Restore behavior")}
								</h2>
								<p className="text-sm text-muted-foreground">
									{t(
										"Applies to every app in this project when another App User ID restores or buys with a receipt that is already in use.",
									)}
								</p>
								<RadioGroup
									aria-labelledby="restore-behavior-title"
									value={restoreBehavior}
									onValueChange={(value) => {
										setRestoreBehavior(storedRestoreBehavior(value));
										setSaved(false);
									}}
								>
									{restoreBehaviors.map((behavior) => (
										<div key={behavior.value} className="flex items-start gap-3">
											<RadioGroupItem
												id={`restore-behavior-${behavior.value}`}
												value={behavior.value}
												aria-describedby={`restore-behavior-${behavior.value}-help`}
												className="mt-0.5"
											/>
											<div className="space-y-1">
												<Label htmlFor={`restore-behavior-${behavior.value}`}>
													{t(behavior.label)}
												</Label>
												<p
													id={`restore-behavior-${behavior.value}-help`}
													className="text-sm text-muted-foreground"
												>
													{t(behavior.help)}
												</p>
											</div>
										</div>
									))}
								</RadioGroup>
								<label className="flex items-center gap-2">
									<Checkbox
										checked={sandboxBehavior !== null}
										onCheckedChange={(value) => {
											setSandboxBehavior(value === true ? restoreBehavior : null);
											setSaved(false);
										}}
									/>
									{t("Use a different restore behavior for sandbox")}
								</label>
								{sandboxBehavior !== null && (
									<div className="space-y-2 ps-6">
										<Label htmlFor="sandbox-restore-behavior">
											{t("Sandbox restore behavior")}
										</Label>
										<select
											id="sandbox-restore-behavior"
											aria-describedby="sandbox-restore-behavior-help"
											className="h-9 w-full max-w-md rounded-md border bg-background px-3 text-sm"
											value={sandboxBehavior}
											onChange={(event) => {
												setSandboxBehavior(storedRestoreBehavior(event.target.value));
												setSaved(false);
											}}
										>
											{restoreBehaviors.map((behavior) => (
												<option key={behavior.value} value={behavior.value}>
													{t(behavior.label)}
												</option>
											))}
										</select>
										<p id="sandbox-restore-behavior-help" className="text-sm text-muted-foreground">
											{t(
												"Applies to sandbox purchases instead of the behavior above, to test another behavior without changing production.",
											)}
										</p>
									</div>
								)}
							</div>
						</fieldset>
						{error === "save" && <p role="alert">{t("Could not save billing settings.")}</p>}
						{saved && <p role="status">{t("Settings saved.")}</p>}
						<Button type="submit" disabled={!dirty || busy}>
							{t(busy ? "Saving…" : "Save settings")}
						</Button>
					</form>
				)}
				{!operatorAccountPage && <DisplayCurrencySetting key={projectId} projectId={projectId} />}
			</TabsContent>
			<TabsContent className="space-y-5" value="gateways" forceMount hidden={tab !== "gateways"}>
				<StripeSettings key={projectId} projectId={projectId} />
				{!overview ? (
					unavailable
				) : (
					<div className="space-y-4">
						<h2>{t("Connected Gateways")}</h2>
						<p>
							{t(
								"Configure store credentials in the iOS or Android application settings, then test the connection here.",
							)}
						</p>
						{connectionResult && <p role="status">{connectionResult}</p>}
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
									className="flex flex-col gap-3 rounded border p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
								>
									<div className="flex flex-wrap items-center gap-2">
										<span className="font-medium">{t(label)}</span>
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
									<div className="flex flex-wrap items-center gap-2">
										<Button asChild variant="outline">
											<a href={`/app/${platform}-setup?lang=${locale}`}>{t("Configure store")}</a>
										</Button>
										<Button
											type="button"
											disabled={busy}
											onClick={() => {
												setBusy(true);
												setConnectionResult(null);
												testBillingCredentials(projectId, platform)
													.then(() => {
														setConnectionResult(t("Store connection verified."));
													})
													.catch(() => {
														setConnectionResult(
															t(
																"Store connection failed. Check the application credentials and try again.",
															),
														);
													})
													.finally(() => {
														setBusy(false);
													});
											}}
										>
											{t("Test connection")}
										</Button>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</TabsContent>
		</>
	);
}
