import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { d1, r2, sandbox } from "@emdash-cms/cloudflare";
import { cloudflareEmail } from "@emdash-cms/cloudflare/plugins";
import { defineConfig } from "astro/config";
import emdash from "emdash/astro";

import { superboardReleaseOperatorApi } from "./release-operator-api.mjs";
import { superboardConfiguredPlugins } from "./superboard-emdash-plugins.mjs";

const emailFromAddress = process.env.SUPERBOARD_SITE_EMAIL_FROM_ADDRESS ?? "noreply@localhost";
const emailFromName = process.env.SUPERBOARD_SITE_EMAIL_FROM_NAME ?? "SuperBoard";
const emailReplyTo = process.env.SUPERBOARD_SITE_EMAIL_REPLY_TO || undefined;
export default defineConfig({
	output: "server",
	adapter: cloudflare(),
	integrations: [
		react(),
		superboardReleaseOperatorApi(),
		emdash({
			database: d1({ binding: "DB", session: "disabled" }),
			storage: r2({ binding: "MEDIA" }),
			plugins: [
				cloudflareEmail({
					from: { email: emailFromAddress, name: emailFromName },
					replyTo: emailReplyTo,
				}),
			],
			sandboxed: [...superboardConfiguredPlugins],
			sandboxRunner: sandbox(),
		}),
	],
	devToolbar: { enabled: false },
	security: { checkOrigin: true },
});
