"use client";

import { useOptionalFrontContext } from "@superboard/front-ui/context";
import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { usePublicConfig } from "@superboard/front-ui/lib/config.js";
import {
	showErrorNotification,
	showSuccessNotification,
} from "@superboard/front-ui/lib/Notifications.js";
import { EmptyProject, moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import {
	AutosaveIndicator,
	SettingsActions,
	SettingsDependents,
	SettingsRow,
	SettingsSection,
	SettingsTextField,
	SwitchField,
	useSettingsAutosave,
} from "@superboard/front-ui/settings-form";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@superboard/front-ui/ui/alert-dialog.js";
import { Alert, AlertDescription, AlertTitle } from "@superboard/front-ui/ui/alert.js";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { Button, buttonVariants } from "@superboard/front-ui/ui/button.js";
import { Card, CardContent } from "@superboard/front-ui/ui/card.js";
import {
	Bell,
	CheckCircle2,
	Code2,
	FileCode2,
	Globe,
	KeyRound,
	Link2,
	Package,
	RotateCcw,
	Smartphone,
	Store,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import sdkCatalog from "../../../../../../../../scripts/config/sdk-libraries.json";
import {
	deleteSdkConfiguration,
	getAccessKey,
	getSdkConfiguration,
	saveSdkConfiguration,
	testSdkConfiguration,
	type SdkConfiguration,
	type SdkPlatform,
} from "../../api/app/appService.js";
import { useSettingsI18n } from "../../i18n.js";
import { useSdkI18n, type SdkMessage } from "../../sdk-i18n.js";
import {
	RenderCodeBlock,
	SectionHeader,
	StepNavigation,
	WizardSidebar,
	type CodeBlockData,
	type StepDef,
} from "../developers/SetupShared.js";
import StoreCredentialsSection from "./StoreCredentialsSection.js";

type SetupForm = {
	bundle_id: string;
	team_id: string;
	package_name: string;
	sha256: string;
	domain: string;
	push_credential_reference: string;
	store_credential_reference: string;
	minimum_version: string;
	recommended_version: string;
	maintenance_enabled: boolean;
	maintenance_message: string;
	store_url: string;
};

const emptyForm: SetupForm = {
	bundle_id: "",
	team_id: "",
	package_name: "",
	sha256: "",
	domain: "",
	push_credential_reference: "",
	store_credential_reference: "",
	minimum_version: "",
	recommended_version: "",
	maintenance_enabled: false,
	maintenance_message: "",
	store_url: "",
};

const platformLabels: Record<SdkPlatform, string> = {
	ios: "iOS",
	android: "Android",
	web: "Web",
};

type StepKey = Omit<StepDef, "name"> & { name: SdkMessage };

const steps: Record<SdkPlatform, StepKey[]> = {
	ios: [
		{ name: "step.registerApp", icon: Smartphone, optional: false },
		{ name: "step.urlScheme", icon: Link2, optional: false },
		{ name: "step.addSdk", icon: Package, optional: false },
		{ name: "step.push", icon: Bell, optional: true },
		{ name: "step.store", icon: Store, optional: true },
		{ name: "step.initialize", icon: Code2, optional: false },
	],
	android: [
		{ name: "step.registerApp", icon: Smartphone, optional: false },
		{ name: "step.intentFilters", icon: FileCode2, optional: false },
		{ name: "step.addSdk", icon: Package, optional: false },
		{ name: "step.push", icon: Bell, optional: true },
		{ name: "step.store", icon: Store, optional: true },
		{ name: "step.initialize", icon: Code2, optional: false },
	],
	web: [
		{ name: "step.registerDomain", icon: Globe, optional: false },
		{ name: "step.addSdk", icon: Package, optional: false },
		{ name: "step.integrate", icon: Code2, optional: false },
	],
};

const stepDescriptions: Record<SdkPlatform, SdkMessage[]> = {
	ios: ["step.ios.0", "step.ios.1", "step.ios.2", "step.ios.3", "step.ios.4", "step.ios.5"],
	android: [
		"step.android.0",
		"step.android.1",
		"step.android.2",
		"step.android.3",
		"step.android.4",
		"step.android.5",
	],
	web: ["step.web.0", "step.web.1", "step.web.2"],
};

const statusLabels: Record<
	SdkConfiguration["status"],
	{ label: SdkMessage; variant: "success" | "info" | "destructive" }
> = {
	verified: { label: "status.verified", variant: "success" },
	configured: { label: "status.configured", variant: "info" },
	error: { label: "status.error", variant: "destructive" },
};

function completedIndexes(completed: boolean[]) {
	return completed.map((value, index) => (value ? index : -1)).filter((index) => index >= 0);
}

function configurationForm(configuration: Record<string, unknown>): SetupForm {
	return {
		...emptyForm,
		...Object.fromEntries(
			Object.keys(emptyForm)
				.filter((key) => key !== "maintenance_enabled")
				.map((key) => [key, typeof configuration[key] === "string" ? configuration[key] : ""]),
		),
		maintenance_enabled: configuration.maintenance_enabled === true,
	} as SetupForm;
}

function code(language: string, filename: string, content: string): CodeBlockData[] {
	return [{ language, filename, code: content }];
}

function library(id: "ios" | "android") {
	const value = [...sdkCatalog.libraries, ...sdkCatalog.components].find((item) => item.id === id);
	if (!value) throw new Error(`SDK catalogue entry ${id} is missing`);
	if (!("install" in value) || typeof value.install !== "string") {
		throw new Error(`SDK catalogue entry ${id} has no published installation`);
	}
	return value;
}

function registryLibrary(id: "android") {
	const value = library(id);
	if (!("distribution" in value) || !value.distribution) {
		throw new Error(`SDK catalogue entry ${id} has no distribution contract`);
	}
	return value;
}

export function sdkInstallCode(platform: "android" | "ios" | "web"): CodeBlockData[] {
	if (platform === "ios") {
		return code("swift", "Package.swift", library("ios").install);
	}
	if (platform === "web") {
		const web = sdkCatalog.libraries.find((item) => item.id === "web");
		if (!web) throw new Error("SDK catalogue entry web is missing");
		return code(
			"bash",
			"Terminal",
			"install" in web && typeof web.install === "string"
				? web.install
				: `# ${web.displayName} ${web.sourceVersion}: source not published yet.\n# Use the monorepo workspace for local development.\npnpm --dir ${web.sourcePath} build`,
		);
	}

	const android = registryLibrary("android");
	const distribution = android.distribution;
	const authentication = distribution.authentication;
	if (!authentication.usernameEnvironmentVariable) {
		throw new Error("Android distribution requires a GitHub username variable");
	}
	const usernameEnvironmentVariable = authentication.usernameEnvironmentVariable;
	const tokenEnvironmentVariable = authentication.tokenEnvironmentVariable;
	const settings = [
		`val superBoardPackagesUser = providers.environmentVariable("${usernameEnvironmentVariable}").orNull`,
		`    ?: error("${usernameEnvironmentVariable} is required")`,
		`val superBoardPackagesToken = providers.environmentVariable("${tokenEnvironmentVariable}").orNull`,
		`    ?: error("${tokenEnvironmentVariable} is required")`,
		"",
		"dependencyResolutionManagement {",
		"    repositories {",
		"        maven {",
		'            name = "SuperBoardGitHubPackages"',
		`            url = uri("${distribution.registry}")`,
		"            credentials {",
		"                username = superBoardPackagesUser",
		"                password = superBoardPackagesToken",
		"            }",
		"        }",
		"    }",
		"}",
	].join("\n");
	return [
		...code("kotlin", "settings.gradle.kts", settings),
		...code("kotlin", "build.gradle.kts", android.install),
		...code(
			"bash",
			"Terminal",
			[
				`test -n "\${${usernameEnvironmentVariable}:-}"`,
				`test -n "\${${tokenEnvironmentVariable}:-}"`,
				"./gradlew assemble",
			].join(" \\\n  && "),
		),
	];
}

function stepCode(
	platform: SdkPlatform,
	step: number,
	accessKey: string,
	form: SetupForm,
	config: ReturnType<typeof usePublicConfig>,
	uriScheme: string,
): CodeBlockData[] | null {
	if (platform === "ios") {
		if (step === 1)
			return code(
				"xml",
				"Info.plist",
				`<key>CFBundleURLTypes</key>\n<array>\n  <dict><key>CFBundleURLSchemes</key><array><string>${uriScheme}</string></array></dict>\n</array>`,
			);
		if (step === 2) return sdkInstallCode("ios");
		if (step === 3)
			return code("swift", "AppDelegate.swift", `SuperBoard.shared.registerForPushNotifications()`);
		if (step === 4)
			return code(
				"swift",
				"AppDelegate.swift",
				`SuperBoardPurchases.shared.configure(storeKit: .automatic)`,
			);
		if (step === 5)
			return code(
				"swift",
				"App.swift",
				`SuperBoard.configure(\n  accessKey: "${accessKey}",\n  appId: "${form.bundle_id || "com.example.app"}"\n)`,
			);
	}
	if (platform === "android") {
		if (step === 1 && !config.shortlinkUrl) return null;
		if (step === 1)
			return code(
				"xml",
				"AndroidManifest.xml",
				`<intent-filter android:autoVerify="true">\n  <action android:name="android.intent.action.VIEW" />\n  <category android:name="android.intent.category.BROWSABLE" />\n  <data android:scheme="https" android:host="${new URL(config.shortlinkUrl!).hostname}" />\n</intent-filter>`,
			);
		if (step === 2) return sdkInstallCode("android");
		if (step === 3)
			return code("kotlin", "SuperBoardMessagingService.kt", `SuperBoard.setPushToken(token)`);
		if (step === 4) return code("kotlin", "Application.kt", `SuperBoardPurchases.configure(this)`);
		if (step === 5)
			return code(
				"kotlin",
				"Application.kt",
				`SuperBoard.initialize(\n  context = this,\n  accessKey = "${accessKey}",\n  appId = "${form.package_name || "com.example.app"}"\n)`,
			);
	}
	if (platform === "web") {
		if (step === 2 && !config.sdkUrl) return null;
		const javascriptLibrary = sdkCatalog.libraries.find((item) => item.id === "web");
		if (!javascriptLibrary) throw new Error("SDK catalogue entry web is missing");
		if (step === 1) return sdkInstallCode("web");
		if (step === 2)
			return code(
				"typescript",
				"superboard.ts",
				`import SuperBoard from "${javascriptLibrary.packageName}";\n\nconst superBoard = new SuperBoard(\n  "${accessKey}",\n  false,\n  (data) => console.info("SuperBoard link", data),\n  "${config.sdkUrl}",\n);\nsuperBoard.start();`,
			);
	}
	return null;
}

export default function SdkSetupWizard({ platform }: { platform: SdkPlatform }) {
	const { selectedProject } = useProjectSelection();
	const projectId = selectedProject?.id;
	const { t } = useSdkI18n();
	const stepKeys = steps[platform];
	const platformSteps = useMemo<StepDef[]>(
		() => stepKeys.map((step) => ({ ...step, name: t(step.name) })),
		[stepKeys, t],
	);
	const [record, setRecord] = useState<SdkConfiguration | null>(null);
	const [form, setForm] = useState<SetupForm>(emptyForm);
	const [initial, setInitial] = useState<SetupForm>(emptyForm);
	const [revision, setRevision] = useState(0);
	const [currentStep, setCurrentStep] = useState(0);
	const [completed, setCompleted] = useState<boolean[]>(stepKeys.map(() => false));
	const [accessKey, setAccessKey] = useState("YOUR_ACCESS_KEY");
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [confirmRemove, setConfirmRemove] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		if (!projectId) return;
		setLoading(true);
		try {
			const [configuration, key] = await Promise.all([
				getSdkConfiguration(projectId, platform),
				getAccessKey(projectId),
			]);
			setRecord(configuration);
			const nextForm = configurationForm(configuration?.configuration ?? {});
			setForm(nextForm);
			setInitial(nextForm);
			setRevision((value) => value + 1);
			const savedSteps = Array.isArray(configuration?.configuration.completed_steps)
				? configuration.configuration.completed_steps
				: [];
			setCompleted(stepKeys.map((_, index) => savedSteps.includes(index)));
			setAccessKey(key?.prefix ? `${key.prefix}••••••••` : "YOUR_ACCESS_KEY");
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause));
		} finally {
			setLoading(false);
		}
	}, [platform, stepKeys, projectId]);

	useEffect(() => {
		void load();
	}, [load]);

	const autosave = useSettingsAutosave({
		resourceKey: `${projectId ?? ""}:${platform}:${revision}`,
		value: form,
		enabled: Boolean(projectId && record) && !loading,
		save: async (value) => {
			if (!projectId) return;
			const saved = await saveSdkConfiguration(projectId, platform, {
				...value,
				completed_steps: completedIndexes(completed),
			});
			setRecord(saved);
			setInitial(value);
		},
	});

	const hasChanges = useMemo(
		() => JSON.stringify(form) !== JSON.stringify(initial),
		[form, initial],
	);
	const visitedSteps = useMemo(
		() => new Set(platformSteps.map((_, index) => index)),
		[platformSteps],
	);

	const save = async (nextStep?: number) => {
		if (!projectId) return;
		setSaving(true);
		try {
			const nextCompleted = completed.map((value, index) => (index === currentStep ? true : value));
			const configuration = { ...form, completed_steps: completedIndexes(nextCompleted) };
			const saved = await saveSdkConfiguration(projectId, platform, configuration);
			setRecord(saved);
			setInitial(form);
			if (!record) setRevision((value) => value + 1);
			setCompleted(nextCompleted);
			showSuccessNotification(t("wizard.saved", { platform: platformLabels[platform] }));
			if (nextStep !== undefined) setCurrentStep(nextStep);
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		} finally {
			setSaving(false);
		}
	};

	const finish = async () => {
		await save();
		if (!projectId) return;
		try {
			await testSdkConfiguration(projectId, platform);
			showSuccessNotification(t("wizard.verified"));
			await load();
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		}
	};

	const remove = async () => {
		if (!projectId) return;
		setConfirmRemove(false);
		setSaving(true);
		try {
			await deleteSdkConfiguration(projectId, platform);
			setRecord(null);
			setForm(emptyForm);
			setInitial(emptyForm);
			setRevision((value) => value + 1);
			setCompleted(stepKeys.map(() => false));
			setCurrentStep(0);
			showSuccessNotification(t("wizard.removed"));
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		} finally {
			setSaving(false);
		}
	};

	const next = Math.min(currentStep + 1, platformSteps.length - 1);
	const isInteractive = currentStep === 0 || currentStep === 3 || currentStep === 4;
	const currentDefinition = platformSteps[currentStep] ?? platformSteps[0]!;
	const status = record ? statusLabels[record.status] : undefined;

	return (
		<section className="space-y-4">
			<p className="text-sm text-muted-foreground">
				{t("wizard.intro", { count: platformSteps.length, platform: platformLabels[platform] })}
			</p>
			{error && (
				<Alert variant="destructive">
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<div className="space-y-4">
					<div className="flex items-center justify-between gap-4 rounded-lg border border-kumo-line px-4 py-3">
						<span className="text-sm font-medium">
							{t("wizard.sdk", { platform: platformLabels[platform] })}
						</span>
						<Badge variant={loading ? "outline" : (status?.variant ?? "default")}>
							{record?.status === "verified" && !loading ? <CheckCircle2 /> : null}
							{t(loading ? "status.loading" : (status?.label ?? "status.notConfigured"))}
						</Badge>
					</div>

					<Card className="overflow-hidden">
						<CardContent className="flex min-h-[620px] overflow-x-auto p-0">
							<WizardSidebar
								platformLabel={t("wizard.sdk", { platform: platformLabels[platform] })}
								steps={platformSteps}
								currentStep={currentStep}
								visitedSteps={visitedSteps}
								stepCompleted={completed}
								sdkConfigured={Boolean(record)}
								onStepClick={setCurrentStep}
								onOverview={() => setCurrentStep(0)}
							/>
							<div className="flex min-w-[560px] flex-1 flex-col">
								<div className="flex-1 overflow-auto p-6">
									<SetupStep
										platform={platform}
										step={currentStep}
										definition={currentDefinition}
										form={form}
										setForm={setForm}
										accessKey={accessKey}
									/>
								</div>
								<StepNavigation
									currentStep={currentStep}
									totalSteps={platformSteps.length}
									isOptional={currentDefinition.optional}
									hasChanges={hasChanges || !completed[currentStep]}
									isInteractive={isInteractive}
									isSaving={saving}
									onBack={() => setCurrentStep(Math.max(0, currentStep - 1))}
									onContinue={() => {
										setCompleted((values) =>
											values.map((value, index) => (index === currentStep ? true : value)),
										);
										setCurrentStep(next);
									}}
									onSaveAndContinue={() => void save(next)}
									onSkip={() => setCurrentStep(next)}
									onFinish={() => void finish()}
								/>
							</div>
						</CardContent>
					</Card>

					{record ? <AutosaveIndicator status={autosave.status} onRetry={autosave.retry} /> : null}

					<SettingsActions>
						<Button variant="outline" disabled={loading} onClick={() => void load()}>
							<RotateCcw className="size-4" /> {t("wizard.reload")}
						</Button>
						<Button
							variant="destructive"
							disabled={!record || saving}
							onClick={() => {
								setConfirmRemove(true);
							}}
						>
							<Trash2 className="size-4" /> {t("wizard.remove")}
						</Button>
					</SettingsActions>
					<AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>
									{t("wizard.removeTitle", { platform: platformLabels[platform] })}
								</AlertDialogTitle>
								<AlertDialogDescription>{t("wizard.removeDescription")}</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>{t("wizard.cancel")}</AlertDialogCancel>
								<AlertDialogAction
									className={buttonVariants({ variant: "destructive" })}
									onClick={() => void remove()}
								>
									{t("wizard.removeConfirm")}
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				</div>
			)}
		</section>
	);
}

