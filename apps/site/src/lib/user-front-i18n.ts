import { setupI18n } from "@lingui/core";

import {
	USER_FRONT_CATALOGS,
	type UserFrontLocale,
	type UserFrontMessageId,
} from "./user-front-catalogs.js";

export { USER_FRONT_CATALOGS } from "./user-front-catalogs.js";
export type { UserFrontLocale, UserFrontMessageId } from "./user-front-catalogs.js";

export const FRONT_LOCALE_COOKIE = "superboard-locale";
const identityPath = /^(\/(?:superboard-preview\/[^/]+\/)?identity\/)(?:en|fr|ar)(?=\/|[?#]|$)/u;
const identityLocale = /^\/(?:superboard-preview\/[^/]+\/)?identity\/(en|fr)(?=\/|$)/u;

export function isUserFrontLocale(value: unknown): value is UserFrontLocale {
	return value === "en" || value === "fr";
}

export function localizeFrontPath(path: string, locale: UserFrontLocale): string {
	return path.replace(identityPath, `$1${locale}`);
}

export function resolveUserFrontRequestLocale(request: Request): UserFrontLocale {
	const url = new URL(request.url);
	const explicit = url.searchParams.get("lang");
	if (isUserFrontLocale(explicit)) return explicit;
	const cookie = request.headers
		.get("cookie")
		?.split(";")
		.map((entry) => entry.trim())
		.find((entry) => entry.startsWith(`${FRONT_LOCALE_COOKIE}=`))
		?.slice(FRONT_LOCALE_COOKIE.length + 1);
	if (isUserFrontLocale(cookie)) return cookie;
	const pathLocale = identityLocale.exec(url.pathname)?.[1];
	if (isUserFrontLocale(pathLocale)) return pathLocale;
	return resolveUserFrontLocale(request.headers.get("accept-language"));
}

export function createUserFrontI18n(locale: UserFrontLocale) {
	return setupI18n({ locale, messages: { [locale]: USER_FRONT_CATALOGS[locale] } });
}

export function resolveUserFrontLocale(value: string | null): UserFrontLocale {
	const languages = (value ?? "")
		.split(",")
		.map((entry) => {
			const [tag, ...parameters] = entry.trim().toLowerCase().split(";");
			const weight = parameters
				.map((parameter) => parameter.trim())
				.find((parameter) => parameter.startsWith("q="));
			return { locale: tag?.split("-")[0], quality: weight ? Number(weight.slice(2)) : 1 };
		})
		.filter(({ locale, quality }) => isUserFrontLocale(locale) && quality > 0 && quality <= 1)
		.toSorted((first, second) => second.quality - first.quality);
	const locale = languages[0]?.locale;
	return isUserFrontLocale(locale) ? locale : "en";
}

export function userFrontMessage(locale: UserFrontLocale, id: UserFrontMessageId): string {
	return createUserFrontI18n(locale)._(id);
}
