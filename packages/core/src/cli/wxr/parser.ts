import type { Readable } from "node:stream";

import sax from "sax";

const PHP_SERIALIZED_STRING_PATTERN = /s:\d+:"([^"]+)"/g;
const PHP_SERIALIZED_STRING_MATCH_PATTERN = /s:\d+:"([^"]+)"/;

export interface WxrData {
	site: WxrSite;
	posts: WxrPost[];
	attachments: WxrAttachment[];
	categories: WxrCategory[];
	tags: WxrTag[];
	authors: WxrAuthor[];
	terms: WxrTerm[];
	navMenus: WxrNavMenu[];
}

export interface WxrSite {
	title?: string;
	link?: string;
	description?: string;
	language?: string;
	baseSiteUrl?: string;
	baseBlogUrl?: string;
}

export interface WxrPost {
	id?: number;
	title?: string;
	link?: string;
	pubDate?: string;
	creator?: string;
	guid?: string;
	description?: string;
	content?: string;
	excerpt?: string;
	postDate?: string;
	postDateGmt?: string;
	postModified?: string;
	postModifiedGmt?: string;
	commentStatus?: string;
	pingStatus?: string;
	status?: string;
	postType?: string;
	postName?: string;
	postPassword?: string;
	isSticky?: boolean;
	postParent?: number;
	menuOrder?: number;
	categories: string[];
	tags: string[];
	customTaxonomies?: Map<string, string[]>;
	taxonomyLabels?: Map<string, string>;
	meta: Map<string, string>;
	locale?: string;
	translationGroup?: string;
}

const WPML_LOCALE_META_KEYS = ["_icl_lang_code"] as const;
const WPML_TRID_META_KEYS = ["trid", "_icl_translation_id"] as const;

const POLYLANG_LOCALE_META_KEY = "_locale";
const POLYLANG_TRANSLATIONS_META_KEY = "_translations";
const POLYLANG_LANG_TAXONOMY = "language";

function polylangTranslationGroupFromMeta(serialized: string): string | undefined {
	const encoder = new TextEncoder();
	const bytes = encoder.encode(serialized);
	const decoder = new TextDecoder("utf-8");

	const ids: number[] = [];
	let i = 0;
	const n = bytes.length;
	const CHAR_S = 0x73;
	const CHAR_I = 0x69;
	const CHAR_COLON = 0x3a;
	const CHAR_SEMI = 0x3b;
	const CHAR_QUOTE = 0x22;

	const indexOf = (byte: number, from: number): number => {
		for (let k = from; k < n; k++) {
			if (bytes[k] === byte) return k;
		}
		return -1;
	};

	while (i < n) {
		const ch = bytes[i];
		if (ch === CHAR_S && bytes[i + 1] === CHAR_COLON) {
			const lenStart = i + 2;
			const lenEnd = indexOf(CHAR_COLON, lenStart);
			if (lenEnd === -1) break;
			const lenText = decoder.decode(bytes.slice(lenStart, lenEnd));
			const len = Number.parseInt(lenText, 10);
			if (!Number.isFinite(len) || len < 0) {
				i = lenEnd + 1;
				continue;
			}
			if (bytes[lenEnd + 1] !== CHAR_QUOTE) {
				i = lenEnd + 1;
				continue;
			}
			const payloadStart = lenEnd + 2;
			const afterPayload = payloadStart + len;
			i = afterPayload + 2;
			continue;
		}
		if (ch === CHAR_I && bytes[i + 1] === CHAR_COLON) {
			const valStart = i + 2;
			const valEnd = indexOf(CHAR_SEMI, valStart);
			if (valEnd === -1) break;
			const idText = decoder.decode(bytes.slice(valStart, valEnd));
			const id = Number.parseInt(idText, 10);
			if (Number.isFinite(id)) ids.push(id);
			i = valEnd + 1;
			continue;
		}
		i++;
	}
	if (ids.length === 0) return undefined;
	const sorted = [...new Set(ids)].toSorted((a, b) => a - b);
	return `pll:${sorted.join(",")}`;
}

