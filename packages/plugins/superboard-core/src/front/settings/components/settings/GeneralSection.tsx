"use client";

import { useOptionalFrontContext } from "@superboard/front-ui/context";
import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import {
	showGenericError,
	showSuccessNotification,
} from "@superboard/front-ui/lib/Notifications.js";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { Separator } from "@superboard/front-ui/ui/separator.js";
import type { ReactNode } from "react";

import { useDeleteInstanceMutation } from "../../hooks/mutations/useInstanceMutations.js";
import { useInstancesQuery } from "../../hooks/queries/useInstanceQueries.js";
import { useSettingsI18n } from "../../i18n.js";
import AdminOnlyDisplay from "../../lib/adminOnlyDisplay.js";
import DangerZoneSection from "./DangerZoneSection.js";

const SDK_APPS_PATH = "/core/libraries";

/** Environment settings › General: project identity, environments and danger zone. */
export default function GeneralSection() {
	const { t } = useSettingsI18n();
	const front = useOptionalFrontContext();
	const { selectedInstance, setSelectedInstance, projectType } = useProjectSelection();
	const instancesQuery = useInstancesQuery();
	const deleteInstanceMutation = useDeleteInstanceMutation();
	const deployments = front?.environments?.length
		? front.environments
		: front?.deployment
			? [front.deployment]
			: [];

	const handleDeleteInstance = async () => {
		if (!selectedInstance) return;
		try {
			await deleteInstanceMutation.mutateAsync(selectedInstance.id);
			showSuccessNotification(t("danger.deleted"));
			// Instances query auto-invalidated by mutation; pick the last one after refetch
			const result = await instancesQuery.refetch();
			const lastInstance = result.data?.at(-1);
			if (lastInstance) setSelectedInstance(lastInstance);
		} catch {
			showGenericError();
		}
	};

	return (
		<div className="flex max-w-[800px] flex-col gap-8 py-4">
			<SettingsBlock title={t("general.title")} description={t("general.description")}>
				{selectedInstance ? (
					<dl className="grid gap-3 text-sm sm:grid-cols-[180px_1fr]">
						<dt className="text-muted-foreground">{t("general.name")}</dt>
						<dd className="font-medium">{selectedInstance.name}</dd>
						<dt className="text-muted-foreground">{t("general.instance")}</dt>
						<dd>
							<code>{selectedInstance.id}</code>
						</dd>
					</dl>
				) : (
					<p className="text-sm text-muted-foreground">{t("general.unavailable")}</p>
				)}
			</SettingsBlock>

			<SettingsBlock
				title={t("general.environments")}
				description={t("general.environmentsDescription")}
			>
				<ul className="divide-y rounded-xl border">
					{selectedInstance
						? (["production", "test"] as const).map((environment) => (
								<li key={environment} className="flex items-center gap-3 px-4 py-3 text-sm">
									<span className="w-28 shrink-0 text-muted-foreground">
										{t(`general.${environment}`)}
									</span>
									<span className="flex-1 font-medium">
										{selectedInstance[environment]?.name ?? "—"}
									</span>
									{projectType === environment ? (
										<Badge variant="secondary">{t("general.active")}</Badge>
									) : null}
								</li>
							))
						: null}
					{deployments.map((deployment) => (
						<li key={deployment.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
							<span className="w-28 shrink-0 text-muted-foreground">{t("general.deployment")}</span>
							<span className="flex-1 font-medium">
								{deployment.label} · {deployment.environment}
							</span>
							<a className="underline" href={deployment.consoleUrl}>
								{t("general.console")}
							</a>
							<code className="text-xs">{deployment.apiUrl}</code>
							{deployment.id === front?.deployment?.id ? (
								<Badge variant="secondary">{t("general.active")}</Badge>
							) : null}
						</li>
					))}
				</ul>
			</SettingsBlock>

			<SettingsBlock
				title={t("general.maintenance")}
				description={t("general.maintenanceDescription")}
			>
				<div className="flex flex-wrap gap-3 text-sm">
					{(["web", "ios", "android"] as const).map((platform) => (
						<a key={platform} className="underline" href={`${SDK_APPS_PATH}?tab=${platform}`}>
							{t(`sdk.${platform}`)}
						</a>
					))}
				</div>
			</SettingsBlock>

			<AdminOnlyDisplay>
				<Separator />
				<DangerZoneSection handleRemoveProject={() => void handleDeleteInstance()} />
			</AdminOnlyDisplay>
		</div>
	);
}

function SettingsBlock({
	title,
	description,
	children,
}: {
	title: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-4">
			<div className="flex flex-col gap-0.5">
				<h2 className="text-sm font-semibold">{title}</h2>
				<span className="text-xs text-muted-foreground">{description}</span>
			</div>
			{children}
		</section>
	);
}
