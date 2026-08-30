import { useEffect, useMemo, useState, type ReactNode } from "react";

import IdentityAccountPage from "../../../dashboard/src/app/(protected)/identity/[lang]/account/page";
import IdentityAppPage from "../../../dashboard/src/app/(protected)/identity/[lang]/apps/[id]/page";
import IdentityBannerPage from "../../../dashboard/src/app/(protected)/identity/[lang]/apps/banners/[id]/page";
import IdentityNewBannerPage from "../../../dashboard/src/app/(protected)/identity/[lang]/apps/banners/new/page";
import IdentityNewAppPage from "../../../dashboard/src/app/(protected)/identity/[lang]/apps/new/page";
import IdentityAppsPage from "../../../dashboard/src/app/(protected)/identity/[lang]/apps/page";
import IdentityDashboardPage from "../../../dashboard/src/app/(protected)/identity/[lang]/dashboard/page";
import IdentityEmailLogPage from "../../../dashboard/src/app/(protected)/identity/[lang]/logs/email/[id]/page";
import IdentityLogsPage from "../../../dashboard/src/app/(protected)/identity/[lang]/logs/page";
import IdentitySignInLogPage from "../../../dashboard/src/app/(protected)/identity/[lang]/logs/sign-in/[id]/page";
import IdentitySmsLogPage from "../../../dashboard/src/app/(protected)/identity/[lang]/logs/sms/[id]/page";
import IdentityOrgPage from "../../../dashboard/src/app/(protected)/identity/[lang]/orgs/[id]/page";
import IdentityNewOrgPage from "../../../dashboard/src/app/(protected)/identity/[lang]/orgs/new/page";
import IdentityOrgsPage from "../../../dashboard/src/app/(protected)/identity/[lang]/orgs/page";
import IdentityRolePage from "../../../dashboard/src/app/(protected)/identity/[lang]/roles/[id]/page";
import IdentityNewRolePage from "../../../dashboard/src/app/(protected)/identity/[lang]/roles/new/page";
import IdentityRolesPage from "../../../dashboard/src/app/(protected)/identity/[lang]/roles/page";
import IdentitySamlPage from "../../../dashboard/src/app/(protected)/identity/[lang]/saml/[id]/page";
import IdentityNewSamlPage from "../../../dashboard/src/app/(protected)/identity/[lang]/saml/new/page";
import IdentitySamlListPage from "../../../dashboard/src/app/(protected)/identity/[lang]/saml/page";
import IdentityScopePage from "../../../dashboard/src/app/(protected)/identity/[lang]/scopes/[id]/page";
import IdentityNewScopePage from "../../../dashboard/src/app/(protected)/identity/[lang]/scopes/new/page";
import IdentityScopesPage from "../../../dashboard/src/app/(protected)/identity/[lang]/scopes/page";
import IdentityAttributePage from "../../../dashboard/src/app/(protected)/identity/[lang]/user-attributes/[id]/page";
import IdentityNewAttributePage from "../../../dashboard/src/app/(protected)/identity/[lang]/user-attributes/new/page";
import IdentityAttributesPage from "../../../dashboard/src/app/(protected)/identity/[lang]/user-attributes/page";
import IdentityUserPage from "../../../dashboard/src/app/(protected)/identity/[lang]/users/[authId]/page";
import IdentityUsersPage from "../../../dashboard/src/app/(protected)/identity/[lang]/users/page";
import InfrastructurePage from "../../../dashboard/src/app/(protected)/infrastructure/page";
import ProjectSettingsPage from "../../../dashboard/src/app/(protected)/project-settings/page";
import MessagePreviewCraft from "../../../dashboard/src/app/message-preview-craft/page";
import {
	AnalyticsPage,
	type AnalyticsPageKind,
} from "../../../dashboard/src/components/analytics/AnalyticsPages";
import AccessKeyPageContent from "../../../dashboard/src/components/app/AccessKeyPageContent";
import {
	CustomersAnalyticsPage,
	ReferralsAnalyticsPage,
} from "../../../dashboard/src/components/app/AppAudiencePages";
import ApplicationUsersPage from "../../../dashboard/src/components/app/ApplicationUsersPage";
import LibrariesPageContent from "../../../dashboard/src/components/app/LibrariesPageContent";
import SdkSetupWizard from "../../../dashboard/src/components/app/SdkSetupWizard";
import DashboardPageContent from "../../../dashboard/src/components/dashboard/DashboardPageContent";
import CampaignsPageContent from "../../../dashboard/src/components/dynamic_links/campaigns/CampaignsPageContent";
import DomainPageContent from "../../../dashboard/src/components/dynamic_links/domain/DomainPageContent";
import LinksPageContent from "../../../dashboard/src/components/dynamic_links/links/LinksPageContent";
import RedirectRulesPageContent from "../../../dashboard/src/components/dynamic_links/redirect-rules/RedirectRulesPageContent";
import SocialPreviewPageContent from "../../../dashboard/src/components/dynamic_links/social-preview/SocialPreviewPageContent";
import TrackingPageContent from "../../../dashboard/src/components/dynamic_links/tracking/TrackingPageContent";
import BillingCustomersPage from "../../../dashboard/src/components/modules/BillingCustomersPage";
import InAppMessagesPage from "../../../dashboard/src/components/modules/InAppMessagesPage";
import {
	MarketingChannelsPage,
	MarketingJourneysPage,
} from "../../../dashboard/src/components/modules/MarketingJourneyPages";
import {
	MarketingListPage,
	MarketingSettingsPage,
	MarketingStatisticsPage,
} from "../../../dashboard/src/components/modules/MarketingPages";
import {
	OnboardingStatisticsPage,
	OnboardingsPage,
} from "../../../dashboard/src/components/modules/OnboardingPages";
import {
	PaywallStatisticsPage,
	PaywallsPage,
} from "../../../dashboard/src/components/modules/PaywallsPage";
import {
	EntitlementsPage,
	OfferingsPage,
	PurchasesPage,
} from "../../../dashboard/src/components/modules/ProductsPages";
import SupportAutomationsPage from "../../../dashboard/src/components/modules/SupportAutomationsPage";
import SupportCaptainPage from "../../../dashboard/src/components/modules/SupportCaptainPage";
import SupportChannelsPage from "../../../dashboard/src/components/modules/SupportChannelsPage";
import SupportConfigurationPage from "../../../dashboard/src/components/modules/SupportConfigurationPage";
import SupportContactsPage from "../../../dashboard/src/components/modules/SupportContactsPage";
import SupportHelpCenterPage from "../../../dashboard/src/components/modules/SupportHelpCenterPage";
import SupportInboxPage from "../../../dashboard/src/components/modules/SupportInboxPage";
import SupportIntegrationsPage from "../../../dashboard/src/components/modules/SupportIntegrationsPage";
import SupportProactivePage from "../../../dashboard/src/components/modules/SupportProactivePage";
import { SupportQualityPage } from "../../../dashboard/src/components/modules/SupportQualityPage";
import SupportReportsPage from "../../../dashboard/src/components/modules/SupportReportsPage";
import SupportSettingsPage from "../../../dashboard/src/components/modules/SupportSettingsPage";
import SupportWorkforcePage from "../../../dashboard/src/components/modules/SupportWorkforcePage";
import { ComponentsPage } from "../../../dashboard/src/features/flows/ComponentsPage";
import { WorkflowEditorPage } from "../../../dashboard/src/features/flows/editor/WorkflowEditorPage";
import { LaunchpadPage } from "../../../dashboard/src/features/flows/LaunchpadPage";
import { FlowsOverviewPage } from "../../../dashboard/src/features/flows/OverviewPage";
import {
	EnvironmentsSettingsPage,
	LocalizationSettingsPage,
	SdkSettingsPage,
} from "../../../dashboard/src/features/flows/SettingsPages";
import { FlowUserDetailsPage } from "../../../dashboard/src/features/flows/UserDetailsPage";
import { FlowsUsersPage } from "../../../dashboard/src/features/flows/UsersPage";
import { FlowsWorkflowsPage } from "../../../dashboard/src/features/flows/WorkflowsPage";
import IdentityIntlProvider from "../../../dashboard/src/identity/IdentityIntlProvider";
import IdentitySetup from "../../../dashboard/src/identity/Setup";
import identityEnglish from "../../../dashboard/src/identity/translations/en.json";
import identityFrench from "../../../dashboard/src/identity/translations/fr.json";
import { POST } from "../compat/dashboard-api";
import { frontSurfaceComponent } from "../lib/front-surface-registry";
import { SuperBoardFrontProviders } from "./SuperBoardFrontProviders";

