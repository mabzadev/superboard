import { Button, Input, Loader, Select } from "@superboard/front-ui/kumo";
import { useCallback, useEffect, useState } from "react";

import {
	createMarketingJourney,
	getMarketingJourneys,
	transitionMarketingJourney,
	updateMarketingJourney,
	type EmailTemplate,
	type JourneyCondition,
	type MarketingJourney,
	type MarketingJourneyInput,
} from "../api/marketing/marketingService.js";
import { JourneyCanvasEditor } from "../components/modules/JourneyCanvasEditor.js";
import { useStudioI18n } from "./i18n.js";

export function EmailItemTriggers({
	project,
	template,
}: {
	project: string;
	template: EmailTemplate;
}) {
	const { t } = useStudioI18n();
	const [items, setItems] = useState<MarketingJourney[]>([]);
	const [form, setForm] = useState<MarketingJourneyInput | null>(null);
	const [conditionIds, setConditionIds] = useState<string[]>([]);
	const [editing, setEditing] = useState<string>();
	const [busy, setBusy] = useState(false);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const load = useCallback(async () => {
		try {
			const values = await getMarketingJourneys(project);
			setItems(
				values.filter((item) =>
					item.definition.nodes.some(
						(node) => node.type === "email" && node.template_id === template.id,
					),
				),
			);
		} catch {
			setError(t("Loading failed"));
		} finally {
			setLoading(false);
		}
	}, [project, template.id, t]);
	useEffect(() => {
		let active = true;
		void getMarketingJourneys(project).then(
			(values) => {
				if (!active) return;
				setItems(
					values.filter((item) =>
						item.definition.nodes.some(
							(node) => node.type === "email" && node.template_id === template.id,
						),
					),
				);
				setLoading(false);
			},
			() => {
				if (active) {
					setError(t("Loading failed"));
					setLoading(false);
				}
			},
		);
		return () => {
			active = false;
		};
	}, [project, template.id, t]);
	const run = (action: () => Promise<unknown>) => {
		if (busy) return;
		setBusy(true);
		setError("");
		action()
			.then(() => load())
			.then(() => {
				setBusy(false);
			})
			.catch(() => {
				setError(t("Save failed"));
				setBusy(false);
			});
	};
	const editCondition = (index: number, value: Partial<JourneyCondition>) => {
		if (!form) return;
		setForm({
			...form,
			trigger: {
				...form.trigger,
				conditions: form.trigger.conditions.map((condition, position) =>
					index === position ? { ...condition, ...value } : condition,
				),
			},
		});
	};
	if (loading) return <Loader />;
	return (
		<section className="space-y-5">
			<div className="flex items-center justify-between gap-3">
				<div>
					<h2 className="text-xl font-semibold">{t("Triggers")}</h2>
					<p className="text-sm text-kumo-subtle">
						{t("Choose an event, filter who enters, then configure the steps before sending.")}
					</p>
				</div>
				<Button
					variant="primary"
					disabled={busy}
					onClick={() => {
						setConditionIds([]);
						setEditing(undefined);
						setForm({
							name: template.name,
							trigger: { event_name: "", conditions: [] },
							reentry_policy: template.template_type === "campaign" ? "once" : "every_event",
							definition: {
								start_node_id: "message",
								nodes: [
									{ id: "message", type: "email", template_id: template.id },
									{ id: "exit", type: "exit" },
								],
								edges: [{ from: "message", to: "exit", outcome: "default" }],
							},
						});
					}}
				>
					{t("Add trigger")}
				</Button>
			</div>
			{error && <p role="alert">{error}</p>}
			{form && (
				<form
					className="space-y-5 rounded-lg border border-kumo-line p-5"
					onSubmit={(event) => {
						event.preventDefault();
						run(async () => {
							if (editing) await updateMarketingJourney(project, editing, form);
							else await createMarketingJourney(project, form);
							setForm(null);
						});
					}}
				>
					<div className="grid gap-4 md:grid-cols-3">
						<Input
							label={t("Name")}
							value={form.name}
							required
							onChange={(event) => {
								setForm({ ...form, name: event.target.value });
							}}
						/>
						<Input
							label={t("Trigger event")}
							value={form.trigger.event_name}
							required
							placeholder={t("Event name from your application")}
							onChange={(event) => {
								setForm({ ...form, trigger: { ...form.trigger, event_name: event.target.value } });
							}}
						/>
						<Select
							label={t("Re-entry")}
							value={form.reentry_policy}
							items={{
								once: t("Once per contact"),
								after_completion: t("After completion"),
								every_event: t("Every event"),
							}}
							onValueChange={(value) => {
								if (value === "once" || value === "after_completion" || value === "every_event")
									setForm({ ...form, reentry_policy: value });
							}}
						/>
					</div>
					<fieldset className="space-y-3">
						<legend className="font-medium">{t("Trigger filters")}</legend>
						<p className="text-sm text-kumo-subtle">
							{t("All conditions must match the incoming event.")}
						</p>
						{form.trigger.conditions.map((condition, index) => (
							<div key={conditionIds[index]} className="flex flex-wrap items-end gap-3">
								<Input
									label={t("Field")}
									value={condition.field}
									required
									onChange={(event) => {
										editCondition(index, { field: event.target.value });
									}}
								/>
								<Select
									label={t("Operator")}
									value={condition.operator}
									items={Object.fromEntries(
										[
											"equals",
											"not_equals",
											"contains",
											"starts_with",
											"exists",
											"greater_than",
											"less_than",
										].map((operator) => [operator, t(operator)]),
									)}
									onValueChange={(value) => {
										if (
											value === "equals" ||
											value === "not_equals" ||
											value === "contains" ||
											value === "starts_with" ||
											value === "exists" ||
											value === "greater_than" ||
											value === "less_than"
										)
											editCondition(index, { operator: value });
									}}
								/>
								{condition.operator !== "exists" && (
									<Input
										label={t("Value")}
										value={
											typeof condition.value === "string"
												? condition.value
												: JSON.stringify(condition.value ?? "")
										}
										onChange={(event) => {
											editCondition(index, {
												value: ["greater_than", "less_than"].includes(condition.operator)
													? Number(event.target.value)
													: event.target.value,
											});
										}}
									/>
								)}
								<Button
									onClick={() => {
										setConditionIds(conditionIds.filter((_, position) => position !== index));
										setForm({
											...form,
											trigger: {
												...form.trigger,
												conditions: form.trigger.conditions.filter(
													(_, position) => position !== index,
												),
											},
										});
									}}
								>
									{t("Remove")}
								</Button>
							</div>
						))}
						<Button
							onClick={() => {
								setConditionIds([...conditionIds, crypto.randomUUID()]);
								setForm({
									...form,
									trigger: {
										...form.trigger,
										conditions: [
											...form.trigger.conditions,
											{ field: "", operator: "equals", value: "" },
										],
									},
								});
							}}
						>
							{t("Add condition")}
						</Button>
					</fieldset>
					<JourneyCanvasEditor
						project={project}
						value={form.definition}
						templates={[template]}
						connectors={[]}
						onChange={(definition) => {
							setForm({ ...form, definition });
						}}
					/>
					<div className="flex gap-3">
						<Button
							type="submit"
							variant="primary"
							loading={busy}
							disabled={
								!form.definition.nodes.some(
									(node) => node.type === "email" && node.template_id === template.id,
								)
							}
						>
							{t("Save trigger")}
						</Button>
						<Button
							disabled={busy}
							onClick={() => {
								setForm(null);
							}}
						>
							{t("Cancel")}
						</Button>
					</div>
				</form>
			)}
			{items.map((item) => (
				<article
					key={item.id}
					className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-kumo-line p-5"
				>
					<div>
						<h3 className="font-medium">{item.name}</h3>
						<p className="text-sm text-kumo-subtle">
							{item.trigger.event_name} · {t(item.status)}
						</p>
					</div>
					<div className="flex flex-wrap gap-2">
						<Button
							disabled={busy || item.status === "active" || item.status === "archived"}
							onClick={() => {
								setConditionIds(item.trigger.conditions.map(() => crypto.randomUUID()));
								setEditing(item.id);
								setForm({
									name: item.name,
									description: item.description,
									trigger: item.trigger,
									definition: item.definition,
									reentry_policy: item.reentry_policy,
									entry_segment_id: item.entry_segment_id,
								});
							}}
						>
							{t("Configure")}
						</Button>
						{item.status !== "archived" && (
							<Button
								disabled={busy}
								onClick={() => {
									run(() =>
										transitionMarketingJourney(
											project,
											item.id,
											item.status === "active"
												? "pause"
												: item.status === "paused"
													? "resume"
													: "activate",
										),
									);
								}}
							>
								{t(item.status === "active" ? "Pause" : "Activate")}
							</Button>
						)}
					</div>
				</article>
			))}
			{!items.length && !form && (
				<p className="text-kumo-subtle">
					{t("No triggers yet. Add a trigger after preparing your email.")}
				</p>
			)}
		</section>
	);
}
