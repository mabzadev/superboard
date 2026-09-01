"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import IdentityAccountPage from "@/app/(protected)/identity/[lang]/account/page";
import IdentityAppsPage from "@/app/(protected)/identity/[lang]/apps/page";
import IdentityDashboardPage from "@/app/(protected)/identity/[lang]/dashboard/page";
import IdentityLogsPage from "@/app/(protected)/identity/[lang]/logs/page";
import IdentityOrganizationsPage from "@/app/(protected)/identity/[lang]/orgs/page";
import IdentityRolesPage from "@/app/(protected)/identity/[lang]/roles/page";
import IdentitySamlPage from "@/app/(protected)/identity/[lang]/saml/page";
import IdentityScopesPage from "@/app/(protected)/identity/[lang]/scopes/page";
import IdentityUserAttributesPage from "@/app/(protected)/identity/[lang]/user-attributes/page";
import IdentityUsersPage from "@/app/(protected)/identity/[lang]/users/page";
import {
  AnalyticsPage,
  type AnalyticsPageKind,
} from "@/components/analytics/AnalyticsPages";
import AccessKeyPageContent from "@/components/app/AccessKeyPageContent";
import {
  CustomersAnalyticsPage,
  ReferralsAnalyticsPage,
} from "@/components/app/AppAudiencePages";
import ApplicationUsersPage from "@/components/app/ApplicationUsersPage";
import LibrariesPageContent from "@/components/app/LibrariesPageContent";
import SdkSetupWizard from "@/components/app/SdkSetupWizard";
import DashboardPageContent from "@/components/dashboard/DashboardPageContent";
import CampaignsPageContent from "@/components/dynamic_links/campaigns/CampaignsPageContent";
import DomainPageContent from "@/components/dynamic_links/domain/DomainPageContent";
import LinksPageContent from "@/components/dynamic_links/links/LinksPageContent";
import RedirectRulesPageContent from "@/components/dynamic_links/redirect-rules/RedirectRulesPageContent";
import SocialPreviewPageContent from "@/components/dynamic_links/social-preview/SocialPreviewPageContent";
import TrackingPageContent from "@/components/dynamic_links/tracking/TrackingPageContent";
import BillingCustomersPage from "@/components/modules/BillingCustomersPage";
import InAppMessagesPage from "@/components/modules/InAppMessagesPage";
import {
  MarketingChannelsPage,
  MarketingJourneysPage,
} from "@/components/modules/MarketingJourneyPages";
import {
  MarketingListPage,
  MarketingSettingsPage,
  MarketingStatisticsPage,
} from "@/components/modules/MarketingPages";
import {
  EntitlementsPage,
  OfferingsPage,
  PurchasesPage,
} from "@/components/modules/ProductsPages";
import SupportAutomationsPage from "@/components/modules/SupportAutomationsPage";
import SupportCaptainPage from "@/components/modules/SupportCaptainPage";
import SupportChannelsPage from "@/components/modules/SupportChannelsPage";
import SupportContactsPage from "@/components/modules/SupportContactsPage";
import SupportHelpCenterPage from "@/components/modules/SupportHelpCenterPage";
import SupportInboxPage from "@/components/modules/SupportInboxPage";
import SupportIntegrationsPage from "@/components/modules/SupportIntegrationsPage";
import SupportProactivePage from "@/components/modules/SupportProactivePage";
import SupportReportsPage from "@/components/modules/SupportReportsPage";
import SupportSettingsPage from "@/components/modules/SupportSettingsPage";
import SupportWorkforcePage from "@/components/modules/SupportWorkforcePage";
import { ProjectSelectionProvider } from "@/context/useProjectSelection";
import LinkDialogProvider from "@/context/useLinkDialogContext";
import { ComponentsPage } from "@/features/flows/ComponentsPage";
import { FlowsProvider } from "@/features/flows/FlowsContext";
import { LaunchpadPage } from "@/features/flows/LaunchpadPage";
import { FlowsOverviewPage } from "@/features/flows/OverviewPage";
import {
  EnvironmentsSettingsPage,
  LocalizationSettingsPage,
  SdkSettingsPage,
} from "@/features/flows/SettingsPages";
import { FlowsUsersPage } from "@/features/flows/UsersPage";
import { FlowsWorkflowsPage } from "@/features/flows/WorkflowsPage";
import Setup from "@/identity/Setup";
import IdentityIntlProvider from "@/identity/IdentityIntlProvider";
import english from "@/identity/translations/en.json";
import french from "@/identity/translations/fr.json";

