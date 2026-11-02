export type DatabaseDialectType = "sqlite" | "postgres";

export type CollectionDeletionGuardInput =
	| {
			action: "fence";
			collectionId: string;
			collectionSlug: string;
			leaseToken: string;
			forceDelete: boolean;
	  }
	| {
			action: "drop";
			collectionId: string;
			collectionSlug: string;
			leaseToken: string;
	  };

export type CollectionDeletionGuardResult =
	| { outcome: "fenced" }
	| { outcome: "has_content" }
	| { outcome: "stale" }
	| { outcome: "dropped" };

export type ExecuteCollectionDeletionGuard = (
	config: unknown,
	input: CollectionDeletionGuardInput,
) => Promise<CollectionDeletionGuardResult>;

const ENVIRONMENT_VARIABLE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function migrationEnvironmentVariable(
	value: string | undefined,
	fallback: string,
	optionName: string,
): string {
	const name = value ?? fallback;
	if (!ENVIRONMENT_VARIABLE_PATTERN.test(name)) {
		throw new Error(`${optionName} must be a valid environment variable name.`);
	}
	return name;
}

export interface DatabaseDescriptor {
	entrypoint: string;
	config: unknown;
	type: DatabaseDialectType;
	migrations?: {
		entrypoint: string;
		manifestConfig: unknown;
	};
	supportsRequestScope?: boolean;
	needsLastContentWriteAt?: boolean;
	supportsCoalescing?: boolean;
	supportsCollectionDeletionGuard?: boolean;
}

export interface SqliteConfig {
	url: string;
}

export interface LibsqlConfig {
	url: string;
	authToken?: string;
	migrationAuthTokenEnv?: string;
}

export function sqlite(config: SqliteConfig): DatabaseDescriptor {
	return {
		entrypoint: "emdash/db/sqlite",
		config,
		type: "sqlite",
		migrations: {
			entrypoint: "emdash/db/sqlite-migrations",
			manifestConfig: { url: config.url },
		},
	};
}

export function libsql(config: LibsqlConfig): DatabaseDescriptor {
	const { migrationAuthTokenEnv, ...runtimeConfig } = config;
	return {
		entrypoint: "emdash/db/libsql",
		config: runtimeConfig,
		type: "sqlite",
		migrations: {
			entrypoint: "emdash/db/libsql-migrations",
			manifestConfig: {
				url: config.url,
				authTokenEnv: migrationEnvironmentVariable(
					migrationAuthTokenEnv,
					"TURSO_AUTH_TOKEN",
					"migrationAuthTokenEnv",
				),
			},
		},
	};
}

export interface PostgresConfig {
	connectionString?: string;
	host?: string;
	port?: number;
	database?: string;
	user?: string;
	password?: string;
	ssl?: boolean;
	pool?: { min?: number; max?: number };
	migrationConnectionStringEnv?: string;
}

export function postgres(config: PostgresConfig): DatabaseDescriptor {
	const { migrationConnectionStringEnv, ...runtimeConfig } = config;
	return {
		entrypoint: "emdash/db/postgres",
		config: runtimeConfig,
		type: "postgres",
		migrations: {
			entrypoint: "emdash/db/postgres-migrations",
			manifestConfig: {
				connectionStringEnv: migrationEnvironmentVariable(
					migrationConnectionStringEnv,
					"DATABASE_URL",
					"migrationConnectionStringEnv",
				),
			},
		},
	};
}