function promoteI18nMetadata(post: WxrPost): void {
	for (const key of WPML_LOCALE_META_KEYS) {
		const value = post.meta.get(key);
		if (value) {
			post.locale = value;
			break;
		}
	}
	for (const key of WPML_TRID_META_KEYS) {
		const value = post.meta.get(key);
		if (value) {
			post.translationGroup = `wpml:${value}`;
			break;
		}
	}

	if (!post.locale) {
		const pllLocale = post.meta.get(POLYLANG_LOCALE_META_KEY);
		if (pllLocale) {
			post.locale = pllLocale;
		} else {
			const langTaxonomy = post.customTaxonomies?.get(POLYLANG_LANG_TAXONOMY);
			const firstLang = langTaxonomy?.[0];
			if (firstLang) post.locale = firstLang;
		}
	}

	if (!post.translationGroup) {
		const pllTranslations = post.meta.get(POLYLANG_TRANSLATIONS_META_KEY);
		if (pllTranslations) {
			const group = polylangTranslationGroupFromMeta(pllTranslations);
			if (group) post.translationGroup = group;
		}
	}
}

export interface WxrAttachment {
	id?: number;
	title?: string;
	url?: string;
	postDate?: string;
	meta: Map<string, string>;
}

export interface WxrCategory {
	id?: number;
	nicename?: string;
	name?: string;
	parent?: string;
	description?: string;
}

export interface WxrTag {
	id?: number;
	slug?: string;
	name?: string;
	description?: string;
}

export interface WxrTerm {
	id: number;
	taxonomy: string;
	slug: string;
	name: string;
	parent?: string;
	description?: string;
}

export interface WxrNavMenu {
	id: number;
	name: string;
	label: string;
	items: WxrNavMenuItem[];
}

export interface WxrNavMenuItem {
	id: number;
	menuId: number;
	parentId?: number;
	sortOrder: number;
	type: "custom" | "post_type" | "taxonomy";
	objectType?: string;
	objectId?: number;
	url?: string;
	title: string;
	target?: string;
	classes?: string;
}

export interface WxrAuthor {
	id?: number;
	login?: string;
	email?: string;
	displayName?: string;
	firstName?: string;
	lastName?: string;
}

function attrStr(attr: string | { value: string } | undefined): string {
	if (typeof attr === "string") return attr;
	if (attr && typeof attr === "object" && "value" in attr) return attr.value;
	return "";
}

function normaliseDomain(domain: string): string {
	if (domain === "post_tag") return "tag";
	return domain;
}

function captureItemCategoryLabel(
	item: WxrPost,
	pair: { domain: string; nicename: string },
	label: string,
): void {
	if (!label || label === pair.nicename) return;
	if (!item.taxonomyLabels) item.taxonomyLabels = new Map();
	const key = `${normaliseDomain(pair.domain)}\u0000${pair.nicename}`;
	if (!item.taxonomyLabels.has(key)) item.taxonomyLabels.set(key, label);
}

function isCompleteWxrTerm(term: Partial<WxrTerm>): term is WxrTerm {
	return (
		term.id !== undefined &&
		term.taxonomy !== undefined &&
		term.slug !== undefined &&
		term.name !== undefined
	);
}

