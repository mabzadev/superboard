import type { Kysely } from "kysely";
import { ulid } from "ulidx";

import type { WxrNavMenu, WxrNavMenuItem } from "../cli/wxr/parser.js";
import type { Database } from "../database/types.js";
import type { MenuItemType } from "../menus/types.js";

export interface MenuImportResult {
	menusCreated: number;
	itemsCreated: number;
	menuIdMap: Map<string, string>;
	errors: Array<{ menu: string; error: string }>;
}

export interface PluginMenu {
	id: number;
	name: string;
	label: string;
	items: PluginMenuItem[];
}

export interface PluginMenuItem {
	id: number;
	parent_id: number | null;
	sort_order: number;
	type: "custom" | "post_type" | "taxonomy";
	object: string | null;
	object_id: number | null;
	url: string;
	title: string;
	target: string | null;
	classes: string | null;
}

export async function importMenusFromWxr(
	menus: WxrNavMenu[],
	db: Kysely<Database>,
	contentIdMap: Map<number, string>,
): Promise<MenuImportResult> {
	const result: MenuImportResult = {
		menusCreated: 0,
		itemsCreated: 0,
		menuIdMap: new Map(),
		errors: [],
	};

	for (const menu of menus) {
		try {
			const existing = await db
				.selectFrom("_emdash_menus")
				.select("id")
				.where("name", "=", menu.name)
				.executeTakeFirst();

			if (existing) {
				result.menuIdMap.set(menu.name, existing.id);
				continue;
			}

			const menuId = ulid();
			await db
				.insertInto("_emdash_menus")
				.values({
					id: menuId,
					name: menu.name,
					label: menu.label,
				})
				.execute();

			result.menusCreated++;
			result.menuIdMap.set(menu.name, menuId);

			const itemsCreated = await importWxrMenuItems(menu.items, menuId, db, contentIdMap);
			result.itemsCreated += itemsCreated;
		} catch (error) {
			result.errors.push({
				menu: menu.name,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return result;
}

export async function importMenusFromPlugin(
	menus: PluginMenu[],
	db: Kysely<Database>,
	contentIdMap: Map<number, string>,
): Promise<MenuImportResult> {
	const result: MenuImportResult = {
		menusCreated: 0,
		itemsCreated: 0,
		menuIdMap: new Map(),
		errors: [],
	};

	for (const menu of menus) {
		try {
			const existing = await db
				.selectFrom("_emdash_menus")
				.select("id")
				.where("name", "=", menu.name)
				.executeTakeFirst();

			if (existing) {
				result.menuIdMap.set(menu.name, existing.id);
				continue;
			}

			const menuId = ulid();
			await db
				.insertInto("_emdash_menus")
				.values({
					id: menuId,
					name: menu.name,
					label: menu.label,
				})
				.execute();

			result.menusCreated++;
			result.menuIdMap.set(menu.name, menuId);

			const itemsCreated = await importPluginMenuItems(menu.items, menuId, db, contentIdMap);
			result.itemsCreated += itemsCreated;
		} catch (error) {
			result.errors.push({
				menu: menu.name,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return result;
}

async function importWxrMenuItems(
	items: WxrNavMenuItem[],
	menuId: string,
	db: Kysely<Database>,
	contentIdMap: Map<number, string>,
): Promise<number> {
	const itemIdMap = new Map<number, string>();
	let count = 0;

	const sortedItems = items.toSorted((a, b) => a.sortOrder - b.sortOrder);

	for (const item of sortedItems) {
		const itemId = ulid();
		itemIdMap.set(item.id, itemId);

		const { type, collection, referenceId, customUrl } = mapWxrMenuItem(item, contentIdMap);

		await db
			.insertInto("_emdash_menu_items")
			.values({
				id: itemId,
				menu_id: menuId,
				parent_id: null,
				sort_order: item.sortOrder,
				type,
				reference_collection: collection,
				reference_id: referenceId,
				custom_url: customUrl,
				label: item.title,
				title_attr: null,
				target: item.target || null,
				css_classes: item.classes || null,
			})
			.execute();

		count++;
	}

	for (const item of sortedItems) {
		if (item.parentId) {
			const itemId = itemIdMap.get(item.id);
			const parentId = itemIdMap.get(item.parentId);

			if (itemId && parentId) {
				await db
					.updateTable("_emdash_menu_items")
					.set({ parent_id: parentId })
					.where("id", "=", itemId)
					.execute();
			}
		}
	}

	return count;
}

async function importPluginMenuItems(
	items: PluginMenuItem[],
	menuId: string,
	db: Kysely<Database>,
	contentIdMap: Map<number, string>,
): Promise<number> {
	const itemIdMap = new Map<number, string>();
	let count = 0;

	const sortedItems = items.toSorted((a, b) => a.sort_order - b.sort_order);

	for (const item of sortedItems) {
		const itemId = ulid();
		itemIdMap.set(item.id, itemId);

		const { type, collection, referenceId, customUrl } = mapPluginMenuItem(item, contentIdMap);

		await db
			.insertInto("_emdash_menu_items")
			.values({
				id: itemId,
				menu_id: menuId,
				parent_id: null,
				sort_order: item.sort_order,
				type,
				reference_collection: collection,
				reference_id: referenceId,
				custom_url: customUrl,
				label: item.title,
				title_attr: null,
				target: item.target || null,
				css_classes: item.classes || null,
			})
			.execute();

		count++;
	}

	for (const item of sortedItems) {
		if (item.parent_id) {
			const itemId = itemIdMap.get(item.id);
			const parentId = itemIdMap.get(item.parent_id);

			if (itemId && parentId) {
				await db
					.updateTable("_emdash_menu_items")
					.set({ parent_id: parentId })
					.where("id", "=", itemId)
					.execute();
			}
		}
	}

	return count;
}

function mapWxrMenuItem(
	item: WxrNavMenuItem,
	contentIdMap: Map<number, string>,
): {
	type: MenuItemType;
	collection: string | null;
	referenceId: string | null;
	customUrl: string | null;
} {
	switch (item.type) {
		case "custom":
			return {
				type: "custom",
				collection: null,
				referenceId: null,
				customUrl: item.url || "#",
			};

		case "post_type": {
			const collection = mapObjectToCollection(item.objectType);
			const referenceId = item.objectId ? contentIdMap.get(item.objectId) || null : null;

			if (!referenceId && item.url) {
				return {
					type: "custom",
					collection: null,
					referenceId: null,
					customUrl: item.url,
				};
			}

			return {
				type: collection === "pages" ? "page" : "post",
				collection,
				referenceId,
				customUrl: null,
			};
		}

		case "taxonomy":
			return {
				type: "custom",
				collection: null,
				referenceId: null,
				customUrl: item.url || "#",
			};

		default:
			return {
				type: "custom",
				collection: null,
				referenceId: null,
				customUrl: item.url || "#",
			};
	}
}

function mapPluginMenuItem(
	item: PluginMenuItem,
	contentIdMap: Map<number, string>,
): {
	type: MenuItemType;
	collection: string | null;
	referenceId: string | null;
	customUrl: string | null;
} {
	switch (item.type) {
		case "custom":
			return {
				type: "custom",
				collection: null,
				referenceId: null,
				customUrl: item.url || "#",
			};

		case "post_type": {
			const collection = mapObjectToCollection(item.object);
			const referenceId = item.object_id ? contentIdMap.get(item.object_id) || null : null;

			if (!referenceId && item.url) {
				return {
					type: "custom",
					collection: null,
					referenceId: null,
					customUrl: item.url,
				};
			}

			return {
				type: collection === "pages" ? "page" : "post",
				collection,
				referenceId,
				customUrl: null,
			};
		}

		case "taxonomy":
			return {
				type: "custom",
				collection: null,
				referenceId: null,
				customUrl: item.url || "#",
			};

		default:
			return {
				type: "custom",
				collection: null,
				referenceId: null,
				customUrl: item.url || "#",
			};
	}
}

function mapObjectToCollection(objectType: string | undefined | null): string {
	if (!objectType) return "posts";

	const mapping: Record<string, string> = {
		post: "posts",
		page: "pages",
		product: "products",
		portfolio: "portfolio",
	};

	return mapping[objectType] || objectType;
}
