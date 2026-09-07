import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { useFrontContext } from "../../context.js";
import type { GetStartedSetup, Instance, Project } from "../types/index.js";

interface ProjectSelection {
	selectedInstance: Instance | undefined;
	setSelectedInstance(value: Instance | undefined): void;
	selectedProject: Project | undefined;
	setSelectedProject(value: Project | undefined): void;
	projectType: string;
	setProjectType(value: string): void;
	getStartedSetup: GetStartedSetup | undefined;
	setGetStartedSetup(value: GetStartedSetup | undefined): void;
}
const Selection = createContext<ProjectSelection | null>(null);

export function ProjectSelectionProvider({
	children,
}: {
	children: ReactNode;
	instanceId?: string;
	productionProjectRef?: string;
	testProjectRef?: string;
}) {
	const { projectScope, operator } = useFrontContext();
	const source = projectScope?.instance;
	const [selectedInstance, setSelectedInstance] = useState<Instance | undefined>(() =>
		source
			? {
					...source,
					role: operator?.role === 50 ? "owner" : "admin",
				}
			: undefined,
	);
	const [selectedProject, setSelectedProject] = useState<Project | undefined>(
		() => source?.production,
	);
	const [projectType, setProjectType] = useState("production");
	const [getStartedSetup, setGetStartedSetup] = useState<GetStartedSetup>();
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
		[selectedInstance, selectedProject, projectType, getStartedSetup],
	);
	return <Selection.Provider value={value}>{children}</Selection.Provider>;
}

export function useProjectSelection() {
	const value = useContext(Selection);
	if (!value) throw new Error("Canonical project scope is unavailable");
	return value;
}