type SetForm = React.Dispatch<React.SetStateAction<SetupForm>>;

function SetupStep({
	platform,
	step,
	definition,
	form,
	setForm,
	accessKey,
}: {
	platform: SdkPlatform;
	step: number;
	definition: StepDef;
	form: SetupForm;
	setForm: SetForm;
	accessKey: string;
}) {
	const config = usePublicConfig();
	const front = useOptionalFrontContext();
	const { t: settings } = useSettingsI18n();
	const { t } = useSdkI18n();
	const configuredScheme = front?.projectScope?.instance?.uri_scheme ?? "";
	const uriScheme = /^[a-z][a-z0-9+.-]*$/iu.test(configuredScheme)
		? configuredScheme
		: "superboard";
	const missingEndpoint =
		platform === "android" && step === 1 && !config.shortlinkUrl
			? "Short-link"
			: platform === "web" && step === 2 && !config.sdkUrl
				? "SDK"
				: null;
	const codeBlock = stepCode(platform, step, accessKey, form, config, uriScheme);
	return (
		<div className="mx-auto max-w-3xl space-y-6">
			{missingEndpoint && <p role="alert">{config.endpointError(missingEndpoint)}</p>}
			<SectionHeader
				icon={definition.icon}
				title={definition.name}
				subtitle={t(stepDescriptions[platform][step] ?? "step.default")}
				badge={definition.optional ? <Badge variant="secondary">{t("optional")}</Badge> : undefined}
			/>
			{step === 0 ? (
				<>
					<RegistrationFields platform={platform} form={form} setForm={setForm} />
					<RuntimePolicyFields form={form} setForm={setForm} />
				</>
			) : null}
			{(platform === "ios" || platform === "android") && step === 3 ? (
				<SettingsTextField
					label={t("push.label")}
					description={t("push.hint")}
					placeholder="secret://push/provider-key"
					value={form.push_credential_reference}
					onChange={(event) => {
						const push_credential_reference = event.currentTarget.value;
						setForm((value) => ({ ...value, push_credential_reference }));
					}}
				/>
			) : null}
			{(platform === "ios" || platform === "android") && step === 4 ? (
				<>
					<StoreCredentialsSection platform={platform} registration={form} />
					<SettingsTextField
						label={settings("store.referenceLabel")}
						description={settings("store.referenceHint")}
						placeholder="secret://store/provider-key"
						value={form.store_credential_reference}
						onChange={(event) => {
							const store_credential_reference = event.currentTarget.value;
							setForm((value) => ({ ...value, store_credential_reference }));
						}}
					/>
				</>
			) : null}
			{codeBlock ? <RenderCodeBlock data={codeBlock} /> : null}
			{step > 0 ? (
				<Alert>
					<KeyRound className="size-4" />
					<AlertTitle>{t("scope.title")}</AlertTitle>
					<AlertDescription>{t("scope.description")}</AlertDescription>
				</Alert>
			) : null}
		</div>
	);
}