import "../../../dashboard/src/app/openflow-tokens.css";
import "../../../dashboard/src/app/globals.css";

export function SuperBoardFrontApp({
	path,
	instanceId,
	apiUrl,
	operator,
	projectRefs,
}: {
	path: string;
	instanceId: string;
	apiUrl?: string;
	operator?: { email: string; name: string | null; role: number } | null;
	projectRefs?: { production: string; test: string } | null;
}) {
	if (typeof window !== "undefined" && apiUrl) window.__SUPERBOARD_API_URL__ = apiUrl;
	if (typeof window !== "undefined") {
		(
			window as Window & { __SUPERBOARD_OPERATOR_AUTHENTICATED__?: boolean }
		).__SUPERBOARD_OPERATOR_AUTHENTICATED__ = Boolean(operator);
	}
	return (
		<SuperBoardFrontProviders
			instanceId={instanceId}
			productionProjectRef={projectRefs?.production}
			testProjectRef={projectRefs?.test}
		>
			<SuperBoardShell path={path} operator={operator}>
				<Surface path={path} operator={operator} />
			</SuperBoardShell>
		</SuperBoardFrontProviders>
	);
}

const navigationGroups = [
	{
		label: "Overview",
		items: [["Dashboard", "/dashboard"]],
	},
	{
		label: "Application",
		items: [
			["Users", "/app/users"],
			["Customers", "/app/customers"],
			["Referrals", "/app/referrals"],
			["Access key", "/app/access-key"],
			["iOS setup", "/app/ios-setup"],
			["Android setup", "/app/android-setup"],
			["Web setup", "/app/web-setup"],
			["Libraries", "/app/libraries"],
		],
	},
	{
		label: "Identity",
		items: [
			["Overview", "/identity/en/dashboard"],
			["Users", "/identity/en/users"],
			["Applications", "/identity/en/apps"],
			["Organizations", "/identity/en/orgs"],
			["Roles", "/identity/en/roles"],
			["Scopes", "/identity/en/scopes"],
			["User attributes", "/identity/en/user-attributes"],
			["SAML", "/identity/en/saml"],
			["Logs", "/identity/en/logs"],
		],
	},
	{
		label: "Analytics",
		items: [
			["Overview", "/analytics"],
			["Dashboards", "/analytics/dashboards"],
			["Users", "/analytics/users"],
			["Events", "/analytics/events"],
			["Dimensions", "/analytics/dimensions"],
			["Views", "/analytics/views"],
			["Installations", "/analytics/installations"],
			["Purchases", "/analytics/purchases"],
			["Insights", "/analytics/insights"],
			["Cohorts", "/analytics/cohorts"],
			["Crashes", "/analytics/crashes"],
			["Feedback", "/analytics/feedback"],
			["Remote config", "/analytics/remote-config"],
			["Alerts", "/analytics/alerts"],
			["Reports", "/analytics/reports"],
			["Settings", "/analytics/settings"],
		],
	},
	{
		label: "Growth",
		items: [
			["Campaigns", "/marketing/campaigns"],
			["Email", "/marketing/email"],
			["Journeys", "/marketing/journeys"],
			["Channels", "/marketing/channels"],
			["In-app messages", "/marketing/in-app-messages"],
			["Marketing statistics", "/marketing/statistics"],
			["Marketing settings", "/marketing/settings"],
			["Links", "/dynamic-links/links"],
			["Link campaigns", "/dynamic-links/campaigns"],
			["Link domain", "/dynamic-links/domain"],
			["Redirect rules", "/dynamic-links/redirect-rules"],
			["Social preview", "/dynamic-links/social-media-preview"],
			["Link tracking", "/dynamic-links/tracking"],
			["Offerings", "/products/offerings"],
			["Entitlements", "/products/entitlements"],
			["Purchases", "/products/purchases"],
			["Paywalls", "/paywalls"],
			["Onboardings", "/onboardings"],
		],
	},
	{
		label: "Flows",
		items: [
			["Overview", "/flows"],
			["Workflows", "/flows/workflows"],
			["Launchpad", "/flows/launchpad"],
			["Components", "/flows/components"],
			["Users", "/flows/users"],
			["Environments", "/flows/settings/environments"],
			["Localization", "/flows/settings/localization"],
			["SDK", "/flows/settings/sdk"],
		],
	},
	{
		label: "Support",
		items: [
			["Inbox", "/support/inbox"],
			["Contacts", "/support/contacts"],
			["Channels", "/support/channels"],
			["Automations", "/support/automations"],
			["Help center", "/support/help-center"],
			["Proactive support", "/support/proactive-support"],
			["Captain", "/support/captain"],
			["Quality", "/support/quality"],
			["Workforce", "/support/workforce"],
			["Reports", "/support/reports"],
			["Integrations", "/support/integrations"],
			["Configuration", "/support/configuration"],
			["Settings", "/support/settings"],
		],
	},
	{
		label: "Platform",
		items: [
			["Infrastructure", "/infrastructure"],
			["Project settings", "/project-settings"],
			["Operator account", "/account"],
			["EmDash Admin", "/_emdash/admin"],
		],
	},
] as const;

