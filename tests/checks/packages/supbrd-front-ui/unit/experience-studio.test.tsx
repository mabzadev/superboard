import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { ExperienceStudio } from "../../../../../packages/supbrd-front-ui/src/experience-studio.js";

vi.mock(
	"../../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js",
	() => ({
		useProjectSelection: () => ({ selectedProject: undefined, projectType: "test" }),
	}),
);

vi.mock("../../../../../packages/supbrd-front-ui/src/context.js", () => ({
	useFrontContext: () => ({ locale: "fr" }),
}));

it("simulates an onboarding answer and follows the selected branch", () => {
	render(
		<ExperienceStudio
			kind="onboarding"
			initialDocument={{
				schema_version: 1,
				metadata: {},
				theme: {
					accent_color: "#2563eb",
					background_color: "#ffffff",
					text_color: "#111111",
					font_family: "Arial",
					corner_radius: 12,
				},
				screens: [
					{
						id: "question",
						name: "Profil",
						blocks: [
							{
								id: "level",
								type: "question",
								props: {
									text: "Votre niveau",
									attribute: "level",
									options: [
										{ value: "beginner", label: "Débutant", next_screen_id: "beginner" },
										{ value: "advanced", label: "Avancé", next_screen_id: "advanced" },
									],
								},
							},
							{ id: "next", type: "button", props: { text: "Suivant", action: "next" } },
						],
					},
					{
						id: "advanced",
						name: "Expert",
						blocks: [{ id: "expert", type: "heading", props: { text: "Parcours expert" } }],
					},
					{
						id: "beginner",
						name: "Débutant",
						blocks: [{ id: "start", type: "heading", props: { text: "On commence ensemble" } }],
					},
				],
			}}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Simulation" }));
	fireEvent.click(screen.getByRole("button", { name: "Débutant" }));
	fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
	expect(screen.getByText("On commence ensemble")).toBeVisible();
	expect(screen.queryByText("Parcours expert")).not.toBeInTheDocument();
});

it("keeps a required question visible when a completion action is pressed without an answer", () => {
	render(
		<ExperienceStudio
			kind="onboarding"
			initialDocument={{
				schema_version: 1,
				metadata: {},
				theme: {
					accent_color: "#2563eb",
					background_color: "#ffffff",
					text_color: "#111111",
					font_family: "Arial",
					corner_radius: 12,
				},
				screens: [
					{
						id: "profile",
						name: "Profil",
						blocks: [
							{
								id: "goal",
								type: "question",
								props: {
									text: "Votre objectif",
									attribute: "goal",
									required: true,
									options: [{ value: "learn", label: "Apprendre" }],
								},
							},
							{ id: "finish", type: "button", props: { text: "Terminer", action: "complete" } },
						],
					},
				],
			}}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Simulation" }));
	fireEvent.click(screen.getByRole("button", { name: "Terminer" }));
	expect(screen.getByRole("button", { name: "Apprendre" })).toBeVisible();
	expect(screen.queryByText("Parcours terminé")).not.toBeInTheDocument();
});
