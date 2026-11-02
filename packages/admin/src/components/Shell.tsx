import { useMatches } from "@tanstack/react-router";
import * as React from "react";

import { useCurrentUser } from "../lib/api/current-user";
import { getLocaleDir } from "../locales/config.js";
import { useLocale } from "../locales/useLocale.js";
import { AdminCommandPalette } from "./AdminCommandPalette";
import { Header } from "./Header";
import { Sidebar, SidebarNav } from "./Sidebar";
import { WelcomeModal } from "./WelcomeModal";

declare module "@tanstack/react-router" {
	interface StaticDataRouteOption {
		fullBleed?: boolean;
	}
}

export interface ShellProps {
	children: React.ReactNode;
	manifest: {
		collections: Record<string, { label: string }>;
		plugins: Record<
			string,
			{
				package?: string;
				adminPages?: Array<{ path: string; label?: string; icon?: string }>;
			}
		>;
		taxonomies: Array<{
			id?: string;
			name: string;
			label: string;
			locale?: string;
			translationGroup?: string | null;
		}>;
		i18n?: { defaultLocale: string; locales: string[] };
		version?: string;
	};
}

export function Shell({ children, manifest }: ShellProps) {
	const [welcomeModalOpen, setWelcomeModalOpen] = React.useState(false);

	const { data: user } = useCurrentUser();
	const { locale } = useLocale();
	const sidebarSide = getLocaleDir(locale) === "rtl" ? "right" : "left";
	const fullBleed = useMatches({
		select: (matches) => matches.some((match) => match.staticData.fullBleed),
	});

	React.useEffect(() => {
		if (user?.isFirstLogin) {
			setWelcomeModalOpen(true);
		}
	}, [user?.isFirstLogin]);

	React.useEffect(() => {
		if (!user) return;
		try {
			if (user.role >= 30) {
				localStorage.setItem("emdash-editor", "1");
				localStorage.removeItem("emdash-toolbar-dismissed");
			} else {
				localStorage.removeItem("emdash-editor");
			}
		} catch {}
	}, [user]);

	return (
		<Sidebar.Provider
			defaultOpen
			side={sidebarSide}
			style={
				{
					"--sidebar-bg": "var(--color-kumo-elevated)",
					height: "100svh",
					minHeight: "0",
					overflow: "hidden",
				} as React.CSSProperties
			}
		>
			<SidebarNav manifest={manifest} />

			<div className="flex flex-1 flex-col overflow-hidden">
				<Header />
				<main
					className={
						fullBleed
							? "flex-1 overflow-hidden bg-kumo-elevated"
							: "flex-1 overflow-y-auto bg-kumo-elevated p-6"
					}
				>
					{children}
				</main>
			</div>

			{user && (
				<WelcomeModal
					open={welcomeModalOpen}
					onClose={() => setWelcomeModalOpen(false)}
					userName={user.name}
					userRole={user.role}
				/>
			)}

			<AdminCommandPalette manifest={manifest} />
		</Sidebar.Provider>
	);
}
