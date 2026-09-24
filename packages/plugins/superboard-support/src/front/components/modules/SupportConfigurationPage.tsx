"use client";
import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import {
	showErrorNotification,
	showSuccessNotification,
} from "@superboard/front-ui/lib/Notifications.js";
import { Badge } from "@superboard/front-ui/ui/badge.js";
import { Button } from "@superboard/front-ui/ui/button.js";
import { Card } from "@superboard/front-ui/ui/card.js";
import { Input } from "@superboard/front-ui/ui/input.js";
import { Label } from "@superboard/front-ui/ui/label.js";
import { Switch } from "@superboard/front-ui/ui/switch.js";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
	createMessagingConfiguration,
	deleteMessagingConfiguration,
	getMessagingSettings,
	updateMessagingConfiguration,
	rotateSupportWebhookSecret,
	revokeSupportWebhookSecret,
	type MessagingConfigurationEntity,
	type MessagingFieldDefinition,
	type MessagingSettingsBootstrap,
} from "../../api/messaging/settingsService.js";
import { useSupportI18n } from "../../i18n.js";

type DraftValue = string | boolean;

export default function SupportConfigurationPage({
	entityType = "inbox",
}: {
	entityType?: string;
}) {
	const { t } = useSupportI18n();
	const { selectedProject } = useProjectSelection();
	const projectId = selectedProject?.id;
	const [bootstrap, setBootstrap] = useState<MessagingSettingsBootstrap | null>(null);
	const selectedType = entityType;
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [name, setName] = useState("");
	const [enabled, setEnabled] = useState(true);
	const [position, setPosition] = useState("0");
	const [values, setValues] = useState<Record<string, DraftValue>>({});
	const [saving, setSaving] = useState(false);
	const [loading, setLoading] = useState(false);
	const [webhookSecret, setWebhookSecret] = useState("");

	const load = useCallback(async () => {
		if (!projectId) return;
		setLoading(true);
		try {
			const result = await getMessagingSettings(projectId);
			setBootstrap(result.data);
		} catch (error) {
			showErrorNotification(message(error, t("Unable to load Support settings")));
		} finally {
			setLoading(false);
		}
	}, [projectId, t]);

	useEffect(() => {
		void load();
	}, [load]);

	const definition = bootstrap?.catalog[selectedType];
	const entities = useMemo(
		() => bootstrap?.entities.filter((entity) => entity.entity_type === selectedType) || [],
		[bootstrap?.entities, selectedType],
	);

	const startNew = useCallback(
		(type = selectedType) => {
			setSelectedId(null);
			setName("");
			setEnabled(true);
			setPosition("0");
			const fields = bootstrap?.catalog[type]?.fields || [];
			setValues(
				Object.fromEntries(
					fields.filter((field) => field.type === "boolean").map((field) => [field.key, false]),
				),
			);
			setWebhookSecret("");
		},
		[bootstrap?.catalog, selectedType],
	);

	const edit = (entity: MessagingConfigurationEntity) => {
		setSelectedId(entity.id);
		setName(entity.name);
		setEnabled(entity.enabled);
		setPosition(String(entity.position));
		const fields = bootstrap?.catalog[entity.entity_type]?.fields || [];
		setValues(
			Object.fromEntries(
				fields.map((field) => [field.key, displayValue(field, entity.configuration[field.key])]),
			),
		);
		setWebhookSecret("");
	};

	const saveEntity = async () => {
		if (!projectId || !definition) return;
		setSaving(true);
		try {
			const configuration = Object.fromEntries(
				definition.fields.flatMap((field) => {
					const parsed = submitValue(field, values[field.key]);
					return parsed === undefined ? [] : [[field.key, parsed]];
				}),
			);
			const payload = {
				entity_type: selectedType,
				name: name.trim(),
				enabled,
				position: Number(position || 0),
				configuration,
			};
			if (selectedId) await updateMessagingConfiguration(projectId, selectedId, payload);
			else await createMessagingConfiguration(projectId, payload);
			showSuccessNotification(t("Item saved"));
			await load();
			startNew(selectedType);
		} catch (error) {
			showErrorNotification(message(error, t("Unable to save item")));
		} finally {
			setSaving(false);
		}
	};

	const remove = async () => {
		if (!projectId || !selectedId || !definition) return;
		if (!window.confirm(t("Delete this item? This action is audited."))) return;
		setSaving(true);
		try {
			await deleteMessagingConfiguration(projectId, selectedId);
			showSuccessNotification(t("Item deleted"));
			await load();
			startNew(selectedType);
		} catch (error) {
			showErrorNotification(message(error, t("Unable to delete item")));
		} finally {
			setSaving(false);
		}
	};

	const rotateWebhookSecret = async () => {
		if (!projectId || !selectedId || webhookSecret.length < 16) return;
		setSaving(true);
		try {
			await rotateSupportWebhookSecret(projectId, selectedId, webhookSecret);
			setWebhookSecret("");
			showSuccessNotification(t("Webhook signing secret rotated"));
			await load();
		} catch (error) {
			showErrorNotification(message(error, t("Unable to rotate the webhook signing secret")));
		} finally {
			setSaving(false);
		}
	};

	const revokeWebhookSecret = async () => {
		if (!projectId || !selectedId || !window.confirm(t("Revoke this webhook signing secret?")))
			return;
		setSaving(true);
		try {
			await revokeSupportWebhookSecret(projectId, selectedId);
			setWebhookSecret("");
			showSuccessNotification(t("Webhook signing secret revoked"));
			await load();
		} catch (error) {
			showErrorNotification(message(error, t("Unable to revoke the webhook signing secret")));
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="space-y-4">
			<Button variant="outline" disabled={loading} onClick={() => void load()}>
				{t("Refresh")}
			</Button>
			<div className="grid gap-6 xl:grid-cols-[minmax(240px,1fr)_2fr]">
				<Card className="h-fit overflow-hidden">
					<div className="flex items-start justify-between gap-3 border-b p-4">
						<div>
							<h2 className="font-semibold">{t(definition?.label || "Settings")}</h2>
							<p className="text-xs text-muted-foreground">
								{definition?.description ? t(definition.description) : null}
							</p>
						</div>
						<Button size="sm" variant="outline" onClick={() => startNew()}>
							{t("New")}
						</Button>
					</div>
					<div className="max-h-[660px] overflow-auto">
						{entities.map((entity) => (
							<button
								key={entity.id}
								type="button"
								onClick={() => edit(entity)}
								className={`w-full border-b p-4 text-left hover:bg-muted ${selectedId === entity.id ? "bg-muted" : ""}`}
							>
								<div className="flex items-center justify-between gap-2">
									<span className="truncate font-medium">{entity.name}</span>
									<Badge variant={entity.enabled ? "secondary" : "outline"}>
										{entity.enabled ? t("Enabled") : t("Disabled")}
									</Badge>
								</div>
								<div className="mt-1 truncate text-xs text-muted-foreground">
									{t("Updated by")} {entity.updated_by}
								</div>
							</button>
						))}
						{!entities.length && (
							<div className="p-8 text-center text-sm text-muted-foreground">
								{t("No items have been created.")}
							</div>
						)}
					</div>
				</Card>

				<Card className="h-fit space-y-5 p-5">
					<div>
						<h2 className="text-lg font-semibold">{selectedId ? t("Edit item") : t("New item")}</h2>
						<p className="text-sm text-muted-foreground">
							{t("Fields and accepted values are validated by the Support Worker.")}
						</p>
					</div>
					<div className="grid gap-4 md:grid-cols-2">
						<ProjectField label={t("Name")} value={name} onChange={setName} />
						<ProjectField
							label={t("Position")}
							type="number"
							value={position}
							onChange={setPosition}
						/>
						<div className="flex items-center justify-between rounded-md border px-3 py-2">
							<Label htmlFor="configuration-enabled">{t("Enabled")}</Label>
							<Switch id="configuration-enabled" checked={enabled} onCheckedChange={setEnabled} />
						</div>
					</div>
					<div className="grid gap-4 md:grid-cols-2">
						{definition?.fields.map((field) => (
							<ConfigurationField
								key={field.key}
								field={field}
								value={values[field.key]}
								onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))}
							/>
						))}
					</div>
					{selectedType === "webhook" && selectedId && (
						<div className="space-y-3 rounded-md border p-4">
							<div>
								<h3 className="font-medium">{t("Signing secret")}</h3>
								<p className="text-xs text-muted-foreground">
									{t("Signing secret status")}
									{": "}
									{entities.find((entity) => entity.id === selectedId)?.secret_configured
										? t("configured")
										: t("not configured")}
									.
								</p>
							</div>
							<Input
								type="password"
								autoComplete="new-password"
								minLength={16}
								placeholder={t("New signing secret (minimum 16 characters)")}
								value={webhookSecret}
								onChange={(event) => setWebhookSecret(event.target.value)}
							/>
							<div className="flex justify-between gap-2">
								<Button
									type="button"
									variant="outline"
									disabled={
										saving ||
										!entities.find((entity) => entity.id === selectedId)?.secret_configured
									}
									onClick={() => void revokeWebhookSecret()}
								>
									{t("Revoke secret")}
								</Button>
								<Button
									type="button"
									disabled={saving || webhookSecret.length < 16}
									onClick={() => void rotateWebhookSecret()}
								>
									{entities.find((entity) => entity.id === selectedId)?.secret_configured
										? t("Rotate secret")
										: t("Configure secret")}
								</Button>
							</div>
						</div>
					)}
					<div className="flex flex-wrap justify-between gap-2">
						<Button
							variant="destructive"
							disabled={!selectedId || saving}
							onClick={() => void remove()}
						>
							{t("Delete")}
						</Button>
						<Button
							disabled={!definition || !name.trim() || saving || loading}
							onClick={() => void saveEntity()}
						>
							{t("Save item")}
						</Button>
					</div>
				</Card>
			</div>
		</div>
	);
}

