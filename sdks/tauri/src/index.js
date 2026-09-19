import { SuperBoardClient } from "@superboard/web/client";
import { fetch as nativeFetch } from "@tauri-apps/plugin-http";

export class SuperBoardTauri extends SuperBoardClient {
	constructor(options) {
		super({
			...options,
			platform: "web",
			fetch: options.fetch ?? ((url, init) => nativeFetch(url, { ...init, maxRedirections: 0 })),
		});
	}
}
export { SuperBoardClient };

export * from "@superboard/web/support";
