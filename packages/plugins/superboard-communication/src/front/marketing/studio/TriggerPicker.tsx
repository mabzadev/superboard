import { Checkbox, Input, Select } from "@superboard/front-ui/kumo";
import { useEffect, useState } from "react";

import {
	getSubscriberLists,
	type JourneyTrigger,
	type SubscriberList,
} from "../api/marketing/marketingService.js";
import { useGrowthI18n } from "./growth-i18n.js";
import { getNativeTriggers, type NativeTrigger } from "./growth-service.js";

const CUSTOM = "__custom__";
export const DATE_TRIGGER = "native:date_attribute";
const groupLabels: Record<NativeTrigger["group"], string> = {
	purchases: "Purchases",
	subscriptions: "Subscriptions",
	acquisition: "Acquisition",
	audience: "Audience",
	dates: "Dates",
};

function useNativeTriggers(project: string) {
	const [triggers, setTriggers] = useState<NativeTrigger[]>([]);
	useEffect(() => {
		if (!project) return;
		let active = true;
		void getNativeTriggers(project).then(
			(values) => {
				if (active) setTriggers(values);
			},
			// Without the catalog the picker still accepts a custom event name.
			() => undefined,
		);
		return () => {
			active = false;
		};
	}, [project]);
	return triggers;
}

/** Friendly label of a stored trigger or event key, for lists and summaries. */
export function useEventLabel(project: string) {
	const { t } = useGrowthI18n();
	const triggers = useNativeTriggers(project);
	return (key: string) => {
		const trigger = triggers.find((item) => item.event_name === key);
		return trigger ? t(trigger.label) : key;
	};
}

/** Chooses one event: a native SuperBoard moment or a custom application event. */
export function EventKeyPicker({
	project,
	label,
	value,
	onChange,
	allowDate = false,
	allowEmpty = false,
}: {
	project: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	allowDate?: boolean;
	allowEmpty?: boolean;
}) {
	const { t } = useGrowthI18n();
	const triggers = useNativeTriggers(project).filter(
		(trigger) => allowDate || trigger.event_name !== DATE_TRIGGER,
	);
	const native = triggers.some((trigger) => trigger.event_name === value);
	const [custom, setCustom] = useState(!native && value !== "");
	const selected = native ? value : custom ? CUSTOM : "";
	const items: Record<string, string> = {
		...(allowEmpty ? { "": t("None") } : { "": t("Choose an event") }),
	};
	for (const [group, label] of Object.entries(groupLabels))
		for (const trigger of triggers.filter((item) => item.group === group))
			items[trigger.event_name] = `${t(label)} · ${t(trigger.label)}`;
	items[CUSTOM] = t("Custom event from your application");
	return (
		<div className="grid gap-3">
			<Select
				label={label}
				value={selected}
				items={items}
				onValueChange={(next) => {
					if (next === CUSTOM) {
						setCustom(true);
						onChange(native ? "" : value);
					} else {
						setCustom(false);
						onChange(next ?? "");
					}
				}}
			/>
			{selected === CUSTOM && (
				<Input
					label={t("Event name")}
					placeholder={t("account.created")}
					value={value}
					required
					onChange={(event) => {
						onChange(event.target.value);
					}}
				/>
			)}
		</div>
	);
}

function withCondition(trigger: JourneyTrigger, field: string, value: string): JourneyTrigger {
	const conditions = trigger.conditions.filter((condition) => condition.field !== field);
	return {
		...trigger,
		conditions: value ? [...conditions, { field, operator: "equals", value }] : conditions,
	};
}

/** Trigger of an automation, with the few extra settings some native triggers need. */
export function TriggerPicker({
	project,
	value,
	onChange,
}: {
	project: string;
	value: JourneyTrigger;
	onChange: (value: JourneyTrigger) => void;
}) {
	const { t } = useGrowthI18n();
	const [lists, setLists] = useState<SubscriberList[]>([]);
	const listTrigger = value.event_name === "native:contact_joined_list";
	useEffect(() => {
		if (!listTrigger) return;
		let active = true;
		void getSubscriberLists(project).then(
			(values) => {
				if (active) setLists(values);
			},
			() => undefined,
		);
		return () => {
			active = false;
		};
	}, [project, listTrigger]);
	const conditionValue = (field: string) => {
		const current = value.conditions.find((condition) => condition.field === field)?.value;
		return typeof current === "string" ||
			typeof current === "number" ||
			typeof current === "boolean"
			? String(current)
			: "";
	};
	const date = value.date ?? { attribute: "birthday", anniversary: true, offset_days: 0, hour: 9 };
	return (
		<div className="grid gap-3">
			<EventKeyPicker
				project={project}
				label={t("Starts when")}
				value={value.event_name}
				allowDate
				onChange={(eventName) => {
					onChange({
						event_name: eventName,
						conditions: [],
						...(eventName === DATE_TRIGGER ? { date } : {}),
					});
				}}
			/>
			{listTrigger && (
				<Select
					label={t("Only for the list")}
					value={conditionValue("properties.list_id")}
					items={{
						"": t("Any list"),
						...Object.fromEntries(lists.map((list) => [list.id, list.name])),
					}}
					onValueChange={(next) => {
						onChange(withCondition(value, "properties.list_id", next ?? ""));
					}}
				/>
			)}
			{value.event_name === "native:tag_added" && (
				<Input
					label={t("Only for the tag")}
					placeholder={t("Any tag")}
					value={conditionValue("properties.tag_name")}
					onChange={(event) => {
						onChange(withCondition(value, "properties.tag_name", event.target.value.trim()));
					}}
				/>
			)}
			{value.event_name === DATE_TRIGGER && (
				<div className="grid gap-3 rounded-lg border border-kumo-line p-3 md:grid-cols-2">
					<Input
						label={t("Contact date field")}
						placeholder={t("birthday")}
						value={date.attribute}
						required
						onChange={(event) => {
							onChange({ ...value, date: { ...date, attribute: event.target.value.trim() } });
						}}
					/>
					<Input
						type="number"
						min={-365}
						max={365}
						label={t("Days before the date")}
						value={date.offset_days}
						onChange={(event) => {
							onChange({
								...value,
								date: { ...date, offset_days: Math.trunc(Number(event.target.value) || 0) },
							});
						}}
					/>
					<Input
						type="number"
						min={0}
						max={23}
						label={t("Sending hour (project time zone)")}
						value={date.hour}
						onChange={(event) => {
							onChange({
								...value,
								date: {
									...date,
									hour: Math.min(23, Math.max(0, Math.trunc(Number(event.target.value) || 0))),
								},
							});
						}}
					/>
					<Checkbox
						label={t("Every year (anniversary)")}
						checked={date.anniversary}
						onCheckedChange={(checked) => {
							onChange({ ...value, date: { ...date, anniversary: checked } });
						}}
					/>
				</div>
			)}
		</div>
	);
}
