"use client";

import { Input } from "@superboard/front-ui/ui/input.js";

import { useFlowI18n } from "../../../flows/features/flows/i18n.js";

export type ExperienceStatisticsFilterValues = {
	from: string;
	to: string;
	timezone: string;
	interval: string;
	platform: string;
	placement_id: string;
	version_id: string;
	experience_id: string;
	variant_id: string;
};

export function ExperienceStatisticsFilters({
	value,
	onChange,
}: {
	value: ExperienceStatisticsFilterValues;
	onChange: (value: ExperienceStatisticsFilterValues) => void;
}) {
	const { tr } = useFlowI18n();
	const update = (key: keyof ExperienceStatisticsFilterValues, next: string) =>
		onChange({ ...value, [key]: next });
	return (
		<div className="grid gap-3 rounded-lg border p-4 md:grid-cols-2 xl:grid-cols-5">
			<label className="space-y-1 text-xs">
				{tr("From")}
				<Input
					type="date"
					value={value.from}
					onChange={(event) => update("from", event.target.value)}
				/>
			</label>
			<label className="space-y-1 text-xs">
				{tr("To")}
				<Input
					type="date"
					value={value.to}
					onChange={(event) => update("to", event.target.value)}
				/>
			</label>
			<label className="space-y-1 text-xs">
				{tr("Timezone")}
				<Input
					value={value.timezone}
					onChange={(event) => update("timezone", event.target.value)}
				/>
			</label>
			<label className="space-y-1 text-xs">
				{tr("Interval")}
				<select
					className="block h-9 w-full rounded-md border bg-background px-3 text-sm"
					value={value.interval}
					onChange={(event) => update("interval", event.target.value)}
				>
					<option value="hour">{tr("Hour")}</option>
					<option value="day">{tr("Day")}</option>
					<option value="week">{tr("Week")}</option>
					<option value="month">{tr("Month")}</option>
				</select>
			</label>
			<label className="space-y-1 text-xs">
				{tr("Platform")}
				<select
					className="block h-9 w-full rounded-md border bg-background px-3 text-sm"
					value={value.platform}
					onChange={(event) => update("platform", event.target.value)}
				>
					<option value="">{tr("All platforms")}</option>
					<option value="ios">iOS</option>
					<option value="android">Android</option>
					<option value="web">Web</option>
				</select>
			</label>
			<label className="space-y-1 text-xs">
				{tr("Placement")}
				<Input
					value={value.placement_id}
					onChange={(event) => update("placement_id", event.target.value)}
					placeholder={tr("All placements")}
				/>
			</label>
			<label className="space-y-1 text-xs">
				{tr("Version ID")}
				<Input
					value={value.version_id}
					onChange={(event) => update("version_id", event.target.value)}
					placeholder={tr("All versions")}
				/>
			</label>
			<label className="space-y-1 text-xs">
				{tr("Experience ID")}
				<Input
					value={value.experience_id}
					onChange={(event) => update("experience_id", event.target.value)}
					placeholder={tr("All experiments")}
				/>
			</label>
			<label className="space-y-1 text-xs">
				{tr("Variant ID")}
				<Input
					value={value.variant_id}
					onChange={(event) => update("variant_id", event.target.value)}
					placeholder={tr("All variants")}
				/>
			</label>
		</div>
	);
}