function SuperBoardShell({
	path,
	operator,
	children,
}: {
	path: string;
	operator?: { email: string; name: string | null; role: number } | null;
	children: ReactNode;
}) {
	return (
		<div className="grid min-h-svh bg-background text-foreground lg:grid-cols-[280px_minmax(0,1fr)]">
			<aside className="border-b bg-sidebar lg:sticky lg:top-0 lg:h-svh lg:overflow-y-auto lg:border-b-0 lg:border-r">
				<div className="sticky top-0 z-10 border-b bg-sidebar/95 px-5 py-4 backdrop-blur">
					<a className="text-lg font-bold tracking-tight" href="/dashboard">
						SuperBoard
					</a>
					<p className="mt-1 truncate text-xs text-muted-foreground">
						{operator?.email ?? "Operator"}
					</p>
				</div>
				<nav className="space-y-2 p-3" aria-label="SuperBoard navigation">
					{navigationGroups.map((group) => (
						<details
							key={group.label}
							open={group.items.some(([, href]) => path === href || path.startsWith(`${href}/`))}
							className="group rounded-lg"
						>
							<summary className="cursor-pointer list-none rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-sidebar-accent">
								{group.label}
							</summary>
							<div className="mt-1 space-y-0.5">
								{group.items.map(([label, href]) => {
									const active =
										path === href || (href !== "/dashboard" && path.startsWith(`${href}/`));
									return (
										<a
											key={href}
											href={href}
											aria-current={active ? "page" : undefined}
											className={`block rounded-md px-3 py-2 text-sm transition ${active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/70"}`}
										>
											{label}
										</a>
									);
								})}
							</div>
						</details>
					))}
				</nav>
			</aside>
			<div className="min-w-0">
				<header className="sticky top-0 z-20 flex min-h-16 items-center justify-between border-b bg-background/90 px-4 backdrop-blur sm:px-6">
					<div>
						<p className="text-xs text-muted-foreground">SuperBoard Admin</p>
						<p className="font-medium">{path}</p>
					</div>
					<a className="rounded-lg border px-3 py-2 text-sm font-medium" href="/_emdash/admin">
						EmDash Admin
					</a>
				</header>
				<main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6">{children}</main>
			</div>
		</div>
	);
}

