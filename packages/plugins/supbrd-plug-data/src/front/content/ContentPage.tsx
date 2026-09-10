import { useFrontContext } from "@superboard/front-ui/context";
import { useCallback, useEffect, useState } from "react";

import { Button } from "../../../../../supbrd-front-ui/src/shared/components/ui/button.js";
import { Input } from "../../../../../supbrd-front-ui/src/shared/components/ui/input.js";
import { GET, POST, PUT } from "./transport.js";

interface Collection {
	slug: string;
	label: string;
}
interface Document {
	id: string;
	slug: string | null;
	status: string;
	locale: string;
	data: Record<string, unknown>;
	_rev?: string;
}
const messages = {
	en: {
		title: "Content",
		collection: "Collection",
		language: "Content language",
		slug: "Slug",
		fields: "Document fields (JSON)",
		create: "Create document",
		save: "Save document",
		publish: "Publish",
		revisions: "Revision history",
		new: "New document",
		loading: "Loading…",
		empty: "No documents",
		setup: "Create document collection",
		schema: "Manage content types in EmDash",
		invalid: "Document fields must be a JSON object",
		taxonomy: "Taxonomies",
		success: "Document saved",
		previous: "First page",
		next: "Next page",
	},
	fr: {
		title: "Contenu",
		collection: "Collection",
		language: "Langue du contenu",
		slug: "Slug",
		fields: "Champs du document (JSON)",
		create: "Créer le document",
		save: "Enregistrer le document",
		publish: "Publier",
		revisions: "Historique des révisions",
		new: "Nouveau document",
		loading: "Chargement…",
		empty: "Aucun document",
		setup: "Créer la collection de documents",
		schema: "Gérer les types de contenu dans EmDash",
		invalid: "Les champs doivent être un objet JSON",
		taxonomy: "Taxonomies",
		success: "Document enregistré",
		previous: "Première page",
		next: "Page suivante",
	},
};

