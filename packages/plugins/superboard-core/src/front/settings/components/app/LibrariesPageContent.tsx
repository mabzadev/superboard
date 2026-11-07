"use client";

import { showSuccessNotification } from "@superboard/front-ui/lib/Notifications.js";
import { SettingsActions, SettingsRow, SettingsSection } from "@superboard/front-ui/settings-form";
import { Alert, AlertDescription, AlertTitle } from "@superboard/front-ui/ui/alert.js";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import {
	CheckCircle2,
	Copy,
	ExternalLink,
	GitBranch,
	PackageOpen,
	RefreshCw,
	TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import {
	getPlatformLibraries,
	type PlatformLibraryCatalog,
} from "../../api/platform/platformService.js";
import { useSdkI18n, type SdkMessage } from "../../sdk-i18n.js";

type Library = PlatformLibraryCatalog["libraries"][number];
type BadgeVariant = "default" | "destructive" | "outline" | "secondary";

export default function LibrariesPageContent() {
	const { t } = useSdkI18n();
	const [catalog, setCatalog] = useState<PlatformLibraryCatalog | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			setCatalog(await getPlatformLibraries());
			setError(null);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : t("libraries.loadError"));
		} finally {
			setLoading(false);
		}
	}, [t]);

	useEffect(() => {
		void load();
	}, [load]);

	const copy = async (value: string, message: SdkMessage) => {
		await navigator.clipboard.writeText(value);
		showSuccessNotification(t(message));
	};

	return (
		<div className="flex w-full flex-col gap-8">
			{error && (
				<Alert variant="destructive">
					<AlertTitle>{t("libraries.unavailable")}</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}

			{catalog && (
				<>
					<SettingsSection title={t("libraries.title")} description={t("libraries.description")}>
						<SettingsRow>
							<Alert>
								<GitBranch />
								<AlertTitle>{t("git.title")}</AlertTitle>
								<AlertDescription>{t("git.description")}</AlertDescription>
							</Alert>
						</SettingsRow>
						{catalog.libraries.map((library) => (
							<LibraryRow key={library.id} library={library} catalog={catalog} copy={copy} />
						))}
					</SettingsSection>

					<FlutterFlowLibrarySection catalog={catalog} />

					<SettingsSection title={t("custom.title")} description={t("custom.description")}>
						<SettingsRow>
							<p className="text-sm text-kumo-subtle">
								{t("custom.counts", {
									widgets: catalog.customCode.widgets.length,
									actions: surfaceCount(catalog.customCode.actions),
									streams: surfaceCount(catalog.customCode.streams),
									files: surfaceCount(catalog.customCode.sourceFiles),
								})}
							</p>
						</SettingsRow>
						<SettingsRow>
							<h3 className="text-sm font-semibold">{t("custom.widgets")}</h3>
							<div className="flex flex-wrap gap-2">
								{catalog.customCode.widgets.map((name) => (
									<Badge key={name} variant="secondary">
										{name}
									</Badge>
								))}
							</div>
						</SettingsRow>
						<SettingsRow>
							<h3 className="text-sm font-semibold">{t("custom.actions")}</h3>
							{Object.entries(catalog.customCode.actions).map(([group, actions]) => (
								<SurfaceGroup key={group} group={group} values={actions} />
							))}
						</SettingsRow>
						<SettingsRow>
							<h3 className="text-sm font-semibold">{t("custom.streams")}</h3>
							{Object.entries(catalog.customCode.streams).map(([group, streams]) => (
								<SurfaceGroup key={group} group={group} values={streams} />
							))}
						</SettingsRow>
					</SettingsSection>

					<AdvancedSection catalog={catalog} />
				</>
			)}

			<SettingsActions>
				<Button variant="outline" onClick={() => void load()} disabled={loading}>
					<RefreshCw className={loading ? "animate-spin" : ""} />
					{t("libraries.refresh")}
				</Button>
			</SettingsActions>
		</div>
	);
}

function libraryStatus(library: Library): { label: SdkMessage; variant: BadgeVariant } {
	if (library.releaseStatus === "unreleased")
		return { label: "status.unreleased", variant: "outline" };
	if (library.lifecycle === "archived") return { label: "status.archived", variant: "secondary" };
	if (library.lifecycle === "internal") return { label: "status.internal", variant: "outline" };
	if (library.releaseStatus === "pending-release")
		return { label: "status.pending", variant: "destructive" };
	return { label: "status.released", variant: "default" };
}

