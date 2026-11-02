import type { Kysely } from "kysely";

import {
	MenuGoneError,
	MenuRepository,
	type CreateMenuItemInput as CreateMenuItemRepoInput,
	type Menu,
	type MenuItem,
	type MenuListItem,
	type MenuWithItems,
	type SetMenuItem,
	type UpdateMenuItemInput as UpdateMenuItemRepoInput,
} from "../../database/repositories/menu.js";
import type { Database } from "../../database/types.js";
import { getI18nConfig, resolveConfiguredLocale } from "../../i18n/config.js";
import type { ApiResult } from "../types.js";

export type {
	Menu,
	MenuItem,
	MenuListItem,
	MenuTranslation,
	MenuWithItems,
} from "../../database/repositories/menu.js";

export interface MenuTranslationsResponse {
	translationGroup: string | null;
	translations: Array<{
		id: string;
		name: string;
		locale: string;
		label: string;
		updatedAt: string;
	}>;
}

function ambiguousMenuLocaleError(
	name: string,
	locales: readonly string[],
): { success: false; error: { code: "AMBIGUOUS_LOCALE"; message: string } } {
	const sortedLocales = locales.toSorted();
	return {
		success: false,
		error: {
			code: "AMBIGUOUS_LOCALE",
			message: `Menu '${name}' exists in multiple locales (${sortedLocales.join(
				", ",
			)}); pass 'locale' to disambiguate.`,
		},
	};
}

type ResolveMenuResult =
	| { success: true; menu: Menu }
	| { success: false; error: { code: "NOT_FOUND" | "AMBIGUOUS_LOCALE"; message: string } };

async function resolveMenu(
	repo: MenuRepository,
	name: string,
	options: { locale?: string },
): Promise<ResolveMenuResult> {
	const locale = options.locale ? resolveConfiguredLocale(options.locale) : undefined;
	const matches = await repo.findByName(name, { locale });
	if (matches.length === 0) {
		return {
			success: false,
			error: {
				code: "NOT_FOUND",
				message: `Menu '${name}' not found${options.locale ? ` in locale '${options.locale}'` : ""}`,
			},
		};
	}
	if (matches.length > 1) {
		return {
			success: false,
			error: ambiguousMenuLocaleError(
				name,
				matches.map((m) => m.locale),
			).error,
		};
	}
	return { success: true, menu: matches[0] };
}

export async function handleMenuList(
	db: Kysely<Database>,
	options: { locale?: string } = {},
): Promise<ApiResult<MenuListItem[]>> {
	try {
		const repo = new MenuRepository(db);
		const locale = options.locale ? resolveConfiguredLocale(options.locale) : undefined;
		const items = await repo.findMany({ locale });
		return { success: true, data: items };
	} catch {
		return {
			success: false,
			error: { code: "MENU_LIST_ERROR", message: "Failed to fetch menus" },
		};
	}
}

export async function handleMenuCreate(
	db: Kysely<Database>,
	input: { name: string; label: string; locale?: string; translationOf?: string },
): Promise<ApiResult<Menu>> {
	try {
		if (input.translationOf && !input.locale) {
			return {
				success: false,
				error: {
					code: "VALIDATION_ERROR",
					message: "`locale` is required when `translationOf` is provided",
				},
			};
		}

		const repo = new MenuRepository(db);

		if (input.translationOf) {
			const source = await repo.findById(input.translationOf);
			if (!source) {
				return {
					success: false,
					error: { code: "NOT_FOUND", message: "Source menu for translation not found" },
				};
			}
		}

		const effectiveLocale = input.locale
			? resolveConfiguredLocale(input.locale)
			: (getI18nConfig()?.defaultLocale ?? "en");
		if (await repo.existsByNameAndLocale(input.name, effectiveLocale)) {
			return {
				success: false,
				error: {
					code: "CONFLICT",
					message: `Menu "${input.name}" already exists${
						input.locale ? ` in locale "${input.locale}"` : ""
					}`,
				},
			};
		}

		const menu = await repo.create({ ...input, locale: effectiveLocale });
		return { success: true, data: menu };
	} catch {
		return {
			success: false,
			error: { code: "MENU_CREATE_ERROR", message: "Failed to create menu" },
		};
	}
}

