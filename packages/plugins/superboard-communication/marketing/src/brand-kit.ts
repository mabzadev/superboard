import type { ProjectContext } from "@superboard/contracts/project-context";
import { registerRouter } from "@superboard/contracts/route-registry";
import { isSafePublicHttpsUrl } from "@superboard/contracts/url-security";
import { Hono } from "hono";

import { isRecord, plainText } from "./audience-shared.js";
import { failure } from "./auth.js";
import type { Env } from "./types.js";
import { parseStoredJson, readJsonObject } from "./validation.js";

type BrandColors = {
	background: string;
	surface: string;
	text: string;
	accent: string;
};
const BRAND_COLOR_KEYS: ReadonlyArray<keyof BrandColors> = [
	"background",
	"surface",
	"text",
	"accent",
];
type BrandSocialLink = { network: string; url: string };
type BrandKit = {
	company_name: string | null;
	logo_url: string | null;
	colors: BrandColors;
	font: string;
	footer_text: string | null;
	company_address: string | null;
	social_links: BrandSocialLink[];
};
type GrowthSettings = {
	attribution_window_days: number;
	default_time_zone: string;
};

/** Studio defaults, so an untouched brand kit renders exactly like before. */
const DEFAULT_BRAND_KIT: BrandKit = {
	company_name: null,
	logo_url: null,
	colors: { background: "#f4f4f5", surface: "#ffffff", text: "#18181b", accent: "#2563eb" },
	font: "Arial, sans-serif",
	footer_text: null,
	company_address: null,
	social_links: [],
};
const DEFAULT_GROWTH_SETTINGS: GrowthSettings = {
	attribution_window_days: 7,
	default_time_zone: "UTC",
};
const SOCIAL_NETWORKS = [
	"website",
	"facebook",
	"instagram",
	"linkedin",
	"x",
	"youtube",
	"tiktok",
	"github",
	"discord",
] as const;
const COLOR = /^#[0-9a-f]{6}$/iu;
const FONT = /^[\w\s,'-]+$/u;

type SettingsRow = {
	brand_kit_json: string;
	attribution_window_days: number;
	default_time_zone: string;
};

async function settingsRow(db: D1Database, projectId: number) {
	return db
		.prepare(
			"SELECT brand_kit_json, attribution_window_days, default_time_zone FROM marketing_project_settings WHERE project_id=?",
		)
		.bind(projectId)
		.first<SettingsRow>();
}

/**
 * Reads the project brand kit, filled with Studio defaults. Exported for the
 * preference center and any public page that should look like the sender.
 */
export async function readBrandKit(db: D1Database, projectId: number): Promise<BrandKit> {
	const row = await settingsRow(db, projectId);
	return normalizeStoredBrandKit(parseStoredJson<Record<string, unknown>>(row?.brand_kit_json, {}));
}

export async function readGrowthSettings(
	db: D1Database,
	projectId: number,
): Promise<GrowthSettings> {
	const row = await settingsRow(db, projectId);
	if (!row) return { ...DEFAULT_GROWTH_SETTINGS };
	return {
		attribution_window_days: Number(row.attribution_window_days) || 7,
		default_time_zone: isTimeZone(row.default_time_zone) ? row.default_time_zone : "UTC",
	};
}

export function isTimeZone(value: unknown): value is string {
	if (typeof value !== "string" || !value || value.length > 64) return false;
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: value });
		return true;
	} catch {
		return false;
	}
}

function normalizeStoredBrandKit(value: Record<string, unknown>): BrandKit {
	try {
		return validateBrandKit(value);
	} catch {
		return structuredClone(DEFAULT_BRAND_KIT);
	}
}

function optionalString(value: unknown, field: string, max: number): string | null {
	if (value == null || value === "") return null;
	if (typeof value !== "string" || value.trim().length > max)
		throw failure("BRAND_KIT_INVALID", `${field} is limited to ${max} characters.`);
	return value.trim() || null;
}