function RegistrationFields({
	platform,
	form,
	setForm,
}: {
	platform: SdkPlatform;
	form: SetupForm;
	setForm: SetForm;
}) {
	const { t } = useSdkI18n();
	return (
		<SettingsSection title={t("registration.title")} description={t("registration.description")}>
			<SettingsRow>
				{platform === "ios" ? (
					<>
						<Field
							label={t("field.bundleId")}
							placeholder="com.example.app"
							value={form.bundle_id}
							onChange={(bundle_id) => setForm((value) => ({ ...value, bundle_id }))}
						/>
						<Field
							label={t("field.teamId")}
							placeholder="ABCDE12345"
							value={form.team_id}
							onChange={(team_id) => setForm((value) => ({ ...value, team_id }))}
						/>
					</>
				) : platform === "android" ? (
					<>
						<Field
							label={t("field.packageName")}
							placeholder="com.example.app"
							value={form.package_name}
							onChange={(package_name) => setForm((value) => ({ ...value, package_name }))}
						/>
						<Field
							label={t("field.sha256")}
							placeholder="AA:BB:CC:…"
							value={form.sha256}
							onChange={(sha256) => setForm((value) => ({ ...value, sha256 }))}
						/>
					</>
				) : (
					<Field
						label={t("field.domain")}
						placeholder="app.example.com"
						value={form.domain}
						onChange={(domain) => setForm((value) => ({ ...value, domain }))}
					/>
				)}
			</SettingsRow>
		</SettingsSection>
	);
}

