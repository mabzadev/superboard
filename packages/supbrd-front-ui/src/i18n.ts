import { setupI18n } from "@lingui/core";
import { compileMessage } from "@lingui/message-utils/compileMessage";

export function createFrontI18n(options: Parameters<typeof setupI18n>[0]) {
	return setupI18n(options).setMessagesCompiler(compileMessage);
}
