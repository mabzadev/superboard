import type { applySeed, SeedMenu, SeedMenuItem } from "emdash";

import {
	MenuRepository,
	type MenuItem,
	type SetMenuItem,
} from "../../../../packages/core/src/database/repositories/menu.js";
import legacyMenu from "../../seed/legacy-superboard-menu.json";

const pendingLabel = "superboard-front-menu:initializing";

export async function ensureNativeFrontMenus(
	db: Parameters<typeof applySeed>[0],
	menus: readonly SeedMenu[],
) {
	const repository = new MenuRepository(db);
	let sourceId: string | undefined;
	for (const definition of menus) {
		const locale = definition.locale ?? "en";
		let menu = (await repository.findByName(definition.name, { locale }))[0];
		if (!menu)
			menu = await repository.create({
				name: definition.name,
				label: pendingLabel,
				locale,
				...(sourceId ? { translationOf: sourceId } : {}),
			});
		if (locale === "en") sourceId = menu.id;
		const items = await repository.findItems(menu.id);
		const untouchedLegacy =
			locale === "en" &&
			menu.label === legacyMenu.label &&
			JSON.stringify(storedItems(items)) === JSON.stringify(seedItems(legacyMenu.items));
		if (menu.label === pendingLabel || untouchedLegacy) {
			await repository.setItems(menu.id, locale, seedItems(definition.items));
			await repository.update(menu.id, { label: definition.label });
		}
	}
}

function seedItems(items: readonly SeedMenuItem[]): SetMenuItem[] {
	const result: SetMenuItem[] = [];
	const visit = (entries: readonly SeedMenuItem[], parentIndex?: number) => {
		for (const entry of entries) {
			if (entry.type !== "custom") throw new Error("Front menu seed entries must be custom links");
			const index = result.length;
			result.push({
				type: entry.type,
				label: entry.label ?? "",
				...(entry.url ? { customUrl: entry.url } : {}),
				...(entry.target ? { target: entry.target } : {}),
				...(entry.titleAttr ? { titleAttr: entry.titleAttr } : {}),
				...(entry.cssClasses ? { cssClasses: entry.cssClasses } : {}),
				...(parentIndex !== undefined ? { parentIndex } : {}),
			});
			visit(entry.children ?? [], index);
		}
	};
	visit(items);
	return result;
}

function storedItems(
	items: readonly MenuItem[],
): Array<Omit<SetMenuItem, "type"> & { type: string }> {
	const result: Array<Omit<SetMenuItem, "type"> & { type: string }> = [];
	const visit = (parentId: string | null, parentIndex?: number) => {
		for (const item of items.filter((entry) => entry.parentId === parentId)) {
			const index = result.length;
			result.push({
				type: item.type,
				label: item.label,
				...(item.customUrl ? { customUrl: item.customUrl } : {}),
				...(item.target ? { target: item.target } : {}),
				...(item.titleAttr ? { titleAttr: item.titleAttr } : {}),
				...(item.cssClasses ? { cssClasses: item.cssClasses } : {}),
				...(item.referenceCollection ? { referenceCollection: item.referenceCollection } : {}),
				...(item.referenceId ? { referenceId: item.referenceId } : {}),
				...(parentIndex !== undefined ? { parentIndex } : {}),
			});
			visit(item.id, index);
		}
	};
	visit(null);
	return result;
}
