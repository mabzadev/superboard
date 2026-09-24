import { canonicalFrontHref } from "@superboard/contracts/front-paths";
import type { applySeed, SeedMenu, SeedMenuItem } from "emdash";

import {
	MenuRepository,
	type MenuItem,
	type SetMenuItem,
} from "../../../../packages/core/src/database/repositories/menu.js";
import legacyAuthenticationMenus from "../../seed/legacy-authentication-menus.json";
import legacyProductMenus from "../../seed/legacy-product-menus.json";
import legacyMenu from "../../seed/legacy-superboard-menu.json";
import { retiredFrontPageDestination } from "./retired-front-pages.js";

const acquisitionMenuPaths = new Set([
	"/acquisition/paywalls",
	"/acquisition/paywalls/statistics",
	"/acquisition/onboardings",
	"/acquisition/onboardings/statistics",
	"/acquisition/workflows",
	"/acquisition/overview",
	"/acquisition/launchpad",
	"/acquisition/components",
	"/acquisition/dynamic-links",
	"/acquisition/dynamic-links/campaigns",
	"/acquisition/dynamic-links/redirect-rules",
	"/acquisition/dynamic-links/domain",
	"/acquisition/dynamic-links/social-media-preview",
	"/acquisition/dynamic-links/tracking",
	"/acquisition/settings",
	"/acquisition/settings/environments",
	"/acquisition/settings/localization",
	"/acquisition/settings/sdk",
]);

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
			JSON.stringify(storedItems(items)) === JSON.stringify(seedItems(legacyMenu.items, false));
		const untouchedProduct = [...legacyProductMenus, ...legacyAuthenticationMenus].some(
			(entry) =>
				entry.locale === locale &&
				JSON.stringify(storedItems(items)) === JSON.stringify(seedItems(entry.items, false)),
		);
		if (menu.label === pendingLabel || untouchedLegacy || untouchedProduct) {
			await repository.setItems(menu.id, locale, seedItems(definition.items));
			await repository.update(menu.id, { label: definition.label });
		} else {
			for (const item of items) {
				if (
					item.parentId &&
					item.customUrl?.startsWith("/support/") &&
					!["/support/inbox", "/support/help-center", "/support/settings"].includes(item.customUrl)
				) {
					const supportParent = items.find(
						(parent) => parent.id === item.parentId && parent.customUrl === "/support/inbox",
					);
					if (supportParent && !items.some((child) => child.parentId === item.id)) {
						await repository.deleteItem(menu.id, item.id);
						continue;
					}
				}

				const retired = retiredFrontPageDestination(item.customUrl ?? "");
				if (retired) {
					if (retired.startsWith("/identity/") || items.some((child) => child.parentId === item.id))
						await repository.updateItem(menu.id, item.id, {
							customUrl: canonicalFrontHref(retired),
						});
					else await repository.deleteItem(menu.id, item.id);
					continue;
				}
				if (item.customUrl) {
					const canonical = canonicalFrontHref(item.customUrl);
					if (canonical !== item.customUrl) {
						await repository.updateItem(menu.id, item.id, { customUrl: canonical });
						item.customUrl = canonical;
					}
				}
				if (item.customUrl === "/support/configuration") {
					if (
						["Support configuration", "Configuration du support"].includes(item.label) &&
						!items.some((child) => child.parentId === item.id)
					)
						await repository.deleteItem(menu.id, item.id);
					else
						await repository.updateItem(menu.id, item.id, {
							customUrl: "/support/settings?tab=inbox",
						});
					continue;
				}
				if (
					item.customUrl === "/acquisition/settings/environments" &&
					["Journey settings", "Paramètres des parcours"].includes(item.label)
				) {
					await repository.updateItem(menu.id, item.id, {
						customUrl: "/acquisition/settings",
						label: locale === "fr" ? "Paramètres" : "Settings",
					});
					continue;
				}
				if (item.customUrl === "/superboard-system/home") {
					await repository.updateItem(menu.id, item.id, { customUrl: "/" });
					continue;
				}
				if (
					(item.customUrl === "/acquisition/paywalls" || item.customUrl === "/paywalls") &&
					item.label === "Subscription screens"
				) {
					await repository.updateItem(menu.id, item.id, { label: "Paywalls" });
					continue;
				}
				if (
					(item.customUrl === "/acquisition/paywalls/statistics" ||
						item.customUrl === "/paywalls/statistics") &&
					item.label === "Subscription screen results"
				) {
					await repository.updateItem(menu.id, item.id, { label: "Paywalls results" });
					continue;
				}
				if (
					(item.customUrl === "/acquisition/workflows" || item.customUrl === "/flows/workflows") &&
					item.label === "Automated scenarios"
				) {
					await repository.updateItem(menu.id, item.id, { label: "Workflows" });
					continue;
				}
				if (item.customUrl === "/flows" && item.label === "Automation overview") {
					await repository.updateItem(menu.id, item.id, { label: "Workflows overview" });
					continue;
				}
				if (
					(item.customUrl === "/acquisition/components" ||
						item.customUrl === "/flows/components") &&
					item.label === "Journey components"
				) {
					await repository.updateItem(menu.id, item.id, { label: "Components" });
					continue;
				}
				if (
					(item.customUrl === "/acquisition/launchpad" || item.customUrl === "/flows/launchpad") &&
					item.label === "Triggers and releases"
				) {
					await repository.updateItem(menu.id, item.id, { label: "Launchpad" });
					continue;
				}
				if (
					(item.customUrl === "/acquisition/dynamic-links" ||
						item.customUrl === "/dynamic-links/links") &&
					(item.label === "Links and attribution" || item.label === "Liens et attribution")
				) {
					await repository.updateItem(menu.id, item.id, {
						label: item.label === "Liens et attribution" ? "Liens dynamiques" : "Dynamic links",
					});
					continue;
				}
				if (item.customUrl === "/support/inbox" && item.label === "Conversations") {
					await repository.updateItem(menu.id, item.id, { label: "Inbox" });
					continue;
				}
				if (item.customUrl === "/support/workforce" && item.label === "Agents and teams") {
					await repository.updateItem(menu.id, item.id, { label: "Workforce" });
					continue;
				}
				if (item.customUrl === "/support/channels" && item.label === "Contact channels") {
					await repository.updateItem(menu.id, item.id, { label: "Channels" });
					continue;
				}
				if (item.customUrl === "/support/automations" && item.label === "Automation rules") {
					await repository.updateItem(menu.id, item.id, { label: "Automations" });
					continue;
				}
				if (item.customUrl === "/support/proactive-support" && item.label === "Proactive help") {
					await repository.updateItem(menu.id, item.id, { label: "Proactive Support" });
					continue;
				}
				if (
					(item.customUrl === "/communication/campaigns" ||
						item.customUrl === "/marketing/campaigns") &&
					(item.label === "Campaigns and newsletters" || item.label === "Campagnes et newsletters")
				) {
					await repository.updateItem(menu.id, item.id, {
						label: item.label === "Campagnes et newsletters" ? "Campagnes" : "Campaigns",
					});
					continue;
				}
				if (
					(item.customUrl === "/communication/marketing-email" ||
						item.customUrl === "/marketing/email") &&
					(item.label === "Email and marketing contacts" ||
						item.label === "E-mails et contacts marketing")
				) {
					await repository.updateItem(menu.id, item.id, {
						label:
							item.label === "E-mails et contacts marketing"
								? "E-mails marketing"
								: "Marketing email",
					});
					continue;
				}
				if (
					(item.customUrl === "/communication/channels" ||
						item.customUrl === "/marketing/channels") &&
					(item.label === "Marketing channels and settings" ||
						item.label === "Canaux et paramètres marketing")
				) {
					await repository.updateItem(menu.id, item.id, {
						label:
							item.label === "Canaux et paramètres marketing"
								? "Canaux marketing"
								: "Marketing channels",
					});
					continue;
				}
				if (
					(item.customUrl === "/communication/email" || item.customUrl === "/system/email") &&
					(item.label === "Transactional deliveries" || item.label === "Envois transactionnels")
				) {
					await repository.updateItem(menu.id, item.id, {
						label: item.label === "Envois transactionnels" ? "E-mails" : "Emails",
					});
					continue;
				}
				const destination = retiredFrontPageDestination(item.customUrl ?? "");
				if (!destination) continue;
				if (
					destination.startsWith("/identity/") ||
					items.some((child) => child.parentId === item.id)
				)
					await repository.updateItem(menu.id, item.id, { customUrl: destination });
				else await repository.deleteItem(menu.id, item.id);
			}
			const acquisition = items.find(
				(item) => item.label === "Acquisition" && item.parentId === null,
			);
			if (acquisition) {
				const acquisitionDefinition = definition.items.find(
					(entry) => entry.label === "Acquisition",
				);
				const expected = acquisitionDefinition?.children ?? [];
				const descendants = new Set<string>();
				const collect = (parentId: string) => {
					for (const item of items.filter((entry) => entry.parentId === parentId)) {
						descendants.add(item.id);
						collect(item.id);
					}
				};
				collect(acquisition.id);
				const kept = new Set<string>();
				let settingsId: string | undefined;
				let previousOrder = -1;
				for (const item of expected) {
					let existing = items.find(
						(entry) =>
							descendants.has(entry.id) && canonicalFrontHref(entry.customUrl ?? "") === item.url,
					);
					const sortOrder = Math.max(previousOrder + 1, existing?.sortOrder ?? 0);
					previousOrder = sortOrder;
					if (!existing)
						existing = await repository.createItem(menu.id, locale, {
							type: "custom",
							label: item.label ?? "",
							customUrl: item.url,
							parentId: acquisition.id,
							sortOrder,
						});
					else if (existing.parentId !== acquisition.id || existing.sortOrder !== sortOrder)
						await repository.updateItem(menu.id, existing.id, {
							parentId: acquisition.id,
							sortOrder,
						});
					kept.add(existing.id);
					if (item.url === "/acquisition/settings") settingsId = existing.id;
				}
				const obsolete = items.filter(
					(item) =>
						descendants.has(item.id) &&
						!kept.has(item.id) &&
						acquisitionMenuPaths.has(canonicalFrontHref(item.customUrl ?? "")),
				);
				const removedIds = new Set(obsolete.map((item) => item.id));
				for (const item of items) {
					if (
						settingsId &&
						descendants.has(item.id) &&
						!removedIds.has(item.id) &&
						!kept.has(item.id) &&
						item.parentId &&
						(item.parentId === acquisition.id || removedIds.has(item.parentId))
					)
						await repository.updateItem(menu.id, item.id, { parentId: settingsId });
				}
				for (const item of obsolete.toReversed()) await repository.deleteItem(menu.id, item.id);
				if (acquisitionDefinition?.url && acquisition.customUrl !== acquisitionDefinition.url)
					await repository.updateItem(menu.id, acquisition.id, {
						customUrl: acquisitionDefinition.url,
					});
			}
			const communicationParent = items.find(
				(item) => item.customUrl === "/communication/campaigns" && item.parentId === null,
			);
			if (communicationParent) {
				const settings = items.find((item) => item.customUrl === "/communication/settings");
				const label = locale === "fr" ? "Paramètres" : "Settings";
				if (!settings) {
					await repository.createItem(menu.id, locale, {
						type: "custom",
						label,
						customUrl: "/communication/settings",
						parentId: communicationParent.id,
					});
				} else if (settings.parentId !== communicationParent.id) {
					const order =
						Math.max(
							-1,
							...items
								.filter((item) => item.parentId === communicationParent.id)
								.map((item) => item.sortOrder),
						) + 1;
					await repository.updateItem(menu.id, settings.id, {
						parentId: communicationParent.id,
						sortOrder: order,
						...(["Marketing settings", "Paramètres marketing"].includes(settings.label)
							? { label }
							: {}),
					});
				}
			}
			if (communicationParent) {
				const entries = [
					["/communication/campaigns", locale === "fr" ? "E-mails de campagne" : "Campaign email"],
					[
						"/communication/email",
						locale === "fr" ? "E-mails transactionnels" : "Transactional email",
					],
					[
						"/communication/in-app-messages",
						locale === "fr" ? "Messages dans l’application" : "In-app messages",
					],
					["/communication/settings", locale === "fr" ? "Paramètres" : "Settings"],
				] as const;
				const retained = new Set(entries.map(([path]) => path as string));
				for (const child of items.filter(
					(item) =>
						item.customUrl?.startsWith("/communication/") &&
						item.id !== communicationParent.id &&
						!retained.has(item.customUrl),
				)) {
					await repository.deleteItem(menu.id, child.id);
				}
				for (const [sortOrder, [customUrl, label]] of entries.entries()) {
					const child = items.find(
						(item) => item.customUrl === customUrl && item.id !== communicationParent.id,
					);
					if (child)
						await repository.updateItem(menu.id, child.id, {
							label,
							parentId: communicationParent.id,
							sortOrder,
						});
					else if (customUrl !== "/communication/settings")
						await repository.createItem(menu.id, locale, {
							type: "custom",
							label,
							customUrl,
							parentId: communicationParent.id,
							sortOrder,
						});
				}
			}

			const analyticsParent = items.find(
				(item) =>
					item.customUrl === "/analytics" &&
					item.parentId === null &&
					(item.label === "Analytics" || item.cssClasses === "sb-icon-analytics"),
			);
			if (analyticsParent) {
				const settings = items.find((item) => item.customUrl === "/analytics/settings");
				const label = locale === "fr" ? "Paramètres" : "Settings";
				if (!settings) {
					await repository.createItem(menu.id, locale, {
						type: "custom",
						label,
						customUrl: "/analytics/settings",
						parentId: analyticsParent.id,
					});
				} else if (settings.parentId !== analyticsParent.id) {
					const order =
						Math.max(
							-1,
							...items
								.filter((item) => item.parentId === analyticsParent.id)
								.map((item) => item.sortOrder),
						) + 1;
					await repository.updateItem(menu.id, settings.id, {
						parentId: analyticsParent.id,
						sortOrder: order,
						...(["Statistics settings", "Paramètres des statistiques"].includes(settings.label)
							? { label }
							: {}),
					});
				}
			}
			const authenticationSettings = items.find((item) =>
				item.customUrl?.startsWith("/auth/settings?"),
			);
			const authenticationActivity = items.find(
				(item) =>
					item.customUrl?.startsWith("/auth/logs?") &&
					item.parentId === authenticationSettings?.parentId,
			);
			if (
				authenticationSettings &&
				authenticationActivity &&
				authenticationSettings.sortOrder < authenticationActivity.sortOrder
			) {
				await repository.updateItem(menu.id, authenticationSettings.id, {
					sortOrder: authenticationActivity.sortOrder,
				});
				await repository.updateItem(menu.id, authenticationActivity.id, {
					sortOrder: authenticationSettings.sortOrder,
				});
			}
			const supportSettings = items.find((item) => item.customUrl === "/support/settings");
			if (
				supportSettings &&
				["Support settings", "Paramètres du support"].includes(supportSettings.label)
			) {
				await repository.updateItem(menu.id, supportSettings.id, {
					label: locale === "fr" ? "Paramètres" : "Settings",
				});
			}
			const supportParent = items.find(
				(item) => item.customUrl === "/support/inbox" && item.parentId === null,
			);
			if (supportParent && !items.some((item) => item.customUrl === "/support/settings")) {
				await repository.createItem(menu.id, locale, {
					type: "custom",
					label: locale === "fr" ? "Paramètres" : "Settings",
					customUrl: "/support/settings",
					parentId: supportParent.id,
				});
			}
			const dataParent = items.find((i) => i.customUrl === "/data/content" && i.parentId === null);
			if (dataParent && !items.some((i) => i.customUrl === "/data/settings")) {
				await repository.createItem(menu.id, locale, {
					type: "custom",
					label: locale === "fr" ? "Paramètres" : "Settings",
					customUrl: "/data/settings",
					parentId: dataParent.id,
				});
			}
			const monetizationParent = items.find(
				(i) => i.customUrl === "/monetization/customers" && i.parentId === null,
			);
			if (monetizationParent && !items.some((i) => i.customUrl === "/monetization/settings")) {
				await repository.createItem(menu.id, locale, {
					type: "custom",
					label: locale === "fr" ? "Paramètres" : "Settings",
					customUrl: "/monetization/settings",
					parentId: monetizationParent.id,
				});
			}
		}
	}
}

function seedItems(items: readonly SeedMenuItem[], canonical = true): SetMenuItem[] {
	const result: SetMenuItem[] = [];
	const visit = (entries: readonly SeedMenuItem[], parentIndex?: number) => {
		for (const entry of entries) {
			if (entry.type !== "custom") throw new Error("Front menu seed entries must be custom links");
			const index = result.length;
			result.push({
				type: entry.type,
				label: entry.label ?? "",
				...(entry.url ? { customUrl: canonical ? canonicalFrontHref(entry.url) : entry.url } : {}),
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
