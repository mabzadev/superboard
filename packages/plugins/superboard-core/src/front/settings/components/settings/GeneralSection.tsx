"use client";

import { useOptionalFrontContext } from "@superboard/front-ui/context";
import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { useQuery } from "@superboard/front-ui/query";
import { SettingsRow, SettingsSection } from "@superboard/front-ui/settings-form";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import type { ReactNode } from "react";

import { getSdkConfiguration, type SdkPlatform } from "../../api/app/appService.js";
import { useSettingsI18n } from "../../i18n.js";

const SDK_APPS_PATH = "/core/libraries";
const platforms: readonly SdkPlatform[] = ["web", "ios", "android"];

export default function GeneralSection() {
	const { t } = useSettingsI18n();
	const front = useOptionalFrontContext();
	const { selectedInstance, selectedProject, projectType } = useProjectSelection();
	const deployments = front?.environments?.length
		? front.environments
		: front?.deployment
			? [front.deployment]
			: [];

	return (
		<div className="flex max-w-3xl flex-col gap-8 py-4">
			<SettingsSection title={t("general.title")} description={t("general.description")}>
				{selectedInstance ? (
					<>
						<Detail label={t("general.name")}>
							<span className="font-medium">{selectedInstance.name}</span>
						</Detail>
						<Detail label={t("general.instance")}>
							<code className="break-all">{selectedInstance.id}</code>
						</Detail>
					</>
				) : (
					<SettingsRow>
						<p className="text-sm text-kumo-subtle">{t("general.unavailable")}</p>
					</SettingsRow>
				)}
			</SettingsSection>

			<SettingsSection
				title={t("general.environments")}
				description={t("general.environmentsDescription")}
			>
				{selectedInstance
					? (["production", "test"] as const).map((environment) => (
							<SettingsRow key={environment}>
								<LabelledState
									label={t(`general.${environment}`)}
									state={
										projectType === environment ? (
											<Badge variant="success">{t("general.active")}</Badge>
										) : null
									}
								>
									<span className="text-sm font-medium">
										{selectedInstance[environment]?.name ?? "—"}
									</span>
								</LabelledState>
							</SettingsRow>
						))
					: null}
				{deployments.map((deployment) => (
					<SettingsRow key={deployment.id}>
						<LabelledState
							label={t("general.deployment")}
							state={
								deployment.id === front?.deployment?.id ? (
									<Badge variant="success">{t("general.active")}</Badge>
								) : null
							}
						>
							<span className="text-sm font-medium">
								{deployment.label} · {deployment.environment}
							</span>
						</LabelledState>
						<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
							<a className="text-kumo-brand underline" href={deployment.consoleUrl}>
								{t("general.console")}
							</a>
							<span className="text-kumo-subtle">
								{t("general.api")} <code className="break-all text-xs">{deployment.apiUrl}</code>
							</span>
						</div>
					</SettingsRow>
				))}
				{!selectedInstance && deployments.length === 0 ? (
					<SettingsRow>
						<p className="text-sm text-kumo-subtle">{t("general.noEnvironment")}</p>
					</SettingsRow>
				) : null}
			</SettingsSection>

			<SettingsSection
				title={t("general.maintenance")}
				description={t("general.maintenanceDescription")}
			>
				{platforms.map((platform) => (
					<MaintenanceRow key={platform} platform={platform} projectRef={selectedProject?.id} />
				))}
			</SettingsSection>
		</div>
	);
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
	return (
		<SettingsRow className="space-y-1">
			<p className="text-xs text-kumo-subtle">{label}</p>
			<div className="text-sm">{children}</div>
		</SettingsRow>
	);
}

function LabelledState({
	label,
	state,
	children,
}: {
	label: string;
	state: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="flex items-center justify-between gap-4">
			<div className="min-w-0 space-y-1">
				<p className="text-xs text-kumo-subtle">{label}</p>
				{children}
			</div>
			{state}
		</div>
	);
}

function MaintenanceRow({
	platform,
	projectRef,
}: {
	platform: SdkPlatform;
	projectRef: string | undefined;
}) {
	const { t } = useSettingsI18n();
	const query = useQuery({
		queryKey: ["sdk-configuration", projectRef, platform],
		queryFn: () => getSdkConfiguration(projectRef ?? "", platform),
		enabled: Boolean(projectRef),
	});
	const label = t(`sdk.${platform}`);
	const state = query.isError ? (
		<Badge variant="default">{t("general.statusUnavailable")}</Badge>
	) : query.isSuccess ? (
		!query.data ? (
			<Badge variant="outline">{t("general.notConfigured")}</Badge>
		) : query.data.configuration.maintenance_enabled === true ? (
			<Badge variant="warning">{t("general.maintenanceOn")}</Badge>
		) : (
			<Badge variant="default">{t("general.maintenanceOff")}</Badge>
		)
	) : null;
	return (
		<SettingsRow>
			<div className="flex items-center justify-between gap-4">
				<span className="text-sm font-medium">{label}</span>
				<div className="flex shrink-0 items-center gap-3">
					{state}
					<a
						className="text-sm text-kumo-brand underline"
						href={`${SDK_APPS_PATH}?tab=${platform}`}
						aria-label={t("general.configure", { platform: label })}
					>
						{t("general.configureShort")}
					</a>
				</div>
			</div>
		</SettingsRow>
	);
}
