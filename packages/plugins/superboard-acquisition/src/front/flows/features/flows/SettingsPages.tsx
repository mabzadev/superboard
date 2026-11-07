"use client";

import { config, usePublicConfig } from "@superboard/front-ui/lib/config.js";
import {
	showErrorNotification,
	showSuccessNotification,
} from "@superboard/front-ui/lib/Notifications.js";
import { PluginDiagnosticsLink } from "@superboard/front-ui/plugin-diagnostics-link";
import {
	AutosaveIndicator,
	SettingsActions,
	SettingsRow,
	SettingsSection,
	SettingsTextField,
	SwitchField,
	useSettingsAutosave,
} from "@superboard/front-ui/settings-form";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@superboard/front-ui/ui/dialog.js";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superboard/front-ui/ui/select.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@superboard/front-ui/ui/tabs.js";
import { Check, Copy, FolderKanban, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ConfirmDialog, SettingsField } from "../../../SettingsLayout.js";
import {
	flowsApi,
	type FlowEnvironment,
	type FlowLanguageGroup,
} from "../../api/flows/flowsService.js";
import { useFlows } from "./FlowsContext.js";
import { FlowsEmptyState } from "./FlowsPage.js";
import { useFlowI18n } from "./i18n.js";

const settingsTabs = ["environments", "localization", "sdk"] as const;
type SettingsTab = (typeof settingsTabs)[number];

function environmentKind(kind: FlowEnvironment["kind"]) {
	return kind === "development" ? "Development" : kind === "production" ? "Production" : "Test";
}

export function EnvironmentsContent({ projectRef }: { projectRef: string }) {
	const { t, tr } = useFlowI18n();
	const [items, setItems] = useState<FlowEnvironment[]>([]);
	const [open, setOpen] = useState(false);
	const [revealed, setRevealed] = useState<{ environment: string; key: string } | null>(null);
	const [rotating, setRotating] = useState<FlowEnvironment | null>(null);
	const load = useCallback(() => {
		if (!projectRef) return Promise.resolve();
		return flowsApi.listEnvironments(projectRef).then((environments) => {
			setItems(environments);
		});
	}, [projectRef]);
	useEffect(() => {
		void load().catch((cause: unknown) => {
			showErrorNotification(message(cause, t("apiFailure")));
		});
	}, [load, t]);
	const rotate = async (environment: FlowEnvironment) => {
		if (!projectRef) return;
		try {
			const result = await flowsApi.rotateEnvironmentKey(projectRef, environment.id);
			setRevealed({ environment: environment.name, key: result.sdk_key });
			showSuccessNotification(tr("SDK key rotated"));
		} catch (cause) {
			showErrorNotification(message(cause, t("apiFailure")));
		}
	};
	return (
		<div className="flex w-full flex-col gap-8">
			{revealed && (
				<SettingsSection title={tr("New SDK key")} description={t("revealOnce")}>
					<SettingsRow>
						<p className="text-sm font-medium">{revealed.environment}</p>
						<CopyField value={revealed.key} />
					</SettingsRow>
				</SettingsSection>
			)}
			<SettingsSection
				title={tr("Release environments")}
				description={tr(
					"Each environment has its own SDK key, shown only once when it is created or rotated.",
				)}
			>
				{items.length ? (
					items.map((environment) => (
						<SettingsRow
							key={environment.id}
							className="flex flex-wrap items-center justify-between gap-3 space-y-0"
						>
							<div className="min-w-0 space-y-2">
								<h3 className="text-sm font-medium">{environment.name}</h3>
								<div className="flex flex-wrap gap-2">
									<Badge variant="outline">{tr(environmentKind(environment.kind))}</Badge>
									<Badge variant={environment.allow_draft ? "warning" : "default"}>
										{tr(
											environment.allow_draft
												? "Draft releases allowed"
												: "Published versions only",
										)}
									</Badge>
									<Badge variant={environment.active ? "success" : "default"}>
										{tr(environment.active ? "Active" : "Inactive")}
									</Badge>
								</div>
							</div>
							<Button
								variant="outline"
								size="sm"
								onClick={() => {
									setRotating(environment);
								}}
							>
								<RefreshCw /> {t("rotateKey")}
							</Button>
						</SettingsRow>
					))
				) : (
					<SettingsRow>
						<p className="text-sm text-kumo-subtle">{tr("No environments yet.")}</p>
					</SettingsRow>
				)}
			</SettingsSection>
			<SettingsActions>
				<Dialog open={open} onOpenChange={setOpen}>
					<DialogTrigger asChild>
						<Button>
							<Plus /> {tr("New environment")}
						</Button>
					</DialogTrigger>
					<CreateEnvironmentDialog
						onCreated={(environment, key) => {
							setOpen(false);
							if (key) setRevealed({ environment, key });
							void load().catch((cause: unknown) => {
								showErrorNotification(message(cause, t("apiFailure")));
							});
						}}
					/>
				</Dialog>
			</SettingsActions>
			<ConfirmDialog
				open={rotating !== null}
				title={tr("Rotate this SDK key?")}
				description={tr(
					"The current key stops working immediately. Applications that use it need the new key.",
				)}
				confirm={t("rotateKey")}
				cancel={t("cancel")}
				onConfirm={() => {
					if (rotating) rotate(rotating).catch(() => undefined);
				}}
				onClose={() => {
					setRotating(null);
				}}
			/>
		</div>
	);
}

