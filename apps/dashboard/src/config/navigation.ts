import type { LucideIcon } from "lucide-react";
import {
  AppWindow,
  Boxes,
  ChartNoAxesCombined,
  Fingerprint,
  Link2,
  LayoutDashboard,
  LifeBuoy,
  Megaphone,
  Workflow,
} from "lucide-react";

export type SectionSlug =
  | "dashboard"
  | "app"
  | "products"
  | "flows"
  | "dynamic-links"
  | "support"
  | "identity"
  | "marketing"
  | "analytics";

export type SectionPage = Readonly<{
  label: string;
  href: string;
}>;

export type DashboardSection = Readonly<{
  slug: SectionSlug;
  label: string;
  icon: LucideIcon;
  href: string;
  pages: readonly SectionPage[];
}>;

const page = (label: string, href: string): SectionPage => ({
  label,
  href,
});

export const DASHBOARD_SECTIONS: readonly DashboardSection[] = [
  {
    slug: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    href: "/dashboard",
    pages: [page("Dashboard", "/dashboard")],
  },
  {
    slug: "app",
    label: "App",
    icon: AppWindow,
    href: "/app/customers",
    pages: [
      page("Customers", "/app/customers"),
      page("Users", "/app/users"),
      page("Referrals", "/app/referrals"),
      page("Access Key", "/app/access-key"),
      page("Libraries", "/app/libraries"),
      page("Android Setup", "/app/android-setup"),
      page("iOS Setup", "/app/ios-setup"),
      page("Web Setup", "/app/web-setup"),
    ],
  },
  {
    slug: "identity",
    label: "Identity",
    icon: Fingerprint,
    href: "/identity/en/dashboard",
    pages: [
      page("Overview", "/identity/en/dashboard"),
      page("Users", "/identity/en/users"),
      page("User Attributes", "/identity/en/user-attributes"),
      page("Roles", "/identity/en/roles"),
      page("Applications", "/identity/en/apps"),
      page("Scopes", "/identity/en/scopes"),
      page("Organizations", "/identity/en/orgs"),
      page("Logs", "/identity/en/logs"),
      page("SAML SSO", "/identity/en/saml"),
      page("Account Policies", "/identity/en/account"),
    ],
  },
  {
    slug: "products",
    label: "Products",
    icon: Boxes,
    href: "/products/purchases",
    pages: [
      page("Purchases", "/products/purchases"),
      page("Customers", "/products/customers"),
      page("Offerings", "/products/offerings"),
      page("Entitlements", "/products/entitlements"),
    ],
  },
  {
    slug: "flows",
    label: "Flows",
    icon: Workflow,
    href: "/flows",
    pages: [
      page("Overview", "/flows"),
      page("Workflows", "/flows/workflows"),
      page("Launchpad", "/flows/launchpad"),
      page("Users", "/flows/users"),
      page("Components", "/flows/components"),
      page("Environments", "/flows/settings/environments"),
      page("Localization", "/flows/settings/localization"),
      page("SDK", "/flows/settings/sdk"),
    ],
  },
  {
    slug: "dynamic-links",
    label: "Dynamic Links",
    icon: Link2,
    href: "/dynamic-links/links",
    pages: [
      page("Links", "/dynamic-links/links"),
      page("Campaigns", "/dynamic-links/campaigns"),
      page("Redirect Rules", "/dynamic-links/redirect-rules"),
      page("Domain", "/dynamic-links/domain"),
      page("Social Media Preview", "/dynamic-links/social-media-preview"),
      page("Tracking", "/dynamic-links/tracking"),
    ],
  },
  {
    slug: "support",
    label: "Support",
    icon: LifeBuoy,
    href: "/support/inbox",
    pages: [
      page("Inbox", "/support/inbox"),
      page("Contacts", "/support/contacts"),
      page("Workforce", "/support/workforce"),
      page("Channels", "/support/channels"),
      page("Automations", "/support/automations"),
      page("Proactive Support", "/support/proactive-support"),
      page("Help Center", "/support/help-center"),
      page("Captain", "/support/captain"),
      page("Integrations", "/support/integrations"),
      page("Reports", "/support/reports"),
      page("Settings", "/support/settings"),
    ],
  },
  {
    slug: "marketing",
    label: "Marketing",
    icon: Megaphone,
    href: "/marketing/in-app-messages",
    pages: [
      page("In-app Messages", "/marketing/in-app-messages"),
      page("Email", "/marketing/email"),
      page("Campaigns", "/marketing/campaigns"),
      page("Journeys", "/marketing/journeys"),
      page("Channels", "/marketing/channels"),
      page("Statistics", "/marketing/statistics"),
      page("Settings", "/marketing/settings"),
    ],
  },
  {
    slug: "analytics",
    label: "Analytics",
    icon: ChartNoAxesCombined,
    href: "/analytics",
    pages: [
      page("Overview", "/analytics"),
      page("Dashboards", "/analytics/dashboards"),
      page("Users & Sessions", "/analytics/users"),
      page("Events", "/analytics/events"),
      page("Technology & Location", "/analytics/dimensions"),
      page("Views", "/analytics/views"),
      page("Installations", "/analytics/installations"),
      page("Verified Purchases", "/analytics/purchases"),
      page("Funnels & Retention", "/analytics/insights"),
      page("Cohorts", "/analytics/cohorts"),
      page("Crashes", "/analytics/crashes"),
      page("Feedback", "/analytics/feedback"),
      page("Remote Config", "/analytics/remote-config"),
      page("Alerts", "/analytics/alerts"),
      page("Reports & Exports", "/analytics/reports"),
      page("Settings", "/analytics/settings"),
    ],
  },
] as const;

export function sectionForPath(pathname: string) {
  return DASHBOARD_SECTIONS.find(
    (section) =>
      pathname === `/${section.slug}` ||
      pathname.startsWith(`/${section.slug}/`)
  );
}

export function pageForPath(pathname: string) {
  const section = sectionForPath(pathname);
  const comparablePath = pathname.replace(
    /^\/identity\/(?:en|fr)(?=\/|$)/,
    "/identity/en"
  );
  return [...(section?.pages ?? [])]
    .sort((left, right) => right.href.length - left.href.length)
    .find(
      (item) =>
        comparablePath === item.href ||
        comparablePath.startsWith(`${item.href}/`)
    );
}
