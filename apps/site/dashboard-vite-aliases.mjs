import { fileURLToPath } from "node:url";

const frontUI = fileURLToPath(new URL("../../packages/supbrd-front-ui/src/", import.meta.url));

export const dashboardViteAliases = [
	{ find: "next/navigation", replacement: `${frontUI}navigation.tsx` },
	{ find: "next/link", replacement: `${frontUI}next-link.tsx` },
	{ find: "next/image", replacement: `${frontUI}next-image.tsx` },
	{ find: "next/dynamic", replacement: `${frontUI}next-dynamic.tsx` },
];
