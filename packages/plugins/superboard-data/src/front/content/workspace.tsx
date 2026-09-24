import { useFrontContext } from "@superboard/front-ui/context";
import { Input } from "@superboard/front-ui/ui/input.js";
import { useCallback, useEffect, useRef, useState } from "react";

import { GET } from "./transport.js";

export interface Collection {
	slug: string;
	label: string;
}
export interface Field {
	slug: string;
	label: string;
	type: string;
	required?: boolean;
	validation?: { options?: string[] };
}
export interface Document {
	id: string;
	slug: string | null;
	locale: string;
	status: string;
	data: Record<string, unknown>;
	scheduledAt?: string | null;
	liveRevisionId?: string | null;
}
export interface Page<T> {
	items: T[];
	nextCursor?: string;
}
export const encode = encodeURIComponent;
export const collectionPath = (collection: string) => `/_emdash/api/content/${encode(collection)}`;
export const schemaPath = (collection: string) =>
	`/_emdash/api/schema/collections/${encode(collection)}`;

const fr = {
	title: "Contenus",
	documents: "Documents",
	trash: "Corbeille",
	collections: "Collections",
	taxonomies: "Taxonomies",
	settings: "Paramètres des contenus",
	collection: "Collection",
	language: "Langue du contenu",
	allLanguages: "Toutes les langues",
	loading: "Chargement…",
	retry: "Réessayer",
	empty: "Aucun document",
	noCollections: "Créez une collection pour commencer.",
	search: "Rechercher",
	status: "Statut",
	all: "Tous",
	draft: "Brouillon",
	published: "Publié",
	archived: "Archivé",
	slug: "Slug",
	new: "Nouveau document",
	save: "Enregistrer",
	create: "Créer le document",
	back: "Retour aux documents",
	edit: "Modifier",
	publish: "Publier",
	unpublish: "Dépublier",
	duplicate: "Dupliquer",
	remove: "Mettre à la corbeille",
	restore: "Restaurer",
	discard: "Abandonner les modifications du brouillon",
	confirmDiscard: "Les modifications non publiées seront remplacées par la version publiée.",
	confirmRemove: "Le document sera déplacé dans la corbeille.",
	confirm: "Confirmer",
	cancel: "Annuler",
	saved: "Modifications enregistrées",
	failed: "Impossible de terminer cette opération. Réessayez.",
	first: "Première page",
	next: "Page suivante",
	fields: "Champs",
	advanced: "Édition JSON",
	invalid: "Saisissez un objet JSON valide.",
	publication: "Publication",
	schedule: "Programmer",
	scheduledAt: "Date de publication",
	unschedule: "Annuler la programmation",
	preview: "Générer un aperçu",
	openPreview: "Ouvrir l’aperçu",
	unsaved: "Enregistrez les modifications avant cette action.",
	revisions: "Révisions",
	compare: "Comparer avec la version publiée",
	live: "Version publiée",
	current: "Brouillon",
	noChanges: "Aucune différence",
	date: "Date",
	noRevisions: "Aucune révision",
	showRevision: "Voir la révision",
	restoreRevision: "Restaurer cette révision",
	translations: "Traductions",
	targetLocale: "Langue de traduction",
	addTranslation: "Créer une traduction",
	noTranslations: "Aucune traduction",
	name: "Nom",
	collectionName: "Nom de la collection",
	createCollection: "Créer la collection",
	fieldsTitle: "Champs de la collection",
	addField: "Ajouter le champ",
	fieldName: "Nom du champ",
	type: "Type",
	required: "Obligatoire",
	options: "Options (une par ligne)",
	taxonomyName: "Nom de la taxonomie",
	taxonomyKey: "Identifiant de la taxonomie",
	createTaxonomy: "Créer la taxonomie",
	terms: "Termes",
	termName: "Nom du terme",
	addTerm: "Ajouter le terme",
	noTaxonomies: "Aucune taxonomie",
	noTerms: "Aucun terme",
	assignments: "Catégories et tags",
	saveTerms: "Enregistrer les catégories et tags",
	select: "Sélectionner",
	noSelection: "Sélectionnez un document.",
	string: "Texte court",
	text: "Texte long",
	number: "Nombre",
	integer: "Entier",
	boolean: "Oui / Non",
	datetime: "Date et heure",
	url: "URL",
	selectType: "Liste de choix",
	json: "JSON",
	deleteTerm: "Supprimer le terme",
	confirmTerm: "Ce terme sera supprimé et retiré des contenus associés.",
};
const en: Record<keyof typeof fr, string> = {
	title: "Content",
	documents: "Documents",
	trash: "Trash",
	collections: "Collections",
	taxonomies: "Taxonomies",
	settings: "Content settings",
	collection: "Collection",
	language: "Content language",
	allLanguages: "All languages",
	loading: "Loading…",
	retry: "Retry",
	empty: "No documents",
	noCollections: "Create a collection to get started.",
	search: "Search",
	status: "Status",
	all: "All",
	draft: "Draft",
	published: "Published",
	archived: "Archived",
	slug: "Slug",
	new: "New document",
	save: "Save",
	create: "Create document",
	back: "Back to documents",
	edit: "Edit",
	publish: "Publish",
	unpublish: "Unpublish",
	duplicate: "Duplicate",
	remove: "Move to trash",
	restore: "Restore",
	discard: "Discard draft changes",
	confirmDiscard: "Unpublished changes will be replaced with the published version.",
	confirmRemove: "The document will be moved to trash.",
	confirm: "Confirm",
	cancel: "Cancel",
	saved: "Changes saved",
	failed: "Unable to complete this operation. Please try again.",
	first: "First page",
	next: "Next page",
	fields: "Fields",
	advanced: "JSON editing",
	invalid: "Enter a valid JSON object.",
	publication: "Publication",
	schedule: "Schedule",
	scheduledAt: "Publication date",
	unschedule: "Cancel schedule",
	preview: "Generate preview",
	openPreview: "Open preview",
	unsaved: "Save your changes before this action.",
	revisions: "Revisions",
	compare: "Compare with published version",
	live: "Published version",
	current: "Draft",
	noChanges: "No differences",
	date: "Date",
	noRevisions: "No revisions",
	showRevision: "View revision",
	restoreRevision: "Restore this revision",
	translations: "Translations",
	targetLocale: "Translation language",
	addTranslation: "Create translation",
	noTranslations: "No translations",
	name: "Name",
	collectionName: "Collection name",
	createCollection: "Create collection",
	fieldsTitle: "Collection fields",
	addField: "Add field",
	fieldName: "Field name",
	type: "Type",
	required: "Required",
	options: "Options (one per line)",
	taxonomyName: "Taxonomy name",
	taxonomyKey: "Taxonomy identifier",
	createTaxonomy: "Create taxonomy",
	terms: "Terms",
	termName: "Term name",
	addTerm: "Add term",
	noTaxonomies: "No taxonomies",
	noTerms: "No terms",
	assignments: "Categories and tags",
	saveTerms: "Save categories and tags",
	select: "Select",
	noSelection: "Select a document.",
	string: "Short text",
	text: "Long text",
	number: "Number",
	integer: "Integer",
	boolean: "Yes / No",
	datetime: "Date and time",
	url: "URL",
	selectType: "Select list",
	json: "JSON",
	deleteTerm: "Delete term",
	confirmTerm: "This term will be deleted and removed from associated content.",
};
export function useDataI18n() {
	const { locale } = useFrontContext();
	return { t: locale === "fr" ? fr : en, locale };
}
export type Messages = typeof en;
export async function responseData<T>(response: { data: unknown }): Promise<T> {
	const body = response.data;
	if (!body || typeof body !== "object" || !("data" in body))
		throw new Error("INVALID_API_RESPONSE");
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The EmDash route validates its response contract; callers provide that contract.
	return body.data as T;
}
export function useResource<T>(path: string | null) {
	const [version, setVersion] = useState(0);
	const [result, setResult] = useState<{
		key: string;
		data: T | null;
		error: string | null;
	} | null>(null);
	const key = `${path ?? ""}:${version}`;
	const refresh = useCallback(() => {
		setVersion((v) => v + 1);
	}, []);
	useEffect(() => {
		if (!path) return;
		let active = true;
		void GET(path)
			.then(responseData<T>)
			.then((data) => {
				if (active) setResult({ key, data, error: null });
			})
			.catch((cause: unknown) => {
				if (active)
					setResult({
						key,
						data: null,
						error: cause instanceof Error ? cause.message : "REQUEST_FAILED",
					});
			});
		return () => {
			active = false;
		};
	}, [path, key]);
	return {
		data: result?.key === key ? result.data : null,
		error: result?.key === key ? result.error : null,
		refresh,
	};
}
export function useOperation() {
	const { t } = useDataI18n();
	const lock = useRef(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	async function execute(action: () => Promise<void>) {
		if (lock.current) return;
		lock.current = true;
		setBusy(true);
		setError(null);
		setSaved(false);
		try {
			await action();
			setSaved(true);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : t.failed);
		} finally {
			lock.current = false;
			setBusy(false);
		}
	}
	function run(action: () => Promise<void>) {
		execute(action).catch((cause: unknown) => {
			setError(cause instanceof Error ? cause.message : t.failed);
		});
	}

	return {
		busy,
		error,
		run,
		feedback: (
			<>
				{error && <p role="alert">{error}</p>}
				{saved && <p role="status">{t.saved}</p>}
			</>
		),
	};
}
export function TextField({
	label,
	value,
	onChange,
	type = "text",
	required = false,
}: {
	label: string;
	value: string;
	onChange(value: string): void;
	type?: string;
	required?: boolean;
}) {
	return (
		<label className="grid gap-2">
			{label}
			<Input
				type={type}
				value={value}
				required={required}
				onChange={(event) => {
					onChange(event.target.value);
				}}
			/>
		</label>
	);
}
export function documentTitle(item: Document) {
	return typeof item.data.title === "string" ? item.data.title : (item.slug ?? item.id);
}

export function fieldText(value: unknown): string {
	return typeof value === "string"
		? value
		: typeof value === "number" || typeof value === "boolean"
			? String(value)
			: "";
}
