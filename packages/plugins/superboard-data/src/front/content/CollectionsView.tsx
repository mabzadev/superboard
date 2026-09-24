import { Button } from "@superboard/front-ui/ui/button.js";
import { Input } from "@superboard/front-ui/ui/input.js";
import { useState } from "react";

import { POST, PUT } from "./transport.js";
import {
	schemaPath,
	encode,
	TextField,
	useDataI18n,
	useOperation,
	useResource,
	type Collection,
	type Field,
	type Page,
} from "./workspace.js";

export function CollectionsView({
	collections,
	collection,
	onSelect,
	onChanged,
}: {
	collections: Collection[];
	collection: string;
	onSelect(value: string): void;
	onChanged(): void;
}) {
	const { t } = useDataI18n();
	const operation = useOperation();
	const [slug, setSlug] = useState("");
	const [label, setLabel] = useState("");
	return (
		<div className="grid gap-6 pt-4 lg:grid-cols-2">
			<form
				className="grid content-start gap-3"
				onSubmit={(event) => {
					event.preventDefault();
					operation.run(async () => {
						await POST("/_emdash/api/schema/collections", { slug, label, labelSingular: label });
						setSlug("");
						setLabel("");
						onSelect(slug);
						onChanged();
					});
				}}
			>
				<h2>{t.createCollection}</h2>
				{operation.feedback}
				<TextField label={t.collectionName} value={label} onChange={setLabel} required />
				<TextField label={t.slug} value={slug} onChange={setSlug} required />
				<Button type="submit" disabled={operation.busy}>
					{t.createCollection}
				</Button>
			</form>
			<div className="space-y-4">
				<label className="grid gap-2">
					{t.collection}
					<select
						value={collection}
						onChange={(event) => {
							onSelect(event.target.value);
						}}
					>
						{collections.map((item) => (
							<option key={item.slug} value={item.slug}>
								{item.label}
							</option>
						))}
					</select>
				</label>
				{collection && <CollectionFields key={collection} collection={collection} />}
			</div>
		</div>
	);
}
function CollectionFields({ collection }: { collection: string }) {
	const { t } = useDataI18n();
	const operation = useOperation();
	const resource = useResource<Page<Field>>(`${schemaPath(collection)}/fields`);
	const [selected, setSelected] = useState<Field | null>(null);
	const [slug, setSlug] = useState("");
	const [label, setLabel] = useState("");
	const [type, setType] = useState("string");
	const [required, setRequired] = useState(false);
	const [options, setOptions] = useState("");
	function select(field: Field | null) {
		setSelected(field);
		setSlug(field?.slug ?? "");
		setLabel(field?.label ?? "");
		setType(field?.type ?? "string");
		setRequired(field?.required ?? false);
		setOptions(field?.validation?.options?.join("\n") ?? "");
	}
	return (
		<div className="space-y-4">
			<h2>{t.fieldsTitle}</h2>
			{operation.feedback}
			{resource.error && <p role="alert">{resource.error}</p>}
			<ul>
				{resource.data?.items.map((field) => (
					<li key={field.slug}>
						<Button
							variant="ghost"
							onClick={() => {
								select(field);
							}}
						>
							{field.label} · {field.type}
						</Button>
					</li>
				))}
			</ul>
			<Button
				onClick={() => {
					select(null);
				}}
			>
				{t.addField}
			</Button>
			<form
				className="grid gap-3"
				onSubmit={(event) => {
					event.preventDefault();
					operation.run(async () => {
						const values = {
							label,
							required,
							...(type === "select"
								? {
										validation: {
											options: options
												.split("\n")
												.map((value) => value.trim())
												.filter(Boolean),
										},
									}
								: {}),
						};
						if (selected)
							await PUT(`${schemaPath(collection)}/fields/${encode(selected.slug)}`, values);
						else await POST(`${schemaPath(collection)}/fields`, { ...values, slug, type });
						select(null);
						resource.refresh();
					});
				}}
			>
				<TextField label={t.fieldName} value={label} onChange={setLabel} required />
				{!selected && <TextField label={t.slug} value={slug} onChange={setSlug} required />}
				<label className="grid gap-2">
					{t.type}
					<select
						value={type}
						disabled={!!selected}
						onChange={(event) => {
							setType(event.target.value);
						}}
					>
						{(
							[
								"string",
								"text",
								"number",
								"integer",
								"boolean",
								"datetime",
								"url",
								"select",
								"json",
							] as const
						).map((value) => (
							<option key={value} value={value}>
								{value === "select" ? t.selectType : t[value]}
							</option>
						))}
						{selected &&
							![
								"string",
								"text",
								"number",
								"integer",
								"boolean",
								"datetime",
								"url",
								"select",
								"json",
							].includes(type) && <option value={type}>{type}</option>}
					</select>
				</label>
				{type === "select" && (
					<label className="grid gap-2">
						{t.options}
						<textarea
							value={options}
							onChange={(event) => {
								setOptions(event.target.value);
							}}
							required
						/>
					</label>
				)}
				<label className="flex items-center gap-2">
					<Input
						type="checkbox"
						className="w-auto"
						checked={required}
						onChange={(event) => {
							setRequired(event.target.checked);
						}}
					/>
					{t.required}
				</label>
				<Button type="submit" disabled={operation.busy}>
					{selected ? t.save : t.addField}
				</Button>
			</form>
		</div>
	);
}
