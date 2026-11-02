import { AsyncLocalStorage } from "node:async_hooks";

import type { HookPipeline } from "./hooks.js";
import type { EmailDeliverEvent, EmailMessage } from "./types.js";

const EMAIL_DELIVER_HOOK = "email:deliver";

const SYSTEM_SOURCE = "system";

export class EmailNotConfiguredError extends Error {
	constructor() {
		super(
			"No email provider is configured. Install and activate an email provider plugin, " +
				"then select it in Settings > Email.",
		);
		this.name = "EmailNotConfiguredError";
	}
}

export class EmailRecursionError extends Error {
	constructor() {
		super(
			"Recursive email send detected. A plugin hook attempted to send an email " +
				"from within the email pipeline, which would cause infinite recursion.",
		);
		this.name = "EmailRecursionError";
	}
}

const emailSendALS = new AsyncLocalStorage<{ depth: number }>();

export class EmailPipeline {
	private pipeline: HookPipeline;

	constructor(pipeline: HookPipeline) {
		this.pipeline = pipeline;
	}

	setPipeline(pipeline: HookPipeline): void {
		this.pipeline = pipeline;
	}

	async send(message: EmailMessage, source: string): Promise<void> {
		const store = emailSendALS.getStore();
		if (store && store.depth > 0) {
			throw new EmailRecursionError();
		}

		const run = () => this.sendInner(message, source);
		if (store) {
			store.depth++;
			try {
				await run();
			} finally {
				store.depth--;
			}
		} else {
			await emailSendALS.run({ depth: 1 }, run);
		}
	}

	private async sendInner(message: EmailMessage, source: string): Promise<void> {
		if (!message || typeof message !== "object") {
			throw new Error("Invalid email message: message must be an object");
		}
		if (!message.to || typeof message.to !== "string") {
			throw new Error("Invalid email message: 'to' is required and must be a string");
		}
		if (!message.subject || typeof message.subject !== "string") {
			throw new Error("Invalid email message: 'subject' is required and must be a string");
		}
		if (!message.text || typeof message.text !== "string") {
			throw new Error("Invalid email message: 'text' is required and must be a string");
		}

		const isSystemEmail = source === SYSTEM_SOURCE;

		let finalMessage: EmailMessage;
		if (isSystemEmail) {
			finalMessage = message;
		} else {
			const beforeResult = await this.pipeline.runEmailBeforeSend(message, source);

			if (beforeResult.message === false) {
				const cancellingResult = beforeResult.results.find((r) => r.value === false);
				const cancelledBy = cancellingResult?.pluginId ?? "unknown";

				console.info(`[email] Email to "${message.to}" cancelled by plugin "${cancelledBy}"`);
				return;
			}

			finalMessage = beforeResult.message;
		}

		const deliverEvent: EmailDeliverEvent = { message: finalMessage, source };
		const deliverResult = await this.pipeline.invokeExclusiveHook(EMAIL_DELIVER_HOOK, deliverEvent);

		if (!deliverResult) {
			throw new EmailNotConfiguredError();
		}

		if (deliverResult.error) {
			throw deliverResult.error;
		}

		if (!isSystemEmail) {
			this.pipeline
				.runEmailAfterSend(finalMessage, source)
				.catch((err) =>
					console.error(
						"[email] afterSend pipeline error:",
						err instanceof Error ? err.message : err,
					),
				);
		}
	}

	isAvailable(): boolean {
		return this.pipeline.getExclusiveSelection(EMAIL_DELIVER_HOOK) !== undefined;
	}
}
