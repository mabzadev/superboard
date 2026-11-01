import { Button, Checkbox, Dialog, Input, Loader, Select } from "@superboard/front-ui/kumo";
import { moduleErrorMessage } from "@superboard/front-ui/modules/ModulePage.js";
import { useSearchParams } from "@superboard/front-ui/navigation";
import {
	Table as FrontTable,
	TableHeader as FrontTableHeader,
	TableBody as FrontTableBody,
	TableRow as FrontTableRow,
	TableHead as FrontTableHead,
	TableCell as FrontTableCell,
} from "@superboard/front-ui/ui/table.js";
import { useCallback, useEffect, useState } from "react";

import {
	createEmailSubscriber,
	exportEmailSubscribers,
	deleteEmailSubscriber,
	updateEmailSubscriber,
	getSubscriberLists,
	getEmailSubscriberExport,
	suppressEmailSubscriber,
	type SubscriberList,
	type SubscriberExport,
} from "../api/marketing/marketingService.js";
import {
	assignAudienceTags,
	getAudienceFields,
	getAudienceTags,
	getContactPage,
	type AudienceContact,
	type AudienceField,
	type AudienceTag,
} from "./audience-service.js";
import { ContactImport } from "./ContactImport.js";
import { useStudioI18n } from "./i18n.js";

const languageAttributes = [
	["locale", "Preferred language"],
	["billing_locale", "Billing language"],
	["notification_locale", "Notification language"],
	["marketing_locale", "Marketing language"],
	["support_locale", "Support language"],
	["time_zone", "Time zone"],
] as const;

