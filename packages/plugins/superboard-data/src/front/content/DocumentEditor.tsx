import { Button } from "@superboard/front-ui/ui/button.js";
import { Input } from "@superboard/front-ui/ui/input.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@superboard/front-ui/ui/tabs.js";
import { useState } from "react";

import { DocumentHistory, DocumentTranslations } from "./DocumentRelations.js";
import { DocumentTerms } from "./TaxonomiesView.js";
import { DELETE, POST, PUT } from "./transport.js";
import {
	responseData,
	fieldText,
	collectionPath,
	schemaPath,
	encode,
	TextField,
	useDataI18n,
	useOperation,
	useResource,
	type Document,
	type Field,
	type Page,
} from "./workspace.js";

interface Entry {
	item: Document;
	_rev?: string;
}
export function DocumentEditor({
	collection,
	id,
	language,
	onBack,
	onSelect,
}: {
	collection: string;
	id: string;
	language: string;
	onBack(): void;
	onSelect(item: Document): void;
}) {
	const { t } = useDataI18n();
	const [tab, setTab] = useState("fields");
	const resource = useResource<Entry>(
		id ? `${collectionPath(collection)}/${encode(id)}?locale=${encode(language)}` : null,
	);
	const fields = useResource<Page<Field>>(`${schemaPath(collection)}/fields`);
	return (
		<div className="space-y-4 pt-4">
			<Button onClick={onBack}>{t.back}</Button>
			{resource.error || fields.error ? (
				<div role="alert">
					{resource.error ?? fields.error}
					<Button
						onClick={() => {
							resource.refresh();
							fields.refresh();
						}}
					>
						{t.retry}
					</Button>
				</div>
			) : (id && !resource.data) || !fields.data ? (
				<p role="status">{t.loading}</p>
			) : (
				<EditorForm
					key={`${id}:${resource.data?._rev ?? "new"}`}
					collection={collection}
					entry={resource.data}
					fields={fields.data.items}
					language={language}
					onBack={onBack}
					onSelect={onSelect}
					refresh={resource.refresh}
					tab={tab}
					setTab={setTab}
				/>
			)}
		</div>
	);
}
function EditorForm({
	collection,
	entry,
	fields,
	language,
	onBack,
	onSelect,
	refresh,
	tab,
	setTab,
}: {
	collection: string;
	entry: Entry | null;
	fields: Field[];
	language: string;
	onBack(): void;
	onSelect(item: Document): void;
	refresh(): void;
	tab: string;
	setTab(value: string): void;
}) {
	const { t } = useDataI18n();
	const operation = useOperation();
	const [slug, setSlug] = useState(entry?.item.slug ?? "");
	const [values, setValues] = useState<Record<string, unknown>>(entry?.item.data ?? {});
	const [json, setJson] = useState(JSON.stringify(values, null, 2));
	const [advanced, setAdvanced] = useState(false);
	const [dirty, setDirty] = useState(false);

	const [scheduledAt, setScheduledAt] = useState("");
	const [preview, setPreview] = useState<string | null>(null);
	const [confirmation, setConfirmation] = useState<"remove" | "discard" | null>(null);
	const base = collectionPath(collection);
	const itemPath = `${base}/${encode(entry?.item.id ?? "")}`;
	const actionPath = (action: string) => `${itemPath}/${action}?locale=${encode(language)}`;
	function update(field: string, value: unknown) {
		setDirty(true);
		setValues((current) => ({ ...current, [field]: value }));
	}
	async function save() {
		let data: unknown = values;
		if (advanced) {
			try {
				data = JSON.parse(json);
			} catch {
				throw new Error(t.invalid);
			}
		}
		if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(t.invalid);
		if (entry) {
			await PUT(`${itemPath}?locale=${encode(language)}`, {
				slug,
				data,
				...(entry._rev ? { _rev: entry._rev } : {}),
			});
			refresh();
		} else {
			const response = await POST(base, { slug, data, locale: language });
			onSelect((await responseData<Entry>(response)).item);
		}
	}
	async function action(name: string) {
		await POST(actionPath(name), {});
		refresh();
	}
	return (
		<div className="space-y-4">
			{operation.feedback}
			<Tabs value={tab} onValueChange={setTab}>
				<TabsList aria-label={t.edit}>
					{(
						[
							"fields",
							...(entry
								? (["publication", "revisions", "translations", "assignments"] as const)
								: []),
						] as const
					).map((value) => (
						<TabsTrigger key={value} value={value} disabled={operation.busy}>
							{t[value]}
						</TabsTrigger>
					))}
				</TabsList>
				<TabsContent value="fields">
					<form
						className="grid max-w-3xl gap-4"
						onSubmit={(event) => {
							event.preventDefault();
							operation.run(save);
						}}
					>
						<TextField
							label={t.slug}
							value={slug}
							onChange={(value) => {
								setSlug(value);
								setDirty(true);
							}}
						/>
						<label className="flex items-center gap-2">
							<Input
								className="w-auto"
								type="checkbox"
								checked={advanced}
								onChange={(event) => {
									if (event.target.checked) {
										setJson(JSON.stringify(values, null, 2));
										setAdvanced(true);
									} else {
										try {
											const parsed: unknown = JSON.parse(json);
											if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
												throw new Error(t.invalid);
											setValues(Object.fromEntries(Object.entries(parsed)));
											setAdvanced(false);
										} catch {
											operation.run(async () => {
												throw new Error(t.invalid);
											});
										}
									}
								}}
							/>
							{t.advanced}
						</label>
						{advanced ? (
							<label className="grid gap-2">
								{t.fields}
								<textarea
									className="min-h-64 rounded border p-3 font-mono"
									value={json}
									onChange={(event) => {
										setJson(event.target.value);
										setDirty(true);
									}}
								/>
							</label>
						) : (
							fields.map((field) => (
								<ValueField
									key={field.slug}
									field={field}
									value={values[field.slug]}
									onChange={(value) => {
										update(field.slug, value);
									}}
								/>
							))
						)}
						<Button type="submit" disabled={operation.busy}>
							{entry ? t.save : t.create}
						</Button>
					</form>
				</TabsContent>
				{entry && (
					<>
						<TabsContent value="publication">
							<div className="space-y-4">
								{dirty && <p role="status">{t.unsaved}</p>}
								<p>{entry.item.status === "published" ? t.published : t.draft}</p>
								<div className="flex flex-wrap gap-2">
									<Button
										disabled={operation.busy || dirty}
										onClick={() => {
											operation.run(() => action("publish"));
										}}
									>
										{t.publish}
									</Button>
									<Button
										disabled={operation.busy || dirty || !entry.item.liveRevisionId}
										onClick={() => {
											operation.run(() => action("unpublish"));
										}}
									>
										{t.unpublish}
									</Button>
									<Button
										disabled={operation.busy || dirty}
										onClick={() => {
											operation.run(async () => {
												const result = await POST(`${itemPath}/duplicate`, {});
												onSelect((await responseData<Entry>(result)).item);
											});
										}}
									>
										{t.duplicate}
									</Button>
									<Button
										disabled={operation.busy || !entry.item.liveRevisionId}
										onClick={() => {
											setConfirmation("discard");
										}}
									>
										{t.discard}
									</Button>
									<Button
										disabled={operation.busy}
										onClick={() => {
											setConfirmation("remove");
										}}
									>
										{t.remove}
									</Button>
								</div>
								{confirmation && (
									<div
										role="alertdialog"
										aria-label={confirmation === "remove" ? t.remove : t.discard}
										className="space-y-3 rounded border p-4"
									>
										<p>{confirmation === "remove" ? t.confirmRemove : t.confirmDiscard}</p>
										<Button
											disabled={operation.busy}
											onClick={() => {
												operation.run(async () => {
													if (confirmation === "remove") {
														await DELETE(`${itemPath}?locale=${encode(language)}`);
														onBack();
													} else await action("discard-draft");
													setConfirmation(null);
												});
											}}
										>
											{t.confirm}
										</Button>
										<Button
											onClick={() => {
												setConfirmation(null);
											}}
										>
											{t.cancel}
										</Button>
									</div>
								)}
								<form
									className="flex flex-wrap items-end gap-3"
									onSubmit={(event) => {
										event.preventDefault();
										operation.run(async () => {
											await POST(actionPath("schedule"), {
												scheduledAt: new Date(scheduledAt).toISOString(),
											});
											refresh();
										});
									}}
								>
									<TextField
										label={t.scheduledAt}
										type="datetime-local"
										value={scheduledAt}
										onChange={setScheduledAt}
										required
									/>
									<Button type="submit" disabled={operation.busy || dirty}>
										{t.schedule}
									</Button>
								</form>
								{entry.item.scheduledAt && (
									<div className="flex gap-3">
										<time dateTime={entry.item.scheduledAt}>{entry.item.scheduledAt}</time>
										<Button
											disabled={operation.busy}
											onClick={() => {
												operation.run(async () => {
													await DELETE(actionPath("schedule"));
													refresh();
												});
											}}
										>
											{t.unschedule}
										</Button>
									</div>
								)}
								<Button
									disabled={operation.busy || dirty}
									onClick={() => {
										operation.run(async () => {
											const response = await POST(`${itemPath}/preview-url`, {});
											const url = new URL(
												(await responseData<{ url: string }>(response)).url,
												window.location.origin,
											);
											if (!["http:", "https:"].includes(url.protocol)) throw new Error(t.failed);
											setPreview(url.href);
										});
									}}
								>
									{t.preview}
								</Button>
								{preview && (
									<a href={preview} target="_blank" rel="noopener noreferrer">
										{t.openPreview}
									</a>
								)}
							</div>
						</TabsContent>
						<TabsContent value="revisions">
							<DocumentHistory path={itemPath} onChanged={refresh} />
						</TabsContent>
						<TabsContent value="translations">
							<DocumentTranslations collection={collection} item={entry.item} onSelect={onSelect} />
						</TabsContent>
						<TabsContent value="assignments">
							<DocumentTerms collection={collection} item={entry.item} />
						</TabsContent>
					</>
				)}
			</Tabs>
		</div>
	);
}
function ValueField({
	field,
	value,
	onChange,
}: {
	field: Field;
	value: unknown;
	onChange(value: unknown): void;
}) {
	const { t } = useDataI18n();
	if (
		["json", "portableText", "repeater", "multiSelect", "reference", "image", "file"].includes(
			field.type,
		)
	)
		return <JsonField field={field} value={value} onChange={onChange} />;
	if (field.type === "boolean")
		return (
			<label className="flex items-center gap-2">
				<Input
					type="checkbox"
					className="w-auto"
					checked={Boolean(value)}
					onChange={(event) => {
						onChange(event.target.checked);
					}}
				/>
				{field.label}
			</label>
		);
	if (field.type === "select")
		return (
			<label className="grid gap-2">
				{field.label}
				<select
					value={fieldText(value)}
					required={field.required}
					onChange={(event) => {
						onChange(event.target.value);
					}}
				>
					<option value="">{t.select}</option>
					{field.validation?.options?.map((option) => (
						<option key={option} value={option}>
							{option}
						</option>
					))}
				</select>
			</label>
		);
	if (field.type === "text")
		return (
			<label className="grid gap-2">
				{field.label}
				<textarea
					className="min-h-32 rounded border p-3"
					value={fieldText(value)}
					required={field.required}
					onChange={(event) => {
						onChange(event.target.value);
					}}
				/>
			</label>
		);
	const numeric = ["number", "integer"].includes(field.type);
	return (
		<label className="grid gap-2">
			{field.label}
			<Input
				type={numeric ? "number" : field.type === "url" ? "url" : "text"}
				step={field.type === "integer" ? 1 : "any"}
				value={fieldText(value)}
				required={field.required}
				onChange={(event) => {
					onChange(
						numeric
							? event.target.value === ""
								? null
								: Number(event.target.value)
							: event.target.value,
					);
				}}
			/>
		</label>
	);
}
function JsonField({
	field,
	value,
	onChange,
}: {
	field: Field;
	value: unknown;
	onChange(value: unknown): void;
}) {
	const { t } = useDataI18n();
	const [text, setText] = useState(JSON.stringify(value ?? null, null, 2));
	return (
		<label className="grid gap-2">
			{field.label}
			<textarea
				className="min-h-32 rounded border p-3 font-mono"
				value={text}
				required={field.required}
				onChange={(event) => {
					setText(event.target.value);
					try {
						onChange(JSON.parse(event.target.value));
						event.target.setCustomValidity("");
					} catch {
						event.target.setCustomValidity(t.invalid);
					}
				}}
			/>
		</label>
	);
}
