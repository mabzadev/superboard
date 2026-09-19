import { createContext, useContext, type ReactNode } from "react";

const SectionNavigationContext = createContext<ReactNode>(null);

export const SectionNavigationProvider = SectionNavigationContext.Provider;

export function SectionNavigation() {
	return useContext(SectionNavigationContext);
}
