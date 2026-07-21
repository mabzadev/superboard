"use client";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PRODUCTION, TEST } from "@/constants/OptionsConstants";
import { SidebarHeader, SidebarTrigger } from "../../ui/sidebar";
import { useProjectSelection } from "@/context/useProjectSelection";
import { Earth, TestTubeDiagonal } from "lucide-react";
import { Separator } from "../../ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../../ui/breadcrumb";

const LinksHeader = () => {
  const { projectType, setProjectType } = useProjectSelection();

  return (
    <SidebarHeader className="flex flex-row items-center px-6 py-4">
      <SidebarTrigger className="-ml-1" />
      <div className="flex w-full h-full p-2 gap-4 ">
        <Separator orientation="vertical" />
        <Breadcrumb className="flex items-center ">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <BreadcrumbPage>Dynamic Links</BreadcrumbPage>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <BreadcrumbPage>Links</BreadcrumbPage>
              </BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      <div className="flex ml-auto gap-4">
        <Select
          value={projectType}
          onValueChange={(value) => setProjectType(value)}
        >
          <SelectTrigger className="w-auto bg-secondary border-none shadow-none">
            <div className="flex items-center gap-2 text-secondary-foreground">
              {projectType === PRODUCTION && (
                <Earth className="w-4 h-4 text-secondary-foreground" />
              )}
              {projectType === TEST && (
                <TestTubeDiagonal className="w-4 h-4 text-secondary-foreground" />
              )}
              <span>{projectType}</span>
            </div>

            <Separator orientation="vertical" className="ml-auto" />
            {!projectType && <SelectValue placeholder="Select Env" />}
          </SelectTrigger>
          <SelectContent className="bg-secondary border-none">
            <SelectGroup>
              <SelectLabel>Env</SelectLabel>
              <SelectItem value={PRODUCTION} className="focus:bg-background">
                <Earth className="w-4 h-4 text-secondary-foreground" />
                Production
              </SelectItem>
              <SelectItem value={TEST} className="focus:bg-background">
                <TestTubeDiagonal className="w-4 h-4 text-secondary-foreground" />
                Test
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </SidebarHeader>
  );
};

export default LinksHeader;
