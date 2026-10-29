import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import {
	createStudioDocument,
	ExperienceStudio,
} from "../../../../../packages/supbrd-front-ui/src/experience-studio.js";

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
	const preview = within(screen.getByLabelText("Canevas du parcours"));
	expect(preview.getByText("On commence ensemble")).toBeVisible();
	expect(preview.queryByText("Parcours expert")).not.toBeInTheDocument();
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

it("edits a paywall from its layers and restores the content with undo and redo", () => {
	render(
		<ExperienceStudio kind="paywall" initialDocument={createStudioDocument("paywall", "fr")} />,
	);
	const layers = within(screen.getByRole("complementary", { name: "Structure" }));
	fireEvent.click(layers.getByRole("button", { name: "Profitez de toute l’expérience" }));
	fireEvent.change(screen.getByRole("textbox", { name: "Texte", exact: true }), {
		target: { value: "Votre nouvelle offre" },
	});
	expect(screen.getByRole("heading", { name: "Votre nouvelle offre" })).toBeVisible();
	fireEvent.click(screen.getByRole("button", { name: "Annuler", exact: true }));
	expect(screen.getByRole("heading", { name: "Profitez de toute l’expérience" })).toBeVisible();
	fireEvent.click(screen.getByRole("button", { name: "Rétablir", exact: true }));
	expect(screen.getByRole("heading", { name: "Votre nouvelle offre" })).toBeVisible();
	fireEvent.change(screen.getByLabelText("Nom du calque"), {
		target: { value: "Accroche principale" },
	});
	expect(layers.getByRole("button", { name: "Accroche principale" })).toBeVisible();
	expect(screen.getByRole("heading", { name: "Votre nouvelle offre" })).toBeVisible();
});

it("adds and reorders paywall components without losing their content", () => {
	render(
		<ExperienceStudio kind="paywall" initialDocument={createStudioDocument("paywall", "fr")} />,
	);
	const layers = within(screen.getByRole("complementary", { name: "Structure" }));
	fireEvent.click(layers.getByRole("button", { name: "Ajouter", exact: true }));
	fireEvent.change(screen.getByLabelText("Rechercher un composant"), {
		target: { value: "Titre" },
	});
	fireEvent.click(layers.getByRole("button", { name: "Titre", exact: true }));
	fireEvent.change(screen.getByRole("textbox", { name: "Texte", exact: true }), {
		target: { value: "Une seconde accroche" },
	});
	expect(screen.getAllByRole("group", { name: "Titre", exact: true })).toHaveLength(2);
	fireEvent.click(layers.getAllByRole("button", { name: "Monter", exact: true }).at(-1)!);
	const canvas = screen.getByLabelText("Canevas du paywall");
	expect(within(canvas).getAllByRole("group").at(-2)).toHaveTextContent("Une seconde accroche");
	const headings = within(canvas).getAllByRole("heading");
	expect(headings.map((heading) => heading.textContent)).toEqual([
		"Profitez de toute l’expérience",
		"Une seconde accroche",
	]);
	fireEvent.click(screen.getByRole("button", { name: "Supprimer", exact: true }));
	expect(within(canvas).queryByText("Une seconde accroche")).not.toBeInTheDocument();
	expect(
		within(canvas).getByRole("heading", { name: "Profitez de toute l’expérience" }),
	).toBeVisible();
});

it("simulates a paywall purchase without changing its saved document", () => {
	const changes = vi.fn();
	render(
		<ExperienceStudio
			kind="paywall"
			initialDocument={createStudioDocument("paywall", "fr")}
			onChange={changes}
		/>,
	);
	const initialChanges = changes.mock.calls.length;
	const initialZoom = Number.parseInt(screen.getByLabelText("Zoom").textContent ?? "0");
	fireEvent.click(screen.getByRole("button", { name: "Agrandir", exact: true }));
	expect(Number.parseInt(screen.getByLabelText("Zoom").textContent ?? "0")).toBeGreaterThan(
		initialZoom,
	);
	fireEvent.click(screen.getByRole("button", { name: "Recentrer le canevas", exact: true }));
	expect(Number.parseInt(screen.getByLabelText("Zoom").textContent ?? "0")).toBe(initialZoom);
	fireEvent.click(screen.getByRole("button", { name: "Simulation", exact: true }));
	fireEvent.click(
		within(screen.getByLabelText("Canevas du paywall")).getByRole("button", {
			name: "Choisir ma formule",
			exact: true,
		}),
	);
	expect(screen.getByText("Simulation d’achat")).toBeVisible();
	expect(changes).toHaveBeenCalledTimes(initialChanges);
});

it("moves a heading by dragging its preview and undoes the complete move", () => {
	render(
		<ExperienceStudio kind="paywall" initialDocument={createStudioDocument("paywall", "fr")} />,
	);
	const preview = within(screen.getByLabelText("Canevas du paywall"));
	const heading = preview.getByRole("group", { name: "Titre", exact: true });
	const product = preview.getByRole("group", { name: "Offre", exact: true });
	const values = new Map<string, string>();
	const dataTransfer = {
		setData: (key: string, value: string) => {
			values.set(key, value);
		},
		getData: (key: string) => values.get(key) ?? "",
		effectAllowed: "all",
	};
	fireEvent.dragStart(heading, { dataTransfer });
	fireEvent.dragOver(product, { dataTransfer, clientY: 1 });
	fireEvent.drop(product, { dataTransfer, clientY: 1 });
	expect(
		preview
			.getAllByRole("group")
			.map((node) => node.getAttribute("aria-label"))
			.slice(0, 3),
	).toEqual(["Texte", "Offre", "Titre"]);
	fireEvent.click(screen.getByRole("button", { name: "Annuler", exact: true }));
	expect(preview.getAllByRole("group")[0]).toHaveAccessibleName("Titre");
});

