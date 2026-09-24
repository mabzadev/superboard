import { Button } from "@superboard/front-ui/ui/button.js";
import { Input } from "@superboard/front-ui/ui/input.js";
import { useState } from "react";

import { DELETE, POST, PUT } from "./transport.js";
import {
	collectionPath,
	encode,
	TextField,
	useDataI18n,
	useOperation,
	useResource,
	type Collection,
	type Document,
} from "./workspace.js";

interface Taxonomy {
	name: string;
	label: string;
	collections: string[];
}
interface Term {
	id: string;
	slug: string;
	label: string;
	children?: Term[];
}
function flatten(terms: Term[]): Term[] {
	return terms.flatMap((term) => [term, ...flatten(term.children ?? [])]);
}
const taxonomyPath = (name: string) => `/_emdash/api/taxonomies/${encode(name)}`;
export function TaxonomiesView({ collections }: { collections: Collection[] }) {
	const { t, locale } = useDataI18n();
	const operation = useOperation();
	const [language, setLanguage] = useState<string>(locale);
	const [selected, setSelected] = useState("");
	const [name, setName] = useState("");
	const [label, setLabel] = useState("");
	const [assigned, setAssigned] = useState<string[]>([]);
	const resource = useResource<{ taxonomies: Taxonomy[] }>(
		`/_emdash/api/taxonomies?locale=${encode(language)}`,
	);
	const current =
		resource.data?.taxonomies.find((taxonomy) => taxonomy.name === selected) ??
		resource.data?.taxonomies[0];
	return (
		<div className="space-y-4 pt-4">
			<TextField label={t.language} value={language} onChange={setLanguage} />
			{operation.feedback}
			{resource.error && <p role="alert">{resource.error}</p>}
			<div className="grid gap-6 lg:grid-cols-2">
				<form
					className="grid content-start gap-3"
					onSubmit={(event) => {
						event.preventDefault();
						operation.run(async () => {
							await POST("/_emdash/api/taxonomies", {
								name,
								label,
								locale: language,
								collections: assigned,
							});
							setSelected(name);
							setName("");
							setLabel("");
							resource.refresh();
						});
					}}
				>
					<h2>{t.createTaxonomy}</h2>
					<TextField label={t.taxonomyName} value={label} onChange={setLabel} required />
					<TextField label={t.taxonomyKey} value={name} onChange={setName} required />
					<fieldset className="space-y-2">
						<legend>{t.collections}</legend>
						{collections.map((collection) => (
							<label key={collection.slug} className="flex items-center gap-2">
								<Input
									className="w-auto"
									type="checkbox"
									checked={assigned.includes(collection.slug)}
									onChange={(event) => {
										setAssigned((current) =>
											event.target.checked
												? [...current, collection.slug]
												: current.filter((value) => value !== collection.slug),
										);
									}}
								/>
								{collection.label}
							</label>
						))}
					</fieldset>
					<Button type="submit" disabled={operation.busy}>
						{t.createTaxonomy}
					</Button>
				</form>
				<div className="space-y-3">
					<label className="grid gap-2">
						{t.taxonomies}
						<select
							value={current?.name ?? ""}
							onChange={(event) => {
								setSelected(event.target.value);
							}}
						>
							{resource.data?.taxonomies.map((taxonomy) => (
								<option key={taxonomy.name} value={taxonomy.name}>
									{taxonomy.label}
								</option>
							))}
						</select>
					</label>
					{current ? (
						<TaxonomyTerms
							key={`${current.name}:${language}`}
							name={current.name}
							language={language}
						/>
					) : (
						<p>{t.noTaxonomies}</p>
					)}
				</div>
			</div>
		</div>
	);
}
function TaxonomyTerms({ name, language }: { name: string; language: string }) {
	const { t } = useDataI18n();
	const operation = useOperation();
	const [selected, setSelected] = useState<Term | null>(null);
	const [label, setLabel] = useState("");
	const [slug, setSlug] = useState("");
	const [removing, setRemoving] = useState<Term | null>(null);
	const base = `${taxonomyPath(name)}/terms`;
	const query = `?locale=${encode(language)}`;
	const resource = useResource<{ terms: Term[] }>(base + query);
	function select(term: Term | null) {
		setSelected(term);
		setLabel(term?.label ?? "");
		setSlug(term?.slug ?? "");
	}
	return (
		<div className="space-y-4">
			{operation.feedback}
			{resource.error && <p role="alert">{resource.error}</p>}
			<h2>{t.terms}</h2>
			<ul>
				{flatten(resource.data?.terms ?? []).map((term) => (
					<li key={term.id} className="flex gap-2">
						<Button
							variant="ghost"
							onClick={() => {
								select(term);
							}}
						>
							{term.label}
						</Button>
						<Button
							onClick={() => {
								setRemoving(term);
							}}
						>
							{t.deleteTerm}
						</Button>
					</li>
				))}
			</ul>
			{resource.data && !resource.data.terms.length && <p>{t.noTerms}</p>}
			{removing && (
				<div role="alertdialog" aria-label={t.deleteTerm} className="space-y-3 rounded border p-4">
					<p>{t.confirmTerm}</p>
					<Button
						disabled={operation.busy}
						onClick={() => {
							operation.run(async () => {
								await DELETE(`${base}/${encode(removing.slug)}${query}`);
								setRemoving(null);
								select(null);
								resource.refresh();
							});
						}}
					>
						{t.confirm}
					</Button>
					<Button
						onClick={() => {
							setRemoving(null);
						}}
					>
						{t.cancel}
					</Button>
				</div>
			)}
			<Button
				onClick={() => {
					select(null);
				}}
			>
				{t.addTerm}
			</Button>
			<form
				className="grid gap-3"
				onSubmit={(event) => {
					event.preventDefault();
					operation.run(async () => {
						if (selected) await PUT(`${base}/${encode(selected.slug)}${query}`, { label, slug });
						else await POST(base, { label, ...(slug ? { slug } : {}), locale: language });
						select(null);
						resource.refresh();
					});
				}}
			>
				<TextField label={t.termName} value={label} onChange={setLabel} required />
				<TextField label={t.slug} value={slug} onChange={setSlug} />
				<Button type="submit" disabled={operation.busy}>
					{selected ? t.save : t.addTerm}
				</Button>
			</form>
		</div>
	);
}
export function DocumentTerms({ collection, item }: { collection: string; item: Document }) {
	const { t } = useDataI18n();
	const resource = useResource<{ taxonomies: Taxonomy[] }>(
		`/_emdash/api/taxonomies?locale=${encode(item.locale)}`,
	);
	const taxonomies =
		resource.data?.taxonomies.filter((taxonomy) => taxonomy.collections.includes(collection)) ?? [];
	return (
		<div className="space-y-4">
			{resource.error && <p role="alert">{resource.error}</p>}
			{!resource.data ? (
				<p role="status">{t.loading}</p>
			) : !taxonomies.length ? (
				<p>{t.noTaxonomies}</p>
			) : (
				taxonomies.map((taxonomy) => (
					<TermAssignment
						key={taxonomy.name}
						collection={collection}
						item={item}
						taxonomy={taxonomy}
					/>
				))
			)}
		</div>
	);
}
function TermAssignment({
	collection,
	item,
	taxonomy,
}: {
	collection: string;
	item: Document;
	taxonomy: Taxonomy;
}) {
	const { t } = useDataI18n();
	const operation = useOperation();
	const path = `${collectionPath(collection)}/${encode(item.id)}/terms/${encode(taxonomy.name)}`;
	const terms = useResource<{ terms: Term[] }>(
		`${taxonomyPath(taxonomy.name)}/terms?locale=${encode(item.locale)}`,
	);
	const assigned = useResource<{ terms: Term[]; unresolved?: unknown[] }>(path);
	const [selection, setSelection] = useState<string[] | null>(null);
	const ids = selection ?? assigned.data?.terms.map((term) => term.id) ?? [];
	return (
		<fieldset className="space-y-3 rounded border p-4">
			<legend>{taxonomy.label}</legend>
			{operation.feedback}
			{terms.error || assigned.error ? (
				<p role="alert">{terms.error ?? assigned.error}</p>
			) : !terms.data || !assigned.data ? (
				<p role="status">{t.loading}</p>
			) : (
				<>
					{flatten(terms.data.terms).map((term) => (
						<label key={term.id} className="flex items-center gap-2">
							<Input
								className="w-auto"
								type="checkbox"
								checked={ids.includes(term.id)}
								onChange={(event) => {
									setSelection(
										event.target.checked ? [...ids, term.id] : ids.filter((id) => id !== term.id),
									);
								}}
							/>
							{term.label}
						</label>
					))}
					<Button
						disabled={operation.busy || selection === null || !!assigned.data.unresolved?.length}
						onClick={() => {
							operation.run(async () => {
								await POST(path, { termIds: ids });
								setSelection(null);
								assigned.refresh();
							});
						}}
					>
						{t.saveTerms}
					</Button>
				</>
			)}
		</fieldset>
	);
}