function LibraryRow({
	library,
	catalog,
	copy,
}: {
	library: Library;
	catalog: PlatformLibraryCatalog;
	copy: (value: string, message: SdkMessage) => Promise<void>;
}) {
	const { t, rich } = useSdkI18n();
	const pending = library.releaseStatus === "pending-release";
	const unreleased = library.releaseStatus === "unreleased";
	const releaseRef = library.releaseRef;
	const install = library.install;
	const status = libraryStatus(library);
	const branch = encodeURIComponent(catalog.developmentBranch);
	return (
		<SettingsRow data-testid={`library-${library.id}`} className="space-y-4">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<h3 className="flex items-center gap-2 font-semibold">
						<PackageOpen className="size-5" />
						{library.displayName}
					</h3>
					<p className="text-sm text-kumo-subtle">
						{library.packageName} · {library.ecosystem}
					</p>
				</div>
				<Badge variant={status.variant}>{t(status.label)}</Badge>
			</div>
			<dl className="space-y-2 text-sm">
				<Version
					label={t("version.source")}
					value={library.sourceVersion}
					icon={
						pending || unreleased ? (
							<TriangleAlert className="size-4 text-kumo-warning" />
						) : (
							<CheckCircle2 className="size-4 text-kumo-success" />
						)
					}
				/>
				{library.latestReleaseVersion && (
					<Version
						label={t("version.latest")}
						value={library.latestReleaseVersion}
						icon={<CheckCircle2 className="size-4 text-kumo-success" />}
					/>
				)}
				<Version
					label={t("version.lifecycle")}
					value={library.lifecycle}
					icon={
						library.lifecycle === "active" ? (
							<CheckCircle2 className="size-4 text-kumo-success" />
						) : (
							<TriangleAlert className="size-4 text-kumo-warning" />
						)
					}
				/>
			</dl>
			{library.candidatePackageName && library.candidateInstall && (
				<div className="space-y-2 rounded-md border border-kumo-line bg-kumo-info-tint p-3 text-xs">
					<div className="flex flex-wrap gap-2">
						<Badge variant="outline">{t("candidate.badge")}</Badge>
						<code>{library.candidatePackageName}</code>
					</div>
					<p className="text-kumo-subtle">
						{t("candidate.note", { version: library.sourceVersion })}
					</p>
				</div>
			)}
			{library.notes && (
				<p className="rounded-md border border-kumo-line bg-kumo-warning-tint p-3 text-xs text-kumo-subtle">
					{library.notes}
				</p>
			)}
			{library.distribution && (
				<div className="space-y-2 rounded-md border border-kumo-line bg-kumo-warning-tint p-3 text-xs">
					<div className="flex flex-wrap gap-2">
						<Badge variant="secondary">{t("distribution.public")}</Badge>
						<Badge variant="outline">{t("distribution.authentication")}</Badge>
						<Badge variant="outline">{t("distribution.anonymous")}</Badge>
					</div>
					<p className="text-kumo-subtle">
						{rich("distribution.note", {
							variables: library.distribution.authentication.usernameEnvironmentVariable ? (
								rich("distribution.variables", {
									token: (
										<code>{library.distribution.authentication.tokenEnvironmentVariable}</code>
									),
									username: (
										<code>{library.distribution.authentication.usernameEnvironmentVariable}</code>
									),
								})
							) : (
								<code>{library.distribution.authentication.tokenEnvironmentVariable}</code>
							),
						})}
					</p>
					<p className="break-all font-mono text-kumo-subtle">{library.distribution.registry}</p>
				</div>
			)}
			{library.sourcePublication !== "local" && (
				<div className="flex flex-wrap gap-3 text-sm">
					<ExternalAnchor
						href={`${catalog.repository}/tree/${branch}/${library.sourcePath}`}
						label={t("source.open", { branch: catalog.developmentBranch })}
					/>
					<ExternalAnchor
						href={`${catalog.repository}/blob/${branch}/${library.versionSource}`}
						label={t("source.version")}
					/>
					<ExternalAnchor
						href={`${catalog.repository}/blob/${branch}/${library.licensePath}`}
						label={t("source.license", { license: library.license })}
					/>
				</div>
			)}
			{releaseRef && (
				<div>
					<p className="mb-1 text-xs font-medium text-kumo-subtle">{t("ref.label")}</p>
					<div className="flex items-center gap-2">
						<code className="min-w-0 flex-1 truncate rounded bg-kumo-recessed px-2 py-1 text-xs">
							{releaseRef}
						</code>
						<Button
							size="icon"
							variant="outline"
							aria-label={t("ref.copy", { name: library.displayName })}
							onClick={() => void copy(releaseRef, "ref.copied")}
						>
							<Copy className="size-4" />
						</Button>
					</div>
				</div>
			)}
			{install && (
				<details>
					<summary className="cursor-pointer text-sm font-medium">
						{t(
							library.lifecycle !== "active"
								? "install.historical"
								: library.distribution
									? "install.authenticated"
									: "install.default",
						)}
					</summary>
					{library.distribution && (
						<p className="mt-2 text-xs text-kumo-subtle">{t("install.warning")}</p>
					)}
					<div className="mt-2 flex items-start gap-2">
						<pre className="min-w-0 flex-1 overflow-auto rounded bg-kumo-recessed p-3 text-xs">
							{install}
						</pre>
						<Button
							size="icon"
							variant="outline"
							aria-label={t("install.copy", { name: library.displayName })}
							onClick={() =>
								void copy(
									install,
									library.distribution ? "install.dependencyCopied" : "install.copied",
								)
							}
						>
							<Copy className="size-4" />
						</Button>
					</div>
				</details>
			)}
		</SettingsRow>
	);
}

