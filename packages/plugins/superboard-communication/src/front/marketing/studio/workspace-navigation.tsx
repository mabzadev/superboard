import { Button } from "@superboard/front-ui/kumo";
import { useRouter, useSearchParams } from "@superboard/front-ui/navigation";

import { useStudioI18n } from "./i18n.js";
import { canLeave } from "./ItemNavigation.js";

export const workspaceSections = {
	emails: { label: "Emails", tabs: ["emails"] },
	automations: { label: "Automations", tabs: ["automations"] },
	"in-app": { label: "In-app & Push", tabs: ["in-app"] },
	audience: {
		label: "Audience",
		tabs: ["contacts", "lists", "segments", "fields", "forms", "suppressions"],
	},
	activity: { label: "Activity", tabs: ["messages", "statistics", "operations"] },
	settings: { label: "Settings", tabs: ["senders", "preferences"] },
} as const;

export type WorkspaceSection = keyof typeof workspaceSections;

// Section names and the former Settings tabs keep their bookmarked destinations.
const aliases: Record<string, string> = {
	audience: "contacts",
	activity: "messages",
	settings: "senders",
	delivery: "senders",
	email: "senders",
	channels: "senders",
	languages: "preferences",
	webhooks: "preferences",
	"email-webhooks": "preferences",
	// Plugin health and lifecycle moved to the Plugins page.
	configuration: "senders",
};

function isWorkspaceSection(value: string): value is WorkspaceSection {
	return value in workspaceSections;
}

export function resolveWorkspaceTab(requested: string | null, fallback: string) {
	for (const candidate of [requested, fallback]) {
		if (!candidate) continue;
		const tab = aliases[candidate] ?? candidate;
		for (const [section, value] of Object.entries(workspaceSections))
			if (isWorkspaceSection(section) && (value.tabs as readonly string[]).includes(tab))
				return { section, tab };
	}
	return { section: "emails" as WorkspaceSection, tab: "emails" };
}

/** Reads and changes the workspace tab kept in `?tab=` on the current route. */
export function useWorkspaceTab(fallback = "emails") {
	const params = useSearchParams();
	const router = useRouter();
	const current = resolveWorkspaceTab(params.get("tab"), fallback);
	const open = async (tab: string, extra: Record<string, string> = {}) => {
		if (!(await canLeave())) return;
		const url = new URL(window.location.href);
		url.searchParams.set("tab", tab);
		url.searchParams.delete("item");
		url.searchParams.delete("section");
		if (resolveWorkspaceTab(tab, fallback).section !== current.section)
			url.searchParams.delete("kind");
		for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
		router.push(url.pathname + url.search);
	};
	return { ...current, open };
}

export function WorkspaceNavigation({ fallback }: { fallback: string }) {
	const { t } = useStudioI18n();
	const { section, open } = useWorkspaceTab(fallback);
	return (
		<nav
			aria-label={t("Communication sections")}
			className="flex flex-wrap gap-1 border-b border-kumo-line pb-3"
		>
			{Object.entries(workspaceSections).map(([value, item]) => (
				<Button
					key={value}
					size="sm"
					variant={section === value ? "secondary" : "ghost"}
					aria-current={section === value ? "page" : undefined}
					onClick={() => void open(item.tabs[0])}
				>
					{t(item.label)}
				</Button>
			))}
		</nav>
	);
}
