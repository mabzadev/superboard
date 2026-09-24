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
	const isIdentity =
		path === "/identity" ||
		path.startsWith("/identity/") ||
		path === "/auth" ||
		/^\/auth\/(?:directory|apps|roles|scopes|orgs|saml|logs|user-attributes|account-policies)(?:\/|$)/u.test(
			path,
		);
	if (!isIdentity || path === "/auth" || path === "/identity") return children;
	if (path.endsWith("/settings")) return children;
	const language = parameters.lang === "fr" || parameters.lang === "en" ? parameters.lang : locale;
	return (
		<IdentityIntlProvider locale={language} messages={language === "fr" ? fr : en}>
			<Setup>{children}</Setup>
		</IdentityIntlProvider>
	);
}
