export interface AuthResult {
	email: string;
	name: string;
	role: number;
	subject?: string;
	metadata?: Record<string, unknown>;
}

export interface AuthDescriptor {
	type: string;

	entrypoint: string;

	config: unknown;
}

export interface AuthProviderModule {
	authenticate(request: Request, config: unknown): Promise<AuthResult>;
}

export interface AuthProviderDescriptor {
	id: string;

	label: string;

	config?: unknown;

	adminEntry?: string;

	routes?: AuthRouteDescriptor[];

	publicRoutes?: string[];

	storage?: Record<
		string,
		{ indexes?: Array<string | string[]>; uniqueIndexes?: Array<string | string[]> }
	>;
}

export interface AuthRouteDescriptor {
	pattern: string;
	entrypoint: string;
}

export interface AuthProviderAdminExports {
	LoginButton?: import("react").ComponentType;

	LoginForm?: import("react").ComponentType;

	SetupStep?: import("react").ComponentType<{ onComplete: () => void }>;
}

export interface ExternalAuthConfig {
	autoProvision?: boolean;

	defaultRole?: number;

	syncRoles?: boolean;

	roleMapping?: Record<string, number>;
}
