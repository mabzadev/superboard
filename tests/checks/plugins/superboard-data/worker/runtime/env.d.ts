declare module "cloudflare:test" {
	interface ProvidedEnv {
		DB: D1Database;
		FILES: R2Bucket;
		REALTIME: DurableObjectNamespace;
		LOADER: WorkerLoader;
		FILES_INTERNAL_TOKEN: string;
		FILES_DOWNLOAD_SIGNING_KEY: string;
		DATA_ENCRYPTION_KEY: string;
		TEST_SIGNING_JWK: string;
		TEST_MIGRATIONS: D1Migration[];
	}
}
