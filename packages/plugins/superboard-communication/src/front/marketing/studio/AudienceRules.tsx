import { Button, Input, Select } from "@superboard/front-ui/kumo";
import { useEffect, useState } from "react";

import { previewAudienceSegment } from "./audience-service.js";
import { useStudioI18n } from "./i18n.js";

type Condition = { field: string; operator: string; value?: unknown; campaign_id?: string };
type Option = { id: string; name: string };
type Kind = "profile" | "tag" | "list" | "opened" | "clicked" | "received";

const profileOperators = [
	"equals",
	"not_equals",
	"contains",
	"starts_with",
	"exists",
	"in",
	"greater_than",
	"less_than",
];
const kindLabels: Record<Kind, string> = {
	profile: "Profile field",
	tag: "Tag",
	list: "List",
	opened: "Opened an email",
	clicked: "Clicked an email",
	received: "Received an email",
};
const activityFields: Partial<Record<Kind, string>> = {
	opened: "activity.opened",
	clicked: "activity.clicked",
	received: "activity.received",
};

function isKind(value: string): value is Kind {
	return value in kindLabels;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Renders a stored scalar condition value in a text control. */
function conditionText(value: unknown, fallback: string) {
	return typeof value === "string" || typeof value === "number" ? String(value) : fallback;
}

function conditionKind(condition: Condition): Kind {
	if (condition.field === "tag" && ["has", "not_has"].includes(condition.operator)) return "tag";
	if (condition.field === "list" && ["member", "not_member"].includes(condition.operator))
		return "list";
	if (condition.field === "activity.opened") return "opened";
	if (condition.field === "activity.clicked") return "clicked";
	if (condition.field === "activity.received") return "received";
	return "profile";
}

function defaultCondition(kind: Kind, tags: Option[], lists: Option[]): Condition {
	if (kind === "tag") return { field: "tag", operator: "has", value: tags[0]?.id ?? "" };
	if (kind === "list") return { field: "list", operator: "member", value: lists[0]?.id ?? "" };
	const activity = activityFields[kind];
	if (activity) return { field: activity, operator: "within_days", value: 30 };
	return { field: "locale", operator: "equals", value: "" };
}

/**
 * Segment rule editor. Each row picks what to look at (profile, tag, list or
 * email activity) and only shows the controls that kind needs.
 */
export function AudienceRules({
	value,
	onChange,
	project,
	tags = [],
	lists = [],
	campaigns = [],
	fieldKeys = [],
}: {
	value: Record<string, unknown>;
	onChange: (value: Record<string, unknown>) => void;
	project?: string;
	tags?: Option[];
	lists?: Option[];
	campaigns?: Option[];
	fieldKeys?: string[];
}) {
	const { t } = useStudioI18n();
	const conditions = Array.isArray(value.conditions) ? (value.conditions as Condition[]) : [];
	const [estimate, setEstimate] = useState<number | null>(null);
	const update = (index: number, next: Condition) =>
		onChange({
			...value,
			conditions: conditions.map((condition, position) => (position === index ? next : condition)),
		});
	const serialized = JSON.stringify(value);
	useEffect(() => {
		if (!project) return;
		let active = true;
		const timer = setTimeout(() => {
			const rules: unknown = JSON.parse(serialized);
			if (!isRecord(rules)) return;
			void previewAudienceSegment(project, rules).then(
				(result) => {
					if (active) setEstimate(result.subscriber_count);
				},
				() => {
					if (active) setEstimate(null);
				},
			);
		}, 500);
		return () => {
			active = false;
			clearTimeout(timer);
		};
	}, [project, serialized]);
	const kinds = Object.fromEntries(
		Object.keys(kindLabels)
			.filter(isKind)
			.filter((kind) => (kind === "tag" ? tags.length : kind === "list" ? lists.length : true))
			.map((kind) => [kind, t(kindLabels[kind])]),
	);
	return (
		<div className="space-y-3">
			<Select
				label={t("Match conditions")}
				value={String(value.mode ?? "all")}
				onValueChange={(mode) => mode && onChange({ ...value, mode })}
				items={{ all: t("All conditions"), any: t("Any condition") }}
			/>
			<datalist id="audience-rule-fields">
				{["locale", "email", "name", "consent_status", "status", ...fieldKeys].map((key) => (
					<option key={key} value={key} />
				))}
			</datalist>
			{conditions.map((condition, index) => {
				const kind = conditionKind(condition);
				const activity = Boolean(activityFields[kind]);
				return (
					<div key={index} className="space-y-2 rounded-lg border border-kumo-line p-3">
						<Select
							label={t("Condition")}
							value={kind}
							onValueChange={(next) => {
								if (next) update(index, defaultCondition(next, tags, lists));
							}}
							items={kinds}
						/>
						{kind === "profile" && (
							<>
								<Input
									label={t("Profile field")}
									list="audience-rule-fields"
									value={condition.field}
									onChange={(event) => {
										update(index, { ...condition, field: event.target.value });
									}}
								/>
								<Select
									label={t("Operator")}
									value={condition.operator}
									onValueChange={(operator) => {
										if (operator) update(index, { ...condition, operator });
									}}
									items={Object.fromEntries(profileOperators.map((key) => [key, t(key)]))}
								/>
								{condition.operator !== "exists" && (
									<Input
										label={t("Value")}
										value={
											Array.isArray(condition.value)
												? condition.value.join(", ")
												: String(condition.value ?? "")
										}
										onChange={(event) =>
											update(index, {
												...condition,
												value:
													condition.operator === "in"
														? event.target.value.split(",").map((item) => item.trim())
														: event.target.value,
											})
										}
									/>
								)}
							</>
						)}
						{(kind === "tag" || kind === "list") && (
							<div className="grid gap-2 sm:grid-cols-2">
								<Select
									label={t("Operator")}
									value={condition.operator}
									onValueChange={(operator) => {
										if (operator) update(index, { ...condition, operator });
									}}
									items={
										kind === "tag"
											? { has: t("Has the tag"), not_has: t("Does not have the tag") }
											: { member: t("Is in the list"), not_member: t("Is not in the list") }
									}
								/>
								<Select
									label={t(kind === "tag" ? "Tag" : "List")}
									value={conditionText(condition.value, "")}
									onValueChange={(next) => {
										if (next) update(index, { ...condition, value: next });
									}}
									items={Object.fromEntries(
										(kind === "tag" ? tags : lists).map((item) => [item.id, item.name]),
									)}
								/>
							</div>
						)}
						{activity && (
							<div className="grid gap-2 sm:grid-cols-2">
								<Select
									label={t("When")}
									value={condition.operator}
									onValueChange={(operator) => {
										if (operator) update(index, { ...condition, operator });
									}}
									items={{ within_days: t("In the last"), not_within_days: t("Not in the last") }}
								/>
								<Input
									type="number"
									min={1}
									max={3650}
									label={t("Days")}
									value={conditionText(condition.value, "30")}
									onChange={(event) => {
										update(index, { ...condition, value: Number(event.target.value) || 1 });
									}}
								/>
								<Select
									className="sm:col-span-2"
									label={t("Email")}
									value={condition.campaign_id ?? ""}
									onValueChange={(campaign) => {
										const { campaign_id: _previous, ...rest } = condition;
										update(index, campaign ? { ...rest, campaign_id: campaign } : rest);
									}}
									items={{
										"": t("Any email"),
										...Object.fromEntries(campaigns.map((item) => [item.id, item.name])),
									}}
								/>
							</div>
						)}
						<Button
							size="sm"
							variant="ghost"
							disabled={conditions.length < 2}
							onClick={() =>
								onChange({
									...value,
									conditions: conditions.filter((_, position) => position !== index),
								})
							}
						>
							{t("Delete condition")}
						</Button>
					</div>
				);
			})}
			<div className="flex flex-wrap items-center justify-between gap-2">
				<Button
					size="sm"
					disabled={conditions.length >= 25}
					onClick={() =>
						onChange({
							...value,
							conditions: [...conditions, defaultCondition("profile", tags, lists)],
						})
					}
				>
					{t("Add condition")}
				</Button>
				{estimate !== null && (
					<p className="text-sm text-kumo-subtle" role="status">
						{t("About {count} contacts match", { count: estimate })}
					</p>
				)}
			</div>
		</div>
	);
}