export function parseWxr(stream: Readable): Promise<WxrData> {
	return new Promise((resolve, reject) => {
		const parser = sax.createStream(true, { trim: true });

		const data: WxrData = {
			site: {},
			posts: [],
			attachments: [],
			categories: [],
			tags: [],
			authors: [],
			terms: [],
			navMenus: [],
		};

		let currentPath: string[] = [];
		let currentText = "";
		let currentItem: WxrPost | null = null;
		let currentAttachment: WxrAttachment | null = null;
		let currentCategory: WxrCategory | null = null;
		let currentTag: WxrTag | null = null;
		let currentAuthor: WxrAuthor | null = null;
		let currentTerm: Partial<WxrTerm> | null = null;
		let currentMetaKey = "";
		let pendingItemCategory: { domain: string; nicename: string } | null = null;

		const navMenuItemPosts: WxrPost[] = [];
		const menuTermsBySlug = new Map<string, number>();

		parser.on("opentag", (node) => {
			const tagName = node.name.toLowerCase();
			currentPath.push(tagName);
			currentText = "";

			if (tagName === "item") {
				currentItem = {
					categories: [],
					tags: [],
					customTaxonomies: new Map(),
					meta: new Map(),
				};
			} else if (tagName === "wp:category") {
				currentCategory = {};
			} else if (tagName === "wp:tag") {
				currentTag = {};
			} else if (tagName === "wp:author") {
				currentAuthor = {};
			} else if (tagName === "wp:term") {
				currentTerm = {};
			}

			if (tagName === "category" && currentItem && node.attributes) {
				const domain = attrStr(node.attributes.domain);
				const nicename = attrStr(node.attributes.nicename);
				if (domain === "category" && nicename) {
					currentItem.categories.push(nicename);
					pendingItemCategory = { domain, nicename };
				} else if (domain === "post_tag" && nicename) {
					currentItem.tags.push(nicename);
					pendingItemCategory = { domain, nicename };
				} else if (domain && nicename && domain !== "category" && domain !== "post_tag") {
					if (!currentItem.customTaxonomies) {
						currentItem.customTaxonomies = new Map();
					}
					const existing = currentItem.customTaxonomies.get(domain) || [];
					existing.push(nicename);
					currentItem.customTaxonomies.set(domain, existing);
					pendingItemCategory = { domain, nicename };
				}
			}
		});

		parser.on("text", (text) => {
			currentText += text;
		});

		parser.on("cdata", (cdata) => {
			currentText += cdata;
		});

		parser.on("closetag", (tagName) => {
			const tag = tagName.toLowerCase();
			const text = currentText.trim();

			if (currentPath.includes("channel") && !currentItem) {
				switch (tag) {
					case "title":
						if (!data.site.title) data.site.title = text;
						break;
					case "link":
						if (!data.site.link) data.site.link = text;
						break;
					case "description":
						if (!data.site.description) data.site.description = text;
						break;
					case "language":
						data.site.language = text;
						break;
					case "wp:base_site_url":
						data.site.baseSiteUrl = text;
						break;
					case "wp:base_blog_url":
						data.site.baseBlogUrl = text;
						break;
				}
			}

			if (currentItem) {
				switch (tag) {
					case "title":
						currentItem.title = text;
						break;
					case "link":
						currentItem.link = text;
						break;
					case "pubdate":
						currentItem.pubDate = text;
						break;
					case "dc:creator":
						currentItem.creator = text;
						break;
					case "guid":
						currentItem.guid = text;
						break;
					case "description":
						currentItem.description = text;
						break;
					case "content:encoded":
						currentItem.content = text;
						break;
					case "excerpt:encoded":
						currentItem.excerpt = text;
						break;
					case "wp:post_id":
						currentItem.id = parseInt(text, 10);
						break;
					case "wp:post_date":
						currentItem.postDate = text;
						break;
					case "wp:post_date_gmt":
						currentItem.postDateGmt = text;
						break;
					case "wp:post_modified":
						currentItem.postModified = text;
						break;
					case "wp:post_modified_gmt":
						currentItem.postModifiedGmt = text;
						break;
					case "wp:comment_status":
						currentItem.commentStatus = text;
						break;
					case "wp:ping_status":
						currentItem.pingStatus = text;
						break;
					case "wp:status":
						currentItem.status = text;
						break;
					case "wp:post_type":
						currentItem.postType = text;
						break;
					case "wp:post_name":
						currentItem.postName = text;
						break;
					case "wp:post_parent":
						currentItem.postParent = parseInt(text, 10);
						break;
					case "wp:menu_order":
						currentItem.menuOrder = parseInt(text, 10);
						break;
					case "wp:post_password":
						currentItem.postPassword = text || undefined;
						break;
					case "wp:is_sticky":
						currentItem.isSticky = text === "1";
						break;
					case "wp:meta_key":
						currentMetaKey = text;
						break;
					case "wp:meta_value":
						if (currentMetaKey) {
							currentItem.meta.set(currentMetaKey, text);
							currentMetaKey = "";
						}
						break;
					case "wp:attachment_url":
						if (currentItem.postType === "attachment") {
							currentAttachment = {
								id: currentItem.id,
								title: currentItem.title,
								url: text,
								postDate: currentItem.postDate,
								meta: currentItem.meta,
							};
						}
						break;
					case "category":
						if (pendingItemCategory && text) {
							captureItemCategoryLabel(currentItem, pendingItemCategory, text);
						}
						pendingItemCategory = null;
						break;
					case "item":
						if (currentAttachment) {
							data.attachments.push(currentAttachment);
							currentAttachment = null;
						} else if (currentItem.postType === "nav_menu_item") {
							navMenuItemPosts.push(currentItem);
							data.posts.push(currentItem);
						} else if (currentItem.postType !== "attachment") {
							promoteI18nMetadata(currentItem);
							data.posts.push(currentItem);
						}
						currentItem = null;
						break;
				}
			}

			if (currentCategory) {
				switch (tag) {
					case "wp:term_id":
						currentCategory.id = parseInt(text, 10);
						break;
					case "wp:category_nicename":
						currentCategory.nicename = text;
						break;
					case "wp:cat_name":
						currentCategory.name = text;
						break;
					case "wp:category_parent":
						currentCategory.parent = text || undefined;
						break;
					case "wp:category_description":
						currentCategory.description = text || undefined;
						break;
					case "wp:category":
						if (currentCategory.name) {
							data.categories.push(currentCategory);
						}
						currentCategory = null;
						break;
				}
			}

			if (currentTag) {
				switch (tag) {
					case "wp:term_id":
						currentTag.id = parseInt(text, 10);
						break;
					case "wp:tag_slug":
						currentTag.slug = text;
						break;
					case "wp:tag_name":
						currentTag.name = text;
						break;
					case "wp:tag_description":
						currentTag.description = text || undefined;
						break;
					case "wp:tag":
						if (currentTag.name) {
							data.tags.push(currentTag);
						}
						currentTag = null;
						break;
				}
			}

			if (currentAuthor) {
				switch (tag) {
					case "wp:author_id":
						currentAuthor.id = parseInt(text, 10);
						break;
					case "wp:author_login":
						currentAuthor.login = text;
						break;
					case "wp:author_email":
						currentAuthor.email = text;
						break;
					case "wp:author_display_name":
						currentAuthor.displayName = text;
						break;
					case "wp:author_first_name":
						currentAuthor.firstName = text;
						break;
					case "wp:author_last_name":
						currentAuthor.lastName = text;
						break;
					case "wp:author":
						if (currentAuthor.login) {
							data.authors.push(currentAuthor);
						}
						currentAuthor = null;
						break;
				}
			}

			if (currentTerm) {
				switch (tag) {
					case "wp:term_id":
						currentTerm.id = parseInt(text, 10);
						break;
					case "wp:term_taxonomy":
						currentTerm.taxonomy = text;
						break;
					case "wp:term_slug":
						currentTerm.slug = text;
						break;
					case "wp:term_name":
						currentTerm.name = text;
						break;
					case "wp:term_parent":
						currentTerm.parent = text || undefined;
						break;
					case "wp:term_description":
						currentTerm.description = text || undefined;
						break;
					case "wp:term":
						if (isCompleteWxrTerm(currentTerm)) {
							data.terms.push(currentTerm);
							if (currentTerm.taxonomy === "nav_menu") {
								menuTermsBySlug.set(currentTerm.slug, currentTerm.id);
							}
						}
						currentTerm = null;
						break;
				}
			}

			currentPath.pop();
			currentText = "";
		});

		parser.on("error", (err) => {
			reject(new Error(`XML parsing error: ${err.message}`));
		});

		parser.on("end", () => {
			data.navMenus = buildNavMenus(navMenuItemPosts, menuTermsBySlug);
			resolve(data);
		});

		stream.pipe(parser);
	});
}

