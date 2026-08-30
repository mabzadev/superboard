import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

interface Project {
	id: string;
	name: string;
	domain: string;
}

interface Instance {
	id: string;
	name: string;
	role: "owner" | "admin" | "member";
	updated_at: string;
	created_at: string;
	revenue_collection_enabled: boolean;
	get_started_dismissed: boolean;
	projects: Project[];
	api_key: string;
	hash_id: string;
	uri_scheme: string;
	production: Project;
	test: Project;
}

interface GetStartedSetup {
	android_sdk: boolean;
	ios_sdk: boolean;
	web_sdk: boolean;
	has_created_campaigns: boolean;
	has_created_links: boolean;
	redirect_fallback: boolean;
}

interface ProjectSelectionContextValue {
	selectedInstance: Instance | undefined;
	setSelectedInstance: (instance: Instance | undefined) => void;
	selectedProject: Project | undefined;
	setSelectedProject: (project: Project | undefined) => void;
	projectType: string;
	setProjectType: (value: string) => void;
	getStartedSetup: GetStartedSetup | undefined;
	setGetStartedSetup: (setup: GetStartedSetup | undefined) => void;
}

const ProjectSelectionContext = createContext<ProjectSelectionContextValue | undefined>(undefined);

export function ProjectSelectionProvider({
	children,
	instanceId = "local",
}: {
	children: ReactNode;
	instanceId?: string;
}) {
	const production = useMemo<Project>(
		() => ({
			id: instanceId,
			name: "Production",
			domain: globalThis.location?.hostname ?? "local",
		}),
		[instanceId],
	);
	const test = useMemo<Project>(
		() => ({
			id: `${instanceId}-test`,
			name: "Test",
			domain: globalThis.location?.hostname ?? "local",
		}),
		[instanceId],
	);
	const initialInstance = useMemo<Instance>(
		() => ({
			id: instanceId,
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
		}),
		[instanceId, production, test],
	);
	const [selectedInstance, setSelectedInstance] = useState<Instance | undefined>(initialInstance);
	const [selectedProject, setSelectedProject] = useState<Project | undefined>(production);
	const [projectType, setProjectType] = useState("production");
	const [getStartedSetup, setGetStartedSetup] = useState<GetStartedSetup | undefined>();
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
	return (
		<ProjectSelectionContext.Provider value={value}>{children}</ProjectSelectionContext.Provider>
	);
}

export function useProjectSelection() {
	const context = useContext(ProjectSelectionContext);
	if (!context) throw new Error("useProjectSelection must be used within ProjectSelectionProvider");
	return context;
}
