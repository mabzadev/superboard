import { canonicalFrontHref } from "@superboard/contracts/front-paths";
import { useFrontContext } from "@superboard/front-ui/context";
import { createFrontI18n } from "@superboard/front-ui/i18n";
import { Button } from "@superboard/front-ui/kumo";
import { useRouter, useSearchParams } from "@superboard/front-ui/navigation";
import { SectionNavigationProvider } from "@superboard/front-ui/section-navigation";
import { Suspense, useState, type ReactNode } from "react";

const en = {
	close: "Close",
	notFound: "This item is unavailable.",
	banners: "Banners",
	email: "Email",
	sms: "SMS",
	"sign-in": "Login",
	profile: "Profile",
	account: "Account",
	users: "Users",
	profileDescription: "SDK profiles and their activity in the application.",
	deviceDescription: "Platforms and installation activity reported by SDK profiles.",
	settings: "Settings",
	accounts: "Accounts",
	profiles: "Profiles",
	devices: "Devices",
	referrals: "Referrals",
	directory: "Directory",
	login: "Login",
	security: "Security",
	apps: "Apps",
	roles: "Roles",
	permissions: "Permissions",
	organizations: "Organizations",
	fields: "Fields",
	appearance: "Appearance",
	logs: "Logs",
	loading: "Loading…",
	configuration: "Configuration",
	policies: "Recovery",
	keys: "Keys",
	sso: "SSO",
};
const fr = {
	close: "Fermer",
	notFound: "Cet élément est indisponible.",
	banners: "Bannières",
	email: "E-mail",
	sms: "SMS",
	"sign-in": "Connexion",
	profile: "Profil",
	account: "Compte",
	users: "Utilisateurs",
	profileDescription: "Profils SDK et activité dans l’application.",
	deviceDescription: "Plateformes et activité des installations remontées par les profils SDK.",
	settings: "Paramètres",
	accounts: "Comptes",
	profiles: "Profils",
	devices: "Appareils",
	referrals: "Parrainages",
	directory: "Annuaire",
	login: "Connexion",
	security: "Sécurité",
	apps: "Applications",
	roles: "Rôles",
	permissions: "Permissions",
	organizations: "Organisations",
	fields: "Champs",
	appearance: "Apparence",
	logs: "Journal",
	loading: "Chargement…",
	configuration: "Configuration",
	policies: "Récupération",
	keys: "Clés",
	sso: "SSO",
};
export function useAuthenticationI18n() {
	const { locale } = useFrontContext();
	return createFrontI18n({ locale, messages: { en, fr } });
}

export function AuthenticationSection({ name, children }: { name: string; children: ReactNode }) {
	const i18n = useAuthenticationI18n();
	const search = useSearchParams();
	const [expanded, setExpanded] = useState(search.get("section") === name);
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

export function useAuthenticationTab(tabs: readonly string[], fallback: string) {
	const search = useSearchParams();
	const router = useRouter();
	const { locale, path } = useFrontContext();
	const requested = search.get("tab") ?? fallback;
	const selected = tabs.includes(requested) ? requested : fallback;
	return {
		selected,
		select: (tab: string) => {
			router.push(`${path}?lang=${locale}&tab=${encodeURIComponent(tab)}`);
		},
	};
}

export function AuthenticationTabs({
	view,
	tabs,
	selected,
	select,
	children,
}: {
	view: "users" | "settings";
	tabs: readonly string[];
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
				const href = canonicalFrontHref(anchor.getAttribute("href") ?? "");
				const destination = new URL(href, window.location.href);
				if (destination.origin !== window.location.origin || destination.pathname !== path) return;
				event.preventDefault();
				router.push(`${destination.pathname}${destination.search}${destination.hash}`);
			}}
		>
			<h1 className="ds-page-title">{i18n._(view)}</h1>
			<nav aria-label={i18n._(view)} className="flex flex-wrap gap-2">
				{tabs.map((tab) => (
					<Button
						key={tab}
						type="button"
						variant={selected === tab ? "primary" : "secondary"}
						aria-pressed={selected === tab}
						onClick={() => {
							select(tab);
						}}
					>
						{i18n._(tab)}
					</Button>
				))}
			</nav>
			<SectionNavigationProvider value={null}>
				<Suspense fallback={<p role="status">{i18n._("loading")}</p>}>{children}</Suspense>
			</SectionNavigationProvider>
		</section>
	);
}
