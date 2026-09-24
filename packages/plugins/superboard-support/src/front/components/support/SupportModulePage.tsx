import { ModulePage } from "@superboard/front-ui/modules/ModulePage.js";
import { SectionNavigationProvider } from "@superboard/front-ui/section-navigation.js";
import { createContext, useContext, type ComponentProps } from "react";

import { SupportError } from "./SupportUi.js";

const EmbeddedContext = createContext(false);
export function SupportDetail({ children }: { children: React.ReactNode }) {
	return (
		<EmbeddedContext.Provider value={true}>
			<SectionNavigationProvider value={null}>{children}</SectionNavigationProvider>
		</EmbeddedContext.Provider>
	);
}
export function SupportModulePage(props: ComponentProps<typeof ModulePage>) {
	const embedded = useContext(EmbeddedContext);
	return embedded ? (
		<section className="space-y-4">
			<SupportError message={props.error ?? null} />
			{props.children}
		</section>
	) : (
		<ModulePage {...props} />
	);
}
