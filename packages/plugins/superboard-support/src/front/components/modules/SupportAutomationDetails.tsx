import { moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import { Input } from "@superboard/front-ui/ui/input.js";
import { Label } from "@superboard/front-ui/ui/label.js";
import { Switch } from "@superboard/front-ui/ui/switch.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@superboard/front-ui/ui/tabs.js";
import { Textarea } from "@superboard/front-ui/ui/textarea.js";
import { useEffect, useState } from "react";

import { editableAutomationConditions } from "../../api/support/automationScope.js";
import {
	supportAutomations,
	type SupportAutomation,
} from "../../api/support/automationsService.js";
import { getSupportAction } from "../../api/support/nativeClient.js";
import { useSupportI18n } from "../../i18n.js";
import { SupportError, SupportMetric } from "../support/SupportUi.js";

export function SupportAutomationDetails({
	project,
	automation,
	inboxId,
	close,
}: {
	project: string;
	automation: SupportAutomation;
	inboxId?: string;
	close: () => void;
}) {
	const { t } = useSupportI18n();
	const editable = editableAutomationConditions(automation, inboxId);
	const [draft, setDraft] = useState({ ...automation, condition_mode: editable.mode });
	const [conditions, setConditions] = useState(JSON.stringify(editable.conditions, null, 2));
	const [actions, setActions] = useState(JSON.stringify(automation.actions, null, 2));
	const [report, setReport] = useState<Record<string, number | null> | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [tab, setTab] = useState("settings");
	useEffect(() => {
		if (tab !== "reports") return;
		let active = true;
		void getSupportAction<Record<string, number | null>>(project, "reports", {
			automation_id: automation.id,
		})
			.then((result) => {
				if (active) setReport(result.data);
			})
			.catch((cause: unknown) => {
				if (active) setError(moduleErrorMessage(cause));
			});
		return () => {
			active = false;
		};
	}, [project, automation.id, tab]);
	const save = async () => {
		setSaving(true);
		try {
			const parsedConditions: unknown = JSON.parse(conditions);
			const parsedActions: unknown = JSON.parse(actions);
			if (!Array.isArray(parsedConditions) || !Array.isArray(parsedActions))
				throw new Error(t("Conditions and actions must be lists."));
			await supportAutomations.update(project, automation.id, {
				name: draft.name,
				event_name: draft.event_name,
				condition_mode: inboxId ? "all" : draft.condition_mode,
				conditions: inboxId
					? [
							{ field: "inbox_id", operator: "equals", value: inboxId },
							...(parsedConditions.length
								? [{ mode: draft.condition_mode, conditions: parsedConditions }]
								: []),
						]
					: parsedConditions,
				actions: parsedActions,
				position: draft.position,
				active: draft.active,
			});
			close();
		} catch (cause) {
			setError(moduleErrorMessage(cause));
		} finally {
			setSaving(false);
		}
	};
	return (
		<section className="space-y-4">
			<Button variant="outline" onClick={close}>
				{t("Back to list")}
			</Button>
			<h2 className="text-lg font-semibold">{automation.name}</h2>
			<SupportError message={error} />
			<Tabs value={tab} onValueChange={setTab}>
				<TabsList>
					<TabsTrigger value="settings">{t("Settings")}</TabsTrigger>
					<TabsTrigger value="reports">{t("Reports")}</TabsTrigger>
				</TabsList>
				<TabsContent value="settings">
					<form
						className="space-y-4 rounded-md border p-5"
						onSubmit={(event) => {
							event.preventDefault();
							void save().catch((cause: unknown) => {
								setError(moduleErrorMessage(cause));
							});
						}}
					>
						<Label htmlFor="automation-name">{t("Name")}</Label>
						<Input
							id="automation-name"
							value={draft.name}
							required
							onChange={(event) => {
								setDraft({ ...draft, name: event.target.value });
							}}
						/>
						<Label htmlFor="automation-event">{t("Event")}</Label>
						<Input
							id="automation-event"
							value={draft.event_name}
							required
							onChange={(event) => {
								setDraft({ ...draft, event_name: event.target.value });
							}}
						/>
						<Label htmlFor="automation-conditions">{t("Conditions")}</Label>
						<Textarea
							id="automation-conditions"
							value={conditions}
							onChange={(event) => {
								setConditions(event.target.value);
							}}
						/>
						<Label htmlFor="automation-actions">{t("Actions")}</Label>
						<Textarea
							id="automation-actions"
							value={actions}
							onChange={(event) => {
								setActions(event.target.value);
							}}
						/>
						<Label htmlFor="automation-enabled">{t("Enabled")}</Label>
						<Switch
							id="automation-enabled"
							checked={draft.active}
							onCheckedChange={(active) => {
								setDraft({ ...draft, active });
							}}
						/>
						<Button type="submit" disabled={saving}>
							{t("Save settings")}
						</Button>
					</form>
				</TabsContent>
				<TabsContent value="reports">
					<div className="grid gap-4 sm:grid-cols-2">
						{(
							[
								["executions", "Executions"],
								["matched", "Matched"],
								["skipped", "Skipped"],
								["pending", "Pending"],
							] as const
						).map(([key, label]) => (
							<SupportMetric key={key} label={t(label)} value={report ? (report[key] ?? 0) : "—"} />
						))}
					</div>
				</TabsContent>
			</Tabs>
		</section>
	);
}