export default function ContentPage() {
	const { locale } = useFrontContext();
	const t = messages[locale];
	const [collections, setCollections] = useState<Collection[]>([]);
	const [collection, setCollection] = useState("");
	const [items, setItems] = useState<Document[] | null>(null);
	const [selected, setSelected] = useState<Document | null>(null);
	const [slug, setSlug] = useState("");
	const [fields, setFields] = useState('{"title":""}');
	const [language, setLanguage] = useState<string>(locale);
	const [cursor, setCursor] = useState<string | null>(null);
	const [next, setNext] = useState<string | null>(null);
	const [history, setHistory] = useState<unknown>(null);
	const [taxonomies, setTaxonomies] = useState<unknown>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [saved, setSaved] = useState(false);
	const loadCollections = useCallback(async () => {
		const response = await GET("/_emdash/api/schema/collections");
		const rows: Collection[] = response.data.data.items ?? response.data.data.collections ?? [];
		const available = rows.filter(({ slug }) => slug !== "views");
		setCollections(available);
		setCollection((current) =>
			available.some(({ slug }) => slug === current) ? current : (available[0]?.slug ?? ""),
		);
	}, []);
	const load = useCallback(async () => {
		if (!collection) return;
		const query = new URLSearchParams({
			locale: language,
			limit: "50",
			...(cursor ? { cursor } : {}),
		});
		const response = await GET(`/_emdash/api/content/${encodeURIComponent(collection)}?${query}`);
		setItems(response.data.data.items);
		setNext(response.data.data.nextCursor ?? null);
	}, [collection, language, cursor]);
	useEffect(() => {
		void loadCollections().catch((cause) => setError(String(cause)));
	}, [loadCollections]);
	useEffect(() => {
		setItems(null);
		void load().catch((cause) => setError(String(cause)));
	}, [load]);
	async function run(action: () => Promise<void>) {
		if (busy) return;
		setBusy(true);
		setError(null);
		setSaved(false);
		try {
			await action();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setBusy(false);
		}
	}
	function select(item: Document | null) {
		setSelected(item);
		setSlug(item?.slug ?? "");
		setFields(JSON.stringify(item?.data ?? { title: "" }, null, 2));
		setHistory(null);
	}
	async function save() {
		const data: unknown = JSON.parse(fields);
		if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(t.invalid);
		const payload = {
			slug,
			locale: language,
			data,
			...(selected?._rev ? { _rev: selected._rev } : {}),
		};
		const base = `/_emdash/api/content/${encodeURIComponent(collection)}`;
		const response = selected
			? await PUT(`${base}/${encodeURIComponent(selected.id)}`, payload)
			: await POST(base, payload);
		select(response.data.data.item);
		setSaved(true);
		await load();
	}
	return (
		<section className="grid gap-5 p-6">
			<h1 className="text-xl font-semibold">{t.title}</h1>
			{error && <p role="alert">{error}</p>}
			{saved && <p role="status">{t.success}</p>}
			<div className="flex flex-wrap gap-3">
				<label>
					{t.collection}
					<select
						value={collection}
						onChange={(event) => {
							setCollection(event.target.value);
							setCursor(null);
							select(null);
						}}
					>
						{collections.map((item) => (
							<option key={item.slug} value={item.slug}>
								{item.label}
							</option>
						))}
					</select>
				</label>
				<label>
					{t.language}
					<Input
						value={language}
						onChange={(event) => {
							setLanguage(event.target.value);
							setCursor(null);
							select(null);
						}}
					/>
				</label>
				<a href="/_emdash/admin/content-types">{t.schema}</a>
			</div>
			{!collections.length && (
				<Button
					disabled={busy}
					onClick={() =>
						void run(async () => {
							await POST("/_emdash/api/schema/collections", {
								slug: "documents",
								label: "Documents",
								labelSingular: "Document",
							});
							await POST("/_emdash/api/schema/collections/documents/fields", {
								slug: "title",
								label: "Title",
								type: "string",
							});
							await loadCollections();
						})
					}
				>
					{t.setup}
				</Button>
			)}
			{collection && (
				<div className="grid gap-5 lg:grid-cols-2">
					<div>
						<Button onClick={() => select(null)}>{t.new}</Button>
						<ul>
							{items?.map((item) => (
								<li key={item.id}>
									<Button variant="ghost" onClick={() => select(item)}>
										{String(item.data.title ?? item.slug ?? item.id)} · {item.status}
									</Button>
								</li>
							))}
						</ul>
						{items ? !items.length && <p>{t.empty}</p> : <p role="status">{t.loading}</p>}
						{cursor && <Button onClick={() => setCursor(null)}>{t.previous}</Button>}
						{next && <Button onClick={() => setCursor(next)}>{t.next}</Button>}
					</div>
					<form
						className="grid gap-3"
						onSubmit={(event) => {
							event.preventDefault();
							void run(save);
						}}
					>
						<label>
							{t.slug}
							<Input value={slug} onChange={(event) => setSlug(event.target.value)} required />
						</label>
						<label>
							{t.fields}
							<textarea
								className="min-h-48 w-full rounded border p-3 font-mono"
								value={fields}
								onChange={(event) => setFields(event.target.value)}
								required
							/>
						</label>
						<Button type="submit" disabled={busy}>
							{selected ? t.save : t.create}
						</Button>
						{selected && (
							<>
								<Button
									type="button"
									disabled={busy}
									onClick={() =>
										void run(async () => {
											await POST(
												`/_emdash/api/content/${encodeURIComponent(collection)}/${encodeURIComponent(selected.id)}/publish?locale=${encodeURIComponent(language)}`,
												{},
											);
											await load();
										})
									}
								>
									{t.publish}
								</Button>
								<Button
									type="button"
									onClick={() =>
										void run(async () => {
											setHistory(
												(
													await GET(
														`/_emdash/api/content/${encodeURIComponent(collection)}/${encodeURIComponent(selected.id)}/revisions`,
													)
												).data.data,
											);
										})
									}
								>
									{t.revisions}
								</Button>
							</>
						)}
					</form>
				</div>
			)}
			{history !== null && (
				<pre className="max-h-96 overflow-auto">{JSON.stringify(history, null, 2)}</pre>
			)}
			<Button
				variant="outline"
				onClick={() =>
					void run(async () => {
						setTaxonomies((await GET("/_emdash/api/taxonomies")).data.data);
					})
				}
			>
				{t.taxonomy}
			</Button>
			{taxonomies !== null && <pre>{JSON.stringify(taxonomies, null, 2)}</pre>}
		</section>
	);
}
