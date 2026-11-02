import type { PluginContext, PluginDescriptor, ResolvedPlugin } from "emdash";
import { definePlugin } from "emdash";
import type { EmailDeliverEvent } from "emdash/plugin";

export interface CloudflareEmailConfig {
	binding?: string;

	from: string | { email: string; name?: string };

	replyTo?: string;
}

interface SendEmailBinding {
	send(message: {
		to: string | string[];
		from: { email: string; name?: string };
		subject: string;
		text?: string;
		html?: string;
		replyTo?: string;
	}): Promise<{ messageId?: string }>;
}

async function loadWorkerEnv(): Promise<Record<string, unknown>> {
	try {
		const mod = await import("cloudflare:workers");
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- Env is deployment-specific; the binding lookup validates the shape
		return mod.env as unknown as Record<string, unknown>;
	} catch {
		throw new Error(
			"[cloudflare-email] cloudflare:workers is not available — this provider " +
				"only runs on the Cloudflare Workers runtime (deployed or via astro dev " +
				"with the Cloudflare adapter).",
		);
	}
}

export function createCloudflareEmailDeliver(
	config: CloudflareEmailConfig,
	loadEnv: () => Promise<Record<string, unknown>> = loadWorkerEnv,
): (event: EmailDeliverEvent, ctx: PluginContext) => Promise<void> {
	const bindingName = config.binding ?? "EMAIL";
	const from = typeof config.from === "string" ? { email: config.from } : config.from;

	return async (event, ctx) => {
		const { message } = event;
		const env = await loadEnv();
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- Worker binding accessed from untyped env object; the send() check below validates the shape
		const binding = env[bindingName] as SendEmailBinding | undefined;
		if (!binding || typeof binding.send !== "function") {
			throw new Error(
				`[cloudflare-email] send_email binding "${bindingName}" not found — ` +
					`declare it in the wrangler config ("send_email": [{ "name": "${bindingName}" }]).`,
			);
		}

		const result = await binding.send({
			from,
			to: message.to,
			subject: message.subject,
			text: message.text,
			...(message.html ? { html: message.html } : {}),
			...(config.replyTo ? { replyTo: config.replyTo } : {}),
		});

		ctx.log.info("email delivered via Cloudflare Email Sending", {
			messageId: result?.messageId,
		});
	};
}

function assertValidFrom(config: CloudflareEmailConfig): void {
	const fromEmail = typeof config.from === "string" ? config.from : config.from?.email;
	if (!fromEmail || !fromEmail.includes("@")) {
		throw new Error(
			'[cloudflare-email] config.from is required (e.g. { from: "cms@mails.example.com" }) — ' +
				"Cloudflare Email Sending rejects messages without a verified sender address.",
		);
	}
}

export function createPlugin(config: CloudflareEmailConfig): ResolvedPlugin {
	assertValidFrom(config);
	return definePlugin({
		id: "cloudflare-email",
		version: "1.0.0",
		capabilities: ["hooks.email-transport:register"],
		hooks: {
			"email:deliver": {
				exclusive: true,
				handler: createCloudflareEmailDeliver(config),
			},
		},
	});
}

export function cloudflareEmail(
	config: CloudflareEmailConfig,
): PluginDescriptor<CloudflareEmailConfig> {
	assertValidFrom(config);
	return {
		id: "cloudflare-email",
		version: "1.0.0",
		entrypoint: "@emdash-cms/cloudflare/plugins/cloudflare-email",
		format: "native",
		options: config,
		capabilities: ["hooks.email-transport:register"],
	};
}

export default cloudflareEmail;
