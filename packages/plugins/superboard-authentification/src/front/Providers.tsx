import type { PluginViewProps } from "@superboard/front-ui/context";
import type { ReactNode } from "react";

import IdentityIntlProvider from "./identity/IdentityIntlProvider.js";
import { useIdentityMessages } from "./identity/identityMessages.js";
import Setup from "./identity/Setup.js";

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
	return <IdentityProviders language={language}>{children}</IdentityProviders>;
}

function IdentityProviders({ language, children }: { language: string; children: ReactNode }) {
	const messages = useIdentityMessages(language);
	return (
		<IdentityIntlProvider locale={language} messages={messages}>
			<Setup>{children}</Setup>
		</IdentityIntlProvider>
	);
}
