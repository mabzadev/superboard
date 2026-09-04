import { fileURLToPath } from "node:url";

const dashboardSource = fileURLToPath(new URL("../dashboard/src/", import.meta.url));
const dashboardCompat = fileURLToPath(new URL("./src/dashboard-compat/", import.meta.url));

export const dashboardViteAliases = [
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
];