function flutterFlowDependencies(catalog: PlatformLibraryCatalog) {
	return catalog.flutterFlowLibrary.dependencies.map((dependency) => {
		const published = catalog.libraries.find(({ id }) => id === dependency.catalogId);
		return {
			...dependency,
			ready:
				published?.releaseStatus === "released" &&
				published.latestReleaseVersion === dependency.sourceVersion &&
				published.releaseRef === dependency.requiredRef,
		};
	});
}

function FlutterFlowLibrarySection({ catalog }: { catalog: PlatformLibraryCatalog }) {
	const { t } = useSdkI18n();
	const library = catalog.flutterFlowLibrary;
	const dependencies = flutterFlowDependencies(catalog);
	const pending = dependencies.filter(({ ready }) => !ready).length;

	return (
		<SettingsSection
			title={t("flutterflow.title", { name: library.displayName })}
			description={t("flutterflow.description")}
		>
			<SettingsRow className="flex items-center justify-between gap-4 space-y-0">
				<span className="text-sm font-medium">{t("flutterflow.status")}</span>
				<Badge variant={pending === 0 ? "default" : "destructive"}>
					{pending === 0
						? t("flutterflow.ready")
						: t(pending === 1 ? "flutterflow.pendingOne" : "flutterflow.pendingOther", {
								count: pending,
							})}
				</Badge>
			</SettingsRow>
			<SettingsRow>
				<dl className="space-y-2 text-sm">
					<Version
						label={t("flutterflow.values")}
						value={String(library.libraryValues.length)}
						icon={<CheckCircle2 className="size-4 text-kumo-success" />}
					/>
					<Version
						label={t("flutterflow.actions")}
						value={String(surfaceCount(library.actions))}
						icon={<CheckCircle2 className="size-4 text-kumo-success" />}
					/>
					<Version
						label={t("flutterflow.tokenState")}
						value={t("flutterflow.forbidden")}
						icon={<CheckCircle2 className="size-4 text-kumo-success" />}
					/>
				</dl>
			</SettingsRow>
			<SettingsRow>
				<h3 className="text-sm font-semibold">{t("flutterflow.releases")}</h3>
				{dependencies.map((dependency) => (
					<div
						className="flex items-start justify-between gap-3 rounded-md border border-kumo-line p-3"
						key={dependency.catalogId}
					>
						<div className="min-w-0">
							<p className="font-mono text-sm">{dependency.packageName}</p>
							<p className="truncate font-mono text-xs text-kumo-subtle">
								{dependency.requiredRef}
							</p>
						</div>
						<Badge variant={dependency.ready ? "default" : "outline"}>
							{t(dependency.ready ? "flutterflow.published" : "flutterflow.pending")}
						</Badge>
					</div>
				))}
			</SettingsRow>
		</SettingsSection>
	);
}

