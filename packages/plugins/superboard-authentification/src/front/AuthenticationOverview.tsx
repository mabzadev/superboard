import { useFrontContext } from "@superboard/front-ui/context";
import { LinkButton } from "@superboard/front-ui/kumo";

const views = [
	[
		"/auth/users",
		"Application users",
		"Utilisateurs d’application",
		"Profiles, account suspension and application sessions.",
		"Profils, suspension des comptes et sessions applicatives.",
	],
	[
		"/auth/directory/users",
		"Identity directory",
		"Annuaire des identités",
		"Invitations, MFA, passkeys, roles, consent and blocked IPs.",
		"Invitations, MFA, passkeys, rôles, consentements et IP bloquées.",
	],
	[
		"/auth/apps",
		"Applications",
		"Applications",
		"OAuth clients, redirect URLs, secrets and banners.",
		"Clients OAuth, URL de redirection, secrets et bannières.",
	],
	[
		"/auth/roles",
		"Roles",
		"Rôles",
		"Create roles and assign access scopes.",
		"Créer les rôles et attribuer les permissions.",
	],
	[
		"/auth/scopes",
		"Scopes",
		"Scopes",
		"Define permissions requested by applications.",
		"Définir les permissions demandées par les applications.",
	],
	[
		"/auth/orgs",
		"Organizations",
		"Organisations",
		"Organizations, members and groups.",
		"Organisations, membres et groupes.",
	],
	[
		"/auth/saml",
		"SAML providers",
		"Fournisseurs SAML",
		"Configure enterprise single sign-on.",
		"Configurer la connexion unique d’entreprise.",
	],
	[
		"/auth/user-attributes",
		"User attributes",
		"Attributs utilisateurs",
		"Manage custom identity fields.",
		"Gérer les champs personnalisés des identités.",
	],
	[
		"/auth/account-policies",
		"Account journeys",
		"Parcours du compte",
		"Profile, email, password, MFA and recovery-code journeys.",
		"Parcours de modification du profil, de l’email, du mot de passe, du MFA et des codes de récupération.",
	],
	[
		"/auth/logs",
		"Authentication logs",
		"Journaux d’authentification",
		"Sign-ins, email and SMS delivery logs.",
		"Journaux des connexions, emails et SMS.",
	],
	[
		"/auth/settings",
		"Settings",
		"Paramètres",
		"Sign-in methods, providers, security and token lifetimes.",
		"Méthodes de connexion, fournisseurs, sécurité et durée des jetons.",
	],
] as const;

export default function AuthenticationOverview() {
	const { locale } = useFrontContext();
	const french = locale === "fr";
	return (
		<section className="ds-page space-y-5">
			<header>
				<h1 className="ds-page-title">{french ? "Authentification" : "Authentication"}</h1>
				<p className="ds-page-description">
					{french
						? "Gérer les comptes, les accès et la sécurité de vos applications."
						: "Manage accounts, access and security for your applications."}
				</p>
			</header>
			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
				{views.map(([path, en, fr, descriptionEn, descriptionFr]) => (
					<article
						key={path}
						className="flex flex-col items-start gap-3 rounded-lg border bg-card p-5"
					>
						<h2 className="text-lg font-semibold">{french ? fr : en}</h2>
						<p className="grow text-sm text-muted-foreground">
							{french ? descriptionFr : descriptionEn}
						</p>
						<LinkButton href={`${path}?lang=${locale}`}>
							{french ? `Ouvrir : ${fr}` : `Open: ${en}`}
						</LinkButton>
					</article>
				))}
			</div>
		</section>
	);
}