function Surface({
	path,
	operator,
}: {
	path: string;
	operator?: { email: string; name: string | null; role: number } | null;
}) {
	const component = frontSurfaceComponent(path);
	if (!component) {
		return (
			<section className="rounded-xl border border-destructive/40 bg-destructive/5 p-6">
				<h1 className="text-xl font-semibold">Surface not migrated</h1>
				<p className="mt-2 text-sm text-muted-foreground">
					No executable target component is registered for <code>{path}</code>.
				</p>
			</section>
		);
	}
	if (component.startsWith("analytics.")) {
		return <AnalyticsPage kind={component.slice("analytics.".length) as AnalyticsPageKind} />;
	}
	switch (component) {
		case "dashboard.overview":
			return <DashboardPageContent />;
		case "operator.accept_invite":
		case "operator.password":
		case "operator.register":
			return <OperatorAuthPage mode={component} operator={operator} />;
		case "operator.account":
			return <OperatorAccountPage operator={operator} />;
		case "operator.login":
			return <OperatorAuthPage mode="operator.login" operator={operator} />;
		case "user.access_key":
			return <AccessKeyPageContent />;
		case "settings.android_sdk":
			return <SdkSetupWizard platform="android" />;
		case "settings.ios_sdk":
			return <SdkSetupWizard platform="ios" />;
		case "settings.web_sdk":
			return <SdkSetupWizard platform="web" />;
		case "settings.libraries":
			return <LibrariesPageContent />;
		case "user.customers":
			return <CustomersAnalyticsPage />;
		case "user.referrals":
			return <ReferralsAnalyticsPage />;
		case "user.members":
			return <ApplicationUsersPage />;
		case "identity.redirect":
			return <IdentityRedirect />;
		case "identity.surface":
			return <IdentitySurface path={path} />;
		case "observability.infrastructure":
			return <InfrastructurePage />;
		case "mcp.authorize":
			return <McpAuthorize operator={operator} />;
		case "marketing.message_preview":
			return <MessagePreviewCraft />;
		case "settings.project":
			return <ProjectSettingsPage />;
		case "marketing.campaigns":
			return <MarketingListPage kind="campaigns" />;
		case "marketing.email":
			return <MarketingListPage kind="email" />;
		case "marketing.channels":
			return <MarketingChannelsPage />;
		case "marketing.journeys":
			return <MarketingJourneysPage />;
		case "marketing.in_app_messages":
			return <InAppMessagesPage />;
		case "marketing.settings":
			return <MarketingSettingsPage />;
		case "marketing.statistics":
			return <MarketingStatisticsPage />;
		case "billing.customers":
			return <BillingCustomersPage />;
		case "billing.entitlements":
			return <EntitlementsPage />;
		case "products.offerings":
			return <OfferingsPage />;
		case "billing.purchases":
			return <PurchasesPage />;
		case "paywalls.editor":
			return <PaywallsPage />;
		case "paywalls.statistics":
			return <PaywallStatisticsPage />;
		case "onboardings.editor":
			return <OnboardingsPage />;
		case "onboardings.statistics":
			return <OnboardingStatisticsPage />;
		case "support.automations":
			return <SupportAutomationsPage />;
		case "support.captain":
			return <SupportCaptainPage />;
		case "support.channels":
			return <SupportChannelsPage />;
		case "support.configuration":
			return <SupportConfigurationPage />;
		case "support.contacts":
			return <SupportContactsPage />;
		case "support.help-center":
			return <SupportHelpCenterPage />;
		case "support.inbox":
			return <SupportInboxPage />;
		case "support.integrations":
			return <SupportIntegrationsPage />;
		case "support.proactive-support":
			return <SupportProactivePage />;
		case "support.quality":
			return <SupportQualityPage />;
		case "support.reports":
			return <SupportReportsPage />;
		case "support.settings":
			return <SupportSettingsPage />;
		case "support.workforce":
			return <SupportWorkforcePage />;
		case "flows.overview":
			return <FlowsOverviewPage />;
		case "flows.components":
			return <ComponentsPage />;
		case "flows.launchpad":
			return <LaunchpadPage />;
		case "flows.environments":
			return <EnvironmentsSettingsPage />;
		case "flows.localization":
			return <LocalizationSettingsPage />;
		case "flows.sdk":
			return <SdkSettingsPage />;
		case "flows.users":
			return <FlowsUsersPage />;
		case "flows.user_details":
			return <FlowUserDetailsPage userHash={path.split("/").at(-1) ?? ""} />;
		case "flows.workflows":
			return (
				<FlowsWorkflowsPage
					initialOrigin={new URLSearchParams(window.location.search).get("origin") ?? undefined}
				/>
			);
		case "flows.workflow_editor":
			return <WorkflowEditorPage workflowId={path.split("/").at(-1) ?? ""} />;
		case "dynamic_links.campaigns":
			return <CampaignsPageContent />;
		case "dynamic_links.campaign_links":
			return <LinksPageContent campaignId={path.split("/").at(-1)} />;
		case "dynamic_links.domain":
			return <DomainPageContent />;
		case "dynamic_links.links":
			return <LinksPageContent />;
		case "dynamic_links.redirect_rules":
			return <RedirectRulesPageContent />;
		case "dynamic_links.social_preview":
			return <SocialPreviewPageContent />;
		case "dynamic_links.tracking":
			return <TrackingPageContent />;
		default:
			return null;
	}
}

