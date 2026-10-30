import { useFrontContext } from "@superboard/front-ui/context";
import type { ReactNode } from "react";

import IdentityIntlProvider from "./identity/IdentityIntlProvider.js";
import Setup from "./identity/Setup.js";
import en from "./identity/translations/en.json";
import fr from "./identity/translations/fr.json";

export default function IdentityPanel({ children }: { children: ReactNode }) {
	const { locale } = useFrontContext();
	return (
		<IdentityIntlProvider locale={locale} messages={locale === "fr" ? fr : en}>
			<Setup>{children}</Setup>
		</IdentityIntlProvider>
	);
}
