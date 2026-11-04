import { useRouter, useSearchParams } from "@superboard/front-ui/navigation";

import { canLeave } from "./ItemNavigation.js";

export const workspaceSections = {
	emails: { path: "/communication/marketing-email", tabs: ["emails"] },
	automations: { path: "/communication/journeys", tabs: ["automations"] },
	"in-app": { path: "/communication/in-app-messages", tabs: ["in-app"] },
	audience: {
		path: "/communication/audience",
		tabs: ["contacts", "lists", "segments", "fields", "forms", "suppressions"],
	},
	activity: { path: "/communication/statistics", tabs: ["messages", "statistics", "operations"] },
	settings: { path: "/communication/settings", tabs: ["senders", "preferences"] },
} as const;

export type WorkspaceSection = keyof typeof workspaceSections;

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

export function workspaceRedirect(search: URLSearchParams, fallback: string) {
	const home = resolveWorkspaceTab(null, fallback).section;
	const requested = resolveWorkspaceTab(search.get("tab"), fallback).section;
	return requested === home ? null : `${workspaceSections[requested].path}?${search}`;
}

export function workspaceHref(
	href: string,
	tab: string,
	fallback: string,
	extra: Record<string, string> = {},
) {
	const url = new URL(href);
	const section = resolveWorkspaceTab(tab, fallback).section;
	if (section === resolveWorkspaceTab(null, fallback).section) {
		for (const key of ["item", "section", "contact"]) url.searchParams.delete(key);
	} else {
		const lang = url.searchParams.get("lang");
		url.pathname = workspaceSections[section].path;
		url.search = lang ? new URLSearchParams({ lang }).toString() : "";
	}
	url.searchParams.set("tab", tab);
	for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
	return url.pathname + url.search;
}

export function useWorkspaceTab(fallback = "emails") {
	const params = useSearchParams();
	const router = useRouter();
	const current = resolveWorkspaceTab(params.get("tab"), fallback);
	const open = async (tab: string, extra: Record<string, string> = {}) => {
		if (!(await canLeave())) return;
		router.push(workspaceHref(window.location.href, tab, fallback, extra));
	};
	return { ...current, open };
}
