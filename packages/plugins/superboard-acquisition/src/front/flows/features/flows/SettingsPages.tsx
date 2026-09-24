"use client";

import { config, usePublicConfig } from "@superboard/front-ui/lib/config.js";
import {
	showErrorNotification,
	showSuccessNotification,
} from "@superboard/front-ui/lib/Notifications.js";
import { PluginConfigurationTab } from "@superboard/front-ui/plugin-configuration-tab";
import { Button } from "@superboard/front-ui/ui/button.js";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@superboard/front-ui/ui/card.js";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@superboard/front-ui/ui/dialog.js";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@superboard/front-ui/ui/tabs.js";
import { Check, Code2, Copy, FolderKanban, KeyRound, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { LinkDefaults } from "../../../LinkDefaults.js";
import {
	flowsApi,
	type FlowEnvironment,
	type FlowLanguageGroup,
} from "../../api/flows/flowsService.js";
import { useFlows } from "./FlowsContext.js";
import { FlowsEmptyState } from "./FlowsPage.js";
import { useFlowI18n } from "./i18n.js";

export function EnvironmentsContent({ projectRef }: { projectRef: string }) {
	const { t, tr } = useFlowI18n();
	const [items, setItems] = useState<FlowEnvironment[]>([]);
	const [open, setOpen] = useState(false);
	const [revealedKey, setRevealedKey] = useState<string | null>(null);
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
	const rotate = async (id: string) => {
		if (!projectRef) return;
		try {
			const result = await flowsApi.rotateEnvironmentKey(projectRef, id);
			setRevealedKey(result.sdk_key);
			showSuccessNotification(tr("SDK key rotated"));
		} catch (cause) {
			showErrorNotification(message(cause, t("apiFailure")));
		}
	};
	return (
		<div className="space-y-4">
			<div className="flex justify-end">
				<Dialog open={open} onOpenChange={setOpen}>
					<DialogTrigger asChild>
						<Button size="sm">
							<Plus /> {tr("New environment")}
						</Button>
					</DialogTrigger>
					<CreateEnvironmentDialog
						onCreated={() => {
							setOpen(false);
							void load().catch((cause: unknown) => {
								showErrorNotification(message(cause, t("apiFailure")));
							});
						}}
					/>
				</Dialog>
			</div>
			{revealedKey && (
				<Card className="border-amber-500/30 bg-amber-500/5">
					<CardHeader>
						<CardTitle className="text-sm">{tr("New SDK key")}</CardTitle>
						<CardDescription>{t("revealOnce")}</CardDescription>
					</CardHeader>
					<CardContent>
						<CopyField value={revealedKey} />
					</CardContent>
				</Card>
			)}
			<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
				{items.map((environment) => (
					<Card key={environment.id}>
						<CardHeader>
							<div className="flex items-center justify-between gap-3">
								<CardTitle>{environment.name}</CardTitle>
								<span className="rounded-full border bg-muted px-2 py-0.5 text-xs capitalize">
									{tr(
										environment.kind === "development"
											? "Development"
											: environment.kind === "production"
												? "Production"
												: "Test",
									)}
								</span>
							</div>
							<CardDescription className="font-mono">{environment.key}</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-3">
							<p className="text-sm text-muted-foreground">
								{environment.allow_draft
									? tr("Draft releases allowed")
									: tr("Published versions only")}
							</p>
							<div className="flex items-center gap-2 rounded bg-muted px-3 py-2 font-mono text-xs">
								<KeyRound className="size-4" />
								<span className="flex-1">••••••••••••</span>
							</div>
							<Button variant="outline" size="sm" onClick={() => void rotate(environment.id)}>
								<RefreshCw /> {t("rotateKey")}
							</Button>
						</CardContent>
					</Card>
				))}
			</div>
		</div>
	);
}

function CreateEnvironmentDialog({ onCreated }: { onCreated: () => void }) {
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
			showSuccessNotification(
				`${tr("New environment created")}. ${tr("New SDK key")}: ${result.sdk_key ?? "generated"}`,
			);
			onCreated();
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
			<div className="grid gap-4">
				<label className="grid gap-2">
					<Label>{t("name")}</Label>
					<Input
						value={name}
						onChange={(event) => {
							setName(event.target.value);
							if (!key) setKey(identifier(event.target.value));
						}}
					/>
				</label>
				<label className="grid gap-2">
					<Label>{t("identifier")}</Label>
					<Input
						className="font-mono"
						value={key}
						onChange={(event) => {
							setKey(identifier(event.target.value));
						}}
					/>
				</label>
				<label className="grid gap-2">
					<Label>{tr("Kind")}</Label>
					<Select value={kind} onValueChange={setKind}>
						<SelectTrigger className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="development">{tr("Development")}</SelectItem>
							<SelectItem value="test">{tr("Test")}</SelectItem>
							<SelectItem value="production">{tr("Production")}</SelectItem>
						</SelectContent>
					</Select>
				</label>
				<div className="flex items-center justify-between rounded border p-3">
					<Label>{tr("Allow draft releases")}</Label>
					<Switch
						aria-label={tr("Allow draft releases")}
						disabled={kind !== "development"}
						checked={kind === "development" && allowDraft}
						onCheckedChange={setAllowDraft}
					/>
				</div>
			</div>
			<DialogFooter>
				<Button disabled={!name || !key || busy} onClick={() => void create()}>
					{busy ? t("saving") : t("create")}
				</Button>
			</DialogFooter>
		</DialogContent>
	);
}