function CreateEnvironmentDialog({
	onCreated,
}: {
	onCreated: (environment: string, key: string | undefined) => void;
}) {
	const { t, tr } = useFlowI18n();
	const { projectRef } = useFlows();
	const [name, setName] = useState("");
	const [key, setKey] = useState("");
	const [kind, setKind] = useState("development");
	const [allowDraft, setAllowDraft] = useState(true);
	const [busy, setBusy] = useState(false);
	const create = async () => {
		if (!projectRef || !name || !key) return;
		setBusy(true);
		try {
			const result = await flowsApi.createEnvironment(projectRef, {
				name,
				key,
				kind,
				allow_draft: kind === "development" && allowDraft,
			});
			showSuccessNotification(tr("New environment created"));
			onCreated(name, result.sdk_key);
		} catch (cause) {
			showErrorNotification(message(cause, t("apiFailure")));
		} finally {
			setBusy(false);
		}
	};
	return (
		<DialogContent>
			<DialogHeader>
				<DialogTitle>{tr("New environment")}</DialogTitle>
				<DialogDescription>
					{tr("SDK keys are isolated and rotatable. Only development environments can use drafts.")}
				</DialogDescription>
			</DialogHeader>
			<div className="space-y-4">
				<SettingsTextField
					label={t("name")}
					value={name}
					onChange={(event) => {
						setName(event.target.value);
						if (!key) setKey(identifier(event.target.value));
					}}
				/>
				<SettingsTextField
					label={t("identifier")}
					description={tr("Used by the SDK to select this environment.")}
					className="font-mono"
					value={key}
					onChange={(event) => {
						setKey(identifier(event.target.value));
					}}
				/>
				<SettingsField label={tr("Kind")}>
					{(id) => (
						<Select value={kind} onValueChange={setKind}>
							<SelectTrigger id={id} className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="development">{tr("Development")}</SelectItem>
								<SelectItem value="test">{tr("Test")}</SelectItem>
								<SelectItem value="production">{tr("Production")}</SelectItem>
							</SelectContent>
						</Select>
					)}
				</SettingsField>
				{kind === "development" && (
					<SwitchField
						label={tr("Allow draft releases")}
						description={tr("Test unpublished workflow versions in this environment.")}
						checked={allowDraft}
						onCheckedChange={setAllowDraft}
					/>
				)}
			</div>
			<DialogFooter>
				<Button disabled={!name || !key || busy} onClick={() => void create()}>
					{busy ? t("saving") : t("create")}
				</Button>
			</DialogFooter>
		</DialogContent>
	);
}

type LocalizationForm = {
	name: string;
	defaultLocale: string;
	locales: string;
	fallbacks: string;
};

function localizationForm(group: FlowLanguageGroup): LocalizationForm {
	return {
		name: group.name,
		defaultLocale: group.default_locale,
		locales: group.locales.join(", "),
		fallbacks: Object.entries(group.fallbacks)
			.map(([from, to]) => `${from}:${to}`)
			.join(", "),
	};
}

function newLocalizationForm(name: string): LocalizationForm {
	return { name, defaultLocale: "en", locales: "en, fr", fallbacks: "fr:en" };
}