it("chooses a font from the selector and applies it to the device preview", async () => {
	const user = userEvent.setup();
	render(
		<ExperienceStudio kind="paywall" initialDocument={createStudioDocument("paywall", "fr")} />,
	);
	await user.click(screen.getByRole("combobox", { name: "Police", exact: true }));
	await user.click(screen.getByRole("option", { name: "Georgia", exact: true }));
	expect(screen.getByLabelText("Écran de l’appareil")).toHaveStyle({ fontFamily: "Georgia" });
	expect(screen.getByRole("heading", { name: "Profitez de toute l’expérience" })).toHaveStyle({
		fontFamily: "Georgia",
	});
});

it("moves the selected preview with a pointer gesture and cancels a drop outside the editor", () => {
	render(
		<ExperienceStudio kind="paywall" initialDocument={createStudioDocument("paywall", "fr")} />,
	);
	const preview = within(screen.getByLabelText("Canevas du paywall"));
	const heading = preview.getByRole("group", { name: "Titre", exact: true });
	const product = preview.getByRole("group", { name: "Offre", exact: true });
	Object.defineProperties(heading, {
		setPointerCapture: { value: () => {} },
		hasPointerCapture: { value: () => false },
	});
	const original = Object.getOwnPropertyDescriptor(document, "elementsFromPoint");
	let hit: Element[] = [product];
	Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => hit });
	const pointer = (type: string, y: number) => {
		fireEvent(heading, new MouseEvent(type, { bubbles: true, button: 0, clientX: 10, clientY: y }));
	};
	try {
		pointer("pointerdown", 10);
		pointer("pointermove", 80);
		pointer("pointerup", 80);
		expect(
			preview
				.getAllByRole("group")
				.slice(0, 3)
				.map((node) => node.getAttribute("aria-label")),
		).toEqual(["Texte", "Offre", "Titre"]);
		fireEvent.click(screen.getByRole("button", { name: "Annuler", exact: true }));
		expect(preview.getAllByRole("group")[0]).toHaveAccessibleName("Titre");
		hit = [];
		pointer("pointerdown", 10);
		pointer("pointermove", 80);
		pointer("pointerup", 80);
		expect(preview.getAllByRole("group")[0]).toHaveAccessibleName("Titre");
	} finally {
		if (original) Object.defineProperty(document, "elementsFromPoint", original);
		else Reflect.deleteProperty(document, "elementsFromPoint");
	}
});

it("adds screens, reorders the journey and restores the original order with undo", () => {
	const changes = vi.fn();
	render(
		<ExperienceStudio
			kind="onboarding"
			initialDocument={createStudioDocument("onboarding", "fr")}
			onChange={changes}
		/>,
	);
	const sidebar = within(screen.getByRole("complementary", { name: "Écrans du parcours" }));
	fireEvent.click(sidebar.getByRole("button", { name: "Ajouter un écran" }));
	fireEvent.change(screen.getByLabelText("Nom de l’écran"), { target: { value: "Objectifs" } });
	expect(sidebar.getByRole("button", { name: "2. Objectifs" })).toBeVisible();
	fireEvent.click(sidebar.getAllByRole("button", { name: "Monter l’écran" })[1]!);
	expect(changes.mock.lastCall?.[0].screens.map((item: { name: string }) => item.name)).toEqual([
		"Objectifs",
		"Bienvenue",
	]);
	fireEvent.click(screen.getByRole("button", { name: "Annuler", exact: true }));
	expect(changes.mock.lastCall?.[0].screens.map((item: { name: string }) => item.name)).toEqual([
		"Bienvenue",
		"Objectifs",
	]);
	fireEvent.click(sidebar.getByRole("button", { name: "1. Bienvenue" }));
	expect(
		within(screen.getByLabelText("Canevas du parcours")).getByRole("heading", {
			name: "Bienvenue, faisons connaissance",
		}),
	).toBeVisible();
});

it("edits onboarding elements and their styles without changing other screens", () => {
	const changes = vi.fn();
	render(
		<ExperienceStudio
			kind="onboarding"
			initialDocument={createStudioDocument("onboarding", "fr")}
			onChange={changes}
		/>,
	);
	const preview = within(screen.getByLabelText("Canevas du parcours"));
	fireEvent.click(preview.getByRole("heading"));
	fireEvent.change(screen.getByRole("textbox", { name: "Texte", exact: true }), {
		target: { value: "Votre parcours" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Styles", exact: true }));
	expect(
		screen.getByRole("textbox", { name: "Texte", exact: true, hidden: true }),
	).not.toBeVisible();
	fireEvent.change(screen.getByRole("spinbutton", { name: "Taille du texte" }), {
		target: { value: "42" },
	});
	expect(preview.getByRole("heading", { name: "Votre parcours" })).toHaveStyle({
		fontSize: "42px",
	});
	fireEvent.click(screen.getByRole("button", { name: "Éléments", exact: true }));
	const layers = within(screen.getByRole("complementary", { name: "Structure" }));
	fireEvent.click(layers.getByRole("button", { name: "Ajouter", exact: true }));
	fireEvent.click(layers.getByRole("button", { name: "Question", exact: true }));
	expect(preview.getByRole("group", { name: "Question", exact: true })).toBeVisible();
	expect(changes.mock.lastCall?.[0].screens[0].blocks.at(-1).type).toBe("question");
});