export function parseWxrString(xml: string): Promise<WxrData> {
	return new Promise((resolve, reject) => {
		const parser = sax.parser(true, { trim: false, normalize: false });

		const data: WxrData = {
			site: {},
			posts: [],
			attachments: [],
			categories: [],
			tags: [],
			authors: [],
			terms: [],
			navMenus: [],
		};

		let currentPath: string[] = [];
		let currentText = "";
		let currentItem: WxrPost | null = null;
		let currentAttachment: WxrAttachment | null = null;
		let currentCategory: WxrCategory | null = null;
		let currentTag: WxrTag | null = null;
		let currentAuthor: WxrAuthor | null = null;
		let currentTerm: Partial<WxrTerm> | null = null;
		let currentMetaKey = "";
		let pendingItemCategory: { domain: string; nicename: string } | null = null;

		const navMenuItemPosts: WxrPost[] = [];
		const menuTermsBySlug = new Map<string, number>();

		parser.onopentag = (node) => {
			const tag = node.name.toLowerCase();
			currentPath.push(tag);
			currentText = "";

			if (tag === "item") {
				currentItem = {
					categories: [],
					tags: [],
					customTaxonomies: new Map(),
					meta: new Map(),
				};
			} else if (tag === "wp:category") {
				currentCategory = {};
			} else if (tag === "wp:tag") {
				currentTag = {};
			} else if (tag === "wp:author") {
				currentAuthor = {};
			} else if (tag === "wp:term") {
				currentTerm = {};
			}

			if (tag === "category" && currentItem && node.attributes) {
				const domain = attrStr(node.attributes.domain);
				const nicename = attrStr(node.attributes.nicename);
				if (domain === "category" && nicename) {
					currentItem.categories.push(nicename);
					pendingItemCategory = { domain, nicename };
				} else if (domain === "post_tag" && nicename) {
					currentItem.tags.push(nicename);
					pendingItemCategory = { domain, nicename };
				} else if (domain && nicename && domain !== "category" && domain !== "post_tag") {
					if (!currentItem.customTaxonomies) {
						currentItem.customTaxonomies = new Map();
					}
					const existing = currentItem.customTaxonomies.get(domain) || [];
					existing.push(nicename);
					currentItem.customTaxonomies.set(domain, existing);
					pendingItemCategory = { domain, nicename };
				}
			}
		};

		parser.ontext = (text) => {
			currentText += text;
		};

		parser.oncdata = (cdata) => {
			currentText += cdata;
		};

		parser.onclosetag = (tagName) => {
			const tag = tagName.toLowerCase();
			const text = currentText.trim();

			if (currentPath.length === 2 && currentPath[0] === "rss") {
				switch (tag) {
					case "title":
						data.site.title = text;
						break;
					case "link":
						data.site.link = text;
						break;
					case "description":
						data.site.description = text;
						break;
					case "language":
						data.site.language = text;
						break;
					case "wp:base_site_url":
						data.site.baseSiteUrl = text;
						break;
					case "wp:base_blog_url":
						data.site.baseBlogUrl = text;
						break;
				}
			}

			if (currentItem) {
				switch (tag) {
					case "title":
						currentItem.title = text;
						break;
					case "link":
						currentItem.link = text;
						break;
					case "pubdate":
						currentItem.pubDate = text;
						break;
					case "dc:creator":
						currentItem.creator = text;
						break;
					case "guid":
						currentItem.guid = text;
						break;
					case "description":
						currentItem.description = text;
						break;
					case "content:encoded":
						currentItem.content = text;
						break;
					case "excerpt:encoded":
						currentItem.excerpt = text;
						break;
					case "wp:post_id":
						currentItem.id = parseInt(text, 10);
						break;
					case "wp:post_date":
						currentItem.postDate = text;
						break;
					case "wp:post_date_gmt":
						currentItem.postDateGmt = text;
						break;
					case "wp:post_modified":
						currentItem.postModified = text;
						break;
					case "wp:post_modified_gmt":
						currentItem.postModifiedGmt = text;
						break;
					case "wp:comment_status":
						currentItem.commentStatus = text;
						break;
					case "wp:ping_status":
						currentItem.pingStatus = text;
						break;
					case "wp:post_name":
						currentItem.postName = text;
						break;
					case "wp:status":
						currentItem.status = text;
						break;
					case "wp:post_parent":
						currentItem.postParent = parseInt(text, 10);
						break;
					case "wp:menu_order":
						currentItem.menuOrder = parseInt(text, 10);
						break;
					case "wp:post_type":
						currentItem.postType = text;
						if (text === "attachment") {
							currentAttachment = {
								id: currentItem.id,
								title: currentItem.title,
								url: currentItem.link,
								postDate: currentItem.postDate,
								meta: new Map(),
							};
						}
						break;
					case "wp:post_password":
						currentItem.postPassword = text || undefined;
						break;
					case "wp:is_sticky":
						currentItem.isSticky = text === "1";
						break;
					case "wp:attachment_url":
						if (currentAttachment) {
							currentAttachment.url = text;
						}
						break;
					case "wp:meta_key":
						currentMetaKey = text;
						break;
					case "wp:meta_value":
						if (currentMetaKey && currentItem.meta) {
							currentItem.meta.set(currentMetaKey, text);
						}
						break;
					case "category":
						if (pendingItemCategory && text) {
							captureItemCategoryLabel(currentItem, pendingItemCategory, text);
						}
						pendingItemCategory = null;
						break;
					case "item":
						if (currentAttachment) {
							data.attachments.push(currentAttachment);
							currentAttachment = null;
						} else if (currentItem.postType === "nav_menu_item") {
							navMenuItemPosts.push(currentItem);
							data.posts.push(currentItem);
						} else if (currentItem.postType !== "attachment") {
							promoteI18nMetadata(currentItem);
							data.posts.push(currentItem);
						}
						currentItem = null;
						break;
				}
			}

			if (currentCategory) {
				switch (tag) {
					case "wp:term_id":
						currentCategory.id = parseInt(text, 10);
						break;
					case "wp:category_nicename":
						currentCategory.nicename = text;
						break;
					case "wp:cat_name":
						currentCategory.name = text;
						break;
					case "wp:category_parent":
						currentCategory.parent = text || undefined;
						break;
					case "wp:category_description":
						currentCategory.description = text || undefined;
						break;
					case "wp:category":
						if (currentCategory.name) {
							data.categories.push(currentCategory);
						}
						currentCategory = null;
						break;
				}
			}

			if (currentTag) {
				switch (tag) {
					case "wp:term_id":
						currentTag.id = parseInt(text, 10);
						break;
					case "wp:tag_slug":
						currentTag.slug = text;
						break;
					case "wp:tag_name":
						currentTag.name = text;
						break;
					case "wp:tag_description":
						currentTag.description = text || undefined;
						break;
					case "wp:tag":
						if (currentTag.name) {
							data.tags.push(currentTag);
						}
						currentTag = null;
						break;
				}
			}

			if (currentAuthor) {
				switch (tag) {
					case "wp:author_id":
						currentAuthor.id = parseInt(text, 10);
						break;
					case "wp:author_login":
						currentAuthor.login = text;
						break;
					case "wp:author_email":
						currentAuthor.email = text;
						break;
					case "wp:author_display_name":
						currentAuthor.displayName = text;
						break;
					case "wp:author_first_name":
						currentAuthor.firstName = text;
						break;
					case "wp:author_last_name":
						currentAuthor.lastName = text;
						break;
					case "wp:author":
						if (currentAuthor.login) {
							data.authors.push(currentAuthor);
						}
						currentAuthor = null;
						break;
				}
			}

			if (currentTerm) {
				switch (tag) {
					case "wp:term_id":
						currentTerm.id = parseInt(text, 10);
						break;
					case "wp:term_taxonomy":
						currentTerm.taxonomy = text;
						break;
					case "wp:term_slug":
						currentTerm.slug = text;
						break;
					case "wp:term_name":
						currentTerm.name = text;
						break;
					case "wp:term_parent":
						currentTerm.parent = text || undefined;
						break;
					case "wp:term_description":
						currentTerm.description = text || undefined;
						break;
					case "wp:term":
						if (isCompleteWxrTerm(currentTerm)) {
							data.terms.push(currentTerm);
							if (currentTerm.taxonomy === "nav_menu") {
								menuTermsBySlug.set(currentTerm.slug, currentTerm.id);
							}
						}
						currentTerm = null;
						break;
				}
			}

			currentPath.pop();
			currentText = "";
		};

		parser.onerror = (err) => {
			reject(new Error(`XML parsing error: ${err.message}`));
		};

		parser.onend = () => {
			data.navMenus = buildNavMenus(navMenuItemPosts, menuTermsBySlug);
			resolve(data);
		};

		parser.write(xml).close();
	});
}

