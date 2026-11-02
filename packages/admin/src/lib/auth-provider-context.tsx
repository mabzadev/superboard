import * as React from "react";
import { createContext, useContext } from "react";

export interface AuthProviderModule {
	id: string;
	label: string;
	LoginButton?: React.ComponentType<{ inviteToken?: string }>;
	LoginForm?: React.ComponentType;
	SetupStep?: React.ComponentType<{ onComplete: () => void }>;
}

export type AuthProviders = Record<string, AuthProviderModule>;

const AuthProviderContext = createContext<AuthProviders>({});

export interface AuthProviderContextProps {
	children: React.ReactNode;
	authProviders: AuthProviders;
}

export function AuthProviderProvider({ children, authProviders }: AuthProviderContextProps) {
	return (
		<AuthProviderContext.Provider value={authProviders}>{children}</AuthProviderContext.Provider>
	);
}

export function useAuthProviders(): AuthProviders {
	return useContext(AuthProviderContext);
}

export function useAuthProviderList(): AuthProviderModule[] {
	const providers = useContext(AuthProviderContext);
	const list = Object.values(providers);
	return list.toSorted((a, b) => {
		const aHasForm = a.LoginForm ? 1 : 0;
		const bHasForm = b.LoginForm ? 1 : 0;
		return aHasForm - bHasForm;
	});
}