export async function handleMenuGet(
	db: Kysely<Database>,
	name: string,
	options: { locale?: string } = {},
): Promise<ApiResult<MenuWithItems>> {
	try {
		const repo = new MenuRepository(db);
		const locale = options.locale ? resolveConfiguredLocale(options.locale) : undefined;
		const matches = await repo.findByName(name, { locale });
		if (matches.length === 0) {
			return {
				success: false,
				error: { code: "NOT_FOUND", message: `Menu '${name}' not found` },
			};
		}
		const menu = matches[0];
		const items = await repo.findItems(menu.id);
		return { success: true, data: { ...menu, items } };
	} catch {
		return {
			success: false,
			error: { code: "MENU_GET_ERROR", message: "Failed to fetch menu" },
		};
	}
}

export async function handleMenuGetById(
	db: Kysely<Database>,
	id: string,
): Promise<ApiResult<MenuWithItems>> {
	try {
		const repo = new MenuRepository(db);
		const menu = await repo.findWithItems(id);
		if (!menu) {
			return {
				success: false,
				error: { code: "NOT_FOUND", message: `Menu '${id}' not found` },
			};
		}
		return { success: true, data: menu };
	} catch {
		return {
			success: false,
			error: { code: "MENU_GET_ERROR", message: "Failed to fetch menu" },
		};
	}
}

export async function handleMenuUpdate(
	db: Kysely<Database>,
	name: string,
	input: { label?: string; locale?: string },
): Promise<ApiResult<Menu>> {
	try {
		const repo = new MenuRepository(db);
		const resolved = await resolveMenu(repo, name, { locale: input.locale });
		if (!resolved.success) return resolved;
		const updated = await repo.update(resolved.menu.id, { label: input.label });
		if (!updated) {
			return {
				success: false,
				error: { code: "NOT_FOUND", message: `Menu '${name}' not found` },
			};
		}
		return { success: true, data: updated };
	} catch {
		return {
			success: false,
			error: { code: "MENU_UPDATE_ERROR", message: "Failed to update menu" },
		};
	}
}

export async function handleMenuDelete(
	db: Kysely<Database>,
	name: string,
	options: { locale?: string } = {},
): Promise<ApiResult<{ deleted: true }>> {
	try {
		const repo = new MenuRepository(db);
		const resolved = await resolveMenu(repo, name, options);
		if (!resolved.success) return resolved;
		await repo.delete(resolved.menu.id);
		return { success: true, data: { deleted: true } };
	} catch {
		return {
			success: false,
			error: { code: "MENU_DELETE_ERROR", message: "Failed to delete menu" },
		};
	}
}

export async function handleMenuTranslations(
	db: Kysely<Database>,
	idOrGroup: string,
): Promise<ApiResult<MenuTranslationsResponse>> {
	try {
		const repo = new MenuRepository(db);
		const result = await repo.listTranslations(idOrGroup);
		if (!result) {
			return {
				success: false,
				error: { code: "NOT_FOUND", message: "Menu not found" },
			};
		}
		return { success: true, data: result };
	} catch {
		return {
			success: false,
			error: { code: "MENU_TRANSLATIONS_ERROR", message: "Failed to list menu translations" },
		};
	}
}

export type CreateMenuItemInput = CreateMenuItemRepoInput;
export type UpdateMenuItemInput = UpdateMenuItemRepoInput;
export type MenuSetItemsInput = SetMenuItem;

