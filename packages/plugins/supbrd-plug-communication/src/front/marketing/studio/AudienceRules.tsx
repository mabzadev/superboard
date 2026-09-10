import { Button, Input, Select } from "@superboard/front-ui/kumo";

import { useStudioI18n } from "./i18n.js";

type Condition = { field: string; operator: string; value?: unknown };
export function AudienceRules({
	value,
	onChange,
}: {
	value: Record<string, unknown>;
	onChange: (value: Record<string, unknown>) => void;
}) {
	const { t } = useStudioI18n();
	const conditions = Array.isArray(value.conditions) ? (value.conditions as Condition[]) : [];
	const update = (index: number, patch: Partial<Condition>) =>
		onChange({
			...value,
			conditions: conditions.map((condition, position) =>
				position === index ? { ...condition, ...patch } : condition,
			),
		});
	return (
		<div className="space-y-3">
			<Select
				label={t("Match conditions")}
				value={String(value.mode ?? "all")}
				onValueChange={(mode) => mode && onChange({ ...value, mode })}
				items={{ all: t("All conditions"), any: t("Any condition") }}
			/>
			{conditions.map((condition, index) => (
				<div key={index} className="space-y-2 rounded-lg border border-kumo-line p-3">
					<Input
						label={t("Profile field")}
						value={condition.field}
						onChange={(event) => update(index, { field: event.target.value })}
					/>
					<Select
						label={t("Operator")}
						value={condition.operator}
						onValueChange={(operator) => operator && update(index, { operator })}
						items={Object.fromEntries(
							["equals", "not_equals", "contains", "starts_with", "exists", "in"].map((key) => [
								key,
								t(key),
							]),
						)}
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
									value:
										condition.operator === "in"
											? event.target.value.split(",").map((value) => value.trim())
											: event.target.value,
								})
							}
						/>
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
			))}
			<Button
				size="sm"
				disabled={conditions.length >= 25}
				onClick={() =>
					onChange({
						...value,
						conditions: [...conditions, { field: "locale", operator: "equals", value: "" }],
					})
				}
			>
				{t("Add condition")}
			</Button>
		</div>
	);
}
