import type { Kysely, Selectable } from "kysely";
import { ulid } from "ulidx";

import { invalidateMenuObjectCache } from "../../object-cache/index.js";
import { withTransaction } from "../transaction.js";
import type { Database, MenuItemTable, MenuTable } from "../types.js";

export class MenuGoneError extends Error {
	constructor(public readonly menuId: string) {
		super(`Menu ${menuId} was deleted while being modified`);
		this.name = "MenuGoneError";
	}
}

export interface Menu {
	id: string;
	name: string;
	label: string;
	createdAt: string;
	updatedAt: string;
	locale: string;
	translationGroup: string | null;
}

export interface MenuItem {
	id: string;
	menuId: string;
	parentId: string | null;
	sortOrder: number;
	type: string;
	referenceCollection: string | null;
	referenceId: string | null;
	customUrl: string | null;
	label: string;
	titleAttr: string | null;
	target: string | null;
	cssClasses: string | null;
	createdAt: string;
	locale: string;
	translationGroup: string | null;
}

export interface MenuListItem extends Menu {
	itemCount: number;
}

export interface MenuWithItems extends Menu {
	items: MenuItem[];
}

export interface MenuTranslation {
	id: string;
	name: string;
	label: string;
	locale: string;
	updatedAt: string;
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

export interface CreateMenuItemInput {
	type: string;
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

export interface SetMenuItem {
	label: string;
	type: "custom" | "page" | "post" | "taxonomy" | "collection";
	customUrl?: string;
	referenceCollection?: string;
	referenceId?: string;
	titleAttr?: string;
	target?: string;
	cssClasses?: string;
	parentIndex?: number;
}

export interface ReorderItem {
	id: string;
	parentId: string | null;
	sortOrder: number;
}

function rowToMenu(row: Selectable<MenuTable>): Menu {
	return {
		id: row.id,
		name: row.name,
		label: row.label,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		locale: row.locale,
		translationGroup: row.translation_group,
	};
}

function rowToMenuItem(row: Selectable<MenuItemTable>): MenuItem {
	return {
		id: row.id,
		menuId: row.menu_id,
		parentId: row.parent_id,
		sortOrder: row.sort_order,
		type: row.type,
		referenceCollection: row.reference_collection,
		referenceId: row.reference_id,
		customUrl: row.custom_url,
		label: row.label,
		titleAttr: row.title_attr,
		target: row.target,
		cssClasses: row.css_classes,
		createdAt: row.created_at,
		locale: row.locale,
		translationGroup: row.translation_group,
	};
}

export class MenuRepository {
	constructor(private db: Kysely<Database>) {}

	async findMany(options: { locale?: string } = {}): Promise<MenuListItem[]> {
		let query = this.db
			.selectFrom("_emdash_menus as m")
			.leftJoin("_emdash_menu_items as i", "i.menu_id", "m.id")
			.select(({ fn }) => [
				"m.id",
				"m.name",
				"m.label",
				"m.created_at",
				"m.updated_at",
				"m.locale",
				"m.translation_group",
				fn.count<number>("i.id").as("itemCount"),
			])
			.groupBy([
				"m.id",
				"m.name",
				"m.label",
				"m.created_at",
				"m.updated_at",
				"m.locale",
				"m.translation_group",
			])
			.orderBy("m.name", "asc");
		if (options.locale !== undefined) query = query.where("m.locale", "=", options.locale);
		const rows = await query.execute();

		return rows.map((row) => ({
			itemCount: typeof row.itemCount === "string" ? Number(row.itemCount) : row.itemCount,
			...rowToMenu({
				id: row.id,
				name: row.name,
				label: row.label,
				created_at: row.created_at,
				updated_at: row.updated_at,
				locale: row.locale,
				translation_group: row.translation_group,
			}),
		}));
	}

	async findByName(name: string, options: { locale?: string } = {}): Promise<Menu[]> {
		let query = this.db
			.selectFrom("_emdash_menus")
			.selectAll()
			.where("name", "=", name)
			.orderBy("locale", "asc");
		if (options.locale !== undefined) query = query.where("locale", "=", options.locale);
		const rows = await query.execute();
		return rows.map(rowToMenu);
	}

	async findById(id: string): Promise<Menu | null> {
		const row = await this.db
			.selectFrom("_emdash_menus")
			.selectAll()
			.where("id", "=", id)
			.executeTakeFirst();
		return row ? rowToMenu(row) : null;
	}

	async findWithItems(menuId: string): Promise<MenuWithItems | null> {
		const menu = await this.findById(menuId);
		if (!menu) return null;
		const items = await this.findItems(menuId);
		return { ...menu, items };
	}

	async findItems(menuId: string): Promise<MenuItem[]> {
		const rows = await this.db
			.selectFrom("_emdash_menu_items")
			.selectAll()
			.where("menu_id", "=", menuId)
			.orderBy("sort_order", "asc")
			.execute();
		return rows.map(rowToMenuItem);
	}

