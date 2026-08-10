"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, Earth, TestTubeDiagonal } from "lucide-react";
import { usePathname } from "next/navigation";

import { NavUser } from "@/components/layout/nav-user";
import { SectionNavigation } from "@/components/layout/section-navigation";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { PRODUCTION, TEST } from "@/constants/OptionsConstants";
import { useProjectSelection } from "@/context/useProjectSelection";

type AppHeaderProps = {
  hideEnvSelect?: boolean;
};

export default function AppHeader({ hideEnvSelect = false }: AppHeaderProps) {
  const pathname = usePathname();
  const { projectType, setProjectType } = useProjectSelection();
  const isAccountPage =
    pathname === "/account" || pathname.startsWith("/project-settings") || pathname.startsWith("/infrastructure");
  const showEnvironment = !hideEnvSelect && !isAccountPage;

  return (
    <header className="ds-header sticky top-0 w-full shrink-0">
      <SidebarTrigger
        className="ds-button ds-button-ghost ds-button-icon ds-mobile-menu size-8 md:hidden"
        aria-label="Open navigation"
        title="Navigation"
      />

      <SectionNavigation />

      <div className="ds-header-actions">
        {showEnvironment && (
          <Select value={projectType} onValueChange={setProjectType}>
            <SelectTrigger
              aria-label="Environment"
              className="h-8 w-auto min-w-0 rounded-[var(--radius-sm)] border-transparent bg-transparent px-2 shadow-none hover:bg-[var(--color-accent)] focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]"
            >
              <span className="flex items-center gap-2">
                {projectType === PRODUCTION ? (
                  <Earth className="size-4" />
                ) : (
                  <TestTubeDiagonal className="size-4" />
                )}
                <SelectValue placeholder="Select environment" />
              </span>
            </SelectTrigger>
            <SelectContent className="min-w-60 border-[var(--color-border)] bg-[var(--color-card)] p-1 shadow-none">
              <SelectGroup>
                <SelectLabel className="ds-picker-label">
                  Environment
                </SelectLabel>
                <EnvironmentOption
                  value={PRODUCTION}
                  icon={<Earth className="size-4" />}
                  description="Live data from real users"
                />
                <EnvironmentOption
                  value={TEST}
                  icon={<TestTubeDiagonal className="size-4" />}
                  description="Sandbox for testing and development"
                />
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
        <NavUser />
      </div>
    </header>
  );
}

function EnvironmentOption({
  value,
  icon,
  description,
}: {
  value: string;
  icon: React.ReactNode;
  description: string;
}) {
  return (
    <SelectPrimitive.Item value={value} className="ds-picker-item outline-none">
      {icon}
      <span className="ds-workspace-copy">
        <SelectPrimitive.ItemText>
          <span className="text-sm font-medium">{value}</span>
        </SelectPrimitive.ItemText>
        <span className="ds-workspace-name">{description}</span>
      </span>
      <SelectPrimitive.ItemIndicator className="ml-auto">
        <Check className="size-4" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}
