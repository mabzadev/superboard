"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { pageForPath, sectionForPath } from "@/config/navigation";

export function SectionNavigation() {
  const pathname = usePathname();
  const section = sectionForPath(pathname);
  const currentPage = pageForPath(pathname);

  if (!section || section.pages.length <= 1) return null;

  return (
    <nav
      aria-label={`${section.label} pages`}
      className="ds-topnav ds-context-nav min-w-0 flex-1 overflow-x-auto"
    >
      {section.pages.map((item) => {
        const active = currentPage?.href === item.href;
        const locale = pathname.match(/^\/identity\/(en|fr)(?:\/|$)/)?.[1];
        const href = locale
          ? item.href.replace("/identity/en", `/identity/${locale}`)
          : item.href;
        return (
          <Link
            key={item.href}
            href={href}
            aria-current={active ? "page" : undefined}
            className="ds-topnav-link shrink-0"
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
