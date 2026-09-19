import { SuperBoardClient, type SuperBoardClientOptions } from "@superboard/web/client";
export class SuperBoardTauri extends SuperBoardClient {
	constructor(options: Omit<SuperBoardClientOptions, "platform">);
}
export { SuperBoardClient };

export * from "@superboard/web/support";
