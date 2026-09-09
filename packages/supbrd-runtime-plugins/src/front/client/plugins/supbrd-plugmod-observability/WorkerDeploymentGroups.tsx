import { setupI18n } from "@lingui/core";
import { useFrontContext } from "@superboard/front-ui/context";
import type { ReactNode } from "react";

const groups = [
	["console", ["site"]],
	["api", ["api", "app", "products", "paywalls", "onboardings", "dynamic-links", "mcp"]],
	["auth", ["identity"]],
	["files", ["files"]],
	["payments", ["billing"]],
	["communication", ["email", "marketing", "push"]],
	["automations", ["flows"]],
	["support", ["support"]],
	["analytics", ["analytics"]],
	["monitoring", ["observability"]],
] as const;
const messages = {
	en: {
		vocostar: "Vocostar",
		console: "Console",
		api: "API",
		auth: "Authentication",
		files: "Files",
		payments: "Payments",
		communication: "Communication",
		automations: "Automations",
		support: "Customer service",
		analytics: "Statistics",
		monitoring: "Monitoring",
		extensions: "Application plugins",
		workers: "Deployments",
		modules: "Modules",
	},
	fr: {
		vocostar: "Vocostar",
		console: "Console",
		api: "API",
		auth: "Authentification",
		files: "Fichiers",
		payments: "Paiements",
		communication: "Communication",
		automations: "Automatisations",
		support: "Service client",
		analytics: "Statistiques",
		monitoring: "Supervision",
		extensions: "Plugins applicatifs",
		workers: "Déploiements",
		modules: "Modules",
	},
};

export function WorkerDeploymentGroups<T extends { id: string; workerName?: string | null }>({
	services,
	children,
}: {
	services: readonly T[];
	children(service: T): ReactNode;
}) {
	const { locale, activePluginIds } = useFrontContext();
	const i18n = setupI18n({ locale, messages: { [locale]: messages[locale] } });
	const grouped = new Map<string, T[]>();
	for (const service of services) {
		const id =
			groups.find(([, members]) => members.some((member) => member === service.id))?.[0] ??
			(service.id.startsWith("custom") ? "extensions" : service.id);
		const entries = grouped.get(id) ?? [];
		entries.push(service);
		grouped.set(id, entries);
	}
	return (
		<div className="grid gap-3">
			{Array.from(grouped, ([id, services]) => (
				<details key={id} className="rounded-md border border-kumo-line p-4">
					<summary className="cursor-pointer">
						<strong>
							{id === "extensions" && activePluginIds.includes("supbrd-plugmod-vocostar")
								? i18n._("vocostar")
								: i18n._(id)}
						</strong>
						<span className="ms-3 text-sm text-kumo-subtle">
							{i18n._("workers")}:{" "}
							{new Set(services.flatMap(({ workerName }) => (workerName ? [workerName] : []))).size}{" "}
							· {i18n._("modules")}: {services.length}
						</span>
					</summary>
					<div className="mt-4 grid gap-3 lg:grid-cols-2">
						{services.map((service) => children(service))}
					</div>
				</details>
			))}
		</div>
	);
}
