import { fileURLToPath } from "node:url";

import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { d1, r2, sandbox } from "@emdash-cms/cloudflare";
import { cloudflareEmail } from "@emdash-cms/cloudflare/plugins";
import { defineConfig } from "astro/config";
import emdash from "emdash/astro";

import { superboardReleaseOperatorApi } from "./release-operator-api.mjs";
import { superboardConfiguredPlugins } from "./superboard-emdash-plugins.mjs";

function superboardViewsBootstrap() {
	return {
		name: "superboard-views-bootstrap",
		hooks: {
			"astro:config:setup": ({ addMiddleware }) => {
				addMiddleware({
					entrypoint: new URL("./src/views-bootstrap-middleware.ts", import.meta.url),
					order: "post",
				});
			},
		},
	};
}

const emailFromAddress = process.env.SUPERBOARD_SITE_EMAIL_FROM_ADDRESS ?? "noreply@localhost";
const emailFromName = process.env.SUPERBOARD_SITE_EMAIL_FROM_NAME ?? "SuperBoard";
const emailReplyTo = process.env.SUPERBOARD_SITE_EMAIL_REPLY_TO || undefined;
const dashboardSource = fileURLToPath(new URL("../dashboard/src/", import.meta.url));
const dashboardCompat = fileURLToPath(new URL("./src/dashboard-compat/", import.meta.url));
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
		superboardViewsBootstrap(),
	],
	devToolbar: { enabled: false },
	security: { checkOrigin: true },
	vite: {
		define: {
			"process.env.NEXT_PUBLIC_SUPERBOARD_EMDASH_FRONT": JSON.stringify("1"),
		},
		resolve: {
			alias: [
				{ find: "next/navigation", replacement: `${dashboardSource}emdash/next-navigation.ts` },
				{ find: "next/link", replacement: `${dashboardCompat}next-link.tsx` },
				{ find: "next/image", replacement: `${dashboardCompat}next-image.tsx` },
				{ find: "next/dynamic", replacement: `${dashboardCompat}next-dynamic.tsx` },
				{ find: "@melody-auth/react", replacement: `${dashboardSource}identity/melody-react.tsx` },
				{ find: "app/Setup", replacement: `${dashboardSource}identity/Setup.tsx` },
				{ find: "app/useSignalValue", replacement: `${dashboardSource}identity/useSignalValue.ts` },
				{ find: /^signals$/u, replacement: `${dashboardSource}identity/signals/index.ts` },
				{ find: /^stores$/u, replacement: `${dashboardSource}identity/stores/index.tsx` },
				{ find: /^tools$/u, replacement: `${dashboardSource}identity/tools/index.ts` },
				{ find: /^@\//u, replacement: dashboardSource },
				{
					find: /^app\/\[lang\]\//u,
					replacement: `${dashboardSource}app/(protected)/identity/[lang]/`,
				},
				{ find: /^components\//u, replacement: `${dashboardSource}identity/components/` },
				{ find: /^hooks\//u, replacement: `${dashboardSource}identity/hooks/` },
				{ find: /^i18n\//u, replacement: `${dashboardSource}identity/i18n/` },
				{
					find: /^identity-route\//u,
					replacement: `${dashboardSource}app/(protected)/identity/[lang]/`,
				},
				{ find: /^identity\//u, replacement: `${dashboardSource}identity/` },
				{ find: /^services\//u, replacement: `${dashboardSource}identity/services/` },
				{ find: /^signals\//u, replacement: `${dashboardSource}identity/signals/` },
				{ find: /^stores\//u, replacement: `${dashboardSource}identity/stores/` },
				{ find: /^tools\//u, replacement: `${dashboardSource}identity/tools/` },
			],
		},
	},
});
