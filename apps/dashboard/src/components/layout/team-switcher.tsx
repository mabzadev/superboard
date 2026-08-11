"use client";

import { ChevronsUpDown, GalleryVerticalEnd, Plus, Search } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useProjectSelection } from "@/context/useProjectSelection";
import { useCreateInstanceMutation } from "@/hooks/mutations/useInstanceMutations";
import { useInstancesQuery } from "@/hooks/queries/useInstanceQueries";
import type { Instance } from "@/types";
import ProjectFormDialog from "../sidebar/ProjectFormDialog";
import { useState } from "react";
import { showGenericError } from "@/lib/Notifications";
import { trackEvent, EVENTS } from "@/analytics";

export function ProjectSwitcher() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const { setSelectedInstance, selectedInstance } = useProjectSelection();

  const { data: instances } = useInstancesQuery();

  const createInstanceMutation = useCreateInstanceMutation();

  const { isMobile } = useSidebar();
  const handleSelectInstance = (instance: Instance) => {
    setSelectedInstance(instance);
  };

  const handleCreateInstance = async (
    projectName: string,
    members: {
      email: string;
      role: string;
    }[]
  ) => {
    const parsedMembers = members.map((item) => ({
      ...item,
      role: item.role, // in case it's a SelectItem object
    }));

    try {
      const response = await createInstanceMutation.mutateAsync({
        name: projectName,
        members: parsedMembers,
      });
      const instance = response.data.instance;
      trackEvent(EVENTS.PROJECT_CREATED, { projectName });
      setSelectedInstance(instance);
      // No need to manually refetch instances — the mutation auto-invalidates the query
      setDialogOpen(false);
    } catch {
      showGenericError();
    }
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu
          onOpenChange={(open) => {
            if (!open) setSearchTerm("");
          }}
        >
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="h-10! p-0! hover:bg-transparent data-[state=open]:bg-transparent group-data-[collapsible=icon]:size-8!"
            >
              <span className="ds-brand-mark">
                <GalleryVerticalEnd className="size-4" />
              </span>
              <span className="ds-workspace-copy flex-1 text-left group-data-[collapsible=icon]:hidden">
                <strong className="ds-application-name">SuperBoard</strong>
                <small className="ds-workspace-name">
                  {selectedInstance?.production?.name ?? "Select project"}
                </small>
              </span>
              <ChevronsUpDown className="ml-auto size-3.5 group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="min-w-56 rounded-[var(--radius)] border-[var(--color-border)] bg-[var(--color-card)] shadow-none"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuItem
              className="ds-picker-item"
              onSelect={() => {
                setDialogOpen(true);
              }}
            >
              <div className="flex size-6 items-center justify-center rounded-[var(--radius-sm)] border bg-transparent">
                <Plus className="size-4" />
              </div>
              <div className="text-muted-foreground font-medium">
                Add Project
              </div>
            </DropdownMenuItem>

            <DropdownMenuSeparator className="ds-divider ds-picker-separator" />
            <DropdownMenuLabel className="ds-picker-label">
              Projects
            </DropdownMenuLabel>
            {(instances?.length ?? 0) > 10 && (
              <div className="px-2 pb-2">
                <div className="flex items-center gap-2 rounded-md border border-sidebar-border px-2 py-1.5">
                  <Search className="size-3.5 text-muted-foreground shrink-0" />
                  <input
                    type="text"
                    placeholder="Search projects..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </div>
              </div>
            )}
            <div className="max-h-[calc(100vh-200px)] overflow-y-auto">
              {instances
                ?.filter((project: Instance) =>
                  searchTerm === ""
                    ? true
                    : project.production.name
                        .toLowerCase()
                        .includes(searchTerm.toLowerCase())
                )
                .map((project: Instance) => (
                  <DropdownMenuItem
                    key={project.id}
                    onClick={() => handleSelectInstance(project)}
                    className="ds-picker-item"
                  >
                    {project.production.name}
                  </DropdownMenuItem>
                ))}
              {(instances?.length ?? 0) > 10 &&
                searchTerm !== "" &&
                instances?.filter((project: Instance) =>
                  project.production.name
                    .toLowerCase()
                    .includes(searchTerm.toLowerCase())
                ).length === 0 && (
                  <p className="text-xs text-muted-foreground/60 text-center py-3">
                    No projects found
                  </p>
                )}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
        <ProjectFormDialog
          variant="new-project"
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          handleCreateProject={handleCreateInstance}
        />
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
