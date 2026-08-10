"use client";

import { Input } from "@/components/ui/input";

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
  const update = (key: keyof ExperienceStatisticsFilterValues, next: string) =>
    onChange({ ...value, [key]: next });
  return (
    <div className="grid gap-3 rounded-lg border p-4 md:grid-cols-2 xl:grid-cols-5">
      <label className="space-y-1 text-xs">
        From
        <Input
          type="date"
          value={value.from}
          onChange={(event) => update("from", event.target.value)}
        />
      </label>
      <label className="space-y-1 text-xs">
        To
        <Input
          type="date"
          value={value.to}
          onChange={(event) => update("to", event.target.value)}
        />
      </label>
      <label className="space-y-1 text-xs">
        Timezone
        <Input
          value={value.timezone}
          onChange={(event) => update("timezone", event.target.value)}
        />
      </label>
      <label className="space-y-1 text-xs">
        Interval
        <select
          className="block h-9 w-full rounded-md border bg-background px-3 text-sm"
          value={value.interval}
          onChange={(event) => update("interval", event.target.value)}
        >
          <option value="hour">Hour</option>
          <option value="day">Day</option>
          <option value="week">Week</option>
          <option value="month">Month</option>
        </select>
      </label>
      <label className="space-y-1 text-xs">
        Platform
        <select
          className="block h-9 w-full rounded-md border bg-background px-3 text-sm"
          value={value.platform}
          onChange={(event) => update("platform", event.target.value)}
        >
          <option value="">All platforms</option>
          <option value="ios">iOS</option>
          <option value="android">Android</option>
          <option value="web">Web</option>
        </select>
      </label>
      <label className="space-y-1 text-xs">
        Placement
        <Input
          value={value.placement_id}
          onChange={(event) => update("placement_id", event.target.value)}
          placeholder="All placements"
        />
      </label>
      <label className="space-y-1 text-xs">
        Version ID
        <Input
          value={value.version_id}
          onChange={(event) => update("version_id", event.target.value)}
          placeholder="All versions"
        />
      </label>
      <label className="space-y-1 text-xs">
        Experience ID
        <Input
          value={value.experience_id}
          onChange={(event) => update("experience_id", event.target.value)}
          placeholder="All experiments"
        />
      </label>
      <label className="space-y-1 text-xs">
        Variant ID
        <Input
          value={value.variant_id}
          onChange={(event) => update("variant_id", event.target.value)}
          placeholder="All variants"
        />
      </label>
    </div>
  );
}
