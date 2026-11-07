import { Button, Input, Loader, Select } from "@superboard/front-ui/kumo";
import {
	SettingsActions,
	SettingsRow,
	SettingsSection,
	SettingsTextField,
} from "@superboard/front-ui/settings-form";
import { useEffect, useId, useState, type ReactNode } from "react";

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
import { useAutosave } from "./settings-autosave.js";

const colorLabels = {
	accent: "Brand color",
	text: "Text color",
	background: "Background",
	surface: "Content background",
} as const;
const colorKeys = ["accent", "text", "background", "surface"] as const satisfies ReadonlyArray<
	keyof typeof colorLabels
>;

function useLoaded<T>(project: string, load: (project: string) => Promise<T>) {
	const { t } = useGrowthI18n();
	const [value, setValue] = useState<T>();
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		let active = true;
		void load(project).then(
			(result) => {
				if (active) setValue(result);
			},
			() => {
				if (active) setFailed(true);
			},
		);
		return () => {
			active = false;
		};
	}, [project, load]);
	const fallback: ReactNode = failed ? (
		<p role="alert" className="text-sm text-kumo-danger">
			{t("Loading failed")}
		</p>
	) : (
		<Loader />
	);
	return { value, fallback };
}

export function BrandKitSettings({ project }: { project: string }) {
	const { value, fallback } = useLoaded(project, getBrandKit);
	return value ? <BrandKitForm project={project} initial={value} /> : fallback;
}

function BrandKitForm({ project, initial }: { project: string; initial: BrandKit }) {
	const { t } = useGrowthI18n();
	const [brand, setBrand] = useState(initial);
	const { indicator } = useAutosave({
		resourceKey: project,
		value: brand,
		save: async (next) => {
			await saveBrandKit(project, {
				...next,
				social_links: next.social_links.filter((link) => link.url.trim()),
			});
		},
	});
	const patch = (value: Partial<BrandKit>) => {
		setBrand((current) => ({ ...current, ...value }));
	};
	const unusedNetworks = SOCIAL_NETWORKS.filter(
		(network) => !brand.social_links.some((link) => link.network === network),
	);
	return (
		<>
			<SettingsSection
				title={t("Brand kit")}
				description={t(
					"New emails start with your logo, colors, font and footer. Each email can still change them.",
				)}
			>
				<SettingsRow>
					<SettingsTextField
						label={t("Company name")}
						value={brand.company_name ?? ""}
						onChange={(event) => {
							patch({ company_name: event.target.value || null });
						}}
					/>
				</SettingsRow>
				<SettingsRow>
					<SettingsTextField
						label={t("Logo URL")}
						type="url"
						value={brand.logo_url ?? ""}
						onChange={(event) => {
							patch({ logo_url: event.target.value || null });
						}}
					/>
					{brand.logo_url?.startsWith("https://") && (
						<img
							src={brand.logo_url}
							alt={t("Logo preview")}
							className="h-12 w-auto object-contain"
						/>
					)}
				</SettingsRow>
				{colorKeys.map((key) => (
					<SettingsRow key={key}>
						<ColorField
							label={t(colorLabels[key])}
							value={brand.colors[key]}
							onChange={(value) => {
								patch({ colors: { ...brand.colors, [key]: value } });
							}}
						/>
					</SettingsRow>
				))}
				<SettingsRow>
					<Select
						className="w-full"
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
				</SettingsRow>
			</SettingsSection>
			<SettingsSection
				title={t("Footer and social links")}
				description={t("Added at the bottom of new emails, above the unsubscribe link.")}
			>
				<SettingsRow>
					<SettingsTextField
						label={t("Footer text")}
						value={brand.footer_text ?? ""}
						onChange={(event) => {
							patch({ footer_text: event.target.value || null });
						}}
					/>
				</SettingsRow>
				<SettingsRow>
					<SettingsTextField
						label={t("Company address")}
						value={brand.company_address ?? ""}
						onChange={(event) => {
							patch({ company_address: event.target.value || null });
						}}
					/>
				</SettingsRow>
				{brand.social_links.map((link, index) => (
					<SettingsRow key={link.network}>
						<SettingsTextField
							label={t(socialLabel(link.network))}
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
						<SettingsActions>
							<Button
								variant="ghost"
								aria-label={t("Remove {network}", { network: t(socialLabel(link.network)) })}
								onClick={() => {
									patch({
										social_links: brand.social_links.filter((_, position) => position !== index),
									});
								}}
							>
								{t("Remove")}
							</Button>
						</SettingsActions>
					</SettingsRow>
				))}
				{unusedNetworks.length > 0 && (
					<SettingsRow>
						<Select
							className="w-full"
							label={t("Add a social link")}
							value=""
							onValueChange={(value) => {
								if (value)
									patch({ social_links: [...brand.social_links, { network: value, url: "" }] });
							}}
							items={{
								"": t("Choose a network"),
								...Object.fromEntries(
									unusedNetworks.map((network) => [network, t(socialLabel(network))]),
								),
							}}
						/>
					</SettingsRow>
				)}
			</SettingsSection>
			{indicator}
		</>
	);
}

function ColorField({
	label,
	value,
	onChange,
}: {
	label: string;
	value: string;
	onChange(value: string): void;
}) {
	const id = useId();
	return (
		<div className="flex items-center justify-between gap-4">
			<label htmlFor={id} className="text-sm font-medium">
				{label}
			</label>
			<div className="flex shrink-0 items-center gap-3">
				<code className="text-xs text-kumo-subtle">{value}</code>
				<Input
					id={id}
					type="color"
					className="w-14 p-1"
					value={value}
					onChange={(event) => {
						onChange(event.target.value);
					}}
				/>
			</div>
		</div>
	);
}

const zones = (): string[] => {
	try {
		return Intl.supportedValuesOf("timeZone");
	} catch {
		return ["UTC"];
	}
};

export function GrowthPreferences({ project }: { project: string }) {
	const { value, fallback } = useLoaded(project, getGrowthSettings);
	return value ? <GrowthForm project={project} initial={value} /> : fallback;
}

function GrowthForm({ project, initial }: { project: string; initial: GrowthSettings }) {
	const { t } = useGrowthI18n();
	const [settings, setSettings] = useState(initial);
	const { indicator } = useAutosave({
		resourceKey: project,
		value: settings,
		save: async (next) => {
			await saveGrowthSettings(project, next);
		},
	});
	const timeZones = zones();
	return (
		<>
			<SettingsSection
				title={t("Revenue and time zones")}
				description={t(
					"Purchases are credited to the last email clicked within the attribution window.",
				)}
			>
				<SettingsRow>
					<SettingsTextField
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
				</SettingsRow>
				<SettingsRow>
					<Select
						className="w-full"
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
				</SettingsRow>
			</SettingsSection>
			{indicator}
		</>
	);
}
