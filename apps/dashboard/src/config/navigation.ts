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

import dashboardNavigation from "../../../../config/superboard-dashboard-navigation.json";

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

const SECTION_ICONS: Record<SectionSlug, LucideIcon> = {
  dashboard: LayoutDashboard,
  app: AppWindow,
  identity: Fingerprint,
  products: Boxes,
  flows: Workflow,
  "dynamic-links": Link2,
  support: LifeBuoy,
  marketing: Megaphone,
  analytics: ChartNoAxesCombined,
};
const IDENTITY_LOCALE_PATH = /^\/identity\/(?:en|fr)(?=\/|$)/;

export const DASHBOARD_SECTIONS: readonly DashboardSection[] =
  dashboardNavigation.sections.map((section) => {
    if (!isSectionSlug(section.slug)) {
      throw new TypeError(`Unknown Dashboard section: ${section.slug}`);
    }
    return {
      ...section,
      slug: section.slug,
      icon: SECTION_ICONS[section.slug],
    };
  });

export function sectionForPath(pathname: string) {
  return DASHBOARD_SECTIONS.find(
    (section) =>
      pathname === `/${section.slug}` ||
      pathname.startsWith(`/${section.slug}/`)
  );
}

export function pageForPath(pathname: string) {
  const section = sectionForPath(pathname);
  const comparablePath = pathname.replace(IDENTITY_LOCALE_PATH, "/identity/en");
  return (section?.pages ?? [])
    .toSorted((left, right) => right.href.length - left.href.length)
    .find(
      (item) =>
        comparablePath === item.href ||
        comparablePath.startsWith(`${item.href}/`)
    );
}

function isSectionSlug(value: string): value is SectionSlug {
  return Object.hasOwn(SECTION_ICONS, value);
}