	async existsByNameAndLocale(name: string, locale: string): Promise<boolean> {
		const row = await this.db
			.selectFrom("_emdash_menus")
			.select("id")
			.where("name", "=", name)
			.where("locale", "=", locale)
			.executeTakeFirst();
		return row !== undefined;
	}

	async create(input: CreateMenuInput): Promise<Menu> {
		const id = ulid();

		let translationGroup: string = id;
		let sourceMenuId: string | null = null;
		if (input.translationOf) {
			const source = await this.findById(input.translationOf);
			if (!source) throw new Error("Source menu for translation not found");
			translationGroup = source.translationGroup ?? source.id;
			sourceMenuId = source.id;
		}

		await withTransaction(this.db, async (trx) => {
			await trx
				.insertInto("_emdash_menus")
				.values({
					id,
					name: input.name,
					label: input.label,
					...(input.locale !== undefined ? { locale: input.locale } : {}),
					translation_group: translationGroup,
				})
				.execute();

			if (sourceMenuId) {
				const sourceItems = await trx
					.selectFrom("_emdash_menu_items")
					.selectAll()
					.where("menu_id", "=", sourceMenuId)
					.orderBy("sort_order", "asc")
					.execute();
				if (sourceItems.length > 0) {
					const idMap = new Map<string, string>();
					for (const item of sourceItems) idMap.set(item.id, ulid());

					await trx
						.insertInto("_emdash_menu_items")
						.values(
							sourceItems.map((item) => ({
								id: idMap.get(item.id)!,
								menu_id: id,
								parent_id: item.parent_id ? (idMap.get(item.parent_id) ?? null) : null,
								sort_order: item.sort_order,
								type: item.type,
								reference_collection: item.reference_collection,
								reference_id: item.reference_id,
								custom_url: item.custom_url,
								label: item.label,
								title_attr: item.title_attr,
								target: item.target,
								css_classes: item.css_classes,
								...(input.locale !== undefined ? { locale: input.locale } : {}),
								translation_group: item.translation_group ?? item.id,
							})),
						)
						.execute();
				}
			}
		});

		invalidateMenuObjectCache();

		const created = await this.findById(id);
		if (!created) throw new Error("Failed to create menu");
		return created;
	}

	async update(id: string, input: UpdateMenuInput): Promise<Menu | null> {
		const existing = await this.findById(id);
		if (!existing) return null;

		const values: Record<string, unknown> = {};
		if (input.label !== undefined) values.label = input.label;

		if (Object.keys(values).length > 0) {
			await this.db.updateTable("_emdash_menus").set(values).where("id", "=", id).execute();
			invalidateMenuObjectCache();
		}

		return (await this.findById(id))!;
	}

	async delete(id: string): Promise<boolean> {
		const existing = await this.findById(id);
		if (!existing) return false;

		await withTransaction(this.db, async (trx) => {
			await trx.deleteFrom("_emdash_menu_items").where("menu_id", "=", id).execute();
			await trx.deleteFrom("_emdash_menus").where("id", "=", id).execute();
		});
		invalidateMenuObjectCache();
		return true;
	}

	async listTranslations(
		idOrGroup: string,
	): Promise<{ translationGroup: string | null; translations: MenuTranslation[] } | null> {
		const anchor = await this.db
			.selectFrom("_emdash_menus")
			.selectAll()
			.where((eb) => eb.or([eb("id", "=", idOrGroup), eb("translation_group", "=", idOrGroup)]))
			.executeTakeFirst();
		if (!anchor) return null;

		const group = anchor.translation_group ?? anchor.id;
		const rows = await this.db
			.selectFrom("_emdash_menus")
			.selectAll()
			.where("translation_group", "=", group)
			.orderBy("locale", "asc")
			.execute();

		return {
			translationGroup: group,
			translations: rows.map((row) => ({
				id: row.id,
				name: row.name,
				locale: row.locale,
				label: row.label,
				updatedAt: row.updated_at,
			})),
		};
	}

