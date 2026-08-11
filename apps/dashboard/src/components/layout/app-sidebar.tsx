"use client";

import * as React from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { NavMain } from "@/components/layout/nav-main";
import { ProjectSwitcher } from "@/components/layout/team-switcher";
import { DASHBOARD_SECTIONS } from "@/config/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { state, toggleSidebar } = useSidebar();
  const isExpanded = state === "expanded";

  return (
    <Sidebar
      collapsible="icon"
      aria-label="Main navigation"
      className="border-[var(--color-border)] bg-[var(--color-sidebar-background)]"
      {...props}
    >
      <SidebarHeader className="ds-sidebar-header flex-row gap-2 p-0">
        <ProjectSwitcher />
      </SidebarHeader>
      <SidebarContent className="bg-[var(--color-sidebar-background)]">
        <NavMain items={DASHBOARD_SECTIONS} />
      </SidebarContent>
      <SidebarFooter className="ds-sidebar-footer gap-0 p-0">
        <SidebarMenu aria-label="Sidebar display">
          <SidebarMenuItem>
            <SidebarMenuButton
              className="ds-sidebar-link ds-sidebar-collapse"
              tooltip={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
              aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
              onClick={toggleSidebar}
            >
              {isExpanded ? <PanelLeftClose /> : <PanelLeftOpen />}
              <span className="ds-sidebar-link-label">Collapse</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
