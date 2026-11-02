export interface TargetRoute {
	path: string;
	label: string;
	coldThresholdMs: number;
	expectedStatuses: number[];
}

export interface Site {
	id: string;
	label: string;
	targetUrl: string;
	workerName: string;
}

export const SITES: readonly Site[] = [
	{
		id: "blog",
		label: "Baseline",
		targetUrl: "https://blog-demo.emdashcms.com",
		workerName: "emdash-demo-blog",
	},
	{
		id: "cache",
		label: "Astro cache",
		targetUrl: "https://cache-demo.emdashcms.com",
		workerName: "emdash-demo-cache",
	},
	{
		id: "do",
		label: "DO read replica",
		targetUrl: "https://do-demo.emdashcms.com",
		workerName: "emdash-demo-do",
	},
	{
		id: "do-solo",
		label: "DO single primary",
		targetUrl: "https://do-solo-demo.emdashcms.com",
		workerName: "emdash-demo-do-solo",
	},
] as const;

export const DEFAULT_SITE_ID = "blog";

export function getSite(id: string): Site | undefined {
	return SITES.find((s) => s.id === id);
}

export const TRIGGER_WORKER_NAME = "emdash-demo-blog";

export const GITHUB_REPO = "emdash-cms/emdash";

export const TARGET_ROUTES: TargetRoute[] = [
	{
		path: "/",
		label: "Homepage",
		coldThresholdMs: 2000,
		expectedStatuses: [200],
	},
	{
		path: "/posts/notes-on-simplicity",
		label: "Single Post",
		coldThresholdMs: 2000,
		expectedStatuses: [200],
	},
	{
		path: "/_emdash/admin",
		label: "Admin (login page)",
		coldThresholdMs: 1500,
		expectedStatuses: [200],
	},
];

export const REGIONS = ["use", "euw", "ape", "aps", "sae", "oce"] as const;
export type Region = (typeof REGIONS)[number];

export const REGION_LABELS: Record<Region, string> = {
	use: "US East",
	euw: "Europe West",
	ape: "Asia Pacific East",
	aps: "Asia Pacific South",
	sae: "South America",
	oce: "Oceania",
};

export const WARM_REQUESTS = 5;