function OperatorAuthPage({
	mode,
	operator,
}: {
	mode: string;
	operator?: { email: string; name: string | null; role: number } | null;
}) {
	const [search, setSearch] = useState("");
	useEffect(() => setSearch(window.location.search), []);
	const token = new URLSearchParams(search).get("token");
	const inviteHref = `/_emdash/admin/invite/accept${token ? `?token=${encodeURIComponent(token)}` : ""}`;
	const copy = {
		"operator.accept_invite": [
			"Accept invitation",
			"Complete the invitation with the EmDash operator identity service.",
		],
		"operator.password": [
			"Recover operator access",
			"Operator access is passwordless. Request a new email sign-in link from EmDash.",
		],
		"operator.register": [
			"Operator account",
			"This Instance has one operator identity managed by EmDash.",
		],
		"operator.login": ["Sign in", "Continue with the configured operator email."],
	}[mode] ?? ["Operator access", "Continue through EmDash authentication."];
	return (
		<section className="mx-auto max-w-xl rounded-2xl border bg-card p-8 shadow-sm">
			<p className="text-sm font-medium text-muted-foreground">SuperBoard operator</p>
			<h1 className="mt-2 text-3xl font-semibold tracking-tight">{copy[0]}</h1>
			<p className="mt-3 text-muted-foreground">{copy[1]}</p>
			{operator ? (
				<div className="mt-6 rounded-xl border bg-muted/30 p-4 text-sm">
					Signed in as <strong>{operator.email}</strong>
				</div>
			) : null}
			<div className="mt-6 flex flex-wrap gap-3">
				<a
					className="rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground"
					href={mode === "operator.accept_invite" ? inviteHref : "/_emdash/admin/login"}
				>
					{mode === "operator.accept_invite" ? "Continue invitation" : "Send email sign-in link"}
				</a>
				{operator ? (
					<a className="rounded-lg border px-4 py-2 font-medium" href="/app">
						Open SuperBoard
					</a>
				) : null}
			</div>
		</section>
	);
}