export function EmailContacts({
	project,
	locales = ["fr", "en"],
}: {
	project: string;
	locales?: string[];
}) {
	const { t, locale } = useStudioI18n();
	const languageNames = new Intl.DisplayNames([locale], { type: "language" });
	const [contacts, setContacts] = useState<AudienceContact[]>([]);
	const [lists, setLists] = useState<SubscriberList[]>([]);
	const [tags, setTags] = useState<AudienceTag[]>([]);
	const [fields, setFields] = useState<AudienceField[]>([]);
	// `?q=` opens the list already searched, e.g. from the Authentication person sheet.
	const linkedQuery = useSearchParams().get("q") ?? "";
	const [query, setQuery] = useState(linkedQuery);
	const [appliedLinkedQuery, setAppliedLinkedQuery] = useState(linkedQuery);
	if (linkedQuery !== appliedLinkedQuery) {
		setAppliedLinkedQuery(linkedQuery);
		setQuery(linkedQuery);
	}
	const [filter, setFilter] = useState("all");
	const [tagFilter, setTagFilter] = useState("all");
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [selected, setSelected] = useState<Partial<AudienceContact> | null>(null);
	const [pendingTags, setPendingTags] = useState<string[]>([]);
	const [checked, setChecked] = useState<string[]>([]);
	const [bulkTag, setBulkTag] = useState("");
	const [detailTag, setDetailTag] = useState("");
	const [activity, setActivity] = useState<SubscriberExport | null>(null);
	const [busy, setBusy] = useState(false);
	const [hasMore, setHasMore] = useState(false);
	const [doubleOptIn, setDoubleOptIn] = useState(false);
	const [importing, setImporting] = useState(false);
	const [confirmation, setConfirmation] = useState<{
		name: string;
		action: () => Promise<unknown>;
	} | null>(null);
	const page = useCallback(
		(offset: number) =>
			getContactPage(project, {
				q: query,
				offset,
				listId: filter === "all" ? "" : filter,
				tagId: tagFilter === "all" ? "" : tagFilter,
			}),
		[project, query, filter, tagFilter],
	);
	const load = useCallback(async () => {
		setLoading(true);
		try {
			const [people, groups] = await Promise.all([page(0), getSubscriberLists(project)]);
			setContacts(people);
			setHasMore(people.length === 50);
			setLists(groups);
			setChecked((values) => values.filter((id) => people.some((person) => person.id === id)));
		} catch {
			setError(t("Loading failed"));
		} finally {
			setLoading(false);
		}
		// Tags and fields are optional enrichments: the list stays usable without them.
		const [tagResult, fieldResult] = await Promise.allSettled([
			getAudienceTags(project),
			getAudienceFields(project),
		]);
		if (tagResult.status === "fulfilled") setTags(tagResult.value);
		if (fieldResult.status === "fulfilled") setFields(fieldResult.value);
	}, [project, page, t]);
	useEffect(() => {
		const timer = setTimeout(() => void load(), 250);
		return () => clearTimeout(timer);
	}, [load]);
	const run = async (action: () => Promise<unknown>) => {
		setBusy(true);
		setError("");
		try {
			await action();
			await load();
		} catch (cause) {
			setError(moduleErrorMessage(cause, locale) || t("Save failed"));
		} finally {
			setBusy(false);
		}
	};
	const tagNames = new Map(tags.map((tag) => [tag.id, tag.name]));
	const attributes = selected?.attributes ?? {};
	const updateAttribute = (key: string, value: unknown) =>
		setSelected((previous) => ({
			...previous,
			attributes: { ...previous?.attributes, [key]: value },
		}));
	const visible = contacts.filter(
		(contact) =>
			`${contact.email} ${contact.name ?? ""}`.toLowerCase().includes(query.toLowerCase()) &&
			(filter === "all" || contact.list_ids?.includes(filter)) &&
			(tagFilter === "all" || contact.tag_ids?.includes(tagFilter)),
	);
	const allChecked = visible.length > 0 && visible.every((contact) => checked.includes(contact.id));
	const bulk = (action: "add" | "remove") => {
		const name = bulkTag.trim();
		if (!name || !checked.length) return;
		const existing = tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
		void run(async () => {
			await assignAudienceTags(project, {
				subscriber_ids: checked,
				action,
				...(existing ? { tag_ids: [existing.id] } : { tag_names: [name] }),
			});
			setBulkTag("");
		}).catch(() => undefined);
	};
	const changeContactTag = (action: "add" | "remove", name: string, tagId?: string) => {
		if (!selected?.id) {
			setPendingTags((values) =>
				action === "add"
					? [...new Set([...values, name])]
					: values.filter((value) => value !== name),
			);
			return;
		}
		const id = selected.id;
		void run(async () => {
			const result = await assignAudienceTags(project, {
				subscriber_ids: [id],
				action,
				...(tagId ? { tag_ids: [tagId] } : { tag_names: [name] }),
			});
			setSelected((previous) =>
				previous
					? {
							...previous,
							tag_ids:
								action === "add"
									? [...new Set([...(previous.tag_ids ?? []), ...result.tag_ids])]
									: previous.tag_ids?.filter((value) => !result.tag_ids.includes(value)),
						}
					: previous,
			);
		}).catch(() => undefined);
	};
	return (
		<div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
			<section className="space-y-4">
				<datalist id="audience-tag-names">
					{tags.map((tag) => (
						<option key={tag.id} value={tag.name} />
					))}
				</datalist>
				<div className="flex flex-wrap justify-between gap-3">
					<div className="flex flex-wrap gap-2">
						<Input
							placeholder={t("Search contacts")}
							aria-label={t("Search contacts")}
							value={query}
							onChange={(event) => setQuery(event.target.value)}
						/>
						<Select
							aria-label={t("Lists")}
							value={filter}
							onValueChange={(value) => value && setFilter(value)}
							items={{
								all: t("All lists"),
								...Object.fromEntries(lists.map((list) => [list.id, list.name])),
							}}
						/>
						{tags.length > 0 && (
							<Select
								aria-label={t("Tags")}
								value={tagFilter}
								onValueChange={(value) => {
									if (value) setTagFilter(value);
								}}
								items={{
									all: t("All tags"),
									...Object.fromEntries(tags.map((tag) => [tag.id, tag.name])),
								}}
							/>
						)}
					</div>
					<div className="flex flex-wrap gap-2">
						<Button
							onClick={() => {
								setImporting(true);
							}}
						>
							{t("Import CSV")}
						</Button>
						<Button
							onClick={async () => {
								try {
									const blob = await exportEmailSubscribers(project);
									const url = URL.createObjectURL(blob);
									const link = document.createElement("a");
									link.href = url;
									link.download = "contacts.csv";
									link.click();
									setTimeout(() => URL.revokeObjectURL(url), 1000);
								} catch {
									setError(t("Loading failed"));
								}
							}}
						>
							{t("Export CSV")}
						</Button>
						<Button
							variant="primary"
							onClick={() => {
								setSelected({ email: "", name: "", attributes: {}, list_ids: [], tag_ids: [] });
								setPendingTags([]);
								setActivity(null);
								setDoubleOptIn(lists.some((list) => list.optin_mode === "double"));
							}}
						>
							{t("Add contact")}
						</Button>
					</div>
				</div>
				{checked.length > 0 && (
					<div className="flex flex-wrap items-end gap-2 rounded-lg border border-kumo-line bg-kumo-tint p-3">
						<p className="me-auto self-center text-sm font-medium">
							{t("{count} selected", { count: checked.length })}
						</p>
						<Input
							aria-label={t("Tag name")}
							placeholder={t("Tag name")}
							list="audience-tag-names"
							value={bulkTag}
							onChange={(event) => {
								setBulkTag(event.target.value);
							}}
						/>
						<Button
							disabled={busy || !bulkTag.trim()}
							onClick={() => {
								bulk("add");
							}}
						>
							{t("Add tag")}
						</Button>
						<Button
							disabled={busy || !bulkTag.trim()}
							onClick={() => {
								bulk("remove");
							}}
						>
							{t("Remove tag")}
						</Button>
						<Button
							variant="ghost"
							onClick={() => {
								setChecked([]);
							}}
						>
							{t("Clear selection")}
						</Button>
					</div>
				)}
				{error && (
					<p role="alert" className="text-kumo-danger">
						{error}
					</p>
				)}
				{loading ? (
					<Loader />
				) : (
					<div className="overflow-auto rounded-lg border border-kumo-line">
						<FrontTable className="w-full text-start text-sm">
							<FrontTableHeader className="bg-kumo-tint">
								<FrontTableRow>
									<FrontTableHead className="w-10 p-4">
										<Checkbox
											aria-label={t("Select all contacts")}
											checked={allChecked}
											onCheckedChange={(value) => {
												setChecked(value ? visible.map((contact) => contact.id) : []);
											}}
										/>
									</FrontTableHead>
									{["Contact", "Language", "Status", "Lists", "Tags"].map((label) => (
										<FrontTableHead key={label} className="p-4 text-start font-medium">
											{t(label)}
										</FrontTableHead>
									))}
								</FrontTableRow>
							</FrontTableHeader>
							<FrontTableBody>
								{visible.map((contact) => (
									<FrontTableRow key={contact.id} className="border-t border-kumo-line">
										<FrontTableCell className="p-4">
											<Checkbox
												aria-label={t("Select {email}", { email: contact.email })}
												checked={checked.includes(contact.id)}
												onCheckedChange={(value) => {
													setChecked((values) =>
														value
															? [...values, contact.id]
															: values.filter((id) => id !== contact.id),
													);
												}}
											/>
										</FrontTableCell>
										<FrontTableCell className="p-3">
											<Button
												variant="ghost"
												className="h-auto flex-col items-start"
												onClick={async () => {
													setSelected(contact);
													setActivity(null);
													try {
														setActivity(await getEmailSubscriberExport(project, contact.id));
													} catch {
														setError(t("Loading failed"));
													}
												}}
											>
												<span>{contact.name || contact.email}</span>
												<span className="mt-1 text-xs text-kumo-subtle">{contact.email}</span>
											</Button>
										</FrontTableCell>
										<FrontTableCell>
											{typeof contact.attributes?.locale === "string"
												? contact.attributes.locale
												: "—"}
										</FrontTableCell>
										<FrontTableCell>{t(contact.consent_status ?? contact.status)}</FrontTableCell>
										<FrontTableCell>{contact.list_ids?.length ?? 0}</FrontTableCell>
										<FrontTableCell className="p-3">
											<TagChips
												names={(contact.tag_ids ?? []).map((id) => tagNames.get(id) ?? "")}
											/>
										</FrontTableCell>
									</FrontTableRow>
								))}
							</FrontTableBody>
						</FrontTable>
						{!visible.length && (
							<p className="p-6 text-kumo-subtle">
								{t(
									query || filter !== "all" || tagFilter !== "all"
										? "No matching contacts"
										: "No contacts yet. Add a contact, import a CSV file or let your application create them.",
								)}
							</p>
						)}
					</div>
				)}
				{hasMore && (
					<Button
						disabled={busy}
						onClick={async () => {
							try {
								const next = await page(contacts.length);
								setContacts((values) => [...values, ...next]);
								setHasMore(next.length === 50);
							} catch {
								setError(t("Loading failed"));
							}
						}}
					>
						{t("Load more")}
					</Button>
				)}
			</section>
			<ContactImport
				project={project}
				open={importing}
				lists={lists}
				fields={fields}
				onClose={() => {
					setImporting(false);
				}}
				onImported={() => void load()}
			/>
			<Dialog.Root
				open={confirmation !== null}
				onOpenChange={(open) => {
					if (!open && !busy) setConfirmation(null);
				}}
			>
				<Dialog className="p-6">
					<Dialog.Title>
						{t("Delete")} · {confirmation?.name}
					</Dialog.Title>
					<Dialog.Description>{t("This item will be deleted.")}</Dialog.Description>
					{error && <p role="alert">{error}</p>}
					<div className="mt-5 flex justify-end gap-2">
						<Button disabled={busy} onClick={() => setConfirmation(null)}>
							{t("Cancel")}
						</Button>
						<Button
							variant="destructive"
							disabled={busy}
							onClick={async () => {
								if (!confirmation) return;
								setBusy(true);
								try {
									await confirmation.action();
									setConfirmation(null);
									await load();
								} catch {
									setError(t("Save failed"));
								} finally {
									setBusy(false);
								}
							}}
						>
							{t("Delete")}
						</Button>
					</div>
				</Dialog>
			</Dialog.Root>
			<aside className="space-y-4 rounded-lg border border-kumo-line bg-kumo-base p-5">
				{selected ? (
					<>
						<h2 className="text-lg font-semibold">{selected.name || t("Contact")}</h2>
						<Input
							label={t("Name")}
							value={selected.name ?? ""}
							onChange={(event) => setSelected({ ...selected, name: event.target.value })}
						/>
						<Input
							type="email"
							label={t("Email")}
							value={selected.email ?? ""}
							onChange={(event) => setSelected({ ...selected, email: event.target.value })}
						/>
						<div className="space-y-2">
							<p className="text-sm font-medium">{t("Tags")}</p>
							<TagChips
								names={
									selected.id
										? (selected.tag_ids ?? []).map((id) => tagNames.get(id) ?? "")
										: pendingTags
								}
								onRemove={(name) => {
									changeContactTag("remove", name, tags.find((tag) => tag.name === name)?.id);
								}}
								removeLabel={(name) => t("Remove tag {tag}", { tag: name })}
							/>
							<form
								className="flex items-end gap-2"
								onSubmit={(event) => {
									event.preventDefault();
									const name = detailTag.trim();
									if (!name) return;
									changeContactTag(
										"add",
										name,
										tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase())?.id,
									);
									setDetailTag("");
								}}
							>
								<Input
									aria-label={t("Add a tag")}
									placeholder={t("Add a tag")}
									list="audience-tag-names"
									value={detailTag}
									onChange={(event) => {
										setDetailTag(event.target.value);
									}}
								/>
								<Button type="submit" size="sm" disabled={busy || !detailTag.trim()}>
									{t("Add")}
								</Button>
							</form>
						</div>
						{fields.map((field) => (
							<CustomFieldInput
								key={field.id}
								field={field}
								value={attributes[field.key]}
								onChange={(value) => {
									updateAttribute(field.key, value);
								}}
							/>
						))}
						<details>
							<summary className="cursor-pointer text-sm font-medium">
								{t("Languages and time zone")}
							</summary>
							<div className="mt-3 space-y-3">
								{languageAttributes.map(([key, label]) =>
									key === "time_zone" ? (
										<Input
											key={key}
											label={t(label)}
											value={String(attributes[key] ?? "")}
											onChange={(event) => {
												updateAttribute(key, event.target.value);
											}}
										/>
									) : (
										<Select
											key={key}
											label={t(label)}
											value={String(attributes[key] ?? "")}
											onValueChange={(value) => {
												updateAttribute(key, value ?? "");
											}}
											items={Object.fromEntries(
												[...new Set(["", ...locales, String(attributes[key] ?? "")])].map(
													(language) => {
														let name = language;
														try {
															name = language
																? (languageNames.of(language) ?? language)
																: t("Use account language");
														} catch {
															name = language;
														}
														return [language, name];
													},
												),
											)}
										/>
									),
								)}
							</div>
						</details>
						{lists.map((list) => (
							<Checkbox
								key={list.id}
								label={list.name}
								checked={selected.list_ids?.includes(list.id) ?? false}
								onCheckedChange={(value) =>
									setSelected({
										...selected,
										list_ids: value
											? [...(selected.list_ids ?? []), list.id]
											: selected.list_ids?.filter((id) => id !== list.id),
									})
								}
							/>
						))}
						{!selected.id && (
							<Checkbox
								label={t("Ask for confirmation by email (double opt-in)")}
								checked={doubleOptIn}
								onCheckedChange={(value) => {
									setDoubleOptIn(value);
								}}
							/>
						)}
						<Button
							variant="primary"
							disabled={busy || !selected.email}
							onClick={() =>
								void run(async () => {
									const payload = {
										email: selected.email,
										name: selected.name,
										attributes: selected.attributes,
										list_ids: selected.list_ids,
										...(selected.id ? {} : { double_opt_in: doubleOptIn }),
									};
									const result = selected.id
										? await updateEmailSubscriber(project, selected.id, payload)
										: await createEmailSubscriber(project, payload);
									if (!selected.id && pendingTags.length && result.id)
										await assignAudienceTags(project, {
											subscriber_ids: [result.id],
											tag_names: pendingTags,
											action: "add",
										});
									setPendingTags([]);
									setSelected({ ...result, tag_ids: (result as AudienceContact).tag_ids ?? [] });
								})
							}
						>
							{t("Save")}
						</Button>
						{selected.id && (
							<Button
								variant="secondary-destructive"
								disabled={busy}
								onClick={() =>
									void run(async () => {
										setSelected(
											await suppressEmailSubscriber(project, selected.id!, "unsubscribe"),
										);
									})
								}
							>
								{t("Unsubscribe")}
							</Button>
						)}
						{selected.id && (
							<Button
								variant="secondary-destructive"
								disabled={busy}
								onClick={() =>
									setConfirmation({
										name: selected.email ?? "",
										action: async () => {
											await deleteEmailSubscriber(project, selected.id!);
											setSelected(null);
											setActivity(null);
										},
									})
								}
							>
								{t("Delete contact")}
							</Button>
						)}
						{activity && (
							<div className="space-y-3 border-t border-kumo-line pt-4">
								<h3 className="font-semibold">{t("Activity")}</h3>
								{activity.events.slice(0, 20).map((event, index) => (
									<div
										key={String(event.id ?? index)}
										className="rounded-lg bg-kumo-tint p-3 text-xs"
									>
										<p>{t(String(event.event_type ?? event.type ?? "Event"))}</p>
										<p className="mt-1 text-kumo-subtle">
											{String(event.occurred_at ?? event.created_at ?? "")}
										</p>
									</div>
								))}
							</div>
						)}
					</>
				) : (
					<p className="text-sm text-kumo-subtle">
						{t("Select a contact to view preferences and activity.")}
					</p>
				)}
			</aside>
		</div>
	);
}