	async createItem(menuId: string, locale: string, input: CreateMenuItemInput): Promise<MenuItem> {
		let sortOrder = input.sortOrder ?? 0;
		if (input.sortOrder === undefined) {
			const maxOrder = await this.db
				.selectFrom("_emdash_menu_items")
				.select(({ fn }) => fn.max("sort_order").as("max"))
				.where("menu_id", "=", menuId)
				.where("parent_id", "is", input.parentId ?? null)
				.executeTakeFirst();
			// eslint-disable-next-line typescript/no-unsafe-type-assertion -- Kysely fn.max returns unknown; always a number for sort_order column
			sortOrder = ((maxOrder?.max as number) ?? -1) + 1;
		}

		const id = ulid();
		await this.db
			.insertInto("_emdash_menu_items")
			.values({
				id,
				menu_id: menuId,
				parent_id: input.parentId ?? null,
				sort_order: sortOrder,
				type: input.type,
				reference_collection: input.referenceCollection ?? null,
				reference_id: input.referenceId ?? null,
				custom_url: input.customUrl ?? null,
				label: input.label,
				title_attr: input.titleAttr ?? null,
				target: input.target ?? null,
				css_classes: input.cssClasses ?? null,
				locale,
				translation_group: id,
			})
			.execute();

		invalidateMenuObjectCache();

		const row = await this.db
			.selectFrom("_emdash_menu_items")
			.selectAll()
			.where("id", "=", id)
			.executeTakeFirstOrThrow();
		return rowToMenuItem(row);
	}

	async updateItem(
		menuId: string,
		itemId: string,
		input: UpdateMenuItemInput,
	): Promise<MenuItem | null> {
		const existing = await this.db
			.selectFrom("_emdash_menu_items")
			.select("id")
			.where("id", "=", itemId)
			.where("menu_id", "=", menuId)
			.executeTakeFirst();
		if (!existing) return null;

		const values: Record<string, unknown> = {};
		if (input.label !== undefined) values.label = input.label;
		if (input.customUrl !== undefined) values.custom_url = input.customUrl;
		if (input.target !== undefined) values.target = input.target;
		if (input.titleAttr !== undefined) values.title_attr = input.titleAttr;
		if (input.cssClasses !== undefined) values.css_classes = input.cssClasses;
		if (input.parentId !== undefined) values.parent_id = input.parentId;
		if (input.sortOrder !== undefined) values.sort_order = input.sortOrder;

		if (Object.keys(values).length > 0) {
			await this.db
				.updateTable("_emdash_menu_items")
				.set(values)
				.where("id", "=", itemId)
				.execute();
			invalidateMenuObjectCache();
		}

		const row = await this.db
			.selectFrom("_emdash_menu_items")
			.selectAll()
			.where("id", "=", itemId)
			.executeTakeFirstOrThrow();
		return rowToMenuItem(row);
	}

	async deleteItem(menuId: string, itemId: string): Promise<boolean> {
		const result = await this.db
			.deleteFrom("_emdash_menu_items")
			.where("id", "=", itemId)
			.where("menu_id", "=", menuId)
			.execute();
		const deleted = result[0]?.numDeletedRows !== 0n;
		if (deleted) invalidateMenuObjectCache();
		return deleted;
	}

	async setItems(
		menuId: string,
		locale: string,
		items: SetMenuItem[],
	): Promise<{ itemCount: number }> {
		await withTransaction(this.db, async (trx) => {
			const stillThere = await trx
				.selectFrom("_emdash_menus")
				.select("id")
				.where("id", "=", menuId)
				.executeTakeFirst();
			if (!stillThere) throw new MenuGoneError(menuId);

			await trx.deleteFrom("_emdash_menu_items").where("menu_id", "=", menuId).execute();

			const insertedIds: string[] = [];
			for (let i = 0; i < items.length; i++) {
				const item = items[i];
				if (!item) continue;
				const id = ulid();
				const parentId =
					item.parentIndex !== undefined ? (insertedIds[item.parentIndex] ?? null) : null;
				await trx
					.insertInto("_emdash_menu_items")
					.values({
						id,
						menu_id: menuId,
						parent_id: parentId,
						sort_order: i,
						type: item.type,
						reference_collection: item.referenceCollection ?? null,
						reference_id: item.referenceId ?? null,
						custom_url: item.customUrl ?? null,
						label: item.label,
						title_attr: item.titleAttr ?? null,
						target: item.target ?? null,
						css_classes: item.cssClasses ?? null,
						locale,
					})
					.execute();
				insertedIds.push(id);
			}

			await trx
				.updateTable("_emdash_menus")
				.set({ updated_at: new Date().toISOString() })
				.where("id", "=", menuId)
				.execute();
		});

		invalidateMenuObjectCache();
		return { itemCount: items.length };
	}

	async reorderItems(menuId: string, items: ReorderItem[]): Promise<MenuItem[]> {
		invalidateMenuObjectCache();
		return withTransaction(this.db, async (trx) => {
			for (const item of items) {
				await trx
					.updateTable("_emdash_menu_items")
					.set({ parent_id: item.parentId, sort_order: item.sortOrder })
					.where("id", "=", item.id)
					.where("menu_id", "=", menuId)
					.execute();
			}

			const rows = await trx
				.selectFrom("_emdash_menu_items")
				.selectAll()
				.where("menu_id", "=", menuId)
				.orderBy("sort_order", "asc")
				.execute();
			return rows.map(rowToMenuItem);
		});
	}
}