export interface DashboardViewRendererProps {
  bindings: {
    commands: readonly string[];
    data_sources: readonly string[];
  };
  configurationError: string;
  instanceId: string;
  locale: "en" | "fr";
  path: string;
  pluginId: string;
  rendererId: string;
}

const ANALYTICS_KINDS: Readonly<Record<string, AnalyticsPageKind>> = {
  "/analytics": "overview",
  "/analytics/dashboards": "dashboards",
  "/analytics/users": "users",
  "/analytics/events": "events",
  "/analytics/dimensions": "dimensions",
  "/analytics/views": "views",
  "/analytics/installations": "installations",
  "/analytics/purchases": "purchases",
  "/analytics/insights": "insights",
  "/analytics/cohorts": "cohorts",
  "/analytics/crashes": "crashes",
  "/analytics/feedback": "feedback",
  "/analytics/remote-config": "remote-config",
  "/analytics/alerts": "alerts",
  "/analytics/reports": "reports",
  "/analytics/settings": "settings",
};
const IDENTITY_LOCALE_PATH = /^\/identity\/(?:en|fr)(?=\/|$)/u;

const VIEW_FACTORIES: Readonly<Record<string, () => ReactNode>> = {
  "/dashboard": () => <DashboardPageContent />,
  "/app/customers": () => <CustomersAnalyticsPage />,
  "/app/users": () => <ApplicationUsersPage />,
  "/app/referrals": () => <ReferralsAnalyticsPage />,
  "/app/access-key": () => <AccessKeyPageContent />,
  "/app/libraries": () => <LibrariesPageContent />,
  "/app/android-setup": () => <SdkSetupWizard platform="android" />,
  "/app/ios-setup": () => <SdkSetupWizard platform="ios" />,
  "/app/web-setup": () => <SdkSetupWizard platform="web" />,
  "/products/purchases": () => <PurchasesPage />,
  "/products/customers": () => <BillingCustomersPage />,
  "/products/offerings": () => <OfferingsPage />,
  "/products/entitlements": () => <EntitlementsPage />,
  "/flows": () => <FlowsOverviewPage />,
  "/flows/workflows": () => <FlowsWorkflowsPage />,
  "/flows/launchpad": () => <LaunchpadPage />,
  "/flows/users": () => <FlowsUsersPage />,
  "/flows/components": () => <ComponentsPage />,
  "/flows/settings/environments": () => <EnvironmentsSettingsPage />,
  "/flows/settings/localization": () => <LocalizationSettingsPage />,
  "/flows/settings/sdk": () => <SdkSettingsPage />,
  "/dynamic-links/links": () => <LinksPageContent />,
  "/dynamic-links/campaigns": () => <CampaignsPageContent />,
  "/dynamic-links/redirect-rules": () => <RedirectRulesPageContent />,
  "/dynamic-links/domain": () => <DomainPageContent />,
  "/dynamic-links/social-media-preview": () => <SocialPreviewPageContent />,
  "/dynamic-links/tracking": () => <TrackingPageContent />,
  "/support/workforce": () => <SupportWorkforcePage />,
  "/support/channels": () => <SupportChannelsPage />,
  "/support/automations": () => <SupportAutomationsPage />,
  "/support/contacts": () => <SupportContactsPage />,
  "/support/inbox": () => <SupportInboxPage />,
  "/support/proactive-support": () => <SupportProactivePage />,
  "/support/help-center": () => <SupportHelpCenterPage />,
  "/support/captain": () => <SupportCaptainPage />,
  "/support/integrations": () => <SupportIntegrationsPage />,
  "/support/reports": () => <SupportReportsPage />,
  "/support/settings": () => <SupportSettingsPage />,
  "/marketing/email": () => <MarketingListPage kind="email" />,
  "/marketing/campaigns": () => <MarketingListPage kind="campaigns" />,
  "/marketing/journeys": () => <MarketingJourneysPage />,
  "/marketing/channels": () => <MarketingChannelsPage />,
  "/marketing/in-app-messages": () => <InAppMessagesPage />,
  "/marketing/statistics": () => <MarketingStatisticsPage />,
  "/marketing/settings": () => <MarketingSettingsPage />,
  "/identity/en/account": () => <IdentityAccountPage />,
  "/identity/en/apps": () => <IdentityAppsPage />,
  "/identity/en/dashboard": () => <IdentityDashboardPage />,
  "/identity/en/logs": () => <IdentityLogsPage />,
  "/identity/en/orgs": () => <IdentityOrganizationsPage />,
  "/identity/en/roles": () => <IdentityRolesPage />,
  "/identity/en/saml": () => <IdentitySamlPage />,
  "/identity/en/scopes": () => <IdentityScopesPage />,
  "/identity/en/user-attributes": () => <IdentityUserAttributesPage />,
  "/identity/en/users": () => <IdentityUsersPage />,
};

