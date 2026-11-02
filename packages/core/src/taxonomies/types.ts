export interface TaxonomyDef {
	id: string;
	name: string;
	label: string;
	labelSingular?: string;
	hierarchical: boolean;
	collections: string[];
	locale: string;
	translationGroup: string | null;
}

export interface TaxonomyTerm {
	id: string;
	name: string;
	slug: string;
	label: string;
	parentId?: string;
	description?: string;
	children: TaxonomyTerm[];
	count?: number;
	locale: string;
	translationGroup: string | null;
}

export interface TaxonomyTermRow {
	id: string;
	name: string;
	slug: string;
	label: string;
	parent_id: string | null;
	data: string | null;
	locale: string;
	translation_group: string | null;
}

export interface CreateTermInput {
	slug: string;
	label: string;
	parentId?: string;
	description?: string;
	locale?: string;
	translationOf?: string;
}

export interface UpdateTermInput {
	slug?: string;
	label?: string;
	parentId?: string | null;
	description?: string;
}