function buildNavMenus(
	navMenuItemPosts: WxrPost[],
	menuTermsBySlug: Map<string, number>,
): WxrNavMenu[] {
	const menuItemsByMenu = new Map<string, WxrPost[]>();

	for (const post of navMenuItemPosts) {
		const navMenuSlugs = post.customTaxonomies?.get("nav_menu");
		if (!navMenuSlugs || navMenuSlugs.length === 0) continue;

		const menuSlug = navMenuSlugs[0];
		if (!menuSlug) continue;

		const items = menuItemsByMenu.get(menuSlug) || [];
		items.push(post);
		menuItemsByMenu.set(menuSlug, items);
	}

	const menus: WxrNavMenu[] = [];

	for (const [menuSlug, posts] of menuItemsByMenu) {
		const menuId = menuTermsBySlug.get(menuSlug) || 0;

		const items: WxrNavMenuItem[] = posts.map((post) => {
			const meta = post.meta;
			const menuItemTypeRaw = meta.get("_menu_item_type") || "custom";
			const menuItemType: WxrNavMenuItem["type"] =
				menuItemTypeRaw === "post_type" || menuItemTypeRaw === "taxonomy"
					? menuItemTypeRaw
					: "custom";
			const objectType = meta.get("_menu_item_object");
			const objectIdStr = meta.get("_menu_item_object_id");
			const url = meta.get("_menu_item_url");
			const parentIdStr = meta.get("_menu_item_menu_item_parent");
			const target = meta.get("_menu_item_target");
			const classesStr = meta.get("_menu_item_classes");

			let classes: string | undefined;
			if (classesStr) {
				const matches = classesStr.match(PHP_SERIALIZED_STRING_PATTERN);
				if (matches) {
					classes = matches
						.map((m) => m.match(PHP_SERIALIZED_STRING_MATCH_PATTERN)?.[1])
						.filter(Boolean)
						.join(" ");
				}
			}

			return {
				id: post.id || 0,
				menuId,
				parentId: parentIdStr ? parseInt(parentIdStr, 10) || undefined : undefined,
				sortOrder: post.menuOrder || 0,
				type: menuItemType,
				objectType: objectType || undefined,
				objectId: objectIdStr ? parseInt(objectIdStr, 10) : undefined,
				url: url || undefined,
				title: post.title || "",
				target: target || undefined,
				classes: classes || undefined,
			};
		});

		items.sort((a, b) => a.sortOrder - b.sortOrder);

		menus.push({
			id: menuId,
			name: menuSlug,
			label: menuSlug,
			items,
		});
	}

	return menus;
}
