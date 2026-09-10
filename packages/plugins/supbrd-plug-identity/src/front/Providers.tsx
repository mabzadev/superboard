import type { PluginViewProps } from "@superboard/front-ui/context";
import type { ReactNode } from "react";

import IdentityIntlProvider from "./identity/IdentityIntlProvider.js";
import Setup from "./identity/Setup.js";
import en from "./identity/translations/en.json";
import fr from "./identity/translations/fr.json";

export function Providers({
	path,
	parameters,
	locale,
	children,
}: PluginViewProps & { children: ReactNode }) {
	if (path !== "/identity" && !path.startsWith("/identity/")) return children;
	const language = parameters.lang === "fr" || parameters.lang === "en" ? parameters.lang : locale;
	return (
		<IdentityIntlProvider locale={language} messages={language === "fr" ? fr : en}>
			<Setup>{children}</Setup>
		</IdentityIntlProvider>
	);
}
