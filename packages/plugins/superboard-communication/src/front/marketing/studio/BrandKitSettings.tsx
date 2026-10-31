import { Button, Input, Loader, Select } from "@superboard/front-ui/kumo";
import { useEffect, useState } from "react";

import { BRAND_FONTS, SOCIAL_NETWORKS, socialLabel } from "./brand.js";
import { useGrowthI18n } from "./growth-i18n.js";
import {
	getBrandKit,
	getGrowthSettings,
	saveBrandKit,
	saveGrowthSettings,
	type BrandKit,
	type GrowthSettings,
} from "./growth-service.js";

const colorLabels = {
	accent: "Brand color",
	text: "Text color",
	background: "Background",
	surface: "Content background",
} as const;
const colorKeys = ["accent", "text", "background", "surface"] as const satisfies ReadonlyArray<
	keyof typeof colorLabels
>;

/** Project brand kit, applied to new emails and available in the Studio design panel. */
export function BrandKitSettings({ project }: { project: string }) {
	const { t } = useGrowthI18n();
	const [brand, setBrand] = useState<BrandKit>();
	const [status, setStatus] = useState("");
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		let active = true;
		void getBrandKit(project).then(
			(value) => {
				if (active) setBrand(value);
			},
			() => {
				if (active) setStatus(t("Loading failed"));
			},
		);
		return () => {
			active = false;
		};
	}, [project, t]);
	if (!brand) return status ? <p role="alert">{status}</p> : <Loader />;
	const patch = (value: Partial<BrandKit>) => {
		setBrand({ ...brand, ...value });
	};
	const unusedNetworks = SOCIAL_NETWORKS.filter(
		(network) => !brand.social_links.some((link) => link.network === network),
	);
	return (
		<section className="space-y-4 rounded-lg border border-kumo-line p-5">
			<div>
				<h2 className="text-lg font-semibold">{t("Brand kit")}</h2>
				<p className="text-sm text-kumo-subtle">
					{t(
						"New emails start with your logo, colors, font and footer. Each email can still change them.",
					)}
				</p>
			</div>
			<div className="grid gap-4 md:grid-cols-2">
				<Input
					label={t("Company name")}
					value={brand.company_name ?? ""}
					onChange={(event) => {
						patch({ company_name: event.target.value || null });
					}}
				/>
				<Input
					label={t("Logo URL")}
					type="url"
					value={brand.logo_url ?? ""}
					onChange={(event) => {
						patch({ logo_url: event.target.value || null });
					}}
				/>
			</div>
			{brand.logo_url?.startsWith("https://") && (
				<img src={brand.logo_url} alt={t("Logo preview")} className="h-12 w-auto object-contain" />
			)}
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
				{colorKeys.map((key) => (
					<Input
						key={key}
						type="color"
						label={t(colorLabels[key])}
						value={brand.colors[key]}
						onChange={(event) => {
							patch({ colors: { ...brand.colors, [key]: event.target.value } });
						}}
					/>
				))}
				<Select
					label={t("Font")}
					value={brand.font}
					onValueChange={(value) => {
						if (value) patch({ font: value });
					}}
					items={{
						...BRAND_FONTS,
						...(BRAND_FONTS[brand.font] ? {} : { [brand.font]: brand.font }),
					}}
				/>
			</div>
			<details className="rounded-lg border border-kumo-line p-4">
				<summary className="cursor-pointer font-medium">{t("Footer and social links")}</summary>
				<div className="mt-4 space-y-4">
					<Input
						label={t("Footer text")}
						value={brand.footer_text ?? ""}
						onChange={(event) => {
							patch({ footer_text: event.target.value || null });
						}}
					/>
					<Input
						label={t("Company address")}
						value={brand.company_address ?? ""}
						onChange={(event) => {
							patch({ company_address: event.target.value || null });
						}}
					/>
					{brand.social_links.map((link, index) => (
						<div key={link.network} className="flex flex-wrap items-end gap-3">
							<span className="w-28 pb-2 text-sm font-medium">{socialLabel(link.network)}</span>
							<Input
								aria-label={socialLabel(link.network)}
								type="url"
								value={link.url}
								onChange={(event) => {
									patch({
										social_links: brand.social_links.map((item, position) =>
											position === index ? { ...item, url: event.target.value } : item,
										),
									});
								}}
							/>
							<Button
								variant="ghost"
								onClick={() => {
									patch({
										social_links: brand.social_links.filter((_, position) => position !== index),
									});
								}}
							>
								{t("Remove")}
							</Button>
						</div>
					))}
					{unusedNetworks.length > 0 && (
						<Select
							label={t("Add a social link")}
							value=""
							onValueChange={(value) => {
								if (value)
									patch({ social_links: [...brand.social_links, { network: value, url: "" }] });
							}}
							items={{
								"": t("Choose a network"),
								...Object.fromEntries(
									unusedNetworks.map((network) => [network, socialLabel(network)]),
								),
							}}
						/>
					)}
				</div>
			</details>
			<div className="flex items-center gap-3">
				<Button
					variant="primary"
					loading={busy}
					onClick={() => {
						setBusy(true);
						setStatus("");
						saveBrandKit(project, {
							...brand,
							social_links: brand.social_links.filter((link) => link.url.trim()),
						})
							.then((saved) => {
								setBrand(saved);
								setStatus(t("Brand kit saved"));
							})
							.catch(() => {
								setStatus(t("Save failed"));
							})
							.finally(() => {
								setBusy(false);
							});
					}}
				>
					{t("Save brand kit")}
				</Button>
				<p role="status" className="text-sm">
					{status}
				</p>
			</div>
		</section>
	);
}

