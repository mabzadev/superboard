import { usePluginEnabled } from "@superboard/front-ui/context";
import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { Button, LinkButton, SwitchField } from "@superboard/front-ui/kumo";
import { PluginDiagnosticsLink } from "@superboard/front-ui/plugin-diagnostics-link";
import { SectionNavigation } from "@superboard/front-ui/section-navigation.js";
import {
	AutosaveIndicator,
	SettingsActions,
	SettingsDependents,
	SettingsRow,
	SettingsSection,
	useSettingsAutosave,
	type AutosaveStatus,
} from "@superboard/front-ui/settings-form";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { Label } from "@superboard/front-ui/ui/label.js";
import { RadioGroup, RadioGroupItem } from "@superboard/front-ui/ui/radio-group.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@superboard/front-ui/ui/tabs.js";
import { useEffect, useState, type ReactNode } from "react";

import {
	getBillingOverview,
	testBillingCredentials,
	updateBillingSettings,
	type BillingOverview,
} from "./billing/api/billing/billingService.js";
import DisplayCurrencySetting, { useDisplayCurrency } from "./DisplayCurrencySetting.js";
import { useMonetizationI18n } from "./i18n.js";
import StripeSettings, { StripeAdvancedSettings, useStripeConnection } from "./StripeSettings.js";

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

const storePlatforms = [
	["ios", "Apple App Store"],
	["android", "Google Play Billing"],
] as const;

type RestoreBehavior = (typeof restoreBehaviors)[number]["value"];
type StorePlatform = (typeof storePlatforms)[number][0];
type BillingSettingsValues = NonNullable<BillingOverview["settings"]>;

interface PurchaseSettings {
	enabled: boolean;
	restoreBehavior: RestoreBehavior;
	sandboxBehavior: RestoreBehavior | null;
}

function storedRestoreBehavior(value: string | undefined): RestoreBehavior {
	return restoreBehaviors.find((behavior) => behavior.value === value)?.value ?? "transfer";
}

function storedSandboxBehavior(value: string | null | undefined): RestoreBehavior | null {
	return restoreBehaviors.find((behavior) => behavior.value === value)?.value ?? null;
}

function purchaseSettings(settings: BillingSettingsValues): PurchaseSettings {
	return {
		enabled: settings.purchases_enabled === 1,
		restoreBehavior: storedRestoreBehavior(settings.restore_behavior),
		sandboxBehavior: storedSandboxBehavior(settings.sandbox_restore_behavior),
	};
}

const statusPriority: readonly AutosaveStatus[] = ["error", "saving", "pending", "saved"];

function combinedStatus(...statuses: AutosaveStatus[]): AutosaveStatus {
	return statusPriority.find((status) => statuses.includes(status)) ?? "idle";
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
	const { t } = useMonetizationI18n();
	const [overview, setOverview] = useState<BillingOverview | null>(null);
	const [purchases, setPurchases] = useState<PurchaseSettings | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const currency = useDisplayCurrency(projectId, !operatorAccountPage);
	const stripe = useStripeConnection(projectId);
	useEffect(() => {
		let active = true;
		void getBillingOverview(projectId)
			.then((data) => {
				if (!active) return;
				if (!data.settings) throw new Error("BILLING_SETTINGS_MISSING");
				setLoadFailed(false);
				setOverview(data);
				setPurchases(purchaseSettings(data.settings));
			})
			.catch(() => {
				if (active) setLoadFailed(true);
			});
		return () => {
			active = false;
		};
	}, [projectId, attempt]);
	const purchaseAutosave = useSettingsAutosave({
		resourceKey: purchases ? "loaded" : "loading",
		value: purchases,
		enabled: purchases !== null,
		save: async (next) => {
			if (!next) return;
			const storedSandbox = storedSandboxBehavior(overview?.settings?.sandbox_restore_behavior);
			await updateBillingSettings(projectId, {
				purchases_enabled: next.enabled,
				restore_behavior: next.restoreBehavior,
				...(next.sandboxBehavior !== null || storedSandbox !== null
					? { sandbox_restore_behavior: next.sandboxBehavior }
					: {}),
			});
			const persisted = await getBillingOverview(projectId);
			const stored = persisted.settings && purchaseSettings(persisted.settings);
			if (
				!stored ||
				stored.enabled !== next.enabled ||
				stored.restoreBehavior !== next.restoreBehavior ||
				stored.sandboxBehavior !== next.sandboxBehavior
			)
				throw new Error("BILLING_SETTINGS_NOT_PERSISTED");
			setOverview(persisted);
		},
	});
	const unavailable = loadFailed ? (
		<div role="alert" className="space-y-3">
			<p className="text-sm text-kumo-danger">{t("Could not load billing settings.")}</p>
			<SettingsActions>
				<Button
					type="button"
					onClick={() => {
						setLoadFailed(false);
						setAttempt((value) => value + 1);
					}}
				>
					{t("Retry")}
				</Button>
			</SettingsActions>
		</div>
	) : (
		<p role="status" className="text-sm text-kumo-subtle">
			{t("Loading settings…")}
		</p>
	);
	const change = (patch: Partial<PurchaseSettings>) => {
		setPurchases((previous) => previous && { ...previous, ...patch });
	};
	return (
		<>
			<TabsContent value="general" className="flex w-full flex-col gap-8">
				{purchases ? (
					<PurchaseSection value={purchases} onChange={change} />
				) : (
					<SettingsSection
						title={t("Purchases")}
						description={t("Let your apps sell products and restore purchases.")}
					>
						<SettingsRow>{unavailable}</SettingsRow>
					</SettingsSection>
				)}
				{!operatorAccountPage && <DisplayCurrencySetting currency={currency} />}
				<AutosaveIndicator
					status={combinedStatus(purchaseAutosave.status, currency.status)}
					onRetry={() => {
						if (purchaseAutosave.status === "error") purchaseAutosave.retry();
						if (currency.status === "error") currency.retry();
					}}
				/>
			</TabsContent>
			<TabsContent
				className="flex w-full flex-col gap-8"
				value="gateways"
				forceMount
				hidden={tab !== "gateways"}
			>
				<StripeSettings projectId={projectId} stripe={stripe} />
				<StoreGateways projectId={projectId} overview={overview} fallback={unavailable} />
				<StripeAdvancedSettings stripe={stripe} />
				<AutosaveIndicator status={stripe.status} onRetry={stripe.retry} />
			</TabsContent>
		</>
	);
}

