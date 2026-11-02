import type { EmailDeliverEvent, EmailMessage, PluginContext } from "./types.js";

export const DEV_CONSOLE_EMAIL_PLUGIN_ID = "emdash-console-email";

const MAX_STORED_EMAILS = 100;

export interface StoredEmail {
	message: EmailMessage;
	source: string;
	sentAt: string;
}

const GLOBAL_KEY = Symbol.for("emdash:dev-emails");
const g = globalThis as Record<symbol, unknown>;
const storedEmails: StoredEmail[] = (() => {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- globalThis singleton pattern (see request-context.ts)
	const existing = g[GLOBAL_KEY] as StoredEmail[] | undefined;
	if (existing) return existing;
	const fresh: StoredEmail[] = [];
	g[GLOBAL_KEY] = fresh;
	return fresh;
})();

export function getDevEmails(): StoredEmail[] {
	return storedEmails.toReversed();
}

export function clearDevEmails(): void {
	storedEmails.length = 0;
}

export async function devConsoleEmailDeliver(
	event: EmailDeliverEvent,
	_ctx: PluginContext,
): Promise<void> {
	const { message, source } = event;

	console.log(
		`\n📧 [dev-email] Email sent\n` +
			`   From: ${source}\n` +
			`   To: ${message.to}\n` +
			`   Subject: ${message.subject}\n` +
			`   Text: ${message.text.slice(0, 200)}${message.text.length > 200 ? "..." : ""}\n`,
	);

	storedEmails.push({
		message,
		source,
		sentAt: new Date().toISOString(),
	});

	while (storedEmails.length > MAX_STORED_EMAILS) {
		storedEmails.shift();
	}
}