export function LocalizationContent({ projectRef }: { projectRef: string }) {
	const { t, tr } = useFlowI18n();
	const [groups, setGroups] = useState<FlowLanguageGroup[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [name, setName] = useState("");
	const [defaultLocale, setDefaultLocale] = useState("en");
	const [locales, setLocales] = useState("en, fr");
	const [fallbacks, setFallbacks] = useState("fr:en");
	const load = useCallback(
		(preferredId?: string) =>
			flowsApi
				.listLocalization(projectRef)
				.then((result) => {
					setGroups(result);
					const selected = result.find((item) => item.id === preferredId) ?? result[0];
					if (selected) {
						setSelectedId(selected.id);
						setName(selected.name);
						setDefaultLocale(selected.default_locale);
						setLocales(selected.locales.join(", "));
						setFallbacks(
							Object.entries(selected.fallbacks)
								.map(([from, to]) => `${from}:${to}`)
								.join(", "),
						);
					}
				})
				.catch((cause: unknown) => {
					showErrorNotification(message(cause, t("apiFailure")));
				}),
		[projectRef, t],
	);
	useEffect(() => {
		void load().catch((cause: unknown) => {
			showErrorNotification(message(cause, t("apiFailure")));
		});
	}, [load, t]);
	const save = async () => {
		try {
			const saved = await flowsApi.saveLocalization(projectRef, {
				id: selectedId ?? undefined,
				name,
				default_locale: defaultLocale,
				locales: csv(locales),
				fallbacks: parseFallbacks(fallbacks),
			});
			showSuccessNotification(tr("Localization saved"));
			await load(saved.id);
		} catch (cause) {
			showErrorNotification(message(cause, t("apiFailure")));
		}
	};
	return (
		<div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
			<Card className="self-start">
				<CardHeader>
					<CardTitle>{tr("Language groups")}</CardTitle>
				</CardHeader>
				<CardContent className="grid gap-1">
					{groups.map((group) => (
						<Button
							key={group.id}
							variant={selectedId === group.id ? "secondary" : "ghost"}
							className="justify-start"
							onClick={() => {
								setSelectedId(group.id);
								setName(group.name);
								setDefaultLocale(group.default_locale);
								setLocales(group.locales.join(", "));
								setFallbacks(
									Object.entries(group.fallbacks)
										.map(([from, to]) => `${from}:${to}`)
										.join(", "),
								);
							}}
						>
							{group.name}
						</Button>
					))}
					<Button
						variant="outline"
						className="mt-2"
						onClick={() => {
							setSelectedId(null);
							setName(tr("New group"));
							setDefaultLocale("en");
							setLocales("en, fr");
							setFallbacks("fr:en");
						}}
					>
						<Plus /> {tr("New group")}
					</Button>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle>{name || tr("Language group")}</CardTitle>
					<CardDescription>
						{tr(
							"Translated block fields show missing values and use these fallback rules at runtime.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="grid max-w-xl gap-4">
					<label className="grid gap-2">
						<Label>{t("name")}</Label>
						<Input
							value={name}
							onChange={(event) => {
								setName(event.target.value);
							}}
						/>
					</label>
					<label className="grid gap-2">
						<Label>{t("defaultLocale")}</Label>
						<Input
							value={defaultLocale}
							onChange={(event) => {
								setDefaultLocale(event.target.value);
							}}
						/>
					</label>
					<label className="grid gap-2">
						<Label>{t("locales")}</Label>
						<Input
							value={locales}
							onChange={(event) => {
								setLocales(event.target.value);
							}}
							placeholder={tr("en, fr, de")}
						/>
						<span className="text-xs text-muted-foreground">
							{tr("Comma-separated BCP 47 language codes.")}
						</span>
					</label>
					<label className="grid gap-2">
						<Label>{t("fallbacks")}</Label>
						<Input
							value={fallbacks}
							onChange={(event) => {
								setFallbacks(event.target.value);
							}}
							placeholder={tr("fr-CH:fr, fr:en")}
						/>
					</label>
					<Button
						className="w-fit"
						disabled={!name || !defaultLocale || csv(locales).length === 0}
						onClick={() => void save()}
					>
						{t("save")}
					</Button>
				</CardContent>
			</Card>
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
	const tabs = useMemo(
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
	return (
		<div className="space-y-4">
			<Card>
				<CardHeader>
					<CardTitle>{tr("Runtime selection")}</CardTitle>
					<CardDescription>
						{tr(
							"Use the current project identifier and a rotatable environment key. The API stays on SuperBoard.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-4 md:grid-cols-2">
					<label className="grid gap-2">
						<Label>{tr("Project identifier")}</Label>
						<CopyField value={projectRef} />
					</label>
					<label className="grid gap-2">
						<Label>{tr("Environment")}</Label>
						<Select value={environmentKey} onValueChange={setEnvironmentKey}>
							<SelectTrigger className="w-full">
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
					</label>
				</CardContent>
			</Card>
			<Tabs defaultValue="javascript">
				<TabsList className="flex h-auto flex-wrap">
					{tabs.map((tab) => (
						<TabsTrigger key={tab.id} value={tab.id}>
							{tab.label}
						</TabsTrigger>
					))}
				</TabsList>
				{tabs.map((tab) => (
					<TabsContent value={tab.id} key={tab.id}>
						{!environmentKey ? (
							<p role="alert">{tr("Select an available environment to view SDK examples.")}</p>
						) : publicConfig.apiUrl ? (
							<SdkCodePanel
								title={tab.label}
								install={tr(tab.install)}
								code={flowSdkSnippet(tab.id, projectRef, environmentKey, publicConfig.apiUrl)}
							/>
						) : (
							<p role="alert">{publicConfig.endpointError("API")}</p>
						)}
					</TabsContent>
				))}
			</Tabs>
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Code2 className="size-4" /> {tr("Debug and compatibility")}
					</CardTitle>
				</CardHeader>
				<CardContent className="grid gap-2 text-sm text-muted-foreground">
					<p>• {tr("Configure SPA navigation and language in the SDK initialization.")}</p>
					<p>
						• {tr("The debug overlay reconnects WebSockets and displays ordered block updates.")}
					</p>
					<p>
						•{" "}
						{tr(
							"Legacy @flows packages remain compatible through the canonical SDK key header supplied by customFetch.",
						)}
					</p>
					<p>
						•{" "}
						{tr(
							"Existing Paywall and Onboarding widgets remain deprecated adapters to Flows workflows.",
						)}
					</p>
					<p>
						•{" "}
						{tr("Purchases and restores always delegate to Products; Flows never invents revenue.")}
					</p>
				</CardContent>
			</Card>
		</div>
	);
}

export function AcquisitionSettingsPage({
	defaultTab = "environments",
}: {
	defaultTab?: "environments" | "sdk" | "localization" | "configuration";
} = {}) {
	const { t, tr, locale } = useFlowI18n();
	const { projectRef } = useFlows();
	const [tab, setTab] = useState(() => {
		const requested =
			typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab");
		return requested &&
			["environments", "sdk", "localization", "links", "configuration"].includes(requested)
			? requested
			: defaultTab;
	});
	useEffect(() => {
		if (
			/^\/(flows|acquisition)\/settings\/(environments|localization|sdk)$/.test(
				window.location.pathname,
			)
		) {
			const url = new URL(window.location.href);
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
						{tr(
							"Manage release environments, SDK integrations, localization rules and plugin configuration.",
						)}
					</p>
				</div>
			</header>

			<Tabs
				value={tab}
				onValueChange={(value) => {
					setTab(value);
					const url = new URL(window.location.href);
					url.searchParams.set("tab", value);
					window.history.replaceState(null, "", url);
				}}
			>
				<TabsList aria-label={tr("Settings sections")} className="h-auto flex-wrap">
					<TabsTrigger value="environments">{tr("Environments")}</TabsTrigger>
					<TabsTrigger value="sdk">{tr("SDK")}</TabsTrigger>
					<TabsTrigger value="localization">{tr("Localization")}</TabsTrigger>
					<TabsTrigger value="links">{tr("Link defaults")}</TabsTrigger>
					<TabsTrigger value="configuration">{tr("Configuration")}</TabsTrigger>
				</TabsList>
				<TabsContent value="environments">
					{projectRef ? (
						<EnvironmentsContent key={projectRef} projectRef={projectRef} />
					) : (
						<FlowsEmptyState icon={FolderKanban} title={t("selectProject")} />
					)}
				</TabsContent>
				<TabsContent value="sdk">
					{projectRef ? (
						<SdkContent key={projectRef} projectRef={projectRef} />
					) : (
						<FlowsEmptyState icon={FolderKanban} title={t("selectProject")} />
					)}
				</TabsContent>
				<TabsContent value="localization">
					{projectRef ? (
						<LocalizationContent key={projectRef} projectRef={projectRef} />
					) : (
						<FlowsEmptyState icon={FolderKanban} title={t("selectProject")} />
					)}
				</TabsContent>
				<TabsContent value="links">
					<LinkDefaults />
				</TabsContent>
				<TabsContent value="configuration">
					<PluginConfigurationTab locale={locale} />
				</TabsContent>
			</Tabs>
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
		<Card>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				<CardDescription>
					{tr("Install and initialize with your authenticated application user.")}
				</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-4">
				<div>
					<p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						{t("install")}
					</p>
					<CopyField value={install} />
				</div>
				<div>
					<p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						{tr("Initialize")}
					</p>
					<div className="relative">
						<pre className="overflow-x-auto rounded-[var(--radius)] border border-border bg-muted p-4 pe-12 text-xs leading-5 text-foreground font-mono">
							<code>{code}</code>
						</pre>
						<CopyButton value={code} className="absolute top-2 end-2" />
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
function CopyField({ value }: { value: string }) {
	return (
		<div className="flex items-center gap-2 rounded-[var(--radius-sm)] border bg-background p-2 ps-3">
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
