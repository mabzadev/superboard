import { afterEach, describe, expect, it } from "vitest";

import { moduleErrorMessage } from "../../../../../../../../packages/supbrd-front-ui/src/shared/components/modules/ModulePage.js";
import { ApiError } from "../../../../../../../../packages/supbrd-front-ui/src/shared/lib/ApiError.js";

function serverError(status: number, code: string, message: string) {
	return new ApiError(message, status, code, { error: { code, message } });
}

describe("moduleErrorMessage", () => {
	afterEach(() => {
		document.documentElement.lang = "";
	});

	describe("in French", () => {
		it.each([
			[404, "customer_not_found", "Customer not found", "La ressource demandée est introuvable."],
			[404, "NOT_FOUND", "Content item not found: 01J8", "La ressource demandée est introuvable."],
			[
				403,
				"FORBIDDEN",
				"Insufficient permissions",
				"Vous n’avez pas l’autorisation d’effectuer cette action.",
			],
			[
				409,
				"SLUG_CONFLICT",
				"Slug already in use",
				"Cette action est incompatible avec l’état actuel.",
			],
			[422, "VALIDATION_ERROR", "name is required", "Les données fournies sont invalides."],
			[
				400,
				"stripe_amount_invalid",
				"Amount must be positive",
				"Requête invalide. Vérifiez les informations saisies.",
			],
			[429, "RATE_LIMITED", "Slow down", "Trop de requêtes. Réessayez plus tard."],
			[
				500,
				"CONTENT_LIST_ERROR",
				"Failed to list content",
				"Erreur du serveur. Réessayez plus tard.",
			],
			[
				401,
				"UNAUTHORIZED",
				"Unauthorized",
				"Une authentification est nécessaire pour effectuer cette action.",
			],
		])(
			"shows the generic message for a %i %s error instead of the server text",
			(status, code, message, expected) => {
				expect(moduleErrorMessage(serverError(status, code, message), "fr")).toBe(expected);
			},
		);

		it("recognizes a known error code when the status is missing", () => {
			expect(moduleErrorMessage(new ApiError("Too many requests", 0, "RATE_LIMITED"), "fr")).toBe(
				"Trop de requêtes. Réessayez plus tard.",
			);
		});

		it("reads the code and status of an HTTP client error", () => {
			const error = Object.assign(new Error("Request failed with status code 404"), {
				response: {
					status: 404,
					data: { error: { code: "paywall_not_found", message: "Paywall not found" } },
				},
			});
			expect(moduleErrorMessage(error, "fr")).toBe("La ressource demandée est introuvable.");
		});

		it("keeps the server text when neither the code nor the status is known", () => {
			expect(moduleErrorMessage(serverError(418, "teapot", "I'm a teapot"), "fr")).toBe(
				"I'm a teapot",
			);
		});

		it("keeps messages written by the dashboard itself", () => {
			expect(moduleErrorMessage(new Error("Le fichier CSV est vide."), "fr")).toBe(
				"Le fichier CSV est vide.",
			);
		});

		it("follows the dashboard language when no locale is given", () => {
			document.documentElement.lang = "fr";
			expect(moduleErrorMessage(serverError(404, "customer_not_found", "Customer not found"))).toBe(
				"La ressource demandée est introuvable.",
			);
		});
	});

	describe("in English", () => {
		it("keeps the server message", () => {
			expect(
				moduleErrorMessage(serverError(404, "customer_not_found", "Customer not found"), "en"),
			).toBe("Customer not found");
			expect(
				moduleErrorMessage(serverError(404, "NOT_FOUND", "Content item not found: 01J8"), "en"),
			).toBe("Content item not found: 01J8");
		});

		it("keeps the server message when the dashboard language is unknown", () => {
			expect(moduleErrorMessage(serverError(403, "FORBIDDEN", "Insufficient permissions"))).toBe(
				"Insufficient permissions",
			);
		});

		it("describes an HTTP status that came without a message", () => {
			expect(moduleErrorMessage({ response: { status: 404 } }, "en")).toBe(
				"The requested resource was not found.",
			);
		});
	});
});
