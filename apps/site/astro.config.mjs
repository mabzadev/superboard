import { fileURLToPath } from "node:url";

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
const dashboardSource = fileURLToPath(new URL("../dashboard/src", import.meta.url));
const compatSource = fileURLToPath(new URL("./src/compat", import.meta.url));

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
	vite: {
		resolve: {
			alias: [
				{
					find: "@/context/useProjectSelection",
					replacement: `${compatSource}/dashboard-project-context.tsx`,
				},
				{ find: "@/lib/api", replacement: `${compatSource}/dashboard-api.ts` },
				{ find: "@/lib/config", replacement: `${compatSource}/dashboard-config.ts` },
				{ find: "next/link", replacement: `${compatSource}/next-link.tsx` },
				{ find: "next/image", replacement: `${compatSource}/next-image.tsx` },
				{ find: "next/navigation", replacement: `${compatSource}/next-navigation.ts` },
				{ find: "next/dynamic", replacement: `${compatSource}/next-dynamic.tsx` },
				{ find: "@melody-auth/react", replacement: `${dashboardSource}/identity/melody-react.tsx` },
				{ find: "app/Setup", replacement: `${dashboardSource}/identity/Setup.tsx` },
				{
					find: "app/useSignalValue",
					replacement: `${dashboardSource}/identity/useSignalValue.ts`,
				},
				{ find: "app/[lang]", replacement: `${dashboardSource}/app/(protected)/identity/[lang]` },
				{ find: "components", replacement: `${dashboardSource}/identity/components` },
				{ find: "hooks", replacement: `${dashboardSource}/identity/hooks` },
				{ find: "i18n", replacement: `${dashboardSource}/identity/i18n` },
				{
					find: "identity-route",
					replacement: `${dashboardSource}/app/(protected)/identity/[lang]`,
				},
				{ find: "identity", replacement: `${dashboardSource}/identity` },
				{ find: "services", replacement: `${dashboardSource}/identity/services` },
				{ find: "signals", replacement: `${dashboardSource}/identity/signals` },
				{ find: "stores", replacement: `${dashboardSource}/identity/stores` },
				{ find: "tools", replacement: `${dashboardSource}/identity/tools` },
				{ find: "@", replacement: dashboardSource },
			],
		},
	},
});