function PurchaseSection({
	value,
	onChange,
}: {
	value: PurchaseSettings;
	onChange(patch: Partial<PurchaseSettings>): void;
}) {
	const { t } = useMonetizationI18n();
	return (
		<SettingsSection
			title={t("Purchases")}
			description={t("Let your apps sell products and restore purchases.")}
		>
			<SettingsRow>
				<SwitchField
					label={t("Enable purchases")}
					description={t(
						"While purchases are off, the SDK rejects purchase requests from every app in this project.",
					)}
					checked={value.enabled}
					onCheckedChange={(enabled) => {
						onChange({ enabled });
					}}
				/>
				{value.enabled && (
					<SettingsDependents className="space-y-4">
						<div className="space-y-3">
							<div className="space-y-1">
								<h3 id="restore-behavior-title" className="text-sm font-medium">
									{t("Restore behavior")}
								</h3>
								<p className="text-xs text-kumo-subtle">
									{t(
										"Applies to every app in this project when another App User ID restores or buys with a receipt that is already in use.",
									)}
								</p>
							</div>
							<RadioGroup
								aria-labelledby="restore-behavior-title"
								value={value.restoreBehavior}
								onValueChange={(next) => {
									onChange({ restoreBehavior: storedRestoreBehavior(next) });
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
												className="text-xs text-kumo-subtle"
											>
												{t(behavior.help)}
											</p>
										</div>
									</div>
								))}
							</RadioGroup>
						</div>
						<SwitchField
							label={t("Use a different restore behavior for sandbox")}
							checked={value.sandboxBehavior !== null}
							onCheckedChange={(different) => {
								onChange({ sandboxBehavior: different ? value.restoreBehavior : null });
							}}
						/>
						{value.sandboxBehavior !== null && (
							<SettingsDependents>
								<div className="space-y-2">
									<label htmlFor="sandbox-restore-behavior" className="block text-sm font-medium">
										{t("Sandbox restore behavior")}
									</label>
									<select
										id="sandbox-restore-behavior"
										aria-describedby="sandbox-restore-behavior-help"
										className="h-9 w-full rounded-md border border-kumo-line bg-kumo-base px-3 text-sm"
										value={value.sandboxBehavior}
										onChange={(event) => {
											onChange({ sandboxBehavior: storedRestoreBehavior(event.target.value) });
										}}
									>
										{restoreBehaviors.map((behavior) => (
											<option key={behavior.value} value={behavior.value}>
												{t(behavior.label)}
											</option>
										))}
									</select>
									<p id="sandbox-restore-behavior-help" className="text-xs text-kumo-subtle">
										{t(
											"Applies to sandbox purchases instead of the behavior above, to test another behavior without changing production.",
										)}
									</p>
								</div>
							</SettingsDependents>
						)}
					</SettingsDependents>
				)}
			</SettingsRow>
		</SettingsSection>
	);
}

function StoreGateways({
	projectId,
	overview,
	fallback,
}: {
	projectId: string;
	overview: BillingOverview | null;
	fallback: ReactNode;
}) {
	const { t, locale } = useMonetizationI18n();
	const [testing, setTesting] = useState<StorePlatform | null>(null);
	const [result, setResult] = useState<{ platform: StorePlatform; message: string } | null>(null);
	return (
		<SettingsSection
			title={t("Connected Gateways")}
			description={t(
				"Configure store credentials in the iOS or Android application settings, then test the connection here.",
			)}
		>
			{!overview ? (
				<SettingsRow>{fallback}</SettingsRow>
			) : (
				storePlatforms.map(([platform, label]) => {
					const credential = overview.credentials?.[platform];
					return (
						<SettingsRow key={platform}>
							<div className="flex flex-wrap items-center justify-between gap-3">
								<p className="text-sm font-medium">{t(label)}</p>
								<Badge variant={credential?.configured ? "success" : "default"}>
									{t(
										credential
											? credential.configured
												? "Configured"
												: "Not configured"
											: "Unknown",
									)}
								</Badge>
							</div>
							{result?.platform === platform && (
								<p role="status" className="text-sm">
									{result.message}
								</p>
							)}
							<SettingsActions>
								<LinkButton href={`/app/${platform}-setup?lang=${locale}`}>
									{t("Configure store")}
								</LinkButton>
								<Button
									type="button"
									disabled={testing !== null || credential?.configured === false}
									onClick={() => {
										setTesting(platform);
										setResult(null);
										testBillingCredentials(projectId, platform)
											.then(() => {
												setResult({ platform, message: t("Store connection verified.") });
											})
											.catch(() => {
												setResult({
													platform,
													message: t(
														"Store connection failed. Check the application credentials and try again.",
													),
												});
											})
											.finally(() => {
												setTesting(null);
											});
									}}
								>
									{t("Test connection")}
								</Button>
							</SettingsActions>
						</SettingsRow>
					);
				})
			)}
		</SettingsSection>
	);
}
