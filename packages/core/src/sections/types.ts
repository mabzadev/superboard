import type { PortableTextBlock } from "../fields/index.js";

export type SectionSource = "theme" | "user" | "import";

export interface Section {
	id: string;
	slug: string;
	title: string;
	description?: string;
	keywords: string[];
	content: PortableTextBlock[];
	previewUrl?: string;
	source: SectionSource;
	themeId?: string;
	createdAt: string;
	updatedAt: string;
}

export interface SectionRow {
	id: string;
	slug: string;
	title: string;
	description: string | null;
	keywords: string | null;
	content: string;
	preview_media_id: string | null;
	source: SectionSource;
	theme_id: string | null;
	created_at: string;
	updated_at: string;
}

export interface CreateSectionInput {
	slug: string;
	title: string;
	description?: string;
	keywords?: string[];
	content: PortableTextBlock[];
	previewMediaId?: string;
	source?: SectionSource;
	themeId?: string;
}

export interface UpdateSectionInput {
	slug?: string;
	title?: string;
	description?: string;
	keywords?: string[];
	content?: PortableTextBlock[];
	previewMediaId?: string | null;
}

export interface GetSectionsOptions {
	source?: SectionSource;
	search?: string;
	limit?: number;
	cursor?: string;
}