function ConfigurationField({
	field,
	value,
	onChange,
}: {
	field: MessagingFieldDefinition;
	value?: DraftValue;
	onChange: (value: DraftValue) => void;
}) {
	const { t } = useSupportI18n();
	const id = `configuration-${field.key}`;
	if (field.type === "boolean")
		return (
			<div className="flex items-center justify-between rounded-md border px-3 py-2">
				<div>
					<Label htmlFor={id}>{t(field.label)}</Label>
					{field.help && <p className="text-xs text-muted-foreground">{t(field.help)}</p>}
				</div>
				<Switch id={id} checked={value === true} onCheckedChange={onChange} />
			</div>
		);
	if (field.type === "select")
		return (
			<div className="space-y-2">
				<Label htmlFor={id}>
					{t(field.label)}
					{field.required ? " *" : ""}
				</Label>
				<select
					id={id}
					className="h-9 w-full rounded-md border bg-background px-3 text-sm"
					value={String(value || "")}
					onChange={(event) => onChange(event.target.value)}
				>
					<option value="">{t("Select…")}</option>
					{field.options?.map((option) => (
						<option key={option} value={option}>
							{t(humanize(option))}
						</option>
					))}
				</select>
			</div>
		);
	if (["textarea", "string_list", "json"].includes(field.type))
		return (
			<TextAreaField
				label={`${t(field.label)}${field.required ? " *" : ""}`}
				value={String(value || "")}
				help={
					(field.help ? t(field.help) : undefined) ||
					(field.type === "string_list"
						? t("One value per line.")
						: field.type === "json"
							? t("Valid JSON is required.")
							: undefined)
				}
				onChange={onChange}
			/>
		);
	return (
		<ProjectField
			label={`${t(field.label)}${field.required ? " *" : ""}`}
			type={field.type === "number" ? "number" : "text"}
			value={String(value || "")}
			help={field.help ? t(field.help) : undefined}
			onChange={onChange}
		/>
	);
}

