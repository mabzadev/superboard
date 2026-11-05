import { useFrontContext } from "@superboard/front-ui/context";
import { createFrontI18n } from "@superboard/front-ui/i18n";
import { useRouter, useSearchParams } from "@superboard/front-ui/navigation";
import { SectionNavigationProvider } from "@superboard/front-ui/section-navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";

import {
	authenticationHref,
	authenticationTabs,
	authenticationTarget,
	type AuthenticationView,
} from "./authentication-navigation.js";

const en = {
	close: "Close",
	notFound: "This item is unavailable.",
	email: "Email",
	sms: "SMS",
	"sign-in": "Sign-in",
	profile: "Profile",
	account: "Account",
	users: "Users",
	settings: "Settings",
	directory: "Directory",
	apps: "Apps",
	banners: "Banners",
	roles: "Roles",
	permissions: "Permissions",
	organizations: "Organizations",
	fields: "Fields",
	loading: "Loading…",
	policies: "Recovery",
	sso: "SSO/SAML",
	"tab:users": "Users",
	"tab:directory": "Directory",
	"tab:devices": "Devices & profiles",
	"tab:referrals": "Referrals",
	"tab:activity": "Activity",
	"tab:sign-in": "Sign-in",
	"tab:access": "Access control",
	"tab:fields": "Users & fields",
	"tab:appearance": "Appearance",
	devicesDescription: "SDK profiles, platforms and installation activity in the application.",
	activityDescription: "Email, SMS and sign-in logs of your users.",
};
const fr: typeof en = {
	close: "Fermer",
	notFound: "Cet élément est indisponible.",
	email: "E-mail",
	sms: "SMS",
	"sign-in": "Connexion",
	profile: "Profil",
	account: "Compte",
	users: "Utilisateurs",
	settings: "Paramètres",
	directory: "Annuaire",
	apps: "Applications",
	banners: "Bannières",
	roles: "Rôles",
	permissions: "Permissions",
	organizations: "Organisations",
	fields: "Champs",
	loading: "Chargement…",
	policies: "Récupération",
	sso: "SSO/SAML",
	"tab:users": "Utilisateurs",
	"tab:directory": "Annuaire",
	"tab:devices": "Appareils et profils",
	"tab:referrals": "Parrainages",
	"tab:activity": "Activité",
	"tab:sign-in": "Connexion",
	"tab:access": "Contrôle d’accès",
	"tab:fields": "Utilisateurs et champs",
	"tab:appearance": "Apparence",
	devicesDescription: "Profils SDK, plateformes et activité des installations dans l’application.",
	activityDescription: "Journaux des e-mails, SMS et connexions de vos utilisateurs.",
};
export function useAuthenticationI18n() {
	const { locale } = useFrontContext();
	return createFrontI18n({ locale, messages: { en, fr } });
}

export function AuthenticationSection({
	name,
	open,
	children,
}: {
	name: string;
	open: boolean;
	children: ReactNode;
}) {
	const i18n = useAuthenticationI18n();
	const [expanded, setExpanded] = useState(open);
	return (
		<details
			open={expanded}
			className="rounded border border-kumo-subtle p-4"
			onToggle={(event) => {
				setExpanded(event.currentTarget.open);
			}}
		>
			<summary>{i18n._(name)}</summary>
			{expanded && (
				<Suspense fallback={<p role="status">{i18n._("loading")}</p>}>{children}</Suspense>
			)}
		</details>
	);
}

export function useAuthenticationTab(view: AuthenticationView) {
	const search = useSearchParams();
	const router = useRouter();
	const { locale, path } = useFrontContext();
	const target = authenticationTarget(view, search);
	const moved = target.view !== view;
	useEffect(() => {
		if (moved)
			router.replace(
				authenticationHref(`/auth/${view}${globalThis.location.search}${globalThis.location.hash}`),
			);
	}, [moved, router, view]);
	return {
		moved,
		selected: moved ? authenticationTabs[view][0] : target.tab,
		section: target.section,
		select: (tab: string, section?: string) => {
			router.push(
				`${path}?lang=${locale}&tab=${encodeURIComponent(tab)}${section ? `&section=${encodeURIComponent(section)}` : ""}`,
			);
		},
	};
}

export function AuthenticationTabs({
	view,
	selected,
	select,
	children,
}: {
	view: AuthenticationView;
	selected: string;
	select(tab: string): void;
	children: ReactNode;
}) {
	const i18n = useAuthenticationI18n();
	const router = useRouter();
	const { path } = useFrontContext();
	return (
		<section
			className="ds-page space-y-5"
			onClickCapture={(event) => {
				if (
					event.defaultPrevented ||
					event.button !== 0 ||
					event.metaKey ||
					event.ctrlKey ||
					event.shiftKey ||
					event.altKey
				)
					return;
				const anchor = event.target instanceof Element ? event.target.closest("a") : null;
				if (
					!anchor ||
					!anchor.hasAttribute("href") ||
					anchor.hasAttribute("download") ||
					(anchor.target && anchor.target !== "_self")
				)
					return;
				const raw = anchor.getAttribute("href") ?? "";
				const href = authenticationHref(raw);
				const destination = new URL(href, window.location.href);
				if (destination.origin !== window.location.origin) return;
				if (destination.pathname !== path && href === raw) return;
				event.preventDefault();
				router.push(`${destination.pathname}${destination.search}${destination.hash}`);
			}}
		>
			<h1 className="ds-page-title">{i18n._(view)}</h1>
			<nav
				aria-label={i18n._(view)}
				className="bg-muted text-muted-foreground flex w-fit flex-wrap items-center gap-1 rounded-lg p-[3px]"
			>
				{authenticationTabs[view].map((tab) => (
					<button
						key={tab}
						type="button"
						aria-pressed={selected === tab}
						className="text-foreground rounded-md px-3 py-1 text-sm font-medium aria-[pressed=true]:bg-background aria-[pressed=true]:shadow-sm"
						onClick={() => {
							select(tab);
						}}
					>
						{i18n._(`tab:${tab}`)}
					</button>
				))}
			</nav>
			<SectionNavigationProvider value={null}>
				<Suspense fallback={<p role="status">{i18n._("loading")}</p>}>{children}</Suspense>
			</SectionNavigationProvider>
		</section>
	);
}
