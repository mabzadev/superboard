import { AuthProvider as ReactAuthProvider } from "@melody-auth/react";
import { ProviderConfig, StorageType } from "@melody-auth/shared";
import { ReactNode } from "react";

import { CookieOptions } from "./storage/index";

export interface NextAuthProviderProps extends Omit<ProviderConfig, "serverUri" | "storage"> {
	children: ReactNode;
	serverUrl: string;
	storage?: StorageType;
	cookieOptions?: CookieOptions;
}

export const NextAuthProvider = ({
	children,
	serverUrl,
	storage = "cookieStorage",
	...config
}: NextAuthProviderProps) => {
	const reactConfig: ProviderConfig = {
		...config,
		serverUri: serverUrl,
		storage,
	};

	return <ReactAuthProvider {...reactConfig}>{children}</ReactAuthProvider>;
};
