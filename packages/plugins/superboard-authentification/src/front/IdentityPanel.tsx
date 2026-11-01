import { useFrontContext } from "@superboard/front-ui/context";
import type { ReactNode } from "react";

import IdentityIntlProvider from "./identity/IdentityIntlProvider.js";
import { useIdentityMessages } from "./identity/identityMessages.js";
import Setup from "./identity/Setup.js";

export default function IdentityPanel({ children }: { children: ReactNode }) {
	const { locale } = useFrontContext();
	const messages = useIdentityMessages(locale);
	return (
		<IdentityIntlProvider locale={locale} messages={messages}>
			<Setup>{children}</Setup>
		</IdentityIntlProvider>
	);
}
