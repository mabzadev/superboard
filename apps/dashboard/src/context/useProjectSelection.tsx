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

interface ProjectSelectionProviderProps {
  children: ReactNode;
  instanceId?: string;
  productionProjectRef?: string;
  testProjectRef?: string;
}

export function ProjectSelectionProvider({
  children,
  instanceId,
  productionProjectRef,
  testProjectRef,
}: ProjectSelectionProviderProps) {
  const siteSelection = useMemo(() => {
    if (!instanceId) return null;
    const domain = globalThis.location?.hostname ?? "local";
    const production: Project = {
      id: productionProjectRef ?? `${instanceId}-prod`,
      name: "Production",
      domain,
    };
    const test: Project = {
      id: testProjectRef ?? `${instanceId}-test`,
      name: "Test",
      domain,
    };
    const selectedInstance: Instance = {
      id: productionProjectRef?.match(/^(\d+)-prod$/u)?.[1] ?? instanceId,
      name: instanceId,
      role: "owner",
      updated_at: new Date(0).toISOString(),
      created_at: new Date(0).toISOString(),
      revenue_collection_enabled: true,
      get_started_dismissed: true,
      projects: [production, test],
      api_key: "",
      hash_id: instanceId,
      uri_scheme: instanceId,
      production,
      test,
    };
    return { selectedInstance, selectedProject: production };
  }, [instanceId, productionProjectRef, testProjectRef]);
  const [selectedInstance, setSelectedInstance] = useState<
    Instance | undefined
  >(siteSelection?.selectedInstance);
  const [selectedProject, setSelectedProject] = useState<Project | undefined>(
    siteSelection?.selectedProject
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
