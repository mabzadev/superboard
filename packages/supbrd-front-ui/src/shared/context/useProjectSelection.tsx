import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react";

import { useFrontContext } from "../../context.js";
import type { GetStartedSetup, Instance, Project } from "../types/index.js";

interface ProjectSelection {
	ready?: boolean;
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
	const { projectScope, operator, instanceId } = useFrontContext();
	const source = projectScope?.instance;
	const storageKey = `superboard:${instanceId}:environment`;
	const [ready, setReady] = useState(false);
	const [selectedInstance, setSelectedInstance] = useState<Instance | undefined>(() =>
		source
			? {
					...source,
					role: operator?.role === 50 ? "owner" : "admin",
				}
			: undefined,
	);
	const [selectedProject, updateProject] = useState<Project | undefined>();
	const [projectType, updateProjectType] = useState("production");
	const [getStartedSetup, setGetStartedSetup] = useState<GetStartedSetup>();
	useEffect(() => {
		let environment = "production";
		try {
			if (localStorage.getItem(storageKey) === "test") environment = "test";
		} catch {
			environment = "production";
		}
		setSelectedInstance(
			source ? { ...source, role: operator?.role === 50 ? "owner" : "admin" } : undefined,
		);
		updateProjectType(environment);
		updateProject(environment === "test" ? source?.test : source?.production);
		setReady(true);
	}, [source, storageKey, operator?.role]);
	const setProjectType = useCallback(
		(value: string) => {
			const environment = value === "test" ? "test" : "production";
			updateProjectType(environment);
			updateProject(environment === "test" ? source?.test : source?.production);
			try {
				localStorage.setItem(storageKey, environment);
			} catch {
				return;
			}
		},
		[source, storageKey],
	);
	const setSelectedProject = useCallback(
		(value: Project | undefined) => {
			if (value && value.id !== source?.production.id && value.id !== source?.test.id)
				throw new Error("Project scope mismatch");
			if (value) setProjectType(value.id === source?.test.id ? "test" : "production");
			updateProject(value);
		},
		[source, setProjectType],
	);
	const value = useMemo(
		() => ({
			ready,
			selectedInstance,
			setSelectedInstance,
			selectedProject,
			setSelectedProject,
			projectType,
			setProjectType,
			getStartedSetup,
			setGetStartedSetup,
		}),
		[
			selectedInstance,
			selectedProject,
			projectType,
			getStartedSetup,
			ready,
			setProjectType,
			setSelectedProject,
		],
	);
	return <Selection.Provider value={value}>{children}</Selection.Provider>;
}

export function useProjectSelection() {
	const value = useContext(Selection);
	if (!value) throw new Error("Canonical project scope is unavailable");
	return value;
}