function RuntimePolicyFields({ form, setForm }: { form: SetupForm; setForm: SetForm }) {
	const { t } = useSdkI18n();
	return (
		<SettingsSection title={t("runtime.title")} description={t("runtime.description")}>
			<SettingsRow>
				<Field
					label={t("runtime.minimumVersion")}
					placeholder="2.0.0"
					value={form.minimum_version}
					onChange={(minimum_version) => setForm((value) => ({ ...value, minimum_version }))}
				/>
				<Field
					label={t("runtime.recommendedVersion")}
					placeholder="2.1.0"
					value={form.recommended_version}
					onChange={(recommended_version) =>
						setForm((value) => ({ ...value, recommended_version }))
					}
				/>
				<Field
					label={t("runtime.storeUrl")}
					placeholder="https://apps.apple.com/app/id…"
					value={form.store_url}
					onChange={(store_url) => setForm((value) => ({ ...value, store_url }))}
				/>
			</SettingsRow>
			<SettingsRow>
				<SwitchField
					label={t("runtime.maintenance")}
					description={t("runtime.maintenanceDescription")}
					checked={form.maintenance_enabled}
					onCheckedChange={(maintenance_enabled) =>
						setForm((value) => ({ ...value, maintenance_enabled }))
					}
				/>
				{form.maintenance_enabled ? (
					<SettingsDependents>
						<Field
							label={t("runtime.maintenanceMessage")}
							placeholder={t("runtime.maintenancePlaceholder")}
							value={form.maintenance_message}
							onChange={(maintenance_message) => {
								setForm((value) => ({ ...value, maintenance_message }));
							}}
						/>
					</SettingsDependents>
				) : null}
			</SettingsRow>
		</SettingsSection>
	);
}

function Field({
	label,
	placeholder,
	value,
	onChange,
}: {
	label: string;
	placeholder: string;
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<SettingsTextField
			label={label}
			placeholder={placeholder}
			value={value}
			onChange={(event) => onChange(event.currentTarget.value)}
		/>
	);
}
