"use client";

import { useMemo, type ReactNode } from "react";

import { useOptionalFrontContext } from "../../../context.js";
import { createFrontI18n } from "../../../i18n.js";
import { SectionNavigation } from "../../../section-navigation.js";
import { getApiErrorMessage, getErrorMessage } from "../../lib/ApiError.js";
import { componentLocale } from "../../lib/component-i18n.js";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert.js";

const french: Record<string, string> = {
	"Unable to load this module": "Impossible de charger ce module",
	"Select a project to manage this module.": "Sélectionnez un projet pour gérer ce module.",
	"An unexpected error occurred.": "Une erreur inattendue s’est produite.",
	"Invalid request. Please check your input.":
		"Requête invalide. Vérifiez les informations saisies.",
	"Authentication is required to perform this action.":
		"Une authentification est nécessaire pour effectuer cette action.",
	"You don't have permission to perform this action.":
		"Vous n’avez pas l’autorisation d’effectuer cette action.",
	"The requested resource was not found.": "La ressource demandée est introuvable.",
	"This action conflicts with the current state.":
		"Cette action est incompatible avec l’état actuel.",
	"The provided data is invalid.": "Les données fournies sont invalides.",
	"Too many requests. Please try again later.": "Trop de requêtes. Réessayez plus tard.",
	"Server error. Please try again later.": "Erreur du serveur. Réessayez plus tard.",
};

function moduleI18n(locale: string) {
	return createFrontI18n({
		locale,
		messages: {
			[locale]:
				locale === "fr"
					? french
					: Object.fromEntries(Object.keys(french).map((message) => [message, message])),
		},
	});
}

export function moduleErrorMessage(
	error: unknown,
	locale: string | undefined = globalThis.document?.documentElement.lang,
): string {
	const resolved = componentLocale(locale);
	const generic = resolved === "fr" ? getApiErrorMessage(error) : undefined;
	const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
	const message =
		generic ??
		(error instanceof Error
			? error.message
			: typeof status === "number"
				? getErrorMessage(status)
				: "An unexpected error occurred.");
	return Object.hasOwn(french, message) ? moduleI18n(resolved)._(message) : message;
}

export function ModulePage({
	title,
	description,
	error,
	children,
}: {
	title: string;
	description: string;
	error?: string | null;
	children: ReactNode;
}) {
	const locale = useOptionalFrontContext()?.locale ?? "en";
	const i18n = useMemo(() => moduleI18n(locale), [locale]);
	return (
		<div className="ds-page space-y-5">
			<header className="ds-page-header">
				<div>
					<h1 className="ds-page-title">{title}</h1>
					<p className="ds-page-description">{description}</p>
				</div>
			</header>
			<SectionNavigation />
			{error && (
				<Alert variant="destructive">
					<AlertTitle>{i18n._("Unable to load this module")}</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}
			{children}
		</div>
	);
}

export function EmptyProject() {
	const locale = useOptionalFrontContext()?.locale ?? "en";
	const i18n = useMemo(() => moduleI18n(locale), [locale]);
	return (
		<div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
			{i18n._("Select a project to manage this module.")}
		</div>
	);
}
