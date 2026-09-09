import type { OperatorProjectScope } from "@superboard/contracts/site-operator";
import { createContext, useContext, type ReactNode } from "react";

export type PublicEndpoints = Partial<
	Record<"api" | "auth" | "sdk" | "shortlinks" | "files" | "mcp" | "site", string>
>;

export interface FrontOperator {
	id: string;
	email: string;
	name: string | null;
	role: number;
}

export interface PluginViewProps {
	parameters: Record<string, string>;
	path: string;
	locale: "en" | "fr";
}

export interface ConsoleEnvironment {
	id: string;
	application: string;
	label: string;
	environment: string;
	apiUrl: string;
	consoleUrl: string;
}

export interface FrontContextValue extends PluginViewProps {
	deployment?: ConsoleEnvironment | null;
	environments?: readonly ConsoleEnvironment[];
	publicEndpoints?: PublicEndpoints;
	instanceId: string;
	pluginId: string;
	operator: FrontOperator | null;
	projectScope: OperatorProjectScope | null;
	activePluginIds: readonly string[];
}

const FrontContext = createContext<FrontContextValue | null>(null);

export function FrontContextProvider({
	value,
	children,
}: {
	value: FrontContextValue;
	children: ReactNode;
}) {
	return <FrontContext.Provider value={value}>{children}</FrontContext.Provider>;
}

export function useOptionalFrontContext(): FrontContextValue | null {
	return useContext(FrontContext);
}

export function useFrontContext(): FrontContextValue {
	const value = useOptionalFrontContext();
	if (!value) throw new Error("Front context is missing");
	return value;
}

export function usePluginEnabled(pluginId: string): boolean {
	return useFrontContext().activePluginIds.includes(pluginId);
}
