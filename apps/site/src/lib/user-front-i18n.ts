import { setupI18n } from "@lingui/core";

import {
	USER_FRONT_CATALOGS,
	type UserFrontLocale,
	type UserFrontMessageId,
} from "./user-front-catalogs.js";

export { USER_FRONT_CATALOGS } from "./user-front-catalogs.js";
export type { UserFrontLocale, UserFrontMessageId } from "./user-front-catalogs.js";

export function createUserFrontI18n(locale: UserFrontLocale) {
	return setupI18n({ locale, messages: { [locale]: USER_FRONT_CATALOGS[locale] } });
}

export function resolveUserFrontLocale(value: string | null): UserFrontLocale {
	return value?.toLowerCase().startsWith("fr") ? "fr" : "en";
}

export function userFrontMessage(locale: UserFrontLocale, id: UserFrontMessageId): string {
	return createUserFrontI18n(locale)._(id);
}