export function DashboardViewRenderer({
  bindings,
  configurationError,
  instanceId,
  locale,
  path,
  pluginId,
  rendererId,
}: DashboardViewRendererProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            gcTime: 300_000,
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 30_000,
          },
        },
      })
  );
  const view = renderView(canonicalViewPath(path));
  if (!view) return null;
  if (!validViewConfiguration(pluginId, rendererId, bindings)) {
    return (
      <section
        role="alert"
        className="rounded-xl border border-destructive p-5 text-destructive"
      >
        {configurationError}
      </section>
    );
  }
  const localizedView = path.startsWith("/identity/") ? (
    <IdentityIntlProvider
      locale={locale}
      messages={locale === "fr" ? french : english}
    >
      <Setup>{view}</Setup>
    </IdentityIntlProvider>
  ) : (
    view
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ProjectSelectionProvider instanceId={instanceId}>
        <FlowsProvider>
          {path === "/dashboard" ? (
            <LinkDialogProvider>{localizedView}</LinkDialogProvider>
          ) : (
            localizedView
          )}
        </FlowsProvider>
      </ProjectSelectionProvider>
    </QueryClientProvider>
  );
}

export function isDashboardViewPath(path: string): boolean {
  const canonical = canonicalViewPath(path);
  return canonical in ANALYTICS_KINDS || canonical in VIEW_FACTORIES;
}

function renderView(path: string): ReactNode {
  const analyticsKind = ANALYTICS_KINDS[path];
  if (analyticsKind) return <AnalyticsPage kind={analyticsKind} />;
  return VIEW_FACTORIES[path]?.() ?? null;
}

function canonicalViewPath(path: string): string {
  return path.replace(IDENTITY_LOCALE_PATH, "/identity/en");
}

function validViewConfiguration(
  pluginId: string,
  rendererId: string,
  bindings: DashboardViewRendererProps["bindings"]
): boolean {
  const namespace = `${pluginId}.`;
  return (
    rendererId.startsWith(`${namespace}renderer.`) &&
    bindings.data_sources.length > 0 &&
    bindings.data_sources.every((id) =>
      id.startsWith(`${namespace}data_source.`)
    ) &&
    bindings.commands.every((id) => id.startsWith(`${namespace}command.`))
  );
}
