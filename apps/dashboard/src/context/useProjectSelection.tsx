"use client";

import {
  createContext,
  useState,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { PRODUCTION } from "@/constants/OptionsConstants";
import type { Instance, Project, GetStartedSetup } from "@/types";

interface ProjectSelectionContextType {
  selectedInstance: Instance | undefined;
  setSelectedInstance: (instance: Instance | undefined) => void;
  selectedProject: Project | undefined;
  setSelectedProject: (project: Project | undefined) => void;
  projectType: string;
  setProjectType: (value: string) => void;
  getStartedSetup: GetStartedSetup | undefined;
  setGetStartedSetup: (setup: GetStartedSetup | undefined) => void;
}

const ProjectSelectionContext = createContext<
  ProjectSelectionContextType | undefined
>(undefined);

export function ProjectSelectionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [selectedInstance, setSelectedInstance] = useState<
    Instance | undefined
  >(undefined);
  const [selectedProject, setSelectedProject] = useState<Project | undefined>(
    undefined
  );
  const [projectType, setProjectType] = useState<string>(PRODUCTION);
  const [getStartedSetup, setGetStartedSetup] = useState<
    GetStartedSetup | undefined
  >(undefined);

  const value = useMemo(
    () => ({
      selectedInstance,
      setSelectedInstance,
      selectedProject,
      setSelectedProject,
      projectType,
      setProjectType,
      getStartedSetup,
      setGetStartedSetup,
    }),
    [selectedInstance, selectedProject, projectType, getStartedSetup]
  );

  return (
    <ProjectSelectionContext.Provider value={value}>
      {children}
    </ProjectSelectionContext.Provider>
  );
}

export const useProjectSelection = () => {
  const ctx = useContext(ProjectSelectionContext);
  if (!ctx)
    throw new Error(
      "useProjectSelection must be used within ProjectSelectionProvider"
    );
  return ctx;
};