function TagChips({
	names,
	onRemove,
	removeLabel,
}: {
	names: string[];
	onRemove?: (name: string) => void;
	removeLabel?: (name: string) => string;
}) {
	const visible = names.filter(Boolean);
	if (!visible.length) return <span className="text-kumo-subtle">—</span>;
	return (
		<span className="flex flex-wrap gap-1">
			{visible.map((name) => (
				<span
					key={name}
					className="inline-flex items-center gap-1 rounded-full bg-kumo-tint px-2 py-0.5 text-xs"
				>
					{name}
					{onRemove && (
						<button
							type="button"
							className="text-kumo-subtle hover:text-kumo-default"
							aria-label={removeLabel?.(name) ?? name}
							onClick={() => {
								onRemove(name);
							}}
						>
							×
						</button>
					)}
				</span>
			))}
		</span>
	);
}

/** Shows a stored custom field value in a text control; structured values stay empty. */
function fieldText(value: unknown) {
	return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
		? String(value)
		: "";
}

function CustomFieldInput({
	field,
	value,
	onChange,
}: {
	field: AudienceField;
	value: unknown;
	onChange: (value: unknown) => void;
}) {
	const { t } = useStudioI18n();
	if (field.field_type === "boolean")
		return (
			<Checkbox
				label={field.label}
				checked={value === true || value === "true"}
				onCheckedChange={(checked) => {
					onChange(checked);
				}}
			/>
		);
	if (field.field_type === "select")
		return (
			<Select
				label={field.label}
				value={fieldText(value)}
				onValueChange={(next) => {
					onChange(next ?? "");
				}}
				items={{
					"": t("Not set"),
					...Object.fromEntries(field.options.map((option) => [option, option])),
				}}
			/>
		);
	return (
		<Input
			type={
				field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : "text"
			}
			label={field.label}
			value={fieldText(value)}
			onChange={(event) => {
				onChange(event.target.value);
			}}
		/>
	);
}
