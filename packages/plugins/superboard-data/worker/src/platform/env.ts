import type { FilesEnv } from "../index.js";

export type DataEnv = FilesEnv & {
	FILES_INTERNAL_TOKEN_PREVIOUS?: string;
	FILES_DOWNLOAD_SIGNING_KEY_PREVIOUS?: string;
	DATA_ENCRYPTION_KEY?: string;
	DATA_PUBLIC_ORIGIN?: string;
	REALTIME?: DurableObjectNamespace;
	LOADER?: WorkerLoader;
	IMAGES?: ImagesBinding;
	AI?: Ai;
	VECTORS?: Vectorize;
};

export interface Deferral {
	waitUntil(promise: Promise<unknown>): void;
}

export const immediate: Deferral = {
	waitUntil(promise) {
		void promise.catch((cause: unknown) => {
			console.error("[data] deferred task failed", cause);
		});
	},
};