export async function handleMenuItemCreate(
	db: Kysely<Database>,
	menuName: string,
	input: CreateMenuItemInput,
	options: { locale?: string } = {},
): Promise<ApiResult<MenuItem>> {
	try {
		const repo = new MenuRepository(db);
		const resolved = await resolveMenu(repo, menuName, options);
		if (!resolved.success) return resolved;

		const item = await repo.createItem(resolved.menu.id, resolved.menu.locale, input);
		return { success: true, data: item };
	} catch {
		return {
			success: false,
			error: { code: "MENU_ITEM_CREATE_ERROR", message: "Failed to create menu item" },
		};
	}
}

export async function handleMenuItemUpdate(
	db: Kysely<Database>,
	menuName: string,
	itemId: string,
	input: UpdateMenuItemInput,
	options: { locale?: string } = {},
): Promise<ApiResult<MenuItem>> {
	try {
		const repo = new MenuRepository(db);
		const resolved = await resolveMenu(repo, menuName, options);
		if (!resolved.success) return resolved;

		const updated = await repo.updateItem(resolved.menu.id, itemId, input);
		if (!updated) {
			return {
				success: false,
				error: { code: "NOT_FOUND", message: "Menu item not found" },
			};
		}
		return { success: true, data: updated };
	} catch {
		return {
			success: false,
			error: { code: "MENU_ITEM_UPDATE_ERROR", message: "Failed to update menu item" },
		};
	}
}

export async function handleMenuItemDelete(
	db: Kysely<Database>,
	menuName: string,
	itemId: string,
	options: { locale?: string } = {},
): Promise<ApiResult<{ deleted: true }>> {
	try {
		const repo = new MenuRepository(db);
		const resolved = await resolveMenu(repo, menuName, options);
		if (!resolved.success) return resolved;

		const deleted = await repo.deleteItem(resolved.menu.id, itemId);
		if (!deleted) {
			return {
				success: false,
				error: { code: "NOT_FOUND", message: "Menu item not found" },
			};
		}
		return { success: true, data: { deleted: true } };
	} catch {
		return {
			success: false,
			error: { code: "MENU_ITEM_DELETE_ERROR", message: "Failed to delete menu item" },
		};
	}
}

export interface ReorderItem {
	id: string;
	parentId: string | null;
	sortOrder: number;
}

export async function handleMenuSetItems(
	db: Kysely<Database>,
	menuName: string,
	items: MenuSetItemsInput[],
	options: { locale?: string } = {},
): Promise<ApiResult<{ name: string; itemCount: number }>> {
	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		if (item?.parentIndex !== undefined) {
			if (item.parentIndex < 0 || item.parentIndex >= i) {
				return {
					success: false,
					error: {
						code: "VALIDATION_ERROR",
						message: `item[${i}].parentIndex (${item.parentIndex}) must reference an earlier item`,
					},
				};
			}
		}
	}

	try {
		const repo = new MenuRepository(db);
		const resolved = await resolveMenu(repo, menuName, options);
		if (!resolved.success) return resolved;

		const { itemCount } = await repo.setItems(resolved.menu.id, resolved.menu.locale, items);
		return { success: true, data: { name: menuName, itemCount } };
	} catch (error) {
		if (error instanceof MenuGoneError) {
			return {
				success: false,
				error: {
					code: "NOT_FOUND",
					message: `Menu '${menuName}' not found${
						options.locale ? ` in locale '${options.locale}'` : ""
					}`,
				},
			};
		}
		console.error("[emdash] handleMenuSetItems failed:", error);
		return {
			success: false,
			error: { code: "MENU_SET_ITEMS_ERROR", message: "Failed to set menu items" },
		};
	}
}

export async function handleMenuItemReorder(
	db: Kysely<Database>,
	menuName: string,
	items: ReorderItem[],
	options: { locale?: string } = {},
): Promise<ApiResult<MenuItem[]>> {
	try {
		const repo = new MenuRepository(db);
		const resolved = await resolveMenu(repo, menuName, options);
		if (!resolved.success) return resolved;

		const updated = await repo.reorderItems(resolved.menu.id, items);
		return { success: true, data: updated };
	} catch {
		return {
			success: false,
			error: { code: "MENU_REORDER_ERROR", message: "Failed to reorder menu items" },
		};
	}
}