function OperatorAccountPage({
	operator,
}: {
	operator?: { email: string; name: string | null; role: number } | null;
}) {
	return (
		<section className="space-y-6">
			<header>
				<h1 className="text-3xl font-semibold tracking-tight">Operator account</h1>
				<p className="mt-1 text-muted-foreground">
					The operator identity is shared by EmDash Admin and SuperBoard Admin.
				</p>
			</header>
			<div className="grid gap-4 rounded-xl border bg-card p-6 sm:grid-cols-3">
				<div>
					<p className="text-xs uppercase text-muted-foreground">Name</p>
					<p className="mt-1 font-medium">{operator?.name ?? "—"}</p>
				</div>
				<div>
					<p className="text-xs uppercase text-muted-foreground">Email</p>
					<p className="mt-1 font-medium">{operator?.email ?? "—"}</p>
				</div>
				<div>
					<p className="text-xs uppercase text-muted-foreground">Role</p>
					<p className="mt-1 font-medium">{operator?.role ?? "—"}</p>
				</div>
			</div>
			<a
				className="inline-flex rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground"
				href="/_emdash/admin/settings"
			>
				Manage account in EmDash
			</a>
		</section>
	);
}

function IdentityRedirect() {
	useEffect(() => window.location.replace("/identity/en/dashboard"), []);
	return <p className="text-sm text-muted-foreground">Opening Identity…</p>;
}

function IdentitySurface({ path }: { path: string }) {
	const segments = path.split("/").filter(Boolean);
	const locale = segments[1] === "fr" ? "fr" : "en";
	const resource = `/${segments.slice(2).join("/")}`;
	const messages = locale === "fr" ? identityFrench : identityEnglish;
	return (
		<IdentityIntlProvider locale={locale} messages={messages}>
			<IdentitySetup>
				<IdentityRoute resource={resource === "/" ? "/dashboard" : resource} />
			</IdentitySetup>
		</IdentityIntlProvider>
	);
}

