import { Button, Input, InputArea, Loader, Select } from "@superboard/front-ui/kumo";
import { moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import { EmptyState } from "@superboard/front-ui/ui/widgets.js";
import { useCallback, useEffect, useState } from "react";

import {
	createAudienceField,
	createAudienceTag,
	deleteAudienceField,
	deleteAudienceTag,
	getAudienceFields,
	getAudienceTags,
	updateAudienceField,
	updateAudienceTag,
	type AudienceField,
	type AudienceTag,
	type FieldType,
} from "./audience-service.js";
import { useStudioI18n } from "./i18n.js";

const fieldTypes: Record<FieldType, string> = {
	text: "Text",
	number: "Number",
	date: "Date",
	boolean: "Yes / no",
	select: "Choice list",
};

function keyFromLabel(label: string) {
	return label
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.replace(/^(\d)/, "f_$1")
		.slice(0, 64);
}

/** Custom contact fields and tags, managed side by side. */
export function AudienceFields({ project }: { project: string }) {
	const { t, locale } = useStudioI18n();
	const [fields, setFields] = useState<AudienceField[]>([]);
	const [tags, setTags] = useState<AudienceTag[]>([]);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [editing, setEditing] = useState<AudienceField | null>(null);
	const [label, setLabel] = useState("");
	const [key, setKey] = useState("");
	const [keyTouched, setKeyTouched] = useState(false);
	const [type, setType] = useState<FieldType>("text");
	const [options, setOptions] = useState("");
	const [tagName, setTagName] = useState("");
	const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
	const fetchAll = useCallback(
		() => Promise.all([getAudienceFields(project), getAudienceTags(project)]),
		[project],
	);
	const apply = useCallback(([nextFields, nextTags]: [AudienceField[], AudienceTag[]]) => {
		setFields(nextFields);
		setTags(nextTags);
		setLoading(false);
	}, []);
	const fail = useCallback(() => {
		setError(t("Loading failed"));
		setLoading(false);
	}, [t]);
	const reload = useCallback(() => fetchAll().then(apply, fail), [fetchAll, apply, fail]);
	useEffect(() => {
		let active = true;
		void fetchAll().then(
			(values) => {
				if (active) apply(values);
			},
			() => {
				if (active) fail();
			},
		);
		return () => {
			active = false;
		};
	}, [fetchAll, apply, fail]);
	const run = async (action: () => Promise<unknown>) => {
		setBusy(true);
		setError("");
		try {
			await action();
			await reload();
			return true;
		} catch (cause) {
			setError(moduleErrorMessage(cause, locale));
			return false;
		} finally {
			setBusy(false);
		}
	};
	const resetField = () => {
		setEditing(null);
		setLabel("");
		setKey("");
		setKeyTouched(false);
		setType("text");
		setOptions("");
	};
	const optionList = options
		.split("\n")
		.map((option) => option.trim())
		.filter(Boolean);
	if (loading) return <Loader />;
	return (
		<div className="grid gap-6 xl:grid-cols-2">
			{error && (
				<p role="alert" className="text-kumo-danger xl:col-span-2">
					{error}
				</p>
			)}
			<section className="space-y-4">
				<div>
					<h2 className="font-semibold">{t("Contact fields")}</h2>
					<p className="text-sm text-kumo-subtle">
						{t(
							"Fields appear on every contact, in imports, segments and signup forms. Emails can show them with their key.",
						)}
					</p>
				</div>
				{fields.length ? (
					<ul className="divide-y divide-kumo-line rounded-lg border border-kumo-line">
						{fields.map((field) => (
							<li key={field.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
								<div>
									<p className="font-medium">{field.label}</p>
									<p className="text-xs text-kumo-subtle">
										{field.key} · {t(fieldTypes[field.field_type])}
										{field.options.length ? ` · ${field.options.join(", ")}` : ""}
									</p>
								</div>
								<div className="flex gap-2">
									<Button
										size="sm"
										onClick={() => {
											setEditing(field);
											setLabel(field.label);
											setKey(field.key);
											setType(field.field_type);
											setOptions(field.options.join("\n"));
										}}
									>
										{t("Edit")}
									</Button>
									<Button
										size="sm"
										variant="ghost"
										disabled={busy}
										aria-label={t("Delete {name}", { name: field.label })}
										onClick={() => void run(() => deleteAudienceField(project, field.id))}
									>
										{t("Delete")}
									</Button>
								</div>
							</li>
						))}
					</ul>
				) : (
					<EmptyState
						title={t("No custom fields yet")}
						description={t(
							"Add fields such as company, plan or birthday to know your contacts better.",
						)}
					/>
				)}
				<form
					className="space-y-3 rounded-lg border border-kumo-line bg-kumo-base p-4"
					onSubmit={(event) => {
						event.preventDefault();
						void run(() =>
							editing
								? updateAudienceField(project, editing.id, {
										label: label.trim(),
										...(editing.field_type === "select" ? { options: optionList } : {}),
									})
								: createAudienceField(project, {
										key,
										label: label.trim(),
										field_type: type,
										options: type === "select" ? optionList : [],
									}),
						)
							.then((saved) => {
								if (saved) resetField();
							})
							.catch(() => undefined);
					}}
				>
					<h3 className="font-medium">{t(editing ? "Edit field" : "Add a field")}</h3>
					<Input
						label={t("Label")}
						value={label}
						required
						onChange={(event) => {
							setLabel(event.target.value);
							if (!editing && !keyTouched) setKey(keyFromLabel(event.target.value));
						}}
					/>
					{!editing && (
						<>
							<Input
								label={t("Key")}
								value={key}
								required
								pattern="[a-z][a-z0-9_]*"
								onChange={(event) => {
									setKeyTouched(true);
									setKey(event.target.value.toLowerCase());
								}}
							/>
							<Select
								label={t("Type")}
								value={type}
								onValueChange={(next) => {
									if (next) setType(next);
								}}
								items={Object.fromEntries(
									Object.entries(fieldTypes).map(([value, name]) => [value, t(name)]),
								)}
							/>
						</>
					)}
					{(editing ? editing.field_type : type) === "select" && (
						<InputArea
							label={t("Choices, one per line")}
							value={options}
							onChange={(event) => {
								setOptions(event.target.value);
							}}
						/>
					)}
					<div className="flex gap-2">
						<Button
							type="submit"
							variant="primary"
							disabled={
								busy ||
								!label.trim() ||
								(!editing && !key) ||
								((editing ? editing.field_type : type) === "select" && !optionList.length)
							}
						>
							{t(editing ? "Save" : "Add field")}
						</Button>
						{editing && <Button onClick={resetField}>{t("Cancel")}</Button>}
					</div>
				</form>
			</section>
			<section className="space-y-4">
				<div>
					<h2 className="font-semibold">{t("Tags")}</h2>
					<p className="text-sm text-kumo-subtle">
						{t(
							"Tag contacts from the contact list, imports or automations, then target them in segments.",
						)}
					</p>
				</div>
				<form
					className="flex flex-wrap items-end gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						void run(() => createAudienceTag(project, tagName.trim()))
							.then((saved) => {
								if (saved) setTagName("");
							})
							.catch(() => undefined);
					}}
				>
					<Input
						label={t("New tag")}
						value={tagName}
						onChange={(event) => {
							setTagName(event.target.value);
						}}
					/>
					<Button type="submit" variant="primary" disabled={busy || !tagName.trim()}>
						{t("Add tag")}
					</Button>
				</form>
				{tags.length ? (
					<ul className="divide-y divide-kumo-line rounded-lg border border-kumo-line">
						{tags.map((tag) => (
							<li key={tag.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
								{renaming?.id === tag.id ? (
									<form
										className="flex flex-1 items-end gap-2"
										onSubmit={(event) => {
											event.preventDefault();
											void run(() => updateAudienceTag(project, tag.id, renaming.name.trim()))
												.then((saved) => {
													if (saved) setRenaming(null);
												})
												.catch(() => undefined);
										}}
									>
										<Input
											aria-label={t("Tag name")}
											value={renaming.name}
											onChange={(event) => {
												setRenaming({ id: tag.id, name: event.target.value });
											}}
										/>
										<Button type="submit" size="sm" disabled={busy || !renaming.name.trim()}>
											{t("Save")}
										</Button>
										<Button
											size="sm"
											variant="ghost"
											onClick={() => {
												setRenaming(null);
											}}
										>
											{t("Cancel")}
										</Button>
									</form>
								) : (
									<>
										<p>
											<span className="font-medium">{tag.name}</span>{" "}
											<span className="text-xs text-kumo-subtle">
												{t("{count} contacts", { count: tag.subscriber_count ?? 0 })}
											</span>
										</p>
										<div className="flex gap-2">
											<Button
												size="sm"
												onClick={() => {
													setRenaming({ id: tag.id, name: tag.name });
												}}
											>
												{t("Rename")}
											</Button>
											<Button
												size="sm"
												variant="ghost"
												disabled={busy}
												aria-label={t("Delete {name}", { name: tag.name })}
												onClick={() => void run(() => deleteAudienceTag(project, tag.id))}
											>
												{t("Delete")}
											</Button>
										</div>
									</>
								)}
							</li>
						))}
					</ul>
				) : (
					<EmptyState
						title={t("No tags yet")}
						description={t("Create a tag here or select contacts in the list to tag them.")}
					/>
				)}
			</section>
		</div>
	);
}
