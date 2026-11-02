export interface MediaReference {
	mediaId: string;
	alt?: string;
	url?: string;
	contentType?: string;
	width?: number;
	height?: number;
}

export interface SeoSettings {
	titleSeparator?: string;
	defaultOgImage?: MediaReference;
	robotsTxt?: string;
	googleVerification?: string;
	bingVerification?: string;
}

export interface SiteSettings {
	title: string;
	tagline?: string;
	logo?: MediaReference;
	favicon?: MediaReference;

	url?: string;

	postsPerPage: number;
	dateFormat: string;
	timezone: string;

	social?: {
		twitter?: string;
		github?: string;
		facebook?: string;
		instagram?: string;
		linkedin?: string;
		youtube?: string;
	};

	seo?: SeoSettings;
}

export type SiteSettingKey = keyof SiteSettings;