function ProjectField({
	label,
	value,
	onChange,
	type = "text",
	help,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	type?: string;
	help?: string;
}) {
	const id = `field-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;
	return (
		<div className="space-y-2">
			<Label htmlFor={id}>{label}</Label>
			<Input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} />
			{help && <p className="text-xs text-muted-foreground">{help}</p>}
		</div>
	);
}

function TextAreaField({
	label,
	value,
	onChange,
	help,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	help?: string;
}) {
	const id = `field-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;
	return (
		<div className="space-y-2">
			<Label htmlFor={id}>{label}</Label>
			<textarea
				id={id}
				className="min-h-24 w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
				value={value}
				onChange={(event) => onChange(event.target.value)}
			/>
			{help && <p className="text-xs text-muted-foreground">{help}</p>}
		</div>
	);
}

function displayValue(field: MessagingFieldDefinition, value: unknown): DraftValue {
	if (field.type === "boolean") return value === true;
	if (field.type === "json") return value == null ? "" : JSON.stringify(value, null, 2);
	if (field.type === "string_list") return Array.isArray(value) ? value.map(String).join("\n") : "";
	return value == null ? "" : String(value);
}

function submitValue(field: MessagingFieldDefinition, value: DraftValue | undefined): unknown {
	if (field.type === "boolean") return value === true;
	const text = String(value || "").trim();
	if (!text) return undefined;
	if (field.type === "number") return Number(text);
	if (field.type === "string_list") return lines(text);
	if (field.type === "json") return JSON.parse(text) as unknown;
	return text;
}

function lines(value: string) {
	return [
		...new Set(
			value
				.split(/\r?\n|,/)
				.map((item) => item.trim())
				.filter(Boolean),
		),
	];
}
function humanize(value: string) {
	return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}
function message(error: unknown, fallback: string) {
	return error instanceof Error ? error.message : fallback;
}
