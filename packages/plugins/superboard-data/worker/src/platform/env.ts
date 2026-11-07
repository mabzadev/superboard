import type { FilesEnv } from "../index.js";

type OptionalBinding = "REALTIME" | "LOADER" | "IMAGES" | "AI" | "VECTORS" | "DATA_PUBLIC_ORIGIN";

export type DataEnv = Omit<FilesEnv, OptionalBinding> &
	Partial<Pick<FilesEnv, OptionalBinding>> & {
		FILES_INTERNAL_TOKEN_PREVIOUS?: string;
		FILES_DOWNLOAD_SIGNING_KEY_PREVIOUS?: string;
		DATA_ENCRYPTION_KEY?: string;
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