export function validateBrandKit(value: unknown): BrandKit {
	const source = isRecord(value) ? value : {};
	const logo = optionalString(source.logo_url, "logo_url", 2048);
	if (logo && !isSafePublicHttpsUrl(logo))
		throw failure("BRAND_KIT_INVALID", "Use a public HTTPS address for the logo.");
	const rawColors = isRecord(source.colors) ? source.colors : {};
	const colors = { ...DEFAULT_BRAND_KIT.colors };
	for (const key of BRAND_COLOR_KEYS) {
		const color = rawColors[key];
		if (color == null || color === "") continue;
		if (typeof color !== "string" || !COLOR.test(color))
			throw failure("BRAND_KIT_INVALID", "Colors must use the #RRGGBB format.");
		colors[key] = color.toLowerCase();
	}
	const font = optionalString(source.font, "font", 120) ?? DEFAULT_BRAND_KIT.font;
	if (!FONT.test(font)) throw failure("BRAND_KIT_INVALID", "The font name is invalid.");
	const links: unknown[] = Array.isArray(source.social_links) ? source.social_links : [];
	if (links.length > SOCIAL_NETWORKS.length)
		throw failure("BRAND_KIT_INVALID", "Add at most one link per network.");
	const social_links: BrandSocialLink[] = [];
	for (const raw of links) {
		const link = isRecord(raw) ? raw : {};
		const network = plainText(link.network);
		if (!(SOCIAL_NETWORKS as readonly string[]).includes(network))
			throw failure("BRAND_KIT_INVALID", "This social network is not supported.");
		if (!isSafePublicHttpsUrl(link.url))
			throw failure("BRAND_KIT_INVALID", "Social links must use public HTTPS addresses.");
		if (social_links.some((item) => item.network === network))
			throw failure("BRAND_KIT_INVALID", "Add at most one link per network.");
		social_links.push({ network, url: String(link.url) });
	}
	return {
		company_name: optionalString(source.company_name, "company_name", 160),
		logo_url: logo,
		colors,
		font,
		footer_text: optionalString(source.footer_text, "footer_text", 1000),
		company_address: optionalString(source.company_address, "company_address", 500),
		social_links,
	};
}

function validateGrowthSettings(
	value: Record<string, unknown>,
	current: GrowthSettings,
): GrowthSettings {
	const days =
		value.attribution_window_days === undefined
			? current.attribution_window_days
			: Number(value.attribution_window_days);
	if (!Number.isInteger(days) || days < 1 || days > 90)
		throw failure(
			"ATTRIBUTION_WINDOW_INVALID",
			"Choose an attribution window between 1 and 90 days.",
		);
	const zone =
		value.default_time_zone === undefined ? current.default_time_zone : value.default_time_zone;
	if (!isTimeZone(zone)) throw failure("TIME_ZONE_INVALID", "Choose a valid time zone.");
	return { attribution_window_days: days, default_time_zone: zone };
}

export const brandKitRoutes = registerRouter(
	new Hono<{ Bindings: Env; Variables: { project: ProjectContext } }>(),
	{
		service: "marketing",
		module: "brand-kit.brandKitRoutes",
		pluginId: "superboard-marketing",
		surface: "internal",
		access: "internal",
	},
);

brandKitRoutes.get("/brand-kit", async (c) =>
	c.json({ data: await readBrandKit(c.env.DB, c.get("project").projectId) }),
);

brandKitRoutes.put("/brand-kit", async (c) => {
	const projectId = c.get("project").projectId;
	const brand = validateBrandKit(await readJsonObject(c.req.raw, 32_000));
	await c.env.DB.prepare(
		`INSERT INTO marketing_project_settings (project_id, brand_kit_json) VALUES (?, ?)
     ON CONFLICT(project_id) DO UPDATE SET brand_kit_json = excluded.brand_kit_json,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
	)
		.bind(projectId, JSON.stringify(brand))
		.run();
	return c.json({ data: brand });
});

brandKitRoutes.get("/growth-settings", async (c) =>
	c.json({ data: await readGrowthSettings(c.env.DB, c.get("project").projectId) }),
);

brandKitRoutes.put("/growth-settings", async (c) => {
	const projectId = c.get("project").projectId;
	const settings = validateGrowthSettings(
		await readJsonObject(c.req.raw, 8_000),
		await readGrowthSettings(c.env.DB, projectId),
	);
	await c.env.DB.prepare(
		`INSERT INTO marketing_project_settings (project_id, attribution_window_days, default_time_zone)
     VALUES (?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET attribution_window_days = excluded.attribution_window_days,
       default_time_zone = excluded.default_time_zone,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
	)
		.bind(projectId, settings.attribution_window_days, settings.default_time_zone)
		.run();
	return c.json({ data: settings });
});
