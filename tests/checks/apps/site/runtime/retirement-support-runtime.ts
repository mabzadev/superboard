import { ConversationRoom } from "../../../../../packages/plugins/supbrd-plug-support/worker/src/conversation-room.js";
import type { Env } from "../../../../../packages/plugins/supbrd-plug-support/worker/src/types.js";
type Bindings = Env & { HEALTH_SUPPORT_DB: D1Database };
export class RetirementSupportConversationRoom extends ConversationRoom {
	constructor(state: DurableObjectState, env: Bindings) {
		super(state, {
			...env,
			DB: env.HEALTH_SUPPORT_DB,
			INTERNAL_API_TOKEN: "runtime-module-secret",
		});
	}
}
