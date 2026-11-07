"use client";

import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import {
	showErrorNotification,
	showSuccessNotification,
} from "@superboard/front-ui/lib/Notifications.js";
import { EmptyProject, moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import {
	SettingsActions,
	SettingsRow,
	SettingsTextField,
	SwitchField,
} from "@superboard/front-ui/settings-form";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@superboard/front-ui/ui/dialog.js";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superboard/front-ui/ui/select.js";
import { CircleCheck, Globe2, Laptop, Pencil, Plus, Smartphone, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AcquisitionPage } from "../../../../AcquisitionPage.js";
import { useFlowI18n } from "../../../../flows/features/flows/i18n.js";
import {
	ConfirmDialog,
	SettingsCard,
	SettingsField,
	SettingsGroup,
} from "../../../../SettingsLayout.js";
import {
	createRedirectRule,
	deleteRedirectRule,
	getRedirectRules,
	updateRedirectRule,
	type RedirectRule,
} from "../../../api/dynamic-links/dynamicLinksService.js";

const platforms = [
	{ value: "ios", label: "iOS", icon: Smartphone },
	{ value: "android", label: "Android", icon: Smartphone },
	{ value: "web", label: "Web", icon: Globe2 },
	{ value: "desktop", label: "Desktop", icon: Laptop },
] as const;

type RuleForm = {
	id?: string;
	name: string;
	platform: string;
	destination: string;
	priority: number;
	active: boolean;
};

const emptyForm: RuleForm = {
	name: "",
	platform: "ios",
	destination: "",
	priority: 100,
	active: true,
};

function formFromRule(rule: RedirectRule): RuleForm {
	return {
		id: rule.id,
		name: rule.name,
		platform: typeof rule.rule.platform === "string" ? rule.rule.platform : "web",
		destination: typeof rule.rule.destination_url === "string" ? rule.rule.destination_url : "",
		priority: rule.priority,
		active: rule.active,
	};
}

export default function RedirectRulesPageContent() {
	const { tr } = useFlowI18n();
	const { selectedProject } = useProjectSelection();
	const [rules, setRules] = useState<RedirectRule[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [saving, setSaving] = useState(false);
	const [form, setForm] = useState<RuleForm>(emptyForm);

	const load = useCallback(async () => {
		if (!selectedProject) return;
		setLoading(true);
		try {
			setRules(await getRedirectRules(selectedProject.id));
			setError(null);
		} catch (cause) {
			setError(moduleErrorMessage(cause));
		} finally {
			setLoading(false);
		}
	}, [selectedProject]);

	useEffect(() => {
		void load();
	}, [load]);

	const grouped = useMemo(
		() =>
			Object.fromEntries(
				platforms.map(({ value }) => [
					value,
					rules
						.filter((rule) => rule.rule.platform === value)
						.sort((left, right) => left.priority - right.priority),
				]),
			) as Record<string, RedirectRule[]>,
		[rules],
	);

	const openCreate = (platform = "ios") => {
		setForm({ ...emptyForm, platform });
		setDialogOpen(true);
	};

	const save = async () => {
		if (!selectedProject || !form.name.trim() || !form.destination.trim()) return;
		setSaving(true);
		const payload = {
			name: form.name.trim(),
			priority: form.priority,
			active: form.active,
			rule: {
				platform: form.platform,
				destination_url: form.destination.trim(),
			},
		};
		try {
			if (form.id) {
				await updateRedirectRule(selectedProject.id, form.id, payload);
				showSuccessNotification(tr("Redirect rule updated"));
			} else {
				await createRedirectRule(selectedProject.id, payload);
				showSuccessNotification(tr("Redirect rule created"));
			}
			setDialogOpen(false);
			await load();
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		} finally {
			setSaving(false);
		}
	};

	const remove = async () => {
		if (!selectedProject || !form.id) return;
		setSaving(true);
		try {
			await deleteRedirectRule(selectedProject.id, form.id);
			setDialogOpen(false);
			showSuccessNotification(tr("Redirect rule deleted"));
			await load();
		} catch (cause) {
			showErrorNotification(moduleErrorMessage(cause));
		} finally {
			setSaving(false);
		}
	};

	return (
		<AcquisitionPage
			title={tr("Redirect rules")}
			description={tr(
				"Resolve the first matching platform rule by priority, then fall back to the link destination.",
			)}
			error={error}
		>
			{!selectedProject ? (
				<EmptyProject />
			) : (
				<div className="flex w-full flex-col gap-6">
					<p className="text-sm text-kumo-subtle">
						{tr("Lower priority numbers are evaluated first.")}
					</p>
					<SettingsCard>
						{platforms.map(({ value, label, icon: Icon }) => (
							<SettingsRow key={value}>
								<div className="flex items-center justify-between gap-3">
									<div className="min-w-0 space-y-1">
										<h3 className="flex items-center gap-2 text-sm font-semibold">
											<Icon className="size-4" />
											{tr(label)}
										</h3>
										<p className="text-xs text-kumo-subtle">
											{grouped[value]?.length
												? tr("{count} configured rules").replace(
														"{count}",
														String(grouped[value].length),
													)
												: tr("No {platform} redirect configured.").replace("{platform}", tr(label))}
										</p>
									</div>
									<Button
										variant="outline"
										size="sm"
										onClick={() => {
											openCreate(value);
										}}
									>
										<Plus className="size-4" />
										{tr("Add")}
									</Button>
								</div>
								{grouped[value]?.length ? (
									<SettingsCard>
										{grouped[value].map((rule) => (
											<button
												key={rule.id}
												type="button"
												className="flex w-full items-center gap-3 p-3 text-start hover:bg-kumo-tint"
												onClick={() => {
													setForm(formFromRule(rule));
													setDialogOpen(true);
												}}
											>
												<span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-kumo-tint text-xs font-semibold">
													{rule.priority}
												</span>
												<span className="min-w-0 flex-1">
													<span className="block truncate font-medium">{rule.name}</span>
													<span className="block truncate text-xs text-kumo-subtle">
														{typeof rule.rule.destination_url === "string" &&
														rule.rule.destination_url
															? rule.rule.destination_url
															: tr("No destination")}
													</span>
												</span>
												<Badge variant={rule.active ? "success" : "default"}>
													{tr(rule.active ? "Active" : "Paused")}
												</Badge>
												<Pencil className="size-4 text-kumo-subtle" />
											</button>
										))}
									</SettingsCard>
								) : null}
							</SettingsRow>
						))}
					</SettingsCard>
					<SettingsActions>
						<Button
							disabled={loading}
							onClick={() => {
								openCreate();
							}}
						>
							<Plus className="size-4" /> {tr("Add rule")}
						</Button>
					</SettingsActions>
					<SettingsGroup
						title={tr("Resolution flow")}
						description={tr("Preview of the runtime decision order.")}
					>
						<FlowStep icon={Globe2} label={tr("Customer opens a dynamic link")} />
						<FlowStep icon={Smartphone} label={tr("Detect platform and device")} />
						<FlowStep icon={CircleCheck} label={tr("Select first active matching rule")} />
						<FlowStep icon={Globe2} label={tr("Use the link fallback destination")} />
						<SettingsRow>
							<p className="text-xs text-kumo-subtle">
								{tr("{count} active rules are currently evaluated.").replace(
									"{count}",
									String(rules.filter((rule) => rule.active).length),
								)}
							</p>
						</SettingsRow>
					</SettingsGroup>
				</div>
			)}

			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{tr(form.id ? "Edit redirect rule" : "Add redirect rule")}</DialogTitle>
						<DialogDescription>
							{tr("Choose a platform destination and its evaluation priority.")}
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						<SettingsTextField
							label={tr("Rule name")}
							value={form.name}
							onChange={(event) => {
								const name = event.currentTarget.value;
								setForm((value) => ({ ...value, name }));
							}}
						/>
						<SettingsField label={tr("Platform")}>
							{(id) => (
								<Select
									value={form.platform}
									onValueChange={(platform) => {
										setForm((value) => ({ ...value, platform }));
									}}
								>
									<SelectTrigger id={id} className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{platforms.map((platform) => (
											<SelectItem key={platform.value} value={platform.value}>
												{tr(platform.label)}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							)}
						</SettingsField>
						<SettingsTextField
							label={tr("Destination URL")}
							type="url"
							value={form.destination}
							onChange={(event) => {
								const destination = event.currentTarget.value;
								setForm((value) => ({ ...value, destination }));
							}}
						/>
						<SettingsTextField
							label={tr("Priority")}
							description={tr("Lower priority numbers are evaluated first.")}
							type="number"
							inputMode="numeric"
							value={String(form.priority)}
							onChange={(event) => {
								const priority = Math.max(0, Number(event.currentTarget.value) || 0);
								setForm((value) => ({ ...value, priority }));
							}}
						/>
						<SwitchField
							label={tr("Active rule")}
							description={tr("Paused rules are kept but not evaluated.")}
							checked={form.active}
							onCheckedChange={(active) => {
								setForm((value) => ({ ...value, active }));
							}}
						/>
					</div>
					<DialogFooter>
						{form.id ? (
							<Button
								variant="destructive"
								disabled={saving}
								onClick={() => {
									setConfirmingDelete(true);
								}}
							>
								<Trash2 className="size-4" />
								{tr("Delete")}
							</Button>
						) : null}
						<Button
							variant="outline"
							onClick={() => {
								setDialogOpen(false);
							}}
						>
							{tr("Cancel")}
						</Button>
						<Button
							disabled={saving || !form.name.trim() || !form.destination.trim()}
							onClick={() => void save()}
						>
							{tr(saving ? "Saving…" : "Save rule")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<ConfirmDialog
				open={confirmingDelete}
				title={tr("Delete this redirect rule?")}
				description={tr("Links stop using this rule as soon as it is deleted.")}
				confirm={tr("Delete")}
				cancel={tr("Cancel")}
				onConfirm={() => {
					remove().catch(() => undefined);
				}}
				onClose={() => {
					setConfirmingDelete(false);
				}}
			/>
		</AcquisitionPage>
	);
}

function FlowStep({
	icon: Icon,
	label,
}: {
	icon: React.ComponentType<{ className?: string }>;
	label: string;
}) {
	return (
		<SettingsRow className="flex items-center gap-3 space-y-0">
			<Icon className="size-4 text-kumo-subtle" />
			<span className="text-sm">{label}</span>
		</SettingsRow>
	);
}
