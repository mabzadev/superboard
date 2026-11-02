export type MenuItemType = string;

export interface MenuItem {
	id: string;
	label: string;
	url: string;
	target?: string;
	titleAttr?: string;
	cssClasses?: string;
	children: MenuItem[];
}

export interface Menu {
	id: string;
	name: string;
	label: string;
	items: MenuItem[];
	locale: string;
	translationGroup: string | null;
}

export interface MenuItemRow {
	id: string;
	menu_id: string;
	parent_id: string | null;
	sort_order: number;
	type: MenuItemType;
	reference_collection: string | null;
	reference_id: string | null;
	custom_url: string | null;
	label: string;
	title_attr: string | null;
	target: string | null;
	css_classes: string | null;
	created_at: string;
	locale: string;
	translation_group: string | null;
}

export interface MenuRow {
	id: string;
	name: string;
	label: string;
	created_at: string;
	updated_at: string;
	locale: string;
	translation_group: string | null;
}

export interface CreateMenuItemInput {
	type: MenuItemType;
	label: string;
	referenceCollection?: string;
	referenceId?: string;
	customUrl?: string;
	target?: string;
	titleAttr?: string;
	cssClasses?: string;
	parentId?: string;
	sortOrder?: number;
}

export interface UpdateMenuItemInput {
	label?: string;
	customUrl?: string;
	target?: string;
	titleAttr?: string;
	cssClasses?: string;
	parentId?: string | null;
	sortOrder?: number;
}

export interface CreateMenuInput {
	name: string;
	label: string;
	locale?: string;
	translationOf?: string;
}

export interface UpdateMenuInput {
	label?: string;
}

export interface ReorderMenuItemsInput {
	items: Array<{
		id: string;
		parentId: string | null;
		sortOrder: number;
	}>;
}