function IdentityRoute({ resource }: { resource: string }) {
	if (resource === "/dashboard") return <IdentityDashboardPage />;
	if (resource === "/account") return <IdentityAccountPage />;
	if (resource === "/apps") return <IdentityAppsPage />;
	if (resource === "/apps/new") return <IdentityNewAppPage />;
	if (resource === "/apps/banners/new") return <IdentityNewBannerPage />;
	if (/^\/apps\/banners\/[^/]+$/u.test(resource)) return <IdentityBannerPage />;
	if (/^\/apps\/[^/]+$/u.test(resource)) return <IdentityAppPage />;
	if (resource === "/logs") return <IdentityLogsPage />;
	if (/^\/logs\/email\/[^/]+$/u.test(resource)) return <IdentityEmailLogPage />;
	if (/^\/logs\/sign-in\/[^/]+$/u.test(resource)) return <IdentitySignInLogPage />;
	if (/^\/logs\/sms\/[^/]+$/u.test(resource)) return <IdentitySmsLogPage />;
	if (resource === "/orgs") return <IdentityOrgsPage />;
	if (resource === "/orgs/new") return <IdentityNewOrgPage />;
	if (/^\/orgs\/[^/]+$/u.test(resource)) return <IdentityOrgPage />;
	if (resource === "/roles") return <IdentityRolesPage />;
	if (resource === "/roles/new") return <IdentityNewRolePage />;
	if (/^\/roles\/[^/]+$/u.test(resource)) return <IdentityRolePage />;
	if (resource === "/saml") return <IdentitySamlListPage />;
	if (resource === "/saml/new") return <IdentityNewSamlPage />;
	if (/^\/saml\/[^/]+$/u.test(resource)) return <IdentitySamlPage />;
	if (resource === "/scopes") return <IdentityScopesPage />;
	if (resource === "/scopes/new") return <IdentityNewScopePage />;
	if (/^\/scopes\/[^/]+$/u.test(resource)) return <IdentityScopePage />;
	if (resource === "/user-attributes") return <IdentityAttributesPage />;
	if (resource === "/user-attributes/new") return <IdentityNewAttributePage />;
	if (/^\/user-attributes\/[^/]+$/u.test(resource)) return <IdentityAttributePage />;
	if (resource === "/users") return <IdentityUsersPage />;
	if (/^\/users\/[^/]+$/u.test(resource)) return <IdentityUserPage />;
	return <IdentityDashboardPage />;
}

function McpAuthorize({
	operator,
}: {
	operator?: { email: string; name: string | null; role: number } | null;
}) {
	const parameters = useMemo(
		() => new URLSearchParams(typeof window === "undefined" ? "" : window.location.search),
		[],
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const clientName = parameters.get("client_name") || "An application";
	const redirectUri = parameters.get("redirect_uri") || "";
	const approve = async () => {
		setBusy(true);
		setError(null);
		try {
			const response = await POST<{ code: string; state?: string }>("/api/v1/mcp/approve_consent", {
				client_id: parameters.get("client_id") || "",
				redirect_uri: redirectUri,
				code_challenge: parameters.get("code_challenge") || undefined,
				code_challenge_method: parameters.get("code_challenge_method") || undefined,
				state: parameters.get("state") || undefined,
				scope: parameters.get("scope") || undefined,
			});
			const destination = new URL(redirectUri);
			destination.searchParams.set("code", response.data.code);
			if (response.data.state) destination.searchParams.set("state", response.data.state);
			window.location.assign(destination);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Authorization failed");
			setBusy(false);
		}
	};
	const deny = () => {
		try {
			const destination = new URL(redirectUri);
			destination.searchParams.set("error", "access_denied");
			const state = parameters.get("state");
			if (state) destination.searchParams.set("state", state);
			window.location.assign(destination);
		} catch {
			setError("Invalid redirect URI");
		}
	};
	return (
		<section className="mx-auto max-w-lg rounded-2xl border bg-card p-8 shadow-sm">
			<p className="text-sm text-muted-foreground">MCP authorization</p>
			<h1 className="mt-2 text-2xl font-semibold">Authorize {clientName}</h1>
			<p className="mt-3 text-sm text-muted-foreground">
				Signed in as {operator?.email ?? "the SuperBoard operator"}. Requested scopes:{" "}
				{parameters.get("scope") || "default"}.
			</p>
			{error ? (
				<p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
					{error}
				</p>
			) : null}
			<div className="mt-6 flex gap-3">
				<button
					className="rounded-lg border px-4 py-2"
					type="button"
					onClick={deny}
					disabled={busy}
				>
					Deny
				</button>
				<button
					className="rounded-lg bg-primary px-4 py-2 text-primary-foreground"
					type="button"
					onClick={() => void approve()}
					disabled={busy || !redirectUri}
				>
					{busy ? "Authorizing…" : "Authorize"}
				</button>
			</div>
		</section>
	);
}