const zones = (): string[] => {
	try {
		// Older engines lack the method; calling it throws and falls back to UTC.
		return Intl.supportedValuesOf("timeZone");
	} catch {
		return ["UTC"];
	}
};

/** Revenue attribution window and the time zone used for contacts without one. */
export function GrowthPreferences({ project }: { project: string }) {
	const { t } = useGrowthI18n();
	const [settings, setSettings] = useState<GrowthSettings>();
	const [status, setStatus] = useState("");
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		let active = true;
		void getGrowthSettings(project).then(
			(value) => {
				if (active) setSettings(value);
			},
			() => {
				if (active) setStatus(t("Loading failed"));
			},
		);
		return () => {
			active = false;
		};
	}, [project, t]);
	if (!settings) return status ? <p role="alert">{status}</p> : <Loader />;
	const timeZones = zones();
	return (
		<section className="space-y-4 rounded-lg border border-kumo-line p-5">
			<div>
				<h2 className="text-lg font-semibold">{t("Revenue and time zones")}</h2>
				<p className="text-sm text-kumo-subtle">
					{t("Purchases are credited to the last email clicked within the attribution window.")}
				</p>
			</div>
			<div className="grid gap-4 md:grid-cols-2">
				<Input
					type="number"
					min={1}
					max={90}
					label={t("Attribution window (days)")}
					value={settings.attribution_window_days}
					onChange={(event) => {
						setSettings({
							...settings,
							attribution_window_days: Math.min(90, Math.max(1, Number(event.target.value) || 1)),
						});
					}}
				/>
				<Select
					label={t("Default time zone for contacts")}
					value={settings.default_time_zone}
					onValueChange={(value) => {
						if (value) setSettings({ ...settings, default_time_zone: value });
					}}
					items={Object.fromEntries(
						[...new Set(["UTC", settings.default_time_zone, ...timeZones])].map((zone) => [
							zone,
							zone,
						]),
					)}
				/>
			</div>
			<div className="flex items-center gap-3">
				<Button
					loading={busy}
					onClick={() => {
						setBusy(true);
						setStatus("");
						saveGrowthSettings(project, settings)
							.then((saved) => {
								setSettings(saved);
								setStatus(t("Preferences saved"));
							})
							.catch(() => {
								setStatus(t("Save failed"));
							})
							.finally(() => {
								setBusy(false);
							});
					}}
				>
					{t("Save")}
				</Button>
				<p role="status" className="text-sm">
					{status}
				</p>
			</div>
		</section>
	);
}
