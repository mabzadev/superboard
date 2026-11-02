import * as React from "react";
import { createContext, useContext } from "react";

export interface AdminBranding {
	logo?: string;
	siteName?: string;
}

const AdminBrandingContext = createContext<AdminBranding>({});

export interface AdminBrandingProviderProps {
	children: React.ReactNode;
	adminBranding: AdminBranding;
}

export function AdminBrandingProvider({ children, adminBranding }: AdminBrandingProviderProps) {
	return (
		<AdminBrandingContext.Provider value={adminBranding}>{children}</AdminBrandingContext.Provider>
	);
}

export function useAdminBranding(): AdminBranding {
	return useContext(AdminBrandingContext);
}