export function LocalizationContent({ projectRef }: { projectRef: string }) {
	const { t, tr } = useFlowI18n();
	const [groups, setGroups] = useState<FlowLanguageGroup[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [previousId, setPreviousId] = useState<string | null>(null);
	const [form, setForm] = useState<LocalizationForm>(() => newLocalizationForm(""));
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		flowsApi.listLocalization(projectRef).then(
			(result) => {
				setGroups(result);
				const selected = result[0];
				if (selected) {
					setSelectedId(selected.id);
					setForm(localizationForm(selected));
				}
			},
			(cause: unknown) => {
				showErrorNotification(message(cause, t("apiFailure")));
			},
		);
	}, [projectRef, t]);
	const creating = selectedId === null;
	const valid =
		form.name.trim() !== "" && form.defaultLocale.trim() !== "" && csv(form.locales).length > 0;
	const saveGroup = (value: LocalizationForm, id?: string) =>
		flowsApi.saveLocalization(projectRef, {
			id,
			name: value.name,
			default_locale: value.defaultLocale,
			locales: csv(value.locales),
			fallbacks: parseFallbacks(value.fallbacks),
		});
	const autosave = useSettingsAutosave({
		resourceKey: selectedId ?? "new",
		value: form,
		enabled: !creating && valid,
		save: async (value) => {
			const saved = await saveGroup(value, selectedId ?? undefined);
			setGroups((current) => current.map((group) => (group.id === saved.id ? saved : group)));
		},
	});
	const select = (group: FlowLanguageGroup) => {
		setSelectedId(group.id);
		setForm(localizationForm(group));
	};
	const create = async () => {
		setBusy(true);
		try {
			const saved = await saveGroup(form);
			setGroups((current) => [...current, saved]);
			select(saved);
			showSuccessNotification(tr("Localization saved"));
		} catch (cause) {
			showErrorNotification(message(cause, t("apiFailure")));
		} finally {
			setBusy(false);
		}
	};
	const change = (field: keyof LocalizationForm, value: string) => {
		setForm((current) => ({ ...current, [field]: value }));
	};
	return (
		<div className="flex w-full flex-col gap-8">
			<SettingsSection
				title={tr("Language groups")}
				description={tr("Choose the language group to edit, or create a new one.")}
			>
				<SettingsRow>
					<Select
						value={selectedId ?? ""}
						onValueChange={(id) => {
							const group = groups.find((item) => item.id === id);
							if (group) select(group);
						}}
					>
						<SelectTrigger className="w-full" aria-label={tr("Language groups")}>
							<SelectValue placeholder={tr("New group")} />
						</SelectTrigger>
						<SelectContent>
							{groups.map((group) => (
								<SelectItem key={group.id} value={group.id}>
									{group.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{!creating && (
						<SettingsActions>
							<Button
								variant="outline"
								onClick={() => {
									setPreviousId(selectedId);
									setSelectedId(null);
									setForm(newLocalizationForm(tr("New group")));
								}}
							>
								<Plus /> {tr("New group")}
							</Button>
						</SettingsActions>
					)}
				</SettingsRow>
			</SettingsSection>
			<SettingsSection
				title={creating ? tr("New group") : form.name || tr("Language group")}
				description={tr(
					"Translated block fields show missing values and use these fallback rules at runtime.",
				)}
			>
				<SettingsRow>
					<SettingsTextField
						label={t("name")}
						value={form.name}
						onChange={(event) => {
							change("name", event.target.value);
						}}
					/>
				</SettingsRow>
				<SettingsRow>
					<SettingsTextField
						label={t("defaultLocale")}
						value={form.defaultLocale}
						onChange={(event) => {
							change("defaultLocale", event.target.value);
						}}
					/>
				</SettingsRow>
				<SettingsRow>
					<SettingsTextField
						label={t("locales")}
						description={tr("Comma-separated BCP 47 language codes.")}
						placeholder={tr("en, fr, de")}
						value={form.locales}
						onChange={(event) => {
							change("locales", event.target.value);
						}}
					/>
				</SettingsRow>
				<SettingsRow>
					<SettingsTextField
						label={t("fallbacks")}
						description={tr(
							"Language:fallback pairs separated by commas. fr-CH:fr uses French when Swiss French is missing.",
						)}
						placeholder={tr("fr-CH:fr, fr:en")}
						value={form.fallbacks}
						onChange={(event) => {
							change("fallbacks", event.target.value);
						}}
					/>
				</SettingsRow>
			</SettingsSection>
			{creating ? (
				<SettingsActions>
					{groups.length > 0 && (
						<Button
							variant="outline"
							onClick={() => {
								const group = groups.find((item) => item.id === previousId) ?? groups[0];
								if (group) select(group);
							}}
						>
							{t("cancel")}
						</Button>
					)}
					<Button disabled={!valid || busy} onClick={() => void create()}>
						{busy ? t("saving") : t("create")}
					</Button>
				</SettingsActions>
			) : (
				<>
					{!valid && (
						<p className="text-sm text-kumo-danger">
							{tr("Enter a name, a default language and at least one language to save.")}
						</p>
					)}
					<AutosaveIndicator status={autosave.status} onRetry={autosave.retry} />
				</>
			)}
		</div>
	);
}

const SDK_SNIPPETS = {
	javascript: (projectId: string, environmentKey: string, apiUrl: string) =>
		`import { init } from "@superboard/flows-js";\n\nconst flows = init({\n  apiUrl: "${apiUrl}",\n  projectId: "${projectId}",\n  environment: "${environmentKey}",\n  sdkKey: "YOUR_ENVIRONMENT_SDK_KEY",\n  userId: currentUser.id,\n});`,
	react: (projectId: string, environmentKey: string, apiUrl: string) =>
		`import { FlowsProvider } from "@superboard/flows-react";\n\n<FlowsProvider\n  apiUrl="${apiUrl}"\n  projectId="${projectId}"\n  environment="${environmentKey}"\n  sdkKey="YOUR_ENVIRONMENT_SDK_KEY"\n  userId={user.id}\n>\n  <App />\n</FlowsProvider>`,
	flutter: (projectId: string, environmentKey: string, apiUrl: string) =>
		`await SuperBoardFlows.initialize(\n  apiUrl: '${apiUrl}',\n  projectId: '${projectId}',\n  environment: '${environmentKey}',\n  sdkKey: 'YOUR_ENVIRONMENT_SDK_KEY',\n  userId: currentUser.id,\n);\n\nreturn SuperBoardFlowsOverlay(child: app);`,
	flutterflow: (projectId: string, environmentKey: string, apiUrl: string) =>
		`await superboardFlowsInitialize(\n  apiUrl: '${apiUrl}',\n  projectId: '${projectId}',\n  environment: '${environmentKey}',\n  sdkKey: 'YOUR_ENVIRONMENT_SDK_KEY',\n  userId: currentUserId,\n);`,
} as const;

export type FlowSdkSnippetPlatform = keyof typeof SDK_SNIPPETS;

export function flowsSdkApiUrl(apiUrl: string): string {
	if (!apiUrl.trim()) throw new Error("Public API endpoint is not configured");
	return `${apiUrl.trim().replace(/\/+$/u, "")}/api/v1/flows`;
}

export function flowSdkSnippet(
	platform: FlowSdkSnippetPlatform,
	projectId: string,
	environmentKey: string,
	apiUrl: string = config.apiUrl,
): string {
	return SDK_SNIPPETS[platform](projectId, environmentKey, flowsSdkApiUrl(apiUrl));
}

export function SdkContent({ projectRef }: { projectRef: string }) {
	const publicConfig = usePublicConfig();
	const { t, tr } = useFlowI18n();
	const [environments, setEnvironments] = useState<FlowEnvironment[]>([]);
	const [environmentKey, setEnvironmentKey] = useState("");
	const [platform, setPlatform] = useState<FlowSdkSnippetPlatform>("javascript");
	useEffect(() => {
		if (!projectRef) return;
		void flowsApi
			.listEnvironments(projectRef)
			.then((items) => {
				setEnvironments(items);
				setEnvironmentKey(items[0]?.key ?? "");
			})
			.catch((cause: unknown) => {
				showErrorNotification(message(cause, t("apiFailure")));
			});
	}, [projectRef, t]);
	const platforms = useMemo(
		() =>
			[
				{
					id: "javascript",
					label: "JavaScript",
					install: "npm install @superboard/flows-js @superboard/flows-js-components",
				},
				{
					id: "react",
					label: "React",
					install: "npm install @superboard/flows-react @superboard/flows-react-components",
				},
				{
					id: "flutter",
					label: "Flutter",
					install: "flutter pub add superboard_flows",
				},
				{
					id: "flutterflow",
					label: "FlutterFlow",
					install: "Import SuperBoard Flows custom actions and widgets",
				},
			] as const,
		[],
	);
	const selectedPlatform = platforms.find((item) => item.id === platform) ?? platforms[0];
	return (
		<div className="flex w-full flex-col gap-8">
			<SettingsSection
				title={tr("Runtime selection")}
				description={tr(
					"Use the current project identifier and a rotatable environment key. The API stays on SuperBoard.",
				)}
			>
				<SettingsRow>
					<SettingsField label={tr("Environment")}>
						{(id) => (
							<Select value={environmentKey} onValueChange={setEnvironmentKey}>
								<SelectTrigger id={id} className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{environments.map((environment) => (
										<SelectItem key={environment.id} value={environment.key}>
											{environment.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						)}
					</SettingsField>
				</SettingsRow>
				<SettingsRow>
					<SettingsField label={t("platform")}>
						{(id) => (
							<Select
								value={platform}
								onValueChange={(value) => {
									const next = platforms.find((item) => item.id === value);
									if (next) setPlatform(next.id);
								}}
							>
								<SelectTrigger id={id} className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{platforms.map((item) => (
										<SelectItem key={item.id} value={item.id}>
											{item.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						)}
					</SettingsField>
				</SettingsRow>
				<SettingsRow>
					<p className="text-sm font-medium">{tr("Project identifier")}</p>
					<CopyField value={projectRef} />
				</SettingsRow>
				{environmentKey && (
					<SettingsRow>
						<p className="text-sm font-medium">{tr("Environment identifier")}</p>
						<CopyField value={environmentKey} />
					</SettingsRow>
				)}
			</SettingsSection>
			{!environmentKey ? (
				<p role="alert" className="text-sm text-kumo-subtle">
					{tr("Select an available environment to view SDK examples.")}
				</p>
			) : publicConfig.apiUrl ? (
				<SdkCodePanel
					title={selectedPlatform.label}
					install={tr(selectedPlatform.install)}
					code={flowSdkSnippet(platform, projectRef, environmentKey, publicConfig.apiUrl)}
				/>
			) : (
				<p role="alert" className="text-sm text-kumo-danger">
					{publicConfig.endpointError("API")}
				</p>
			)}
			<SettingsSection
				title={tr("Debug and compatibility")}
				description={tr("Notes for the developers who integrate the SDK.")}
			>
				<SettingsRow>
					<ul className="list-disc space-y-2 ps-5 text-sm text-kumo-subtle">
						<li>{tr("Configure SPA navigation and language in the SDK initialization.")}</li>
						<li>
							{tr("The debug overlay reconnects WebSockets and displays ordered block updates.")}
						</li>
						<li>
							{tr(
								"Legacy @flows packages remain compatible through the canonical SDK key header supplied by customFetch.",
							)}
						</li>
						<li>
							{tr(
								"Existing Paywall and Onboarding widgets remain deprecated adapters to Flows workflows.",
							)}
						</li>
						<li>
							{tr(
								"Purchases and restores always delegate to Products; Flows never invents revenue.",
							)}
						</li>
					</ul>
				</SettingsRow>
			</SettingsSection>
		</div>
	);
}

function requestedTab(defaultTab: SettingsTab): SettingsTab {
	if (typeof window === "undefined") return defaultTab;
	const requested = new URLSearchParams(window.location.search).get("tab");
	return settingsTabs.find((tab) => tab === requested) ?? defaultTab;
}

export function AcquisitionSettingsPage({
	defaultTab = "environments",
}: {
	defaultTab?: SettingsTab;
} = {}) {
	const { t, tr, locale } = useFlowI18n();
	const { projectRef } = useFlows();
	const [tab, setTab] = useState(() => requestedTab(defaultTab));
	useEffect(() => {
		const url = new URL(window.location.href);
		if (url.searchParams.get("tab") === "links") {
			const lang = url.searchParams.get("lang");
			window.location.replace(
				`/acquisition/dynamic-links?${lang ? `lang=${encodeURIComponent(lang)}&` : ""}tab=settings`,
			);
			return;
		}
		if (
			/^\/(flows|acquisition)\/settings\/(environments|localization|sdk)$/.test(
				window.location.pathname,
			)
		) {
			url.pathname = "/acquisition/settings";
			url.searchParams.set("tab", defaultTab);
			window.location.replace(url);
		}
	}, [defaultTab]);

	return (
		<section className="ds-page flex min-w-0 flex-col gap-5">
			<header className="ds-page-header shrink-0 gap-4">
				<div className="min-w-0">
					<h1 className="ds-page-title">{tr("Acquisition settings")}</h1>
					<p className="ds-page-description">
						{tr("Manage release environments, SDK integrations and localization rules.")}
					</p>
				</div>
			</header>

			<Tabs
				value={tab}
				onValueChange={(value) => {
					const next = settingsTabs.find((item) => item === value);
					if (!next) return;
					setTab(next);
					const url = new URL(window.location.href);
					url.searchParams.set("tab", next);
					window.history.replaceState(null, "", url);
				}}
			>
				<TabsList aria-label={tr("Settings sections")} className="h-auto flex-wrap">
					<TabsTrigger value="environments">{tr("Environments")}</TabsTrigger>
					<TabsTrigger value="localization">{tr("Localization")}</TabsTrigger>
					<TabsTrigger value="sdk">{tr("SDK")}</TabsTrigger>
				</TabsList>
				<TabsContent value="environments" className="pt-4">
					{projectRef ? (
						<EnvironmentsContent key={projectRef} projectRef={projectRef} />
					) : (
						<FlowsEmptyState icon={FolderKanban} title={t("selectProject")} />
					)}
				</TabsContent>
				<TabsContent value="localization" className="pt-4">
					{projectRef ? (
						<LocalizationContent key={projectRef} projectRef={projectRef} />
					) : (
						<FlowsEmptyState icon={FolderKanban} title={t("selectProject")} />
					)}
				</TabsContent>
				<TabsContent value="sdk" className="pt-4">
					{projectRef ? (
						<SdkContent key={projectRef} projectRef={projectRef} />
					) : (
						<FlowsEmptyState icon={FolderKanban} title={t("selectProject")} />
					)}
				</TabsContent>
			</Tabs>
			<PluginDiagnosticsLink locale={locale} />
		</section>
	);
}

export function EnvironmentsSettingsPage() {
	return <AcquisitionSettingsPage defaultTab="environments" />;
}

export function LocalizationSettingsPage() {
	return <AcquisitionSettingsPage defaultTab="localization" />;
}

export function SdkSettingsPage() {
	return <AcquisitionSettingsPage defaultTab="sdk" />;
}

function SdkCodePanel({ title, install, code }: { title: string; install: string; code: string }) {
	const { t, tr } = useFlowI18n();
	return (
		<SettingsSection
			title={title}
			description={tr("Install and initialize with your authenticated application user.")}
		>
			<SettingsRow>
				<p className="text-sm font-medium">{t("install")}</p>
				<CopyField value={install} />
			</SettingsRow>
			<SettingsRow>
				<p className="text-sm font-medium">{tr("Initialize")}</p>
				<div className="relative">
					<pre className="overflow-x-auto rounded-md border border-kumo-line bg-kumo-tint p-4 pe-12 font-mono text-xs leading-5">
						<code>{code}</code>
					</pre>
					<CopyButton value={code} className="absolute top-2 end-2" />
				</div>
			</SettingsRow>
		</SettingsSection>
	);
}
function CopyField({ value }: { value: string }) {
	return (
		<div className="flex items-center gap-2 rounded-md border border-kumo-line bg-kumo-base p-2 ps-3">
			<code className="min-w-0 flex-1 break-all text-xs">{value || "—"}</code>
			{value && <CopyButton value={value} />}
		</div>
	);
}
function CopyButton({ value, className }: { value: string; className?: string }) {
	const { t } = useFlowI18n();
	const [copied, setCopied] = useState(false);
	return (
		<Button
			variant="ghost"
			size="icon"
			className={className}
			title={copied ? t("copied") : t("copyCode")}
			onClick={() => {
				void navigator.clipboard
					.writeText(value)
					.then(() => {
						setCopied(true);
						window.setTimeout(() => {
							setCopied(false);
						}, 1600);
					})
					.catch((cause: unknown) => {
						showErrorNotification(message(cause, t("apiFailure")));
					});
			}}
		>
			{copied ? <Check /> : <Copy />}
			<span className="sr-only">{t("copyCode")}</span>
		</Button>
	);
}
function message(cause: unknown, fallback: string) {
	return cause instanceof Error ? cause.message : fallback;
}
function identifier(value: string) {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}
function csv(value: string) {
	return [
		...new Set(
			value
				.split(",")
				.map((item) => item.trim())
				.filter(Boolean),
		),
	];
}
function parseFallbacks(value: string) {
	return Object.fromEntries(
		value
			.split(",")
			.map((item) =>
				item
					.trim()
					.split(":")
					.map((part) => part.trim()),
			)
			.filter(
				(parts): parts is [string, string] =>
					parts.length === 2 && Boolean(parts[0]) && Boolean(parts[1]),
			),
	);
}