function AdvancedSection({ catalog }: { catalog: PlatformLibraryCatalog }) {
	const { t } = useSdkI18n();
	const library = catalog.flutterFlowLibrary;
	const branch = encodeURIComponent(catalog.developmentBranch);
	return (
		<div className="border-t border-kumo-line pt-8">
			<SettingsSection title={t("advanced.title")} description={t("advanced.description")}>
				<SettingsRow>
					<h3 className="text-sm font-semibold">{t("flutterflow.remote")}</h3>
					<p className="text-xs text-kumo-subtle">
						{t("flutterflow.remoteDetails", {
							variable: library.remoteProject.projectIdVariable,
							secret: library.remoteProject.apiKeySecret,
							environment: library.remoteProject.githubEnvironment,
						})}
					</p>
					<div className="flex flex-wrap gap-4 text-sm">
						<ExternalAnchor
							href={`${catalog.repository}/blob/${branch}/${library.source.path}`}
							label={t("flutterflow.dsl")}
						/>
						<ExternalAnchor
							href={`${catalog.repository}/actions/workflows/${library.source.workflow.split("/").at(-1)}`}
							label={t("flutterflow.workflow")}
						/>
					</div>
				</SettingsRow>
				<SettingsRow>
					<h3 className="text-sm font-semibold">{t("custom.sourceFiles")}</h3>
					{Object.entries(catalog.customCode.sourceFiles).map(([group, paths]) => (
						<div key={group} className="rounded-md border border-kumo-line p-4">
							<h4 className="mb-2 text-sm font-semibold capitalize">{groupName(group)}</h4>
							<ul className="space-y-1 text-xs">
								{paths.map((path) => (
									<li key={path}>
										<a
											className="inline-flex items-center gap-1 font-mono text-primary"
											href={`${catalog.repository}/blob/${branch}/${path}`}
											target="_blank"
											rel="noreferrer"
										>
											{path}
											<ExternalLink className="size-3 shrink-0" />
										</a>
									</li>
								))}
							</ul>
						</div>
					))}
				</SettingsRow>
				<SettingsRow>
					<h3 className="text-sm font-semibold">{t("custom.adapters")}</h3>
					<p className="text-xs text-kumo-subtle">{t("custom.adaptersNote")}</p>
					{Object.entries(catalog.customCode.referenceAdapters).map(([group, adapters]) => (
						<SurfaceGroup key={group} group={group} values={adapters} />
					))}
				</SettingsRow>
				<SettingsRow>
					<ExternalAnchor
						href={`${catalog.repository}/actions/workflows/prepare-sdk-release.yml`}
						label={t("custom.releaseWorkflow")}
					/>
				</SettingsRow>
			</SettingsSection>
		</div>
	);
}

function ExternalAnchor({ href, label }: { href: string; label: string }) {
	return (
		<a
			className="inline-flex items-center gap-1 text-sm text-primary"
			href={href}
			target="_blank"
			rel="noreferrer"
		>
			{label}
			<ExternalLink className="size-3" />
		</a>
	);
}

function groupName(group: string) {
	return group.replace(/([A-Z])/g, " $1");
}

function SurfaceGroup({ group, values }: { group: string; values: string[] }) {
	const { t } = useSdkI18n();
	return (
		<div className="rounded-md border border-kumo-line p-4">
			<div className="mb-2 flex items-center gap-2">
				<h4 className="text-sm font-semibold capitalize">{groupName(group)}</h4>
				{group === "compatibilityAliases" && (
					<Badge variant="outline">{t("custom.compatibility")}</Badge>
				)}
			</div>
			<ul className="space-y-1 font-mono text-xs text-kumo-subtle">
				{values.map((name) => (
					<li key={name}>{name}</li>
				))}
			</ul>
		</div>
	);
}

function surfaceCount(groups: Record<string, string[]>) {
	return Object.values(groups).reduce((total, values) => total + values.length, 0);
}

function Version({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
	return (
		<div className="flex items-center justify-between gap-4">
			<dt className="text-kumo-subtle">{label}</dt>
			<dd className="flex items-center gap-2 font-mono font-semibold">
				{icon}
				{value}
			</dd>
		</div>
	);
}
